using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarGracefulExitGateTests
{
    [Fact]
    public void VerifiedRestoreAuthorizesTheInitialGracefulClose()
    {
        var gate = new TaskbarGracefulExitGate();

        gate.Request();

        Assert.True(gate.ObserveRestore(verified: true));
        Assert.True(gate.FinalCloseAuthorized);
        Assert.False(gate.WaitingForVerification);
    }

    [Fact]
    public void UnverifiedRestoreCancelsCloseUntilAReceiptIsConfirmed()
    {
        var gate = new TaskbarGracefulExitGate();

        gate.Request();

        Assert.False(gate.ObserveRestore(verified: false));
        Assert.True(gate.WaitingForVerification);
        Assert.False(gate.FinalCloseAuthorized);
        Assert.True(gate.ConfirmVerifiedRestore());
        Assert.True(gate.FinalCloseAuthorized);
        Assert.False(gate.WaitingForVerification);
    }

    [Fact]
    public void ExternalCloseDoesNotWaitOnTheGracefulExitGate()
    {
        var gate = new TaskbarGracefulExitGate();

        Assert.True(gate.ObserveRestore(verified: false));
        Assert.False(gate.Requested);
        Assert.False(gate.ConfirmVerifiedRestore());
    }
}
