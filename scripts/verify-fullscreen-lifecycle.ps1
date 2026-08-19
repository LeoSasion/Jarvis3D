[CmdletBinding()]
param(
    [string]$HostPath = (
        Join-Path $PSScriptRoot '..\host\Jarvis.Host\bin\Debug\net8.0-windows\Jarvis.Host.exe'),
    [string]$OutputPath,
    [int]$ProbeMilliseconds = 6500,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ProbeMilliseconds -lt 3000 -or $ProbeMilliseconds -gt 15000) {
    throw 'ProbeMilliseconds must be between 3000 and 15000.'
}
if ($TimeoutSeconds -lt 15 -or $TimeoutSeconds -gt 90) {
    throw 'TimeoutSeconds must be between 15 and 90.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class JarvisFullscreenLifecycleNative
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

function Test-WindowVisible {
    param([IntPtr]$Window)

    return $Window -ne [IntPtr]::Zero -and
        [JarvisFullscreenLifecycleNative]::IsWindowVisible($Window)
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
        $newLog = Get-NewHostLog
        if ($newLog -match $Pattern) {
            return
        }
    }
    while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for Host log pattern: $Pattern"
}

function Request-SafeExit {
    param([System.Diagnostics.Process]$Process)

    $mainWindow = [JarvisFullscreenLifecycleNative]::FindOwnedWindow(
        [uint32]$Process.Id,
        'JARVIS')
    if ($mainWindow -eq [IntPtr]::Zero) {
        return $false
    }

    return [JarvisFullscreenLifecycleNative]::PostMessage(
        $mainWindow,
        [JarvisFullscreenLifecycleNative]::WmHotkey,
        [IntPtr][JarvisFullscreenLifecycleNative]::SafetyHotkeyId,
        [IntPtr]::Zero)
}

function Start-FullscreenProbe {
    param([int]$DurationMilliseconds)

    $probeSource = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$form = [System.Windows.Forms.Form]::new()
`$form.Text = 'JARVIS Fullscreen Acceptance Probe'
`$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
`$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
`$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
`$form.BackColor = [System.Drawing.Color]::Black
`$form.TopMost = `$true
`$form.ShowInTaskbar = `$true
`$timer = [System.Windows.Forms.Timer]::new()
`$timer.Interval = $DurationMilliseconds
`$timer.Add_Tick({ `$timer.Stop(); `$form.Close() })
`$form.Add_Shown({ `$form.Activate(); `$timer.Start() })
[void]`$form.ShowDialog()
"@
    $encoded = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($probeSource))
    return Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-STA',
        '-EncodedCommand',
        $encoded
    ) -WindowStyle Hidden -PassThru
}

$resolvedHost = [System.IO.Path]::GetFullPath($HostPath)
if (-not (Test-Path -LiteralPath $resolvedHost -PathType Leaf)) {
    throw "Fullscreen lifecycle Host does not exist: $resolvedHost"
}
if (Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue) {
    throw 'Fullscreen lifecycle verification requires JARVIS to be closed.'
}

$settingsPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Settings\taskbar-mode.json'
if (Test-Path -LiteralPath $settingsPath) {
    throw 'Fullscreen lifecycle verification will not overwrite a taskbar preference.'
}

$script:logPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Logs\jarvis-host.log'
$script:logLineStart = if (Test-Path -LiteralPath $script:logPath) {
    @(Get-Content -LiteralPath $script:logPath -Encoding UTF8).Count
}
else {
    0
}

$nativeTaskbarBefore = [JarvisFullscreenLifecycleNative]::FindWindow(
    'Shell_TrayWnd',
    $null)
if (-not (Test-WindowVisible -Window $nativeTaskbarBefore)) {
    throw 'The native Explorer taskbar must be visible before fullscreen verification.'
}

$hostProcess = $null
$probe = $null
$failure = $null
$forcedCleanup = $false
$fullReplacementReady = $false
$fullscreenSuppressed = $false
$taskbarHiddenDuringFullscreen = $false
$taskbarRestoredAfterFullscreen = $false

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $settingsPath) -Force |
        Out-Null
    '{"mode":"full"}' | Set-Content -LiteralPath $settingsPath -Encoding UTF8

    $hostProcess = Start-Process -FilePath $resolvedHost -PassThru
    Wait-HostLog -Pattern 'Primary Windows taskbar replacement is active' `
        -Seconds $TimeoutSeconds
    Wait-HostLog -Pattern 'JARVIS taskbar surface revealed' -Seconds 10
    $fullReplacementReady = $true

    $jarvisTaskbar = [JarvisFullscreenLifecycleNative]::FindOwnedWindow(
        [uint32]$hostProcess.Id,
        'JARVIS Taskbar')
    if (-not (Test-WindowVisible -Window $jarvisTaskbar)) {
        throw 'The JARVIS taskbar was not visible before fullscreen verification.'
    }

    $probe = Start-FullscreenProbe -DurationMilliseconds $ProbeMilliseconds
    Wait-HostLog `
        -Pattern 'taskbar surface suppressed for primary-monitor fullscreen foreground' `
        -Seconds 15
    $fullscreenSuppressed = $true
    $taskbarHiddenDuringFullscreen = -not (
        Test-WindowVisible -Window $jarvisTaskbar)
    if (-not $taskbarHiddenDuringFullscreen) {
        throw 'The JARVIS taskbar remained visible during fullscreen verification.'
    }

    if (-not $probe.WaitForExit($ProbeMilliseconds + 6000)) {
        throw 'The fullscreen probe did not close on schedule.'
    }
    Wait-HostLog `
        -Pattern 'taskbar surface restored after fullscreen foreground' `
        -Seconds 15
    $taskbarRestoredAfterFullscreen = Test-WindowVisible -Window $jarvisTaskbar
    if (-not $taskbarRestoredAfterFullscreen) {
        throw 'The JARVIS taskbar did not return after fullscreen verification.'
    }

    if (-not (Request-SafeExit -Process $hostProcess)) {
        throw 'The JARVIS safe-exit request could not be posted.'
    }
    if (-not $hostProcess.WaitForExit(20000)) {
        throw 'JARVIS did not complete safe exit after fullscreen verification.'
    }
}
catch {
    $failure = $_.Exception.Message
}
finally {
    if ($probe -and -not $probe.HasExited) {
        Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue
        $probe.WaitForExit(5000) | Out-Null
    }

    if ($hostProcess -and -not $hostProcess.HasExited) {
        if (Request-SafeExit -Process $hostProcess) {
            $hostProcess.WaitForExit(10000) | Out-Null
        }
        if (-not $hostProcess.HasExited) {
            $forcedCleanup = $true
            Stop-Process -Id $hostProcess.Id -Force -ErrorAction SilentlyContinue
            $hostProcess.WaitForExit(5000) | Out-Null
        }
    }

    Remove-Item -LiteralPath $settingsPath -Force -ErrorAction SilentlyContinue
}

$cleanupDeadline = [DateTime]::UtcNow.AddSeconds(20)
do {
    $remainingHosts = @(Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue)
    if ($remainingHosts.Count -eq 0) {
        break
    }
    Start-Sleep -Milliseconds 250
}
while ([DateTime]::UtcNow -lt $cleanupDeadline)

$nativeTaskbarAfter = [JarvisFullscreenLifecycleNative]::FindWindow(
    'Shell_TrayWnd',
    $null)
if (-not (Test-WindowVisible -Window $nativeTaskbarAfter) -and
    $remainingHosts.Count -eq 0) {
    & (Join-Path $PSScriptRoot 'restore-native-taskbar.ps1') | Out-Null
    $nativeTaskbarAfter = [JarvisFullscreenLifecycleNative]::FindWindow(
        'Shell_TrayWnd',
        $null)
}

$sessionId = (Get-Process -Id $PID).SessionId
$ledgerPath = Join-Path $env:LOCALAPPDATA (
    'JARVIS\State\startup-health-session-{0}.json' -f $sessionId)
$ledger = if (Test-Path -LiteralPath $ledgerPath -PathType Leaf) {
    Get-Content -LiteralPath $ledgerPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
else {
    $null
}
$startupLedgerClean = $null -ne $ledger -and
    $null -eq $ledger.activeRunId -and
    $null -eq $ledger.activeProcessId -and
    $null -eq $ledger.activeStartedAtUtc
$nativeTaskbarVisible = Test-WindowVisible -Window $nativeTaskbarAfter
$jarvisProcessCount = @(
    Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue).Count

$ready = -not $failure -and
    -not $forcedCleanup -and
    $fullReplacementReady -and
    $fullscreenSuppressed -and
    $taskbarHiddenDuringFullscreen -and
    $taskbarRestoredAfterFullscreen -and
    $nativeTaskbarVisible -and
    $jarvisProcessCount -eq 0 -and
    $startupLedgerClean -and
    -not (Test-Path -LiteralPath $settingsPath)

$result = [ordered]@{
    status = if ($ready) { 'READY' } else { 'ATTENTION' }
    failure = $failure
    fullReplacementReady = $fullReplacementReady
    fullscreenSuppressed = $fullscreenSuppressed
    taskbarHiddenDuringFullscreen = $taskbarHiddenDuringFullscreen
    taskbarRestoredAfterFullscreen = $taskbarRestoredAfterFullscreen
    forcedCleanup = $forcedCleanup
    final = [ordered]@{
        explorerAlive = [bool](Get-Process -Name explorer -ErrorAction SilentlyContinue)
        nativeTaskbarVisible = $nativeTaskbarVisible
        jarvisProcessCount = $jarvisProcessCount
        startupLedgerClean = $startupLedgerClean
        testSettingRemoved = -not (Test-Path -LiteralPath $settingsPath)
        probeProcessClosed = $null -eq $probe -or $probe.HasExited
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
