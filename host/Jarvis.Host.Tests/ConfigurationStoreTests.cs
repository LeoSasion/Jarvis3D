using System.IO;
using System.Text.Json;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class ConfigurationStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "jarvis-configuration-test-" + Guid.NewGuid().ToString("N"));
    private string PreferencesPath => Path.Combine(_directory, "workspace-preferences.json");
    private string GraphPath => Path.Combine(_directory, "graph-visual-settings.json");
    private static JsonElement Preferences(string theme = "nexus") => JsonSerializer.SerializeToElement(new
    {
        version = 1, theme = new { id = theme }, @interface = new { motion = "system" }, profiles = new { },
        audio = new { enabled = false }, effects = new { enabled = false }, language = "zh-CN"
    });
    private static JsonElement Graph(double scale = 1) => JsonSerializer.SerializeToElement(new
    {
        version = 7, view = new { dimension = 3 }, node = new { scale }, edge = new { }, layout = new { },
        profiles = new { }, dimensions = new { }, scene = new { }, performance = new { }, labels = new { }
    });

    [Fact]
    public void IndependentInstancesSharePreferencesWithCompareAndSwapAndVerifiedBackup()
    {
        var a = new ConfigurationPreferencesStore(PreferencesPath);
        var b = new ConfigurationPreferencesStore(PreferencesPath);
        var first = a.Write(Preferences(), null);
        var second = b.Write(Preferences("stealth"), first.Revision);
        var conflict = a.Write(Preferences("clarity"), first.Revision);
        Assert.True(conflict.Conflict);
        Assert.Equal(second.Revision, conflict.Revision);
        Assert.NotNull(second.SavedAtUtc);
        Assert.Equal("workspace-preferences.json", second.Source);
        using var backup = JsonDocument.Parse(File.ReadAllText(PreferencesPath + ".bak"));
        Assert.Equal("nexus", backup.RootElement.GetProperty("theme").GetProperty("id").GetString());
        Assert.Empty(Directory.GetFiles(_directory, "*.tmp"));
    }

    [Fact]
    public void InvalidOrCorruptPreferencesCannotBeOverwrittenByBootstrap()
    {
        var store = new ConfigurationPreferencesStore(PreferencesPath);
        store.Write(Preferences(), null);
        File.WriteAllText(PreferencesPath, "{invalid");
        Assert.ThrowsAny<JsonException>(() => store.Write(Preferences(), null));
        Assert.Equal("{invalid", File.ReadAllText(PreferencesPath));
    }

    [Fact]
    public void SnapshotContainsBothSavedFilesAndNeverMutatesTheirActiveState()
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        var firstPrefs = prefs.Write(Preferences("stealth"), null);
        var firstGraph = graph.Write(Graph(1.4), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var saved = snapshots.Create("Approved appearance");
        prefs.Write(Preferences("clarity"), firstPrefs.Revision);
        graph.Write(Graph(2), firstGraph.Revision);
        var old = snapshots.Read(saved.Id);
        Assert.Equal("stealth", old.Preferences.GetProperty("theme").GetProperty("id").GetString());
        Assert.Equal(1.4, old.Graph.GetProperty("node").GetProperty("scale").GetDouble());
        Assert.Equal(2, graph.Read().Settings!.Value.GetProperty("node").GetProperty("scale").GetDouble());
        Assert.Single(snapshots.List());
        Assert.True(snapshots.Delete(saved.Id));
        Assert.Empty(snapshots.List());
    }

    [Fact]
    public void CheckpointNamesAndIdsAreBoundedAndNoUserPathCanBeSelected()
    {
        var snapshots = new ConfigurationSnapshotStore(_directory);
        Assert.Throws<InvalidDataException>(() => snapshots.Read("../graph-visual-settings"));
        Assert.Throws<InvalidDataException>(() => snapshots.Delete("../../workspace-preferences.json"));
        Assert.Throws<InvalidDataException>(() => snapshots.Create(new string('a', 61)));
        Assert.Throws<InvalidDataException>(() => snapshots.Create("unsaved"));
        Assert.False(Directory.Exists(_directory));
    }

    [Fact]
    public void FullLibraryPreservesExistingSnapshotsInsteadOfPruningUserHistory()
    {
        new ConfigurationPreferencesStore(PreferencesPath).Write(Preferences(), null);
        new GraphVisualSettingsStore(GraphPath).Write(Graph(), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var ids = Enumerable.Range(0, 8).Select(index => snapshots.Create($"Version {index}").Id).ToArray();
        Assert.Throws<InvalidDataException>(() => snapshots.Create("overflow"));
        Assert.Equal(ids.Order(), snapshots.List().Select(snapshot => snapshot.Id).Order());
    }

    [Theory]
    [InlineData("json")]
    [InlineData("schema")]
    [InlineData("oversized")]
    public void DamagedSnapshotIsPreservedAndDoesNotBlockListingOrRestoringOtherSnapshots(string damage)
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        var originalPrefs = prefs.Write(Preferences("stealth"), null);
        var originalGraph = graph.Write(Graph(1.4), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var target = snapshots.Create("Target");
        var damagedId = Guid.NewGuid().ToString("N");
        var damagedPath = Path.Combine(_directory, "Snapshots", damagedId + ".json");
        var content = damage switch
        {
            "json" => "{invalid",
            "schema" => "{}",
            _ => new string('x', 256 * 1024 + 1)
        };
        File.WriteAllText(damagedPath, content);
        var damagedBytes = File.ReadAllBytes(damagedPath);
        var listed = snapshots.List();
        Assert.Equal(2, listed.Count);
        Assert.False(Assert.Single(listed, item => item.Id == target.Id).IsDamaged);
        Assert.True(Assert.Single(listed, item => item.Id == damagedId).IsDamaged);
        var changedPrefs = prefs.Write(Preferences("clarity"), originalPrefs.Revision);
        var changedGraph = graph.Write(Graph(2), originalGraph.Revision);

        var restored = snapshots.Restore(target.Id, changedGraph.Revision!, changedPrefs.Revision!);

        Assert.False(restored.Conflict);
        Assert.Equal("stealth", restored.Preferences.Settings!.Value.GetProperty("theme").GetProperty("id").GetString());
        Assert.Equal(1.4, restored.Graph.Settings!.Value.GetProperty("node").GetProperty("scale").GetDouble());
        Assert.Equal(damagedBytes, File.ReadAllBytes(damagedPath));
        Assert.Equal(3, snapshots.List().Count);
    }

    [Fact]
    public void DamagedSnapshotsOccupyCapacityUntilExplicitDeletionMakesRoomForRestore()
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        var originalPrefs = prefs.Write(Preferences("stealth"), null);
        var originalGraph = graph.Write(Graph(1.4), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var target = snapshots.Create("Target");
        for (var index = 0; index < 6; index++) snapshots.Create($"Other {index}");
        var damagedId = Guid.NewGuid().ToString("N");
        var damagedPath = Path.Combine(_directory, "Snapshots", damagedId + ".json");
        File.WriteAllText(damagedPath, "{invalid");
        var changedPrefs = prefs.Write(Preferences("clarity"), originalPrefs.Revision);
        var changedGraph = graph.Write(Graph(2), originalGraph.Revision);

        Assert.Equal(8, snapshots.List().Count);
        Assert.Throws<InvalidDataException>(() => snapshots.Create("Overflow"));
        Assert.Throws<InvalidDataException>(() => snapshots.Restore(target.Id, changedGraph.Revision!, changedPrefs.Revision!));
        Assert.Equal(changedPrefs.Revision, prefs.Read().Revision);
        Assert.Equal(changedGraph.Revision, graph.Read().Revision);
        Assert.Equal("{invalid", File.ReadAllText(damagedPath));
        Assert.False(File.Exists(Path.Combine(_directory, ".configuration-restore.json")));

        Assert.True(snapshots.Delete(damagedId));
        Assert.False(File.Exists(damagedPath));
        var restored = snapshots.Restore(target.Id, changedGraph.Revision!, changedPrefs.Revision!);
        Assert.False(restored.Conflict);
        Assert.NotNull(restored.Backup);
        Assert.Equal("stealth", restored.Preferences.Settings!.Value.GetProperty("theme").GetProperty("id").GetString());
        Assert.Equal(8, snapshots.List().Count);
        Assert.All(snapshots.List(), item => Assert.False(item.IsDamaged));
    }

    [Fact]
    public void TemporarilyLockedSnapshotIsNotMisclassifiedAsDamaged()
    {
        new ConfigurationPreferencesStore(PreferencesPath).Write(Preferences(), null);
        new GraphVisualSettingsStore(GraphPath).Write(Graph(), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var target = snapshots.Create("Target");
        var path = Path.Combine(_directory, "Snapshots", target.Id + ".json");
        var before = File.ReadAllBytes(path);
        using (var exclusive = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert.Throws<IOException>(() => snapshots.List());
            Assert.Throws<IOException>(() => snapshots.Create("While locked"));
        }
        Assert.False(Assert.Single(snapshots.List()).IsDamaged);
        Assert.Equal(before, File.ReadAllBytes(path));
    }

    [Fact]
    public void OversizedPreferencesCannotReplaceValidData()
    {
        var store = new ConfigurationPreferencesStore(PreferencesPath);
        var saved = store.Write(Preferences(), null);
        using var huge = JsonDocument.Parse(Preferences().GetRawText()[..^1] + ",\"extra\":\"" + new string('x', 200 * 1024) + "\"}");
        Assert.Throws<InvalidDataException>(() => store.Write(huge.RootElement, saved.Revision));
        Assert.Equal(saved.Revision, store.Read().Revision);
    }

    [Fact]
    public void RestoreChecksBothRevisionsAndCreatesACompleteUndoSnapshot()
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        var originalPrefs = prefs.Write(Preferences("stealth"), null);
        var originalGraph = graph.Write(Graph(1.4), null);
        var snapshots = new ConfigurationSnapshotStore(_directory);
        var target = snapshots.Create("Target");
        var changedPrefs = prefs.Write(Preferences("clarity"), originalPrefs.Revision);
        var changedGraph = graph.Write(Graph(2), originalGraph.Revision);
        var conflict = snapshots.Restore(target.Id, originalGraph.Revision!, originalPrefs.Revision!);
        Assert.True(conflict.Conflict);
        Assert.Single(snapshots.List());
        var restored = snapshots.Restore(target.Id, changedGraph.Revision!, changedPrefs.Revision!);
        Assert.False(restored.Conflict);
        Assert.NotNull(restored.Backup);
        Assert.Equal("stealth", restored.Preferences.Settings!.Value.GetProperty("theme").GetProperty("id").GetString());
        Assert.Equal(1.4, restored.Graph.Settings!.Value.GetProperty("node").GetProperty("scale").GetDouble());
        var undo = snapshots.Read(restored.Backup.Id);
        Assert.Equal(2, undo.Graph.GetProperty("node").GetProperty("scale").GetDouble());
        Assert.Equal("clarity", undo.Preferences.GetProperty("theme").GetProperty("id").GetString());
        Assert.False(File.Exists(Path.Combine(_directory, ".configuration-restore.json")));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void InterruptedRestoreRecoversBothExactOriginalFilesBeforeAnyRead(bool readGraphFirst)
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        var savedPrefs = prefs.Write(Preferences("stealth"), null);
        var savedGraph = graph.Write(Graph(1.4), null);
        var graphBytes = File.ReadAllBytes(GraphPath);
        var prefsBytes = File.ReadAllBytes(PreferencesPath);
        SettingsRestoreTransaction.Begin(_directory, graphBytes, prefsBytes);
        // Simulate process termination after writing only the first target file.
        File.WriteAllText(GraphPath, Graph(2).GetRawText());
        if (readGraphFirst) Assert.Equal(savedGraph.Revision, graph.Read().Revision);
        else Assert.Equal(savedPrefs.Revision, prefs.Read().Revision);
        Assert.Equal(graphBytes, File.ReadAllBytes(GraphPath));
        Assert.Equal(prefsBytes, File.ReadAllBytes(PreferencesPath));
        Assert.False(File.Exists(Path.Combine(_directory, ".configuration-restore.json")));
    }

    [Fact]
    public void DamagedRecoveryJournalFailsClosedWithoutReplacingEitherFile()
    {
        var prefs = new ConfigurationPreferencesStore(PreferencesPath);
        var graph = new GraphVisualSettingsStore(GraphPath);
        prefs.Write(Preferences(), null); graph.Write(Graph(), null);
        var graphBytes = File.ReadAllBytes(GraphPath); var prefsBytes = File.ReadAllBytes(PreferencesPath);
        var journal = Path.Combine(_directory, ".configuration-restore.json");
        File.WriteAllText(journal, "{damaged");
        Assert.ThrowsAny<JsonException>(() => prefs.Read());
        Assert.ThrowsAny<JsonException>(() => graph.Write(Graph(3), null));
        Assert.Equal(graphBytes, File.ReadAllBytes(GraphPath));
        Assert.Equal(prefsBytes, File.ReadAllBytes(PreferencesPath));
        Assert.Equal("{damaged", File.ReadAllText(journal));
    }

    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true); }
}
