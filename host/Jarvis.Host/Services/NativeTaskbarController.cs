using System.Diagnostics;
using System.Runtime.InteropServices;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal static class NativeTaskbarController
{
    private const int SwHide = 0;
    private const int SwShowNoActivate = 8;
    private const uint MonitorDefaultToNull = 0;
    private const uint MonitorInfoPrimary = 1;
    private const int WatchdogRestoreMaximumAttempts = 24;
    private static readonly TimeSpan WatchdogRestoreVerificationDelay = TimeSpan.FromMilliseconds(500);
    private static int _ownsVisibilityLease;

    public static bool OwnsVisibilityLease => Volatile.Read(ref _ownsVisibilityLease) == 1;

    public static void AcquireVisibilityLease()
    {
        Interlocked.Exchange(ref _ownsVisibilityLease, 1);
    }

    public static bool TryGetVisiblePrimaryBounds(out PixelRect bounds)
    {
        return TryGetVisiblePrimary(out _, out bounds);
    }

    public static bool TryGetVisiblePrimary(out IntPtr taskbar, out PixelRect bounds)
    {
        return InspectPrimaryTaskbar(out taskbar, out bounds) == TaskbarVisibilityState.Visible;
    }

    public static bool IsPrimaryVisible() =>
        InspectPrimaryTaskbar(out _, out _) == TaskbarVisibilityState.Visible;

    public static bool HidePrimary()
    {
        if (InspectPrimaryTaskbar(out var taskbar, out _) != TaskbarVisibilityState.Visible)
        {
            return false;
        }

        _ = ShowWindowAsync(taskbar, SwHide);
        return true;
    }

    public static void HideReplacementWindow(IntPtr window, int expectedProcessId)
    {
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            return;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == checked((uint)expectedProcessId))
        {
            _ = ShowWindowAsync(window, SwHide);
        }
    }

    public static TaskbarRestoreReceipt RestorePrimary() => RestorePrimary(
        TaskbarRestorePolicy.DefaultMaximumAttempts,
        TaskbarRestorePolicy.DefaultVerificationDelay,
        "host");

    public static TaskbarRestoreReceipt RestorePrimaryForWatchdog() => RestorePrimary(
        WatchdogRestoreMaximumAttempts,
        WatchdogRestoreVerificationDelay,
        "watchdog");

    private static TaskbarRestoreReceipt RestorePrimary(
        int maximumAttempts,
        TimeSpan verificationDelay,
        string recoveryOwner)
    {
        try
        {
            var receipt = TaskbarRestorePolicy.Restore(
                InspectPrimaryVisibility,
                RequestPrimaryShow,
                Thread.Sleep,
                maximumAttempts,
                verificationDelay);
            if (receipt.Verified)
            {
                HostLog.Info(
                    receipt.Requested
                        ? $"Primary Windows taskbar restore verified by {recoveryOwner} after {receipt.Attempts} attempt(s)."
                        : $"Primary Windows taskbar was already visible; {recoveryOwner} recovery verified.");
            }
            else
            {
                HostLog.Warning(
                    $"Primary Windows taskbar restore by {recoveryOwner} was not verified after " +
                    $"{receipt.Attempts} attempt(s). " +
                    receipt.FailureReason);
            }

            return receipt;
        }
        catch (Exception ex)
        {
            HostLog.Error("Failed to restore the primary Windows taskbar.", ex);
            return new TaskbarRestoreReceipt(
                Requested: false,
                Verified: false,
                Attempts: 0,
                FailureReason: ex.Message);
        }
    }

    public static TaskbarRestoreReceipt RestoreOwnedPrimary()
    {
        if (!OwnsVisibilityLease)
        {
            return TaskbarRestoreReceipt.NotRequired;
        }

        var receipt = RestorePrimary();
        if (receipt.Verified)
        {
            _ = Interlocked.CompareExchange(ref _ownsVisibilityLease, 0, 1);
        }

        return receipt;
    }

    private static TaskbarVisibilityState InspectPrimaryVisibility()
        => InspectPrimaryTaskbar(out _, out _);

    private static void RequestPrimaryShow()
    {
        if (InspectPrimaryTaskbar(out var taskbar, out _) == TaskbarVisibilityState.Hidden)
        {
            _ = ShowWindowAsync(taskbar, SwShowNoActivate);
        }
    }

    private static TaskbarVisibilityState InspectPrimaryTaskbar(
        out IntPtr taskbar,
        out PixelRect bounds)
    {
        taskbar = FindWindow("Shell_TrayWnd", null);
        bounds = default;
        if (taskbar == IntPtr.Zero)
        {
            return TaskbarVisibilityState.Missing;
        }

        if (!IsWindow(taskbar) || !TryGetOwnerProcessName(taskbar, out var ownerProcessName))
        {
            return TaskbarVisibilityState.Invalid;
        }

        var monitor = MonitorFromWindow(taskbar, MonitorDefaultToNull);
        if (monitor == IntPtr.Zero)
        {
            return TaskbarVisibilityState.Invalid;
        }

        var monitorInfo = MonitorInfo.Create();
        if (!GetMonitorInfo(monitor, ref monitorInfo) ||
            (monitorInfo.Flags & MonitorInfoPrimary) == 0 ||
            !GetWindowRect(taskbar, out var rect) ||
            !NativeDisplay.TryGetPrimaryMonitorBounds(out var monitorBounds))
        {
            return TaskbarVisibilityState.Invalid;
        }

        bounds = new PixelRect(rect.Left, rect.Top, rect.Right, rect.Bottom);
        if (!IsVerifiedTaskbarCandidate(ownerProcessName, bounds, monitorBounds))
        {
            return TaskbarVisibilityState.Invalid;
        }

        return IsWindowVisible(taskbar)
            ? TaskbarVisibilityState.Visible
            : TaskbarVisibilityState.Hidden;
    }

    internal static bool IsVerifiedTaskbarCandidate(
        string? ownerProcessName,
        PixelRect bounds,
        PixelRect monitorBounds) =>
        string.Equals(ownerProcessName, "explorer", StringComparison.OrdinalIgnoreCase) &&
        IsSupportedHorizontalTaskbar(bounds, monitorBounds);

    private static bool TryGetOwnerProcessName(IntPtr window, out string? processName)
    {
        processName = null;
        _ = GetWindowThreadProcessId(window, out var processId);
        var shellWindow = GetShellWindow();
        _ = GetWindowThreadProcessId(shellWindow, out var shellProcessId);
        if (processId == 0 ||
            processId > int.MaxValue ||
            shellWindow == IntPtr.Zero ||
            shellProcessId != processId)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById((int)processId);
            processName = process.ProcessName;
            return !string.IsNullOrWhiteSpace(processName);
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException or
                System.ComponentModel.Win32Exception or NotSupportedException)
        {
            return false;
        }
    }

    private static bool IsSupportedHorizontalTaskbar(PixelRect bounds, PixelRect monitorBounds)
    {
        var horizontal = bounds.Width >= 480 && bounds.Width > bounds.Height * 4 && bounds.Height >= 24;
        var spansMonitor = bounds.Left <= monitorBounds.Left + 2 &&
                           bounds.Right >= monitorBounds.Right - 2;
        var attachedToBottom = Math.Abs(bounds.Bottom - monitorBounds.Bottom) <= 2;
        return horizontal && spansMonitor && attachedToBottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string? className, string? windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo
    {
        public uint Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public uint Flags;

        public static MonitorInfo Create() => new()
        {
            Size = (uint)Marshal.SizeOf<MonitorInfo>()
        };
    }
}
