[CmdletBinding()]
param(
    [string]$HostPath = (
        Join-Path $PSScriptRoot '..\host\Jarvis.Host\bin\Debug\net8.0-windows\Jarvis.Host.exe'),
    [string]$OutputPath,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($TimeoutSeconds -lt 20 -or $TimeoutSeconds -gt 90) {
    throw 'TimeoutSeconds must be between 20 and 90.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class JarvisCrashRecoveryNative
{
    public const uint WmHotkey = 0x0312;
    public const int SafetyHotkeyId = 0x4A52;
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr window, StringBuilder value, int maximum);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(
        IntPtr window,
        uint message,
        IntPtr wordParameter,
        IntPtr longParameter);

    public static IntPtr FindOwnedWindow(uint expectedProcessId, string expectedTitle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            GetWindowThreadProcessId(window, out uint ownerProcessId);
            if (ownerProcessId != expectedProcessId)
            {
                return true;
            }

            var title = new StringBuilder(128);
            GetWindowText(window, title, title.Capacity);
            if (!String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal))
            {
                return true;
            }

            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@

function Test-NativeTaskbarVisible {
    $window = [JarvisCrashRecoveryNative]::FindWindow('Shell_TrayWnd', $null)
    return $window -ne [IntPtr]::Zero -and
        [JarvisCrashRecoveryNative]::IsWindowVisible($window)
}

function Reset-LogCursor {
    $script:logLineStart = if (Test-Path -LiteralPath $script:logPath) {
        @(Get-Content -LiteralPath $script:logPath -Encoding UTF8).Count
    }
    else {
        0
    }
}

function Get-NewHostLog {
    if (-not (Test-Path -LiteralPath $script:logPath -PathType Leaf)) {
        return ''
    }

    return @(
        Get-Content -LiteralPath $script:logPath -Encoding UTF8 |
            Select-Object -Skip $script:logLineStart
    ) -join [Environment]::NewLine
}

function Wait-HostLog {
    param(
        [string]$Pattern,
        [int]$Seconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        Start-Sleep -Milliseconds 200
        if ((Get-NewHostLog) -match $Pattern) {
            return
        }
    }
    while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for Host log pattern: $Pattern"
}

function Wait-JarvisProcessesExit {
    param([int]$Seconds)

    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $processes = @(Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue)
        if ($processes.Count -eq 0) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    while ([DateTime]::UtcNow -lt $deadline)

    return $false
}

function Request-SafeExit {
    param([System.Diagnostics.Process]$Process)

    $window = [JarvisCrashRecoveryNative]::FindOwnedWindow(
        [uint32]$Process.Id,
        'JARVIS')
    return $window -ne [IntPtr]::Zero -and
        [JarvisCrashRecoveryNative]::PostMessage(
            $window,
            [JarvisCrashRecoveryNative]::WmHotkey,
            [IntPtr][JarvisCrashRecoveryNative]::SafetyHotkeyId,
            [IntPtr]::Zero)
}

function Get-StartupLedger {
    param([int]$SessionId)

    $path = Join-Path $env:LOCALAPPDATA (
        'JARVIS\State\startup-health-session-{0}.json' -f $SessionId)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return $null
    }

    return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

$resolvedHost = [System.IO.Path]::GetFullPath($HostPath)
if (-not (Test-Path -LiteralPath $resolvedHost -PathType Leaf)) {
    throw "Crash recovery Host does not exist: $resolvedHost"
}
if (Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue) {
    throw 'Crash recovery verification requires JARVIS to be closed.'
}
if (-not (Test-NativeTaskbarVisible)) {
    throw 'The native Explorer taskbar must be visible before crash recovery verification.'
}

$settingsPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Settings\taskbar-mode.json'
if (Test-Path -LiteralPath $settingsPath) {
    throw 'Crash recovery verification will not overwrite a taskbar preference.'
}

$sessionId = (Get-Process -Id $PID).SessionId
$startingLedger = Get-StartupLedger -SessionId $sessionId
if ($null -ne $startingLedger -and $null -ne $startingLedger.activeRunId) {
    throw 'Crash recovery verification requires a clean startup health ledger.'
}

$script:logPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Logs\jarvis-host.log'
$fullHost = $null
$safeHost = $null
$failure = $null
$forcedHostKilled = $false
$watchdogRestoredTaskbar = $false
$abnormalLedgerArmed = $false
$automaticSafeModeObserved = $false
$finalSafeExitCompleted = $false
$emergencyCleanup = $false

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $settingsPath) -Force |
        Out-Null
    '{"mode":"full"}' | Set-Content -LiteralPath $settingsPath -Encoding UTF8

    Reset-LogCursor
    $fullHost = Start-Process -FilePath $resolvedHost -PassThru
    Wait-HostLog -Pattern 'Primary Windows taskbar replacement is active' `
        -Seconds $TimeoutSeconds
    Wait-HostLog -Pattern 'JARVIS taskbar surface revealed' -Seconds 10
    if (Test-NativeTaskbarVisible) {
        throw 'The native taskbar was still visible after Full replacement activation.'
    }

    Stop-Process -Id $fullHost.Id -Force
    $forcedHostKilled = $true
    $fullHost.WaitForExit(5000) | Out-Null
    Remove-Item -LiteralPath $settingsPath -Force -ErrorAction SilentlyContinue

    if (-not (Wait-JarvisProcessesExit -Seconds $TimeoutSeconds)) {
        throw 'The recovery watchdog did not exit after the forced Host termination.'
    }
    $watchdogRestoredTaskbar = Test-NativeTaskbarVisible
    if (-not $watchdogRestoredTaskbar) {
        throw 'The recovery watchdog did not restore the native taskbar.'
    }

    $abnormalLedger = Get-StartupLedger -SessionId $sessionId
    $abnormalLedgerArmed = $null -ne $abnormalLedger -and
        $null -ne $abnormalLedger.activeRunId -and
        $abnormalLedger.activeProcessId -eq $fullHost.Id
    if (-not $abnormalLedgerArmed) {
        throw 'The forced Host termination did not leave an auditable abnormal-run ledger.'
    }

    Reset-LogCursor
    $safeHost = Start-Process -FilePath $resolvedHost -PassThru
    Wait-HostLog `
        -Pattern 'Host startup safety mode enabled; native Windows shell surfaces will remain active.*previous host run did not complete cleanly' `
        -Seconds $TimeoutSeconds
    Wait-HostLog -Pattern 'Global Ctrl\+Shift\+Q safety hotkey registered' -Seconds 10
    $automaticSafeModeObserved = Test-NativeTaskbarVisible
    if (-not $automaticSafeModeObserved) {
        throw 'Automatic startup safety mode did not preserve the native taskbar.'
    }

    if (-not (Request-SafeExit -Process $safeHost)) {
        throw 'The automatic Safe Mode Host could not receive a safe-exit request.'
    }
    if (-not $safeHost.WaitForExit(20000)) {
        throw 'The automatic Safe Mode Host did not exit within 20 seconds.'
    }
    $finalSafeExitCompleted = $true
}
catch {
    $failure = $_.Exception.Message
}
finally {
    Remove-Item -LiteralPath $settingsPath -Force -ErrorAction SilentlyContinue

    foreach ($process in @($safeHost, $fullHost)) {
        if ($process -and -not $process.HasExited) {
            if (Request-SafeExit -Process $process) {
                $process.WaitForExit(10000) | Out-Null
            }
            if (-not $process.HasExited) {
                $emergencyCleanup = $true
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                $process.WaitForExit(5000) | Out-Null
            }
        }
    }
}

$allJarvisExited = Wait-JarvisProcessesExit -Seconds 20
if (-not (Test-NativeTaskbarVisible) -and $allJarvisExited) {
    & (Join-Path $PSScriptRoot 'restore-native-taskbar.ps1') | Out-Null
}

$finalLedger = Get-StartupLedger -SessionId $sessionId
$finalLedgerClean = $null -ne $finalLedger -and
    $null -eq $finalLedger.activeRunId -and
    $null -eq $finalLedger.activeProcessId -and
    $null -eq $finalLedger.activeStartedAtUtc
$nativeTaskbarVisible = Test-NativeTaskbarVisible
$jarvisProcessCount = @(
    Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue).Count
$testSettingRemoved = -not (Test-Path -LiteralPath $settingsPath)

$ready = -not $failure -and
    $forcedHostKilled -and
    $watchdogRestoredTaskbar -and
    $abnormalLedgerArmed -and
    $automaticSafeModeObserved -and
    $finalSafeExitCompleted -and
    -not $emergencyCleanup -and
    $nativeTaskbarVisible -and
    $jarvisProcessCount -eq 0 -and
    $finalLedgerClean -and
    $testSettingRemoved

$result = [ordered]@{
    status = if ($ready) { 'READY' } else { 'ATTENTION' }
    failure = $failure
    forcedHostKilled = $forcedHostKilled
    watchdogRestoredTaskbar = $watchdogRestoredTaskbar
    abnormalLedgerArmed = $abnormalLedgerArmed
    automaticSafeModeObserved = $automaticSafeModeObserved
    finalSafeExitCompleted = $finalSafeExitCompleted
    emergencyCleanup = $emergencyCleanup
    final = [ordered]@{
        explorerAlive = [bool](Get-Process -Name explorer -ErrorAction SilentlyContinue)
        nativeTaskbarVisible = $nativeTaskbarVisible
        jarvisProcessCount = $jarvisProcessCount
        startupLedgerClean = $finalLedgerClean
        testSettingRemoved = $testSettingRemoved
    }
}

$json = $result | ConvertTo-Json -Depth 6
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = Split-Path -Parent $resolvedOutput
    if ($outputDirectory) {
        New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    }
    $json | Set-Content -LiteralPath $resolvedOutput -Encoding UTF8
}
$json

if (-not $ready) {
    exit 1
}
