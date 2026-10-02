using System.IO;
using System.Text.Json;

namespace Jarvis.Host.Services;

// The journal is a commit barrier: until it is removed, every settings reader
// restores the exact pre-transaction bytes. Never expose a half-restored pair.
internal static class SettingsRestoreTransaction
{
    private const string JournalName = ".configuration-restore.json";
    private const int MaximumJournalBytes = 384 * 1024;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    internal static void Begin(string directory, byte[] graph, byte[] preferences)
    {
        Validate(graph, preferences);
        var journal = JsonSerializer.SerializeToUtf8Bytes(new RestoreJournal(1,
            Convert.ToBase64String(graph), Convert.ToBase64String(preferences)), Options);
        AtomicJsonSettingsStore.WriteDurably(Path.Combine(directory, JournalName), journal, backup: false);
    }

    internal static void Commit(string directory) => File.Delete(Path.Combine(directory, JournalName));

    internal static void Recover(string directory)
    {
        var path = Path.Combine(directory, JournalName);
        if (!File.Exists(path)) return;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > MaximumJournalBytes) throw new InvalidDataException("Configuration recovery journal is too large.");
        var journal = JsonSerializer.Deserialize<RestoreJournal>(stream, Options)
            ?? throw new InvalidDataException("Invalid configuration recovery journal.");
        if (journal.Version != 1) throw new InvalidDataException("Unsupported configuration recovery journal.");
        var graph = Convert.FromBase64String(journal.Graph);
        var preferences = Convert.FromBase64String(journal.Preferences);
        Validate(graph, preferences);
        var graphPath = Path.Combine(directory, "graph-visual-settings.json");
        var preferencesPath = Path.Combine(directory, "workspace-preferences.json");
        AtomicJsonSettingsStore.WriteDurably(graphPath, graph, backup: false);
        AtomicJsonSettingsStore.WriteDurably(preferencesPath, preferences, backup: false);
        if (!File.ReadAllBytes(graphPath).AsSpan().SequenceEqual(graph)
            || !File.ReadAllBytes(preferencesPath).AsSpan().SequenceEqual(preferences))
            throw new IOException("Configuration recovery could not be verified.");
        Commit(directory);
    }

    private static void Validate(byte[] graph, byte[] preferences)
    {
        if (graph.Length > GraphVisualSettingsStore.MaximumBytes || preferences.Length > ConfigurationPreferencesStore.MaximumBytes)
            throw new InvalidDataException("Configuration recovery data is too large.");
        using var graphDocument = JsonDocument.Parse(graph, new JsonDocumentOptions { MaxDepth = 24 });
        using var preferencesDocument = JsonDocument.Parse(preferences, new JsonDocumentOptions { MaxDepth = 24 });
        GraphVisualSettingsStore.Validate(graphDocument.RootElement);
        ConfigurationPreferencesStore.Validate(preferencesDocument.RootElement);
    }

    private sealed record RestoreJournal(int Version, string Graph, string Preferences);
}
