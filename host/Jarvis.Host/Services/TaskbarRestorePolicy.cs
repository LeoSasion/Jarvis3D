namespace Jarvis.Host.Services;

internal enum TaskbarVisibilityState
{
    Missing,
    Invalid,
    Hidden,
    Visible
}

internal readonly record struct TaskbarRestoreReceipt(
    bool Requested,
    bool Verified,
    int Attempts,
    string? FailureReason)
{
    public static TaskbarRestoreReceipt NotRequired { get; } =
        new(Requested: false, Verified: true, Attempts: 0, FailureReason: null);
}

internal static class TaskbarRestorePolicy
{
    internal const int DefaultMaximumAttempts = 5;
    internal static readonly TimeSpan DefaultVerificationDelay = TimeSpan.FromMilliseconds(80);

    public static TaskbarRestoreReceipt Restore(
        Func<TaskbarVisibilityState> inspect,
        Action requestShow,
        Action<TimeSpan> wait,
        int maximumAttempts = DefaultMaximumAttempts,
        TimeSpan? verificationDelay = null)
    {
        ArgumentNullException.ThrowIfNull(inspect);
        ArgumentNullException.ThrowIfNull(requestShow);
        ArgumentNullException.ThrowIfNull(wait);
        if (maximumAttempts <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumAttempts));
        }

        var delay = verificationDelay ?? DefaultVerificationDelay;
        if (delay < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(verificationDelay));
        }

        var state = inspect();
        if (state == TaskbarVisibilityState.Visible)
        {
            return TaskbarRestoreReceipt.NotRequired;
        }

        var requested = false;
        for (var attempt = 1; attempt <= maximumAttempts; attempt++)
        {
            if (state == TaskbarVisibilityState.Hidden)
            {
                requestShow();
                requested = true;
            }

            wait(delay);
            state = inspect();
            if (state == TaskbarVisibilityState.Visible)
            {
                return new TaskbarRestoreReceipt(
                    requested,
                    Verified: true,
                    Attempts: attempt,
                    FailureReason: null);
            }
        }

        var failureReason = state switch
        {
            TaskbarVisibilityState.Missing =>
                "The primary Windows taskbar window was not available for verification.",
            TaskbarVisibilityState.Invalid =>
                "The candidate Windows taskbar was not a verified Explorer-owned primary bottom taskbar.",
            _ => "The primary Windows taskbar remained hidden after the recovery retry limit."
        };
        return new TaskbarRestoreReceipt(
            requested,
            Verified: false,
            Attempts: maximumAttempts,
            failureReason);
    }
}
