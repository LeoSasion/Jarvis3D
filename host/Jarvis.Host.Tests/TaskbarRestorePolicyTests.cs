using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarRestorePolicyTests
{
    [Fact]
    public void AlreadyVisibleTaskbarReturnsVerifiedReceiptWithoutShowRequest()
    {
        var showRequests = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => TaskbarVisibilityState.Visible,
            () => showRequests++,
            _ => { });

        Assert.True(receipt.Verified);
        Assert.False(receipt.Requested);
        Assert.Equal(0, receipt.Attempts);
        Assert.Equal(0, showRequests);
    }

    [Fact]
    public void HiddenTaskbarIsRetriedUntilVisibilityIsConfirmed()
    {
        var showRequests = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => showRequests >= 2
                ? TaskbarVisibilityState.Visible
                : TaskbarVisibilityState.Hidden,
            () => showRequests++,
            _ => { },
            maximumAttempts: 4);

        Assert.True(receipt.Verified);
        Assert.True(receipt.Requested);
        Assert.Equal(2, receipt.Attempts);
        Assert.Equal(2, showRequests);
        Assert.Null(receipt.FailureReason);
    }

    [Fact]
    public void MissingTaskbarFailsAfterBoundedVerificationWindow()
    {
        var waits = 0;
        var showRequests = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => TaskbarVisibilityState.Missing,
            () => showRequests++,
            _ => waits++,
            maximumAttempts: 3,
            verificationDelay: TimeSpan.Zero);

        Assert.False(receipt.Verified);
        Assert.False(receipt.Requested);
        Assert.Equal(3, receipt.Attempts);
        Assert.Equal(3, waits);
        Assert.Equal(0, showRequests);
        Assert.Contains("not available", receipt.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void PersistentlyHiddenTaskbarReportsUnverifiedRecovery()
    {
        var showRequests = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => TaskbarVisibilityState.Hidden,
            () => showRequests++,
            _ => { },
            maximumAttempts: 2,
            verificationDelay: TimeSpan.Zero);

        Assert.False(receipt.Verified);
        Assert.True(receipt.Requested);
        Assert.Equal(2, showRequests);
        Assert.Contains("remained hidden", receipt.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void InvalidTaskbarCandidateIsNeverShownOrReportedAsRecovered()
    {
        var showRequests = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => TaskbarVisibilityState.Invalid,
            () => showRequests++,
            _ => { },
            maximumAttempts: 3,
            verificationDelay: TimeSpan.Zero);

        Assert.False(receipt.Verified);
        Assert.False(receipt.Requested);
        Assert.Equal(0, showRequests);
        Assert.Contains("Explorer-owned", receipt.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RecoveryWaitsForExplorerRecreationThenVerifiesTheShownTaskbar()
    {
        var states = new Queue<TaskbarVisibilityState>(new[]
        {
            TaskbarVisibilityState.Missing,
            TaskbarVisibilityState.Missing,
            TaskbarVisibilityState.Hidden,
            TaskbarVisibilityState.Visible
        });
        var showRequests = 0;
        var waits = 0;

        var receipt = TaskbarRestorePolicy.Restore(
            () => states.Dequeue(),
            () => showRequests++,
            _ => waits++,
            maximumAttempts: 4,
            verificationDelay: TimeSpan.Zero);

        Assert.True(receipt.Verified);
        Assert.True(receipt.Requested);
        Assert.Equal(3, receipt.Attempts);
        Assert.Equal(1, showRequests);
        Assert.Equal(3, waits);
    }

    [Theory]
    [InlineData("explorer", true)]
    [InlineData("EXPLORER", true)]
    [InlineData("fake-shell", false)]
    [InlineData(null, false)]
    public void NativeCandidateRequiresExplorerOwnership(string? processName, bool expected)
    {
        var monitor = new PixelRect(0, 0, 2560, 1440);
        var taskbar = new PixelRect(0, 1392, 2560, 1440);

        Assert.Equal(
            expected,
            NativeTaskbarController.IsVerifiedTaskbarCandidate(processName, taskbar, monitor));
    }

    [Theory]
    [InlineData(20, 200, 2540, 1440)]
    [InlineData(0, 0, 2560, 48)]
    [InlineData(0, 1300, 300, 1440)]
    [InlineData(0, 1392, 2560, 1430)]
    public void NativeCandidateRejectsNonBottomOrImplausibleGeometry(
        int left,
        int top,
        int right,
        int bottom)
    {
        var monitor = new PixelRect(0, 0, 2560, 1440);

        Assert.False(NativeTaskbarController.IsVerifiedTaskbarCandidate(
            "explorer",
            new PixelRect(left, top, right, bottom),
            monitor));
    }
}
