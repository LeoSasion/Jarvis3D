using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class TaskbarReplacementSession : IDisposable
{
    private readonly object _gate = new();
    private readonly CancellationTokenSource _shutdown = new();

    private TaskbarWatchdogChannel? _watchdog;
    private bool _watchdogExited;
    private bool _active;
    private bool _activating;
    private bool _restoreRequested;
    private bool _disposed;
    private long _generation;

    public event Action? ReplacementLost;

    public event Action? NativeRestoreVerified;

    public bool TryGetTargetBounds(out PixelRect bounds)
    {
        if (Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1")
        {
            bounds = default;
            return false;
        }

        return NativeTaskbarController.TryGetVisiblePrimaryBounds(out bounds);
    }

    public async Task<bool> ActivateAsync(IntPtr replacementWindowHandle)
    {
        long generation;
        lock (_gate)
        {
            if (_disposed)
            {
                return false;
            }

            if (_active)
            {
                return !_restoreRequested;
            }

            if (_activating)
            {
                return false;
            }

            _activating = true;
            _watchdogExited = false;
            _restoreRequested = false;
            generation = ++_generation;
        }

        TaskbarWatchdogChannel? watchdog = null;
        try
        {
            HostLog.Info(
                $"Taskbar replacement activation started for window 0x{replacementWindowHandle.ToInt64():X}.");
            if (!NativeTaskbarController.TryGetVisiblePrimaryBounds(out _))
            {
                HostLog.Warning("Taskbar replacement activation stopped because the native taskbar is not visible.");
                return false;
            }

            if (replacementWindowHandle == IntPtr.Zero)
            {
                HostLog.Warning("Taskbar replacement activation stopped because the replacement window handle is zero.");
                return false;
            }

            watchdog = TaskbarWatchdog.StartForCurrentProcess(replacementWindowHandle);
            HostLog.Info($"Taskbar watchdog process {watchdog.Process.Id} started; awaiting recovery handshake.");
            watchdog.Process.EnableRaisingEvents = true;
            watchdog.Process.Exited += OnWatchdogExited;

            lock (_gate)
            {
                if (_disposed || generation != _generation)
                {
                    watchdog.Process.Exited -= OnWatchdogExited;
                    watchdog.RequestRestore();
                    watchdog.Dispose();
                    return false;
                }

                _watchdog = watchdog;
            }

            if (!await watchdog.ArmAndHideAsync(_shutdown.Token))
            {
                HostLog.Warning(
                    "Taskbar replacement was not enabled because the watchdog did not confirm a hidden taskbar.");
                watchdog.RequestRestore();
                _ = Restore();
                return false;
            }

            HostLog.Info("Taskbar watchdog confirmed that the native taskbar is hidden.");
            NativeTaskbarController.AcquireVisibilityLease();
            var activationFailed = false;
            lock (_gate)
            {
                activationFailed = _disposed ||
                                   generation != _generation ||
                                   _watchdogExited ||
                                   watchdog.Process.HasExited ||
                                   !ReferenceEquals(_watchdog, watchdog);
                if (!activationFailed)
                {
                    _active = true;
                }
            }

            if (activationFailed)
            {
                watchdog.RequestRestore();
                _ = Restore();
                HostLog.Warning("Taskbar replacement was rolled back because the watchdog exited during activation.");
                return false;
            }

            HostLog.Info("Primary Windows taskbar replacement is active.");
            return true;
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            watchdog?.RequestRestore();
            _ = Restore();
            return false;
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar replacement activation failed.", ex);
            watchdog?.RequestRestore();
            _ = Restore();
            return false;
        }
        finally
        {
            lock (_gate)
            {
                if (generation == _generation)
                {
                    _activating = false;
                }
            }
        }
    }

    public TaskbarRestoreReceipt Restore()
    {
        TaskbarWatchdogChannel? watchdog;
        lock (_gate)
        {
            _generation++;
            _activating = false;
            _restoreRequested = true;
            watchdog = _watchdog;
        }

        watchdog?.RequestRestore();

        var receipt = RestoreOwnedTaskbarWithReceipt("taskbar replacement shutdown");
        if (receipt.Verified)
        {
            CompleteVerifiedRestore(watchdog);
        }

        return receipt;
    }

    private void OnWatchdogExited(object? sender, EventArgs e)
    {
        var shouldDisable = false;
        var restoreRequested = false;
        TaskbarWatchdogChannel? watchdog;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            if (_watchdog is null || !ReferenceEquals(_watchdog.Process, sender))
            {
                return;
            }

            _watchdogExited = true;
            watchdog = _watchdog;
            restoreRequested = _restoreRequested;
            shouldDisable = _active && !restoreRequested;
        }

        if (restoreRequested)
        {
            var receipt = RestoreOwnedTaskbarWithReceipt("watchdog recovery completion");
            if (receipt.Verified)
            {
                CompleteVerifiedRestore(watchdog);
                NativeRestoreVerified?.Invoke();
            }
            else
            {
                HostLog.Warning(
                    "The watchdog recovery window ended without a verified native taskbar; " +
                    "the replacement surface and recovery lease remain active for retry.");
            }

            return;
        }

        if (shouldDisable)
        {
            DisableAfterFailure("The taskbar recovery watchdog exited unexpectedly.");
        }
    }

    private void DisableAfterFailure(string message)
    {
        HostLog.Warning(message);
        Restore();
        ReplacementLost?.Invoke();
    }

    public void Dispose()
    {
        TaskbarWatchdogChannel? watchdog;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _generation++;
            _shutdown.Cancel();
            _restoreRequested = true;
            watchdog = _watchdog;
        }

        watchdog?.RequestRestore();
        var receipt = RestoreOwnedTaskbarWithReceipt("taskbar replacement disposal");
        if (receipt.Verified)
        {
            CompleteVerifiedRestore(watchdog);
            watchdog = null;
        }

        if (watchdog is not null)
        {
            watchdog.Process.Exited -= OnWatchdogExited;
            watchdog.Dispose();
        }
        _shutdown.Dispose();
    }

    private void CompleteVerifiedRestore(TaskbarWatchdogChannel? expectedWatchdog)
    {
        TaskbarWatchdogChannel? watchdogToDispose = null;
        lock (_gate)
        {
            _active = false;
            _activating = false;
            _restoreRequested = false;
            if (expectedWatchdog is null || ReferenceEquals(_watchdog, expectedWatchdog))
            {
                watchdogToDispose = _watchdog;
                _watchdog = null;
            }
        }

        if (watchdogToDispose is not null)
        {
            watchdogToDispose.Process.Exited -= OnWatchdogExited;
            watchdogToDispose.Dispose();
        }
    }

    private static TaskbarRestoreReceipt RestoreOwnedTaskbarWithReceipt(string reason)
    {
        var receipt = NativeTaskbarController.RestoreOwnedPrimary();
        if (!receipt.Verified)
        {
            HostLog.Warning(
                $"Native taskbar recovery was not verified during {reason}; " +
                "the application-level recovery lease remains active for another exit-path attempt.");
        }

        return receipt;
    }
}
