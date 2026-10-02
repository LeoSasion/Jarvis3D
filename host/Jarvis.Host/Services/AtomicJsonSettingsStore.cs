using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Services;

// Fixed, host-selected paths only. Shared folder locking also protects checkpoint reads.
internal sealed class AtomicJsonSettingsStore(string path, int maximumBytes, Action<JsonElement> validate)
{
    private readonly string _path = Path.GetFullPath(path);
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, MaxDepth = 24 };

    internal static T WithFolderLock<T>(string directory, Func<T> action)
    {
        var identity = Path.GetFullPath(directory);
        if (OperatingSystem.IsWindows()) identity = identity.ToUpperInvariant();
        using var mutex = new Mutex(false, "JARVIS.Settings." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))));
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(5)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("Settings are busy.");
            return action();
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    public ConfigurationSettingsSnapshot Read() => WithFolderLock(Path.GetDirectoryName(_path)!, () =>
    {
        SettingsRestoreTransaction.Recover(Path.GetDirectoryName(_path)!);
        return ReadCore();
    });

    public ConfigurationSettingsSnapshot Write(JsonElement settings, string? revision)
    {
        validate(settings);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(settings, Options);
        if (bytes.Length > maximumBytes) throw new InvalidDataException("Settings are too large.");
        return WithFolderLock(Path.GetDirectoryName(_path)!, () =>
        {
            SettingsRestoreTransaction.Recover(Path.GetDirectoryName(_path)!);
            var current = ReadCore();
            if (!string.Equals(current.Revision, revision, StringComparison.Ordinal)) return current with { Conflict = true };
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            WriteDurably(_path, bytes, backup: true);
            var result = ReadCore();
            if (result.Revision != Convert.ToHexString(SHA256.HashData(bytes)))
                throw new IOException("Settings could not be verified after saving.");
            return result;
        });
    }

    internal static void WriteDurably(string path, byte[] bytes, bool backup)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            if (backup && File.Exists(path)) File.Copy(path, path + ".bak", overwrite: true);
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private ConfigurationSettingsSnapshot ReadCore()
    {
        if (!File.Exists(_path)) return new(null, null, Source: Path.GetFileName(_path));
        using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > maximumBytes) throw new InvalidDataException("Settings are too large.");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        var bytes = memory.ToArray();
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 24 });
        validate(document.RootElement);
        return new(Convert.ToHexString(SHA256.HashData(bytes)), document.RootElement.Clone(),
            SavedAtUtc: File.GetLastWriteTimeUtc(_path), Source: Path.GetFileName(_path));
    }
}

internal sealed record ConfigurationSettingsSnapshot(string? Revision, JsonElement? Settings,
    bool Conflict = false, DateTime? SavedAtUtc = null, string? Source = null);
