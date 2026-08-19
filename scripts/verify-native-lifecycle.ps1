[CmdletBinding()]
param(
    [string]$JarvisExecutable,
    [string]$OutputPath = (Join-Path $PSScriptRoot "native-lifecycle-result.json"),
    [switch]$LaunchSafeMode,
    [switch]$AllowDisruptive
)

$ErrorActionPreference = "Stop"

if ($AllowDisruptive) {
    Write-Warning "Disruptive Explorer, display, lock, sleep, and network tests require explicit interactive coordination and are not automated by this script."
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisLifecycleNativeMethods
{
    public const uint WM_HOTKEY = 0x0312;
    public const int SafetyHotkeyId = 0x4A52;
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(
        IntPtr window,
        uint message,
        IntPtr wParam,
        IntPtr lParam);

    public static IntPtr FindTopLevelWindow(uint expectedProcessId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            GetWindowThreadProcessId(window, out uint ownerProcessId);
            if (ownerProcessId != expectedProcessId)
            {
                return true;
            }

            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
"@

function Request-JarvisGracefulClose {
    param([System.Diagnostics.Process]$Process)

    # ShowInTaskbar=false prevents Process.CloseMainWindow() from finding the
    # WPF desktop window. Cold WebView2 startup can also take longer than the
    # sampling delay, so discover the exact owned window within a bounded wait
    # before posting the same recovery message as Ctrl+Shift+Q. This exercises
    # the Host's verified safe-exit path without injecting input into the user's
    # foreground application.
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $Process.Refresh()
        if ($Process.HasExited) {
            return $false
        }

        $window = [JarvisLifecycleNativeMethods]::FindTopLevelWindow(
            [uint32]$Process.Id)
        if ($window -ne [IntPtr]::Zero) {
            [uint32]$ownerProcessId = 0
            [JarvisLifecycleNativeMethods]::GetWindowThreadProcessId(
                $window,
                [ref]$ownerProcessId) | Out-Null
            if ($ownerProcessId -eq [uint32]$Process.Id) {
                return [JarvisLifecycleNativeMethods]::PostMessage(
                    $window,
                    [JarvisLifecycleNativeMethods]::WM_HOTKEY,
                    [IntPtr][JarvisLifecycleNativeMethods]::SafetyHotkeyId,
                    [IntPtr]::Zero)
            }
        }

        Start-Sleep -Milliseconds 250
    }
    while ([DateTime]::UtcNow -lt $deadline)

    return $false
}

function Get-LifecycleSnapshot {
    $explorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue)
    $jarvis = @(Get-Process -Name "Jarvis.Host" -ErrorAction SilentlyContinue)
    $taskbar = [JarvisLifecycleNativeMethods]::FindWindow("Shell_TrayWnd", $null)
    [ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString("o")
        windowsVersion = [Environment]::OSVersion.Version.ToString()
        windowsBuild = [Environment]::OSVersion.Version.Build
        explorerProcessCount = $explorer.Count
        explorerAlive = $explorer.Count -gt 0
        nativeTaskbarHandle = ("0x{0:X}" -f $taskbar.ToInt64())
        nativeTaskbarVisible = $taskbar -ne [IntPtr]::Zero -and
            [JarvisLifecycleNativeMethods]::IsWindowVisible($taskbar)
        jarvisProcessCount = $jarvis.Count
    }
}

$before = Get-LifecycleSnapshot
$launch = $null
$launchSessionId = $null
$failure = $null

if ($LaunchSafeMode) {
    if ([string]::IsNullOrWhiteSpace($JarvisExecutable) -or
        -not (Test-Path -LiteralPath $JarvisExecutable -PathType Leaf)) {
        throw "LaunchSafeMode requires an existing -JarvisExecutable."
    }

    $previous = $env:JARVIS_KEEP_NATIVE_TASKBAR
    try {
        $env:JARVIS_KEEP_NATIVE_TASKBAR = "1"
        $launch = Start-Process -FilePath $JarvisExecutable -PassThru -WindowStyle Hidden
        $launchSessionId = $launch.SessionId
        Start-Sleep -Milliseconds 2500
        if ($launch.HasExited) {
            $failure = "JARVIS exited before the safe-mode lifecycle sample completed."
        }
    }
    finally {
        if ($launch -and -not $launch.HasExited) {
            if (-not (Request-JarvisGracefulClose -Process $launch)) {
                $failure =
                    "The safe-mode JARVIS window could not receive a verified graceful close."
            }
            elseif (-not $launch.WaitForExit(15000)) {
                $failure =
                    "The safe-mode JARVIS process did not complete graceful shutdown within 15 seconds."
            }

            if (-not $launch.HasExited) {
                Stop-Process -Id $launch.Id -Force
                if (-not $launch.WaitForExit(5000)) {
                    $failure =
                        "The safe-mode JARVIS process did not exit after forced cleanup."
                }
            }
        }
        $env:JARVIS_KEEP_NATIVE_TASKBAR = $previous
    }

    if (-not $failure -and $null -ne $launchSessionId) {
        $ledgerPath = Join-Path $env:LOCALAPPDATA (
            "JARVIS\State\startup-health-session-{0}.json" -f $launchSessionId)
        try {
            if (-not (Test-Path -LiteralPath $ledgerPath -PathType Leaf)) {
                $failure = "The safe-mode JARVIS run did not persist its startup health ledger."
            }
            else {
                $ledger = Get-Content -LiteralPath $ledgerPath -Raw -Encoding UTF8 |
                    ConvertFrom-Json
                if ($null -ne $ledger.activeRunId -or
                    $null -ne $ledger.activeProcessId -or
                    $null -ne $ledger.activeStartedAtUtc) {
                    $failure =
                        "The safe-mode JARVIS run exited without committing a clean startup health ledger."
                }
            }
        }
        catch {
            $failure =
                "The safe-mode JARVIS startup health ledger could not be verified: $($_.Exception.Message)"
        }
    }
}

$after = Get-LifecycleSnapshot
$result = [ordered]@{
    status = if (
        -not $failure -and
        $after.explorerAlive -and
        $after.nativeTaskbarVisible -and
        $after.jarvisProcessCount -eq 0
    ) { "READY" } else { "ATTENTION" }
    failure = $failure
    safeModeLaunchRequested = [bool]$LaunchSafeMode
    disruptiveTestsExecuted = $false
    before = $before
    after = $after
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
$result | ConvertTo-Json -Depth 6

if ($result.status -ne "READY") {
    exit 1
}
