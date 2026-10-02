using System.IO;
using System.Text.Json;

namespace Jarvis.Host.Services;

internal sealed class ConfigurationSnapshotStore
{
    private const int MaximumSnapshots = 8;
    private const int MaximumBytes = 256 * 1024;
    private readonly string _directory;
    private readonly string _snapshots;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { MaxDepth = 24 };
    public ConfigurationSnapshotStore(string? directory = null)
    {
        _directory = Path.GetFullPath(directory ?? ConfigurationPreferencesStore.DefaultDirectory);
        _snapshots = Path.Combine(_directory, "Snapshots");
    }

    public IReadOnlyList<ConfigurationSnapshotInfo> List() => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        if (!Directory.Exists(_snapshots)) return (IReadOnlyList<ConfigurationSnapshotInfo>)Array.Empty<ConfigurationSnapshotInfo>();
        return Directory.EnumerateFiles(_snapshots, "*.json")
            .Where(path => IsSnapshotId(Path.GetFileNameWithoutExtension(path))).Take(MaximumSnapshots + 1)
            .Select(Describe)
            .OrderByDescending(value => value.CreatedAtUtc).ToArray();
    });

    public ConfigurationSnapshotInfo Create(string label) => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        label = label.Trim();
        if (label.Length is < 1 or > 60 || label.Any(char.IsControl)) throw new InvalidDataException("Invalid snapshot name.");
        var graph = new GraphVisualSettingsStore(Path.Combine(_directory, "graph-visual-settings.json")).Read();
        var preferences = new ConfigurationPreferencesStore(Path.Combine(_directory, "workspace-preferences.json")).Read();
        if (graph.Settings is null || preferences.Settings is null) throw new InvalidDataException("Save current settings before creating a snapshot.");
        if (List().Count >= MaximumSnapshots) throw new InvalidDataException("Snapshot library is full. Delete an older snapshot first.");
        var value = new ConfigurationSnapshotDocument(Guid.NewGuid().ToString("N"), label, DateTimeOffset.UtcNow,
            graph.Settings.Value, preferences.Settings.Value);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Options);
        if (bytes.Length > MaximumBytes) throw new InvalidDataException("Snapshot is too large.");
        Directory.CreateDirectory(_snapshots);
        AtomicJsonSettingsStore.WriteDurably(PathFor(value.Id), bytes, backup: false);
        return new ConfigurationSnapshotInfo(value.Id, value.Label, value.CreatedAtUtc);
    });

    public ConfigurationSnapshotDocument Read(string id) => AtomicJsonSettingsStore.WithFolderLock(_directory, () => ReadCore(id));
    public bool Delete(string id) => AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
    {
        var path = PathFor(id);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    });

    public ConfigurationRestoreResult Restore(string id, string graphRevision, string preferencesRevision) =>
        AtomicJsonSettingsStore.WithFolderLock(_directory, () =>
        {
            SettingsRestoreTransaction.Recover(_directory);
            var target = ReadCore(id);
            var graphPath = Path.Combine(_directory, "graph-visual-settings.json");
            var preferencesPath = Path.Combine(_directory, "workspace-preferences.json");
            var graphStore = new GraphVisualSettingsStore(graphPath);
            var preferencesStore = new ConfigurationPreferencesStore(preferencesPath);
            var graph = graphStore.Read();
            var preferences = preferencesStore.Read();
            if (graph.Revision != graphRevision || preferences.Revision != preferencesRevision)
                return new ConfigurationRestoreResult(true, graph, preferences);
            var backup = Create("Before restore · " + DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
            SettingsRestoreTransaction.Begin(_directory, File.ReadAllBytes(graphPath), File.ReadAllBytes(preferencesPath));
            try
            {
                // Do not call the ordinary stores while a journal is armed: they
                // deliberately recover it before allowing any read or new edit.
                var graphBytes = JsonSerializer.SerializeToUtf8Bytes(target.Graph);
                var preferencesBytes = JsonSerializer.SerializeToUtf8Bytes(target.Preferences);
                AtomicJsonSettingsStore.WriteDurably(graphPath, graphBytes, backup: true);
                AtomicJsonSettingsStore.WriteDurably(preferencesPath, preferencesBytes, backup: true);
                if (!File.ReadAllBytes(graphPath).AsSpan().SequenceEqual(graphBytes)
                    || !File.ReadAllBytes(preferencesPath).AsSpan().SequenceEqual(preferencesBytes))
                    throw new IOException("Restored configuration could not be verified.");
                SettingsRestoreTransaction.Commit(_directory);
            }
            catch
            {
                SettingsRestoreTransaction.Recover(_directory);
                throw;
            }
            return new ConfigurationRestoreResult(false, graphStore.Read(), preferencesStore.Read(), backup);
        });

    private string PathFor(string id)
    {
        if (!IsSnapshotId(id)) throw new InvalidDataException("Invalid snapshot identity.");
        return Path.Combine(_snapshots, id + ".json");
    }

    private static bool IsSnapshotId(string? id) => id is { Length: 32 } && id.All(Uri.IsHexDigit);

    private ConfigurationSnapshotInfo Describe(string path)
    {
        var id = Path.GetFileNameWithoutExtension(path);
        try
        {
            var value = ReadCore(id);
            return new ConfigurationSnapshotInfo(value.Id, value.Label, value.CreatedAtUtc);
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException)
        {
            // Preserve damaged snapshots and their occupied slots, but expose their
            // fixed IDs so users can explicitly delete one to make room for recovery.
            // Sharing violations and other IO failures must still fail the operation.
            return new ConfigurationSnapshotInfo(id, "Damaged snapshot · " + id[..8],
                File.GetLastWriteTimeUtc(path), IsDamaged: true);
        }
    }

    private ConfigurationSnapshotDocument ReadCore(string id)
    {
        var path = PathFor(id);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > MaximumBytes) throw new InvalidDataException("Snapshot is too large.");
        var value = JsonSerializer.Deserialize<ConfigurationSnapshotDocument>(stream, Options)
            ?? throw new InvalidDataException("Invalid snapshot.");
        if (value.Id != id || value.Label is null || value.Label.Length is < 1 or > 60) throw new InvalidDataException("Invalid snapshot metadata.");
        GraphVisualSettingsStore.Validate(value.Graph);
        ConfigurationPreferencesStore.Validate(value.Preferences);
        return value;
    }
}

internal sealed record ConfigurationSnapshotInfo(string Id, string Label, DateTimeOffset CreatedAtUtc, bool IsDamaged = false);
internal sealed record ConfigurationSnapshotDocument(string Id, string Label, DateTimeOffset CreatedAtUtc,
    JsonElement Graph, JsonElement Preferences);
internal sealed record ConfigurationRestoreResult(bool Conflict, GraphVisualSettingsSnapshot Graph,
    ConfigurationSettingsSnapshot Preferences, ConfigurationSnapshotInfo? Backup = null);
