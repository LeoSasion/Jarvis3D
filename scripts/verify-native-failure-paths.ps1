[CmdletBinding()]
param(
    [string]$HostPath,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'native-validation-common.ps1')
if ([string]::IsNullOrWhiteSpace($HostPath)) {
    $HostPath = Join-Path $PSScriptRoot '..\host\Jarvis.Host\bin\Release\net8.0-windows\Jarvis.Host.exe'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisFailureValidationNative
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr word, IntPtr value);
    public static bool CloseOwnedHost(uint expectedProcessId)
    {
        bool sent = false;
        EnumWindows((window, _) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner != expectedProcessId) return true;
            var title = new StringBuilder(128); GetWindowText(window, title, title.Capacity);
            if (title.ToString() != "JARVIS") return true;
            sent = PostMessage(window, 0x0312, new IntPtr(0x4A52), IntPtr.Zero);
            return false;
        }, IntPtr.Zero);
        return sent;
    }
}
'@

function Assert-NativeShell {
    $taskbar = [JarvisFailureValidationNative]::FindWindow('Shell_TrayWnd', $null)
    if ($taskbar -eq [IntPtr]::Zero -or -not [JarvisFailureValidationNative]::IsWindowVisible($taskbar)) {
        throw 'Native taskbar visibility was not preserved.'
    }
    if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { throw 'Explorer is unavailable.' }
}

function Wait-ValidationLog {
    param([string]$Path, [string]$Pattern, [Diagnostics.Process]$Process, [int]$Seconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (Test-Path -LiteralPath $Path) {
            if (([IO.File]::ReadAllText($Path)) -match $Pattern) { return }
        }
        if ($Process.HasExited) { throw "The owned Host exited before: $Pattern" }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for: $Pattern"
}

function Get-ProductionStateFingerprint {
    $root = Join-Path $env:LOCALAPPDATA 'JARVIS'
    $paths = @('Settings', 'State', 'Recovery', 'PiAgent', 'obsidian-vault.txt')
    $values = foreach ($relative in $paths) {
        $path = Join-Path $root $relative
        if (Test-Path -LiteralPath $path) {
            Get-ChildItem -LiteralPath $path -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
                $_.FullName.Substring($root.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
    }
    return $values -join "`n"
}

if (-not (Test-Path -LiteralPath $HostPath -PathType Leaf)) { throw 'Host executable is missing.' }
if (Get-Process Jarvis.Host -ErrorAction SilentlyContinue) { throw 'Close JARVIS before native failure validation.' }
Assert-NativeShell
$before = Get-ProductionStateFingerprint
$results = [Collections.Generic.List[object]]::new()

foreach ($scenario in @('startup-timeout', 'webview-browser-crash', 'full-mode-webview-browser-crash', 'startup-interruption')) {
    $dataRoot = New-NativeValidationDataRoot
    $process = $null
    $forcedCleanup = $false
    try {
        $fullMode = $scenario -eq 'full-mode-webview-browser-crash'
        if ($fullMode) {
            New-Item -ItemType Directory -Path (Join-Path $dataRoot 'Settings') | Out-Null
            [IO.File]::WriteAllText((Join-Path $dataRoot 'Settings\taskbar-mode.json'), '{"mode":"full"}')
        }
        $process = Start-NativeValidationHost -HostPath $HostPath -DataRoot $dataRoot -SafeMode:(!$fullMode) -StartupTimeout:($scenario -eq 'startup-timeout')
        $sessionId = $process.SessionId
        $logPath = Join-Path $dataRoot 'Logs\jarvis-host.log'
        if ($scenario -eq 'startup-timeout') {
            Wait-ValidationLog -Path $logPath -Process $process -Pattern 'Desktop renderer did not become ready within the startup deadline'
        }
        elseif ($scenario -match 'webview-browser-crash') {
            Wait-ValidationLog -Path $logPath -Process $process -Pattern 'Desktop surface is ready; evaluating the requested taskbar mode'
            if ($fullMode) {
                Wait-ValidationLog -Path $logPath -Process $process -Pattern 'Primary Windows taskbar replacement is active'
                Wait-ValidationLog -Path $logPath -Process $process -Pattern 'JARVIS taskbar surface revealed'
            }
            # The browser is a direct child of this exact Host. Renderer children
            # belong to it; never select a WebView process by global image name.
            $browser = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id) AND Name='msedgewebview2.exe'" |
                Where-Object { $_.CommandLine -notmatch '--type=' })
            if ($browser.Count -ne 1) { throw 'Expected exactly one owned WebView2 browser process.' }
            $ownedBrowser = Get-Process -Id $browser[0].ProcessId -ErrorAction Stop
            if ($ownedBrowser.StartTime.ToUniversalTime() -lt $process.StartTime.ToUniversalTime()) { throw 'WebView2 process ownership changed.' }
            $ownedBrowser.Kill()
            $ownedBrowser.WaitForExit(5000) | Out-Null
            Wait-ValidationLog -Path $logPath -Process $process -Pattern 'WebView2 process failed: BrowserProcessExited' -Seconds 15
            if ($fullMode) {
                $recoveryDeadline = [DateTime]::UtcNow.AddSeconds(10)
                do {
                    $taskbar = [JarvisFailureValidationNative]::FindWindow('Shell_TrayWnd', $null)
                    if ($taskbar -ne [IntPtr]::Zero -and [JarvisFailureValidationNative]::IsWindowVisible($taskbar)) { break }
                    Start-Sleep -Milliseconds 100
                } while ([DateTime]::UtcNow -lt $recoveryDeadline)
            }
        }
        else {
            Wait-ValidationLog -Path $logPath -Process $process -Pattern 'Desktop window loaded; initializing WebView2'
        }
        Assert-NativeShell
        if (-not [JarvisFailureValidationNative]::CloseOwnedHost([uint32]$process.Id)) {
            throw 'The owned Host did not accept the safety exit request.'
        }
        if (-not $process.WaitForExit(20000)) { throw 'The owned Host exceeded its shutdown deadline.' }
        if ($process.ExitCode -ne 0) { throw "The owned Host exited with code $($process.ExitCode)." }
        $ledgerPath = Join-Path $dataRoot ("State\startup-health-session-{0}.json" -f $sessionId)
        $ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
        if ($null -ne $ledger.activeRunId -or $null -ne $ledger.activeProcessId) { throw 'Shutdown left an active startup ledger.' }
        Assert-NativeShell
        $results.Add([ordered]@{ scenario = $scenario; passed = $true; nativeTaskbarVisible = $true; cleanExit = $true })
    }
    finally {
        if ($null -ne $process -and -not $process.HasExited) {
            [JarvisFailureValidationNative]::CloseOwnedHost([uint32]$process.Id) | Out-Null
            if (-not $process.WaitForExit(10000)) {
                $forcedCleanup = $true
                $process.Kill()
                $process.WaitForExit(5000) | Out-Null
            }
        }
        Remove-NativeValidationDataRoot -DataRoot $dataRoot
        if ($null -ne $process) { $process.Dispose() }
        Assert-NativeShell
        if ($forcedCleanup) { throw 'Native failure validation required forced cleanup.' }
    }
}

if ((Get-ProductionStateFingerprint) -cne $before) { throw 'Production JARVIS state changed during isolated validation.' }
if (Get-Process Jarvis.Host -ErrorAction SilentlyContinue) { throw 'A Host process remained after validation.' }
$report = [ordered]@{
    schemaVersion = 1
    status = 'PASS'
    hostVersion = (Get-Item -LiteralPath $HostPath).VersionInfo.ProductVersion
    windowsBuild = [Environment]::OSVersion.Version.Build
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    scenarios = @($results.ToArray())
    productionStateUnchanged = $true
    hostProcessesAfter = 0
}
$json = $report | ConvertTo-Json -Depth 6
if ($OutputPath) {
    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($resolvedOutput)) -Force | Out-Null
    [IO.File]::WriteAllText($resolvedOutput, $json)
}
$json
