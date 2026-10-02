using System.IO;
using System.Text.Json;
using Jarvis.Host.Agents;

namespace Jarvis.Host.Tests;

public sealed class AgentConversationStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "jarvis-conversations-test-" + Guid.NewGuid().ToString("N"));
    private static JsonElement Document(string id, string text = "hello") => JsonSerializer.SerializeToElement(
        new AgentConversationDocument(id, "My conversation", "pi", DateTimeOffset.UtcNow,
            [new AgentConversationMessage("m1", "user", text, "complete", null)]),
        new JsonSerializerOptions(JsonSerializerDefaults.Web));

    [Fact]
    public void SavesRenamesAndRestoresThroughANewStoreInstance()
    {
        var store = new AgentConversationStore(_root);
        var id = Guid.NewGuid().ToString("N");
        store.Save(Document(id, "saved content"));
        store.Rename(id, "Work notes");
        var restored = new AgentConversationStore(_root);
        Assert.Equal("Work notes", Assert.Single(restored.List()).Title);
        Assert.Equal("saved content", Assert.Single(restored.Read(id).Messages).Text);
        Assert.True(File.Exists(Path.Combine(_root, id + ".json.bak")));
        Assert.True(restored.Delete(id));
        Assert.False(File.Exists(Path.Combine(_root, id + ".json.bak")));
        Assert.Empty(restored.List());
    }

    [Fact]
    public void PersistsRunAndClientMessageIdsForSourceBoundAnswers()
    {
        var store = new AgentConversationStore(_root);
        var id = Guid.NewGuid().ToString("N");
        var document = new AgentConversationDocument(
            id,
            "Source-backed conversation",
            "pi",
            DateTimeOffset.UtcNow,
            [new AgentConversationMessage(
                "assistant-1", "assistant", "The two notes agree [S1] [S2].", "complete", null,
                RunId: "run-1", ClientMessageId: "user-1")]);
        store.Save(JsonSerializer.SerializeToElement(document, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

        var restored = Assert.Single(new AgentConversationStore(_root).Read(id).Messages);
        Assert.Equal("run-1", restored.RunId);
        Assert.Equal("user-1", restored.ClientMessageId);

        var oversized = document with
        {
            Id = Guid.NewGuid().ToString("N"),
            Messages = [restored with { RunId = new string('r', 161) }]
        };
        Assert.Throws<InvalidDataException>(() => store.Save(
            JsonSerializer.SerializeToElement(oversized, new JsonSerializerOptions(JsonSerializerDefaults.Web))));
        var malformed = oversized with
        {
            Messages = [restored with { RunId = "run\n2" }]
        };
        Assert.Throws<InvalidDataException>(() => store.Save(
            JsonSerializer.SerializeToElement(malformed, new JsonSerializerOptions(JsonSerializerDefaults.Web))));
    }

    [Fact]
    public void RejectsTraversalOversizedMessagesAndInvalidRoles()
    {
        var store = new AgentConversationStore(_root);
        Assert.Throws<ArgumentException>(() => store.Read("../escape"));
        Assert.Throws<InvalidDataException>(() => store.Save(Document(Guid.NewGuid().ToString("N"), new string('x', 16_001))));
        var invalid = JsonSerializer.SerializeToElement(new { id = Guid.NewGuid().ToString("N"), title = "x", provider = "pi",
            messages = new[] { new { id = "m", role = "system", text = "untrusted", status = "complete" } } });
        Assert.Throws<InvalidDataException>(() => store.Save(invalid));
    }

    [Fact]
    public void DamagedTranscriptDoesNotHideOtherConversationsOrGetOverwritten()
    {
        Directory.CreateDirectory(_root);
        var damaged = Path.Combine(_root, Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(damaged, "not-json");
        var store = new AgentConversationStore(_root);
        store.Save(Document(Guid.NewGuid().ToString("N")));
        Assert.Single(store.List());
        Assert.Equal("not-json", File.ReadAllText(damaged));
    }

    [Fact]
    public void InvalidSchemaOversizedAndWrongIdentityFilesDoNotBreakSaveOrRevisionTracking()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, Guid.NewGuid().ToString("N") + ".json"), "{}");
        File.WriteAllText(Path.Combine(_root, Guid.NewGuid().ToString("N") + ".json"), new string(' ', 256 * 1024 + 1));
        File.WriteAllText(Path.Combine(_root, Guid.NewGuid().ToString("N") + ".json"), Document(Guid.NewGuid().ToString("N")).GetRawText());
        var store = new AgentConversationStore(_root);
        var id = Guid.NewGuid().ToString("N");
        var saved = store.Save(Document(id));
        Assert.Equal(1, saved.Revision);
        Assert.Single(store.List());
        var loaded = store.Read(id);
        var updated = store.Save(JsonSerializer.SerializeToElement(loaded, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(2, updated.Revision);
        Assert.Equal(2, store.Read(id).Revision);
        Assert.Throws<InvalidOperationException>(() => store.Save(Document(id)));
        Assert.Equal(2, store.Read(id).Revision);
        Assert.Equal(4, Directory.GetFiles(_root, "*.json").Length);
    }

    [Fact]
    public void ConcurrentConflictCanBeSavedAsACopyWithoutReplacingTheNewerOriginal()
    {
        var first = new AgentConversationStore(_root);
        var second = new AgentConversationStore(_root);
        var id = Guid.NewGuid().ToString("N");
        first.Save(Document(id, "original"));
        var stale = second.Read(id);
        first.Rename(id, "newer remote name");
        var pending = stale with { Messages = [new AgentConversationMessage("m2", "user", "unsaved local work", "complete", null)] };
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Throws<InvalidOperationException>(() => second.Save(JsonSerializer.SerializeToElement(pending, options)));
        var copy = pending with { Id = Guid.NewGuid().ToString("N"), Revision = 0 };
        var saved = second.Save(JsonSerializer.SerializeToElement(copy, options));
        Assert.Equal(1, saved.Revision);
        Assert.Equal("unsaved local work", Assert.Single(first.Read(copy.Id).Messages).Text);
        Assert.Equal("newer remote name", first.Read(id).Title);
        Assert.Equal("original", Assert.Single(first.Read(id).Messages).Text);
        Assert.Equal(2, first.List().Count);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
