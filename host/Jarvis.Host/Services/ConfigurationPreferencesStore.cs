using Jarvis.Host.Infrastructure;
using System.IO;
using System.Text.Json;

namespace Jarvis.Host.Services;

internal sealed class ConfigurationPreferencesStore
{
    public const int MaximumBytes = 192 * 1024;
    private static string? _isolatedDirectory;
    internal static string DefaultDirectory => _isolatedDirectory ?? Path.Combine(
        HostDataPaths.Root, "Settings");
    internal static void UseIsolatedDirectory(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        _isolatedDirectory = Path.GetFullPath(directory);
    }
    private readonly AtomicJsonSettingsStore _store;
    public ConfigurationPreferencesStore(string? path = null) => _store = new(
        path ?? Path.Combine(DefaultDirectory, "workspace-preferences.json"), MaximumBytes, Validate);
    public ConfigurationSettingsSnapshot Read() => _store.Read();
    public ConfigurationSettingsSnapshot Write(JsonElement settings, string? revision) => _store.Write(settings, revision);

    internal static void Validate(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object || !settings.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1)
            throw new InvalidDataException("Unsupported workspace preferences.");
        foreach (var key in new[] { "theme", "interface", "profiles", "audio", "effects" })
            if (!settings.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException("Incomplete workspace preferences.");
        var profiles = settings.GetProperty("profiles");
        if (profiles.EnumerateObject().Count() > 12) throw new InvalidDataException("Too many graph profiles.");
        foreach (var profile in profiles.EnumerateObject())
        {
            if (profile.Name.Length > 96 || profile.Value.ValueKind != JsonValueKind.Object
                || !profile.Value.TryGetProperty("settings", out var graph))
                throw new InvalidDataException("Invalid graph profile.");
            GraphVisualSettingsStore.Validate(graph);
        }
    }
}
