using System.Text;
using System.Text.Json;
using Jarvis.Host.Services;
using Jarvis.Host.Agents;

// Loopback preview bridge: reuse native graph parsing and the fixed-path visual store.
Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
var vault = Environment.GetEnvironmentVariable("JARVIS_OBSIDIAN_VAULT");
if (Environment.GetEnvironmentVariable("JARVIS_PREVIEW_TEST_SETTINGS_DIRECTORY") is { Length: > 0 } testSettingsDirectory)
    ConfigurationPreferencesStore.UseIsolatedDirectory(testSettingsDirectory);
using var service = new ObsidianGraphService(() => vault, () => "");
var visuals = new GraphVisualSettingsStore();
var preferences = new ConfigurationPreferencesStore();
var snapshots = new ConfigurationSnapshotStore();
var conversations = new AgentConversationStore();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
while (Console.ReadLine() is { } line)
{
    var id = 0;
    try
    {
        if (Encoding.UTF8.GetByteCount(line) > 256 * 1024) throw new InvalidDataException("Request too large.");
        using var request = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 24 });
        var root = request.RootElement;
        id = root.GetProperty("id").GetInt32();
        object result;
        if (root.GetProperty("method").GetString() == "visual.read") result = visuals.Read();
        else if (root.GetProperty("method").GetString() == "configuration.read") result = preferences.Read();
        else if (root.GetProperty("method").GetString() == "configuration.write")
            result = preferences.Write(root.GetProperty("settings"), root.GetProperty("revision").GetString());
        else if (root.GetProperty("method").GetString() == "configuration.snapshots.list") result = snapshots.List();
        else if (root.GetProperty("method").GetString() == "configuration.snapshots.create") result = snapshots.Create(root.GetProperty("label").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "configuration.snapshots.read") result = snapshots.Read(root.GetProperty("snapshotId").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "configuration.snapshots.delete") result = snapshots.Delete(root.GetProperty("snapshotId").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "configuration.snapshots.restore") result = snapshots.Restore(
            root.GetProperty("snapshotId").GetString() ?? "", root.GetProperty("graphRevision").GetString() ?? "",
            root.GetProperty("preferencesRevision").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "agentConversations.list") result = conversations.List();
        else if (root.GetProperty("method").GetString() == "agentConversations.read") result = conversations.Read(root.GetProperty("conversationId").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "agentConversations.save") result = conversations.Save(root.GetProperty("conversation"));
        else if (root.GetProperty("method").GetString() == "agentConversations.rename") result = conversations.Rename(root.GetProperty("conversationId").GetString() ?? "", root.GetProperty("title").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "agentConversations.delete") result = conversations.Delete(root.GetProperty("conversationId").GetString() ?? "");
        else if (root.GetProperty("method").GetString() == "visual.write")
            result = visuals.Write(root.GetProperty("settings"), root.GetProperty("revision").GetString());
        else if (root.GetProperty("method").GetString() == "manifest")
        {
            var manifest = root.TryGetProperty("force", out var force) && force.GetBoolean()
                ? service.RefreshDefaultManifest()
                : service.GetDefaultManifest();
            result = manifest with { Source = manifest.Source with { Resolution = "local-preview" } };
        }
        else if (root.GetProperty("method").GetString() == "chunk")
        {
            result = service.GetDefaultChunk(
                root.GetProperty("revision").GetString() ?? "",
                root.GetProperty("nodeOffset").GetInt32(),
                root.GetProperty("nodeLimit").GetInt32(),
                root.GetProperty("edgeOffset").GetInt32(),
                root.GetProperty("edgeLimit").GetInt32());
        }
        else if (root.GetProperty("method").GetString() == "search")
            result = service.SearchKnowledge(root.GetProperty("query").GetString() ?? "", root.GetProperty("tag").GetString() ?? "",
                root.GetProperty("offset").GetInt32(), root.GetProperty("limit").GetInt32());
        else if (root.GetProperty("method").GetString() == "neighborhood")
            result = service.GetKnowledgeNeighborhood(root.GetProperty("revision").GetString() ?? "",
                root.GetProperty("nodeId").GetString() ?? "", root.GetProperty("hops").GetInt32());
        else if (root.GetProperty("method").GetString() == "readNote")
            result = service.ReadKnowledgeNote(root.GetProperty("revision").GetString() ?? "",
                root.GetProperty("nodeId").GetString() ?? "", root.GetProperty("startLine").GetInt32());
        else throw new ArgumentException("Unknown graph method.");
        Console.WriteLine(JsonSerializer.Serialize(new { id, result }, json));
    }
    catch (Exception exception)
    {
        var code = exception is ObsidianGraphRevisionMismatchException
            ? "GRAPH_REVISION_STALE"
            : "LOCAL_GRAPH_UNAVAILABLE";
        // Never return filesystem paths or parser exception details to the browser.
        Console.WriteLine(JsonSerializer.Serialize(new { id, error = new { code } }, json));
    }
}
return 0;
