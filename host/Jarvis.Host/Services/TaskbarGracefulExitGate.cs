namespace Jarvis.Host.Services;

internal sealed class TaskbarGracefulExitGate
{
    public bool Requested { get; private set; }

    public bool WaitingForVerification { get; private set; }

    public bool FinalCloseAuthorized { get; private set; }

    public void Request()
    {
        if (!FinalCloseAuthorized)
        {
            Requested = true;
        }
    }

    public bool ObserveRestore(bool verified)
    {
        if (!Requested)
        {
            return true;
        }

        WaitingForVerification = !verified;
        FinalCloseAuthorized = verified;
        return verified;
    }

    public bool ConfirmVerifiedRestore()
    {
        if (!Requested || FinalCloseAuthorized)
        {
            return false;
        }

        WaitingForVerification = false;
        FinalCloseAuthorized = true;
        return true;
    }
}
