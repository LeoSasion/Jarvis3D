using System.Text;
using System.Text.Json;
using Jarvis.Host.Services;

// Dev-only stdio bridge. Reuse the native read-only parser and watcher verbatim.
Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
var vault = Environment.GetEnvironmentVariable("JARVIS_OBSIDIAN_VAULT");
if (string.IsNullOrWhiteSpace(vault) || !Directory.Exists(vault)) return 1;
using var service = new ObsidianGraphService(() => vault, () => "");
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
while (Console.ReadLine() is { } line)
{
    var id = 0;
    try
    {
        using var request = JsonDocument.Parse(line);
        var root = request.RootElement;
        id = root.GetProperty("id").GetInt32();
        object result;
        if (root.GetProperty("method").GetString() == "manifest")
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
