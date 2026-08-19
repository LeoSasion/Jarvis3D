using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Infrastructure;

internal sealed class HostStartupSafetySession : IDisposable
{
    private const int SchemaVersion = 1;
    private const long MaximumLedgerBytes = 32 * 1024;
    private const string SafeModeArgument = "--safe-mode";
    private const string SafeModeEnvironmentVariable = "JARVIS_KEEP_NATIVE_TASKBAR";
    private const string SafeModeReasonEnvironmentVariable = "JARVIS_SAFE_MODE_REASON";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly object _gate = new();
    private readonly string _ledgerPath;
    private readonly string _runId;
    private HostStartupHealthLedger _ledger;
    private bool _completed;
    private bool _disposed;

    private HostStartupSafetySession(
        string ledgerPath,
        string runId,
        HostStartupHealthLedger ledger,
        bool safeMode,
        string? reason)
    {
        _ledgerPath = ledgerPath;
        _runId = runId;
        _ledger = ledger;
        IsSafeMode = safeMode;
        Reason = reason;
    }

    public bool IsSafeMode { get; private set; }

    public string? Reason { get; private set; }

    internal HostStartupHealthLedger Snapshot
    {
        get
        {
            lock (_gate)
            {
                return _ledger;
            }
        }
    }

    public static HostStartupSafetySession Begin(IReadOnlyList<string> arguments)
    {
        using var process = Process.GetCurrentProcess();
        var stateDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS",
            "State");
        var ledgerPath = Path.Combine(
            stateDirectory,
            $"startup-health-session-{process.SessionId}.json");
        return Begin(
            arguments,
            StartupModifierKeys.IsShiftPressed(),
            ledgerPath,
            DateTimeOffset.UtcNow,
            process.Id,
            applyEnvironment: true);
    }

    internal static HostStartupSafetySession Begin(
        IReadOnlyList<string> arguments,
        bool shiftPressed,
        string ledgerPath,
        DateTimeOffset nowUtc,
        int processId,
        bool applyEnvironment = true)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        ArgumentException.ThrowIfNullOrWhiteSpace(ledgerPath);
        if (processId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(processId));
        }

        var (previousLedger, ledgerUnreadable) = ReadLedger(ledgerPath);
        var previousRunIncomplete = !string.IsNullOrWhiteSpace(previousLedger.ActiveRunId);
        var explicitSafeMode = arguments.Any(argument =>
            argument.Equals(SafeModeArgument, StringComparison.OrdinalIgnoreCase));
        var reason = ResolveReason(
            explicitSafeMode,
            shiftPressed,
            previousRunIncomplete,
            ledgerUnreadable);
        var safeMode = reason is not null;
        var runId = Guid.NewGuid().ToString("N");
        var ledger = previousLedger with
        {
            SchemaVersion = SchemaVersion,
            ActiveRunId = runId,
            ActiveProcessId = processId,
            ActiveStartedAtUtc = nowUtc,
            ConsecutiveAbnormalExits = previousRunIncomplete
                ? previousLedger.ConsecutiveAbnormalExits >= 999
                    ? 1000
                    : Math.Max(previousLedger.ConsecutiveAbnormalExits, 0) + 1
                : Math.Max(previousLedger.ConsecutiveAbnormalExits, 0),
            LastAbnormalExitDetectedUtc = previousRunIncomplete
                ? nowUtc
                : previousLedger.LastAbnormalExitDetectedUtc,
            LastAbnormalRunStartedAtUtc = previousRunIncomplete
                ? previousLedger.ActiveStartedAtUtc
                : previousLedger.LastAbnormalRunStartedAtUtc,
            LastSafeModeReason = reason ?? previousLedger.LastSafeModeReason
        };

        if (!TryWriteLedger(ledgerPath, ledger))
        {
            safeMode = true;
            reason = AppendReason(reason, "startup health ledger could not be persisted");
            ledger = ledger with { LastSafeModeReason = reason };
        }

        if (safeMode && applyEnvironment)
        {
            Environment.SetEnvironmentVariable(SafeModeEnvironmentVariable, "1");
            Environment.SetEnvironmentVariable(SafeModeReasonEnvironmentVariable, reason);
        }

        return new HostStartupSafetySession(ledgerPath, runId, ledger, safeMode, reason);
    }

    public bool MarkCleanExit(DateTimeOffset? nowUtc = null)
    {
        lock (_gate)
        {
            if (_disposed || _completed ||
                !string.Equals(_ledger.ActiveRunId, _runId, StringComparison.Ordinal))
            {
                return _completed;
            }

            var cleanLedger = _ledger with
            {
                ActiveRunId = null,
                ActiveProcessId = null,
                ActiveStartedAtUtc = null,
                ConsecutiveAbnormalExits = 0,
                LastCleanExitUtc = nowUtc ?? DateTimeOffset.UtcNow
            };
            if (!TryWriteLedger(_ledgerPath, cleanLedger))
            {
                return false;
            }

            _ledger = cleanLedger;
            _completed = true;
            return true;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
        }
    }

    private static string? ResolveReason(
        bool explicitSafeMode,
        bool shiftPressed,
        bool previousRunIncomplete,
        bool ledgerUnreadable)
    {
        var reasons = new List<string>(4);
        if (explicitSafeMode)
        {
            reasons.Add("--safe-mode was requested");
        }

        if (shiftPressed)
        {
            reasons.Add("Shift was held during startup");
        }

        if (previousRunIncomplete)
        {
            reasons.Add("the previous host run did not complete cleanly");
        }

        if (ledgerUnreadable)
        {
            reasons.Add("the startup health ledger was unreadable");
        }

        return reasons.Count == 0 ? null : string.Join("; ", reasons);
    }

    private static string AppendReason(string? current, string addition) =>
        string.IsNullOrWhiteSpace(current) ? addition : $"{current}; {addition}";

    private static (HostStartupHealthLedger Ledger, bool Unreadable) ReadLedger(string path)
    {
        if (!File.Exists(path))
        {
            return (HostStartupHealthLedger.Empty, false);
        }

        try
        {
            var fileInfo = new FileInfo(path);
            if (fileInfo.Length <= 0 || fileInfo.Length > MaximumLedgerBytes)
            {
                return (HostStartupHealthLedger.Empty, true);
            }

            var ledger = ReadBoundedLedger(path, fileInfo.Length);
            return ledger is null || !IsValidLedger(ledger)
                ? (HostStartupHealthLedger.Empty, true)
                : (ledger, false);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or JsonException or
                ArgumentException or NotSupportedException or System.Security.SecurityException)
        {
            HostLog.Warning($"Startup health ledger could not be read: {exception.Message}");
            return (HostStartupHealthLedger.Empty, true);
        }
    }

    private static bool IsValidLedger(HostStartupHealthLedger ledger)
    {
        if (ledger.SchemaVersion != SchemaVersion ||
            ledger.ConsecutiveAbnormalExits is < 0 or > 1000 ||
            ledger.LastSafeModeReason?.Length > 1024)
        {
            return false;
        }

        if (ledger.ActiveRunId is null)
        {
            return ledger.ActiveProcessId is null &&
                   ledger.ActiveStartedAtUtc is null &&
                   ledger.ConsecutiveAbnormalExits == 0;
        }

        if (string.IsNullOrWhiteSpace(ledger.ActiveRunId))
        {
            return false;
        }

        return Guid.TryParseExact(ledger.ActiveRunId, "N", out _) &&
               ledger.ActiveProcessId > 0 &&
               ledger.ActiveStartedAtUtc is not null;
    }

    private static bool TryWriteLedger(string path, HostStartupHealthLedger ledger)
    {
        string? temporaryPath = null;
        try
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(path))!;
            temporaryPath = Path.Combine(
                directory,
                $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
            Directory.CreateDirectory(directory);

            var payload = JsonSerializer.SerializeToUtf8Bytes(ledger, JsonOptions);
            if (payload.Length <= 0 || payload.Length > MaximumLedgerBytes)
            {
                HostLog.Warning("Startup health ledger serialization produced an invalid payload size.");
                return false;
            }

            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       bufferSize: 4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(payload);
                stream.Flush(flushToDisk: true);
            }

            if (File.Exists(path))
            {
                File.Replace(temporaryPath, path, destinationBackupFileName: null, ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(temporaryPath, path);
            }

            var committed = new FileInfo(path);
            if (committed.Length <= 0 || committed.Length > MaximumLedgerBytes)
            {
                HostLog.Warning("Startup health ledger commit could not be verified because its size is invalid.");
                return false;
            }

            var verified = ReadBoundedLedger(path, committed.Length);
            if (verified is null || !IsValidLedger(verified) || verified != ledger)
            {
                HostLog.Warning("Startup health ledger commit did not match the expected transaction.");
                return false;
            }

            return true;
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or
                ArgumentException or NotSupportedException or JsonException or
                System.Security.SecurityException)
        {
            HostLog.Warning($"Startup health ledger could not be written: {exception.Message}");
            try
            {
                if (temporaryPath is not null)
                {
                    File.Delete(temporaryPath);
                }
            }
            catch
            {
                // A stale temporary file can be replaced on the next startup.
            }

            return false;
        }
    }

    private static HostStartupHealthLedger? ReadBoundedLedger(string path, long length)
    {
        if (length <= 0 || length > MaximumLedgerBytes)
        {
            return null;
        }

        var byteLength = checked((int)length);
        var payload = new byte[byteLength];
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 4096,
            FileOptions.SequentialScan);
        var offset = 0;
        while (offset < payload.Length)
        {
            var read = stream.Read(payload, offset, payload.Length - offset);
            if (read == 0)
            {
                return null;
            }

            offset += read;
        }

        if (stream.ReadByte() != -1)
        {
            return null;
        }

        // Reject a UTF-8 BOM or malformed UTF-8 instead of accepting a payload
        // that differs from the transaction we believe we committed.
        var json = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
            .GetString(payload);
        return string.IsNullOrWhiteSpace(json)
            ? null
            : JsonSerializer.Deserialize<HostStartupHealthLedger>(json, JsonOptions);
    }
}

internal sealed record HostStartupHealthLedger(
    int SchemaVersion,
    string? ActiveRunId,
    int? ActiveProcessId,
    DateTimeOffset? ActiveStartedAtUtc,
    int ConsecutiveAbnormalExits,
    DateTimeOffset? LastCleanExitUtc,
    DateTimeOffset? LastAbnormalExitDetectedUtc,
    DateTimeOffset? LastAbnormalRunStartedAtUtc,
    string? LastSafeModeReason)
{
    public static HostStartupHealthLedger Empty { get; } = new(
        SchemaVersion: 1,
        ActiveRunId: null,
        ActiveProcessId: null,
        ActiveStartedAtUtc: null,
        ConsecutiveAbnormalExits: 0,
        LastCleanExitUtc: null,
        LastAbnormalExitDetectedUtc: null,
        LastAbnormalRunStartedAtUtc: null,
        LastSafeModeReason: null);
}

internal static class StartupModifierKeys
{
    private const int VirtualKeyShift = 0x10;

    public static bool IsShiftPressed()
    {
        try
        {
            return (GetAsyncKeyState(VirtualKeyShift) & 0x8000) != 0;
        }
        catch (DllNotFoundException)
        {
            return false;
        }
        catch (EntryPointNotFoundException)
        {
            return false;
        }
    }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);
}
