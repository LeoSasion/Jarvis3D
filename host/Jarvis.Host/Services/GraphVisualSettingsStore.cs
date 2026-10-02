using System.IO;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Services;

internal sealed class GraphVisualSettingsStore
{
    public const int MaximumBytes = 48 * 1024;
    private readonly AtomicJsonSettingsStore _store;
    public GraphVisualSettingsStore(string? path = null) => _store = new(path ?? Path.Combine(
        ConfigurationPreferencesStore.DefaultDirectory, "graph-visual-settings.json"), MaximumBytes, Validate);

    public GraphVisualSettingsSnapshot Read() => Convert(_store.Read());
    public GraphVisualSettingsSnapshot Write(JsonElement settings, string? revision) => Convert(_store.Write(settings, revision));
    private static GraphVisualSettingsSnapshot Convert(ConfigurationSettingsSnapshot value) =>
        new(value.Revision, value.Settings, value.Conflict, value.SavedAtUtc, value.Source);

    internal static void Validate(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object
            || !settings.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var number) || number != 7)
            throw new InvalidDataException("Unsupported visual settings version.");
        foreach (var key in new[] { "view", "node", "edge", "layout", "profiles", "dimensions", "scene", "performance", "labels" })
            if (!settings.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException("Incomplete visual settings.");
        if (Encoding.UTF8.GetByteCount(settings.GetRawText()) > MaximumBytes)
            throw new InvalidDataException("Visual settings are too large.");
    }
}

internal sealed record GraphVisualSettingsSnapshot(string? Revision, JsonElement? Settings, bool Conflict = false,
    DateTime? SavedAtUtc = null, string? Source = null);
