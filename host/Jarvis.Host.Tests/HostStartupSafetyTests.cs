using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Tests;

public sealed class HostStartupSafetyTests
{
    private static readonly DateTimeOffset Baseline =
        new(2026, 8, 19, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void IncompleteRunQuarantinesNextStartupUntilCleanExit()
    {
        using var sandbox = new TemporaryLedger();
        using (var first = Begin(sandbox.Path, Array.Empty<string>(), shiftPressed: false, processId: 10))
        {
            Assert.False(first.IsSafeMode);
            Assert.NotNull(first.Snapshot.ActiveRunId);
        }

        using (var recovery = Begin(sandbox.Path, Array.Empty<string>(), shiftPressed: false, processId: 11))
        {
            Assert.True(recovery.IsSafeMode);
            Assert.Contains("previous host run", recovery.Reason, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(1, recovery.Snapshot.ConsecutiveAbnormalExits);
            Assert.Equal(Baseline, recovery.Snapshot.LastAbnormalRunStartedAtUtc);
            Assert.Equal(Baseline, recovery.Snapshot.LastAbnormalExitDetectedUtc);
            Assert.True(recovery.MarkCleanExit(Baseline.AddMinutes(1)));
            Assert.Null(recovery.Snapshot.ActiveRunId);
        }

        using var next = Begin(sandbox.Path, Array.Empty<string>(), shiftPressed: false, processId: 12);
        Assert.False(next.IsSafeMode);
        Assert.Equal(0, next.Snapshot.ConsecutiveAbnormalExits);
    }

    [Theory]
    [InlineData(true, false, new string[] { }, "Shift")]
    [InlineData(false, true, new[] { "--safe-mode" }, "--safe-mode")]
    [InlineData(true, true, new[] { "--safe-mode" }, "--safe-mode")]
    public void ExplicitRecoveryEntrypointsEnableSafeMode(
        bool shiftPressed,
        bool argumentRequested,
        string[] arguments,
        string expectedReason)
    {
        Assert.Equal(argumentRequested, arguments.Length > 0);
        using var sandbox = new TemporaryLedger();
        using var session = Begin(
            sandbox.Path,
            arguments,
            shiftPressed,
            processId: 20);

        Assert.True(session.IsSafeMode);
        Assert.Contains(expectedReason, session.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CorruptLedgerFailsClosedAndCanBeRepairedByCleanExit()
    {
        using var sandbox = new TemporaryLedger("not-json");
        using var session = Begin(
            sandbox.Path,
            Array.Empty<string>(),
            shiftPressed: false,
            processId: 30);

        Assert.True(session.IsSafeMode);
        Assert.Contains("unreadable", session.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.True(session.MarkCleanExit(Baseline.AddMinutes(2)));

        using var repaired = Begin(
            sandbox.Path,
            Array.Empty<string>(),
            shiftPressed: false,
            processId: 31);
        Assert.False(repaired.IsSafeMode);
    }

    [Fact]
    public void OversizedLedgerFailsClosedWithoutParsingUnboundedState()
    {
        using var sandbox = new TemporaryLedger(new string('x', 33 * 1024));
        using var session = Begin(
            sandbox.Path,
            Array.Empty<string>(),
            shiftPressed: false,
            processId: 40);

        Assert.True(session.IsSafeMode);
        Assert.Contains("unreadable", session.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EmptyLedgerFailsClosedAndIsReplacedByAnExactlyVerifiedTransaction()
    {
        using var sandbox = new TemporaryLedger(string.Empty);
        using var session = Begin(
            sandbox.Path,
            Array.Empty<string>(),
            shiftPressed: false,
            processId: 50);

        Assert.True(session.IsSafeMode);
        Assert.Contains("unreadable", session.Reason, StringComparison.OrdinalIgnoreCase);
        var persisted = JsonSerializer.Deserialize<HostStartupHealthLedger>(
            File.ReadAllText(sandbox.Path),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(session.Snapshot, persisted);
        Assert.Empty(Directory.GetFiles(sandbox.DirectoryPath, "*.tmp"));
    }

    [Fact]
    public void CommitFailureFailsClosedAndNeverClaimsAHealthyStartup()
    {
        using var sandbox = new TemporaryLedger();
        Directory.CreateDirectory(sandbox.Path);

        using var session = Begin(
            sandbox.Path,
            Array.Empty<string>(),
            shiftPressed: false,
            processId: 60);

        Assert.True(session.IsSafeMode);
        Assert.Contains("could not be persisted", session.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.False(session.MarkCleanExit(Baseline.AddMinutes(3)));
    }

    private static HostStartupSafetySession Begin(
        string ledgerPath,
        IReadOnlyList<string> arguments,
        bool shiftPressed,
        int processId) =>
        HostStartupSafetySession.Begin(
            arguments,
            shiftPressed,
            ledgerPath,
            Baseline,
            processId,
            applyEnvironment: false);

    private sealed class TemporaryLedger : IDisposable
    {
        private readonly string _directory;

        public TemporaryLedger(string? initialContent = null)
        {
            _directory = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "jarvis-host-startup-safety-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_directory);
            Path = System.IO.Path.Combine(_directory, "startup-health.json");
            if (initialContent is not null)
            {
                File.WriteAllText(Path, initialContent);
            }
        }

        public string Path { get; }

        public string DirectoryPath => _directory;

        public void Dispose()
        {
            if (Directory.Exists(_directory))
            {
                Directory.Delete(_directory, recursive: true);
            }
        }
    }
}
