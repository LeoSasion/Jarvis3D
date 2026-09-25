using System.IO;
using System.Text.Json;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class GraphVisualSettingsStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "jarvis-visual-test-" + Guid.NewGuid().ToString("N"));
    private string SettingsPath => Path.Combine(_directory, "graph-visual-settings.json");
    private static JsonElement Value(double scale = 1) => JsonSerializer.SerializeToElement(new
    {
        version = 7, view = new { dimension = 3 }, node = new { scale }, edge = new { },
        layout = new { }, profiles = new { }, dimensions = new { }, scene = new { }, performance = new { }, labels = new { }
    });

    [Fact]
    public void FreshInstancesShareSavedSettingsAndBackupThePreviousVersion()
    {
        var first = new GraphVisualSettingsStore(SettingsPath);
        Assert.Null(first.Read().Settings);
        var saved = first.Write(Value(1.28), null);
        var second = new GraphVisualSettingsStore(SettingsPath);
        Assert.Equal(saved.Revision, second.Read().Revision);
        Assert.Equal(1.28, second.Read().Settings!.Value.GetProperty("node").GetProperty("scale").GetDouble());
        second.Write(Value(1.5), saved.Revision);
        using var backup = JsonDocument.Parse(File.ReadAllText(SettingsPath + ".bak"));
        Assert.Equal(1.28, backup.RootElement.GetProperty("node").GetProperty("scale").GetDouble());
        Assert.Empty(Directory.GetFiles(_directory, "*.tmp"));
    }

    [Fact]
    public async Task ConcurrentWritersCannotOverwriteTheSameRevision()
    {
        var first = new GraphVisualSettingsStore(SettingsPath);
        var initial = first.Write(Value(), null);
        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(index => Task.Run(() =>
            new GraphVisualSettingsStore(SettingsPath).Write(Value(index + 2), initial.Revision))));
        Assert.Single(results, result => !result.Conflict);
        Assert.Equal(5, results.Count(result => result.Conflict));
        Assert.Equal(results.Single(result => !result.Conflict).Revision, first.Read().Revision);
    }

    [Fact]
    public void ManualFileEditsChangeTheRevisionAndStaleWritersLose()
    {
        var store = new GraphVisualSettingsStore(SettingsPath);
        var original = store.Write(Value(), null);
        File.WriteAllText(SettingsPath, Value(1.7).GetRawText());
        var result = store.Write(Value(2), original.Revision);
        Assert.True(result.Conflict);
        Assert.Equal(1.7, result.Settings!.Value.GetProperty("node").GetProperty("scale").GetDouble());
    }

    [Fact]
    public void CorruptFileIsPreservedInsteadOfBeingSilentlyReset()
    {
        var store = new GraphVisualSettingsStore(SettingsPath);
        var saved = store.Write(Value(), null);
        File.WriteAllText(SettingsPath, "{broken");
        Assert.ThrowsAny<JsonException>(() => store.Read());
        Assert.ThrowsAny<JsonException>(() => store.Write(Value(), saved.Revision));
        Assert.Equal("{broken", File.ReadAllText(SettingsPath));
    }

    [Fact]
    public void InvalidAndOversizedSettingsCannotReplaceAValidFile()
    {
        var store = new GraphVisualSettingsStore(SettingsPath);
        var saved = store.Write(Value(), null);
        Assert.Throws<InvalidDataException>(() => store.Write(JsonSerializer.SerializeToElement(new { version = 99 }), saved.Revision));
        var text = Value().GetRawText()[..^1] + ",\"padding\":\"" + new string('x', 50 * 1024) + "\"}";
        using var large = JsonDocument.Parse(text);
        Assert.Throws<InvalidDataException>(() => store.Write(large.RootElement, saved.Revision));
        Assert.Equal(saved.Revision, store.Read().Revision);
    }

    [Fact]
    public void DeepSettingsCannotReplaceAFileThatTheStoreCanRead()
    {
        var store = new GraphVisualSettingsStore(SettingsPath);
        var saved = store.Write(Value(), null);
        var nested = string.Concat(Enumerable.Repeat("{\"child\":", 25)) + "0" + new string('}', 25);
        var text = Value().GetRawText()[..^1] + ",\"extra\":" + nested + "}";
        using var deep = JsonDocument.Parse(text);

        Assert.ThrowsAny<JsonException>(() => store.Write(deep.RootElement, saved.Revision));
        Assert.Equal(saved.Revision, store.Read().Revision);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"7\"")]
    [InlineData("{}")]
    [InlineData("7.5")]
    public void NonIntegerVersionIsRejectedWithoutChangingTheFile(string version)
    {
        var store = new GraphVisualSettingsStore(SettingsPath);
        var saved = store.Write(Value(), null);
        using var malformed = JsonDocument.Parse("{\"version\":" + version + "}");
        Assert.Throws<InvalidDataException>(() => store.Write(malformed.RootElement, saved.Revision));
        Assert.Equal(saved.Revision, store.Read().Revision);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
