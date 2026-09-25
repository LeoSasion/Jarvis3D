using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Services;

// Shared by the native Host and the loopback preview worker. No renderer-supplied paths.
internal sealed class GraphVisualSettingsStore
{
    public const int MaximumBytes = 48 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, MaxDepth = 24 };
    private static readonly JsonDocumentOptions DocumentOptions = new() { MaxDepth = 24 };
    private readonly string _path;
    private readonly string _mutexName;

    public GraphVisualSettingsStore(string? path = null)
    {
        _path = Path.GetFullPath(path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS", "Settings", "graph-visual-settings.json"));
        var identity = OperatingSystem.IsWindows() ? _path.ToUpperInvariant() : _path;
        _mutexName = "JARVIS.GraphVisualSettings." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
    }

    public GraphVisualSettingsSnapshot Read() => WithLock(ReadCore);

    public GraphVisualSettingsSnapshot Write(JsonElement settings, string? revision)
    {
        Validate(settings);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(settings, JsonOptions);
        if (bytes.Length > MaximumBytes) throw new InvalidDataException("Visual settings are too large.");
        return WithLock(() =>
        {
            var current = ReadCore();
            if (!string.Equals(current.Revision, revision, StringComparison.Ordinal)) return current with { Conflict = true };
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var temporary = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(bytes);
                    stream.Flush(flushToDisk: true);
                }
                if (File.Exists(_path)) File.Copy(_path, _path + ".bak", overwrite: true);
                File.Move(temporary, _path, overwrite: true);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
            return new(Convert.ToHexString(SHA256.HashData(bytes)), settings.Clone());
        });
    }

    private GraphVisualSettingsSnapshot ReadCore()
    {
        if (!File.Exists(_path)) return new(null, null);
        using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > MaximumBytes) throw new InvalidDataException("Visual settings are too large.");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        var bytes = memory.ToArray();
        using var document = JsonDocument.Parse(bytes, DocumentOptions);
        Validate(document.RootElement);
        return new(Convert.ToHexString(SHA256.HashData(bytes)), document.RootElement.Clone());
    }

    private static void Validate(JsonElement settings)
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

    private T WithLock<T>(Func<T> action)
    {
        using var mutex = new Mutex(false, _mutexName);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(5)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("Visual settings are busy.");
            return action();
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }
}

internal sealed record GraphVisualSettingsSnapshot(string? Revision, JsonElement? Settings, bool Conflict = false);
