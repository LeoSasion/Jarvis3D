using System.IO;
using System.Text.Json;
using Jarvis.Host.Services;

namespace Jarvis.Host.Agents;

// JARVIS owns local transcripts independently of a provider's runtime/session format.
internal sealed class AgentConversationStore
{
    internal const int MaximumConversations = 40;
    internal const int MaximumMessages = 100;
    internal const int MaximumCharacters = 40_000;
    private const int MaximumBytes = 256 * 1024;
    private readonly string _directory;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { MaxDepth = 12 };

    public AgentConversationStore(string? directory = null) =>
        _directory = Path.GetFullPath(directory ?? Path.Combine(ConfigurationPreferencesStore.DefaultDirectory, "Conversations"));

    public IReadOnlyList<AgentConversationInfo> List() => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
        (IReadOnlyList<AgentConversationInfo>)ReadAll().Select(Describe).OrderByDescending(value => value.UpdatedAtUtc).ToArray());

    public AgentConversationDocument Read(string id) => AtomicJsonSettingsStore.WithFolderLock(_directory, () => ReadCore(id));

    public AgentConversationInfo Save(JsonElement value) => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        var document = value.Deserialize<AgentConversationDocument>(Options) ?? throw new InvalidDataException("A conversation is required.");
        Validate(document);
        var path = PathFor(document.Id);
        var revision = File.Exists(path) ? ReadCore(document.Id).Revision : 0;
        if (revision != document.Revision) throw new InvalidOperationException("The saved conversation changed in another window. Reload it before saving.");
        document = document with { UpdatedAtUtc = DateTimeOffset.UtcNow, Revision = revision + 1 };
        Write(document);
        foreach (var old in ReadAll().OrderByDescending(entry => entry.UpdatedAtUtc).Skip(MaximumConversations))
            DeleteCore(old.Id);
        return Describe(document);
    });

    public AgentConversationInfo Rename(string id, string title) => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        var current = ReadCore(id);
        var document = current with { Title = title.Trim(), Revision = current.Revision + 1 };
        Validate(document);
        Write(document);
        return Describe(document);
    });

    public bool Delete(string id) => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        var path = PathFor(id);
        if (!File.Exists(path)) return false;
        DeleteCore(id);
        return true;
    });

    private void DeleteCore(string id)
    {
        var path = PathFor(id);
        File.Delete(path);
        if (File.Exists(path + ".bak")) File.Delete(path + ".bak");
    }

    private AgentConversationDocument[] ReadAll()
    {
        if (!Directory.Exists(_directory)) return [];
        var result = new List<AgentConversationDocument>();
        foreach (var path in Directory.EnumerateFiles(_directory, "*.json").Take(MaximumConversations * 2 + 1))
        {
            try { result.Add(ReadCore(Path.GetFileNameWithoutExtension(path))); }
            catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException)
            {
                // Keep damaged entries on disk for recovery; one bad transcript cannot hide the others.
            }
        }
        return result.ToArray();
    }

    private AgentConversationDocument ReadCore(string id)
    {
        var path = PathFor(id);
        if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) throw new InvalidDataException("Linked conversations are not allowed.");
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaximumBytes) throw new InvalidDataException("Conversation exceeds the storage limit.");
        var document = JsonSerializer.Deserialize<AgentConversationDocument>(stream, Options) ?? throw new InvalidDataException("Invalid conversation.");
        Validate(document);
        if (document.Id != id) throw new InvalidDataException("Conversation identity mismatch.");
        return document;
    }

    private void Write(AgentConversationDocument document)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(document, Options);
        if (bytes.Length > MaximumBytes) throw new InvalidDataException("Conversation exceeds the storage limit.");
        Directory.CreateDirectory(_directory);
        var path = PathFor(document.Id);
        if (File.Exists(path) && File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Linked conversations are not allowed.");
        AtomicJsonSettingsStore.WriteDurably(path, bytes, backup: true);
    }

    private string PathFor(string id)
    {
        if (id.Length != 32 || id.Any(character => !char.IsAsciiHexDigit(character))) throw new ArgumentException("Invalid conversation identifier.");
        return Path.Combine(_directory, id + ".json");
    }

    private static void Validate(AgentConversationDocument document)
    {
        if (document.Id is null || document.Id.Length != 32 || document.Id.Any(character => !char.IsAsciiHexDigit(character)) ||
            string.IsNullOrWhiteSpace(document.Title) || document.Title.Length > 80 || document.Title.Any(char.IsControl) ||
            document.Provider is null || document.Provider.Length > 64 || document.Messages is null ||
            document.Revision < 0 || document.Revision == long.MaxValue || document.Messages.Count > MaximumMessages || document.Messages.Any(value => value is null) ||
            document.Messages.Sum(value => (long)(value.Text?.Length ?? 0)) > MaximumCharacters)
            throw new InvalidDataException("Invalid or oversized conversation.");
        foreach (var message in document.Messages)
            if (message is null || message.Role is not ("user" or "assistant") || message.Id is null || message.Id.Length > 160 ||
                message.Text is null || message.Text.Length > 16_000 || message.Status is not ("complete" or "error" or "aborted"))
                throw new InvalidDataException("Invalid conversation message.");
    }

    private static AgentConversationInfo Describe(AgentConversationDocument document) => new(
        document.Id, document.Title, document.Provider, document.UpdatedAtUtc, document.Messages.Count, document.Truncated, document.Revision);
}

internal sealed record AgentConversationDocument(string Id, string Title, string Provider, DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<AgentConversationMessage> Messages, bool Truncated = false, long Revision = 0);
internal sealed record AgentConversationMessage(string Id, string Role, string Text, string Status, string? CreatedAt);
internal sealed record AgentConversationInfo(string Id, string Title, string Provider, DateTimeOffset UpdatedAtUtc, int MessageCount, bool Truncated, long Revision);
