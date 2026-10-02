param(
    [string]$HostPath,
    [int]$TimeoutSeconds = 45,
    [ValidateSet('en-US', 'zh-CN')]
    [string]$Culture = 'en-US',
    [switch]$MeasurePerformance,
    [string]$ReportPath,
    [switch]$GraphicsRegression,
    [string]$GraphicsReportPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'native-validation-common.ps1')
if ([string]::IsNullOrWhiteSpace($HostPath)) {
    $HostPath = Join-Path $PSScriptRoot '..\host\Jarvis.Host\bin\Debug\net8.0-windows\Jarvis.Host.exe'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JarvisRendererSmokeNative
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
}
'@

function Assert-NativeTaskbarVisible {
    $window = [JarvisRendererSmokeNative]::FindWindow('Shell_TrayWnd', $null)
    if ($window -eq [IntPtr]::Zero -or -not [JarvisRendererSmokeNative]::IsWindowVisible($window)) {
        throw 'The native Windows taskbar is not visible.'
    }
}

$resolvedHost = [System.IO.Path]::GetFullPath($HostPath)
if (-not (Test-Path -LiteralPath $resolvedHost -PathType Leaf)) {
    throw "Renderer smoke host does not exist: $resolvedHost"
}

$existingHosts = @(Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue)
if ($existingHosts.Count -gt 0) {
    throw 'Renderer smoke requires JARVIS to be closed before the isolated check.'
}

$smokeParent = Join-Path ([System.IO.Path]::GetTempPath()) 'jarvis-renderer-smoke'
$dataRoot = Join-Path $smokeParent ([Guid]::NewGuid().ToString('N'))
$receiptPath = Join-Path $dataRoot 'receipts\renderer.json'
$nonce = [Guid]::NewGuid().ToString('N')
$process = $null

try {
    Assert-NativeTaskbarVisible
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedHost
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    Set-ValidationProcessEnvironment -StartInfo $startInfo -DataRoot $dataRoot
    # Windows PowerShell 5.1 exposes the .NET Framework ProcessStartInfo shape,
    # which does not have ArgumentList. These generated paths cannot contain a
    # quote, so quoting each value keeps the command line safe on both 5.1 and 7.
    $startInfo.Arguments = @(
        '--renderer-smoke'
        "--renderer-smoke-data-root=`"$dataRoot`""
        "--renderer-smoke-receipt=`"$receiptPath`""
        "--renderer-smoke-nonce=$nonce"
        "--renderer-smoke-culture=$Culture"
    ) -join ' '

    if ($MeasurePerformance) {
        $TimeoutSeconds = [Math]::Max($TimeoutSeconds, 120)
        $startInfo.Arguments += ' --renderer-smoke-performance'
        $fixtureVault = Join-Path $dataRoot 'FixtureVault'
        New-Item -ItemType Directory -Path $fixtureVault -Force | Out-Null
        for ($index = 0; $index -lt 96; $index++) {
            $links = 1..3 | ForEach-Object { '[[Note-{0:d3}]]' -f (($index + $_) % 96) }
            $note = "---`naliases: [Fixture-$index]`ntags: [validation]`n---`n# Synthetic note $index`n" + ($links -join "`n")
            [IO.File]::WriteAllText((Join-Path $fixtureVault ('Note-{0:d3}.md' -f $index)), $note)
        }
        $startInfo.EnvironmentVariables['JARVIS_OBSIDIAN_VAULT'] = $fixtureVault
    }
    if ($GraphicsRegression) {
        $TimeoutSeconds = [Math]::Max($TimeoutSeconds, 240)
        $startInfo.Arguments += ' --renderer-smoke-graphics'
        if ([string]::IsNullOrWhiteSpace($GraphicsReportPath)) {
            $GraphicsReportPath = Join-Path ([IO.Path]::GetTempPath()) "jarvis-native-graphics-$nonce"
        }
        if (Test-Path -LiteralPath $GraphicsReportPath) { throw 'Refusing to overwrite an existing graphics report directory.' }
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw 'Renderer smoke host could not be started.'
    }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        throw "Renderer smoke exceeded the ${TimeoutSeconds}s timeout."
    }
    if ($GraphicsRegression) {
        $graphicsArtifacts = Join-Path $dataRoot 'receipts\graphics-regression'
        if (Test-Path -LiteralPath $graphicsArtifacts -PathType Container) {
            Copy-Item -LiteralPath $graphicsArtifacts -Destination $GraphicsReportPath -Recurse
            Write-Output "Native graphics regression artifacts: $GraphicsReportPath"
        }
    }
    if ($process.ExitCode -ne 0) {
        $diagnostic = if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
            Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8
        }
        else {
            'No renderer receipt was produced.'
        }
        $failureLog = Join-Path $dataRoot 'Logs\jarvis-host.log'
        if (Test-Path -LiteralPath $failureLog -PathType Leaf) {
            $diagnostic += "`n" + ((Get-Content -LiteralPath $failureLog -Tail 40 -Encoding UTF8) -join "`n")
        }
        throw "Renderer smoke host exited with code $($process.ExitCode).`n$diagnostic"
    }

    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        throw 'Renderer smoke did not create its isolated receipt.'
    }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.schemaVersion -ne 1 -or
        $receipt.mode -ne 'renderer-smoke' -or
        $receipt.nonce -ne $nonce -or
        $receipt.culture -ne $Culture -or
        $receipt.success -ne $true -or
        $receipt.mainWindowCreated -ne $true -or
        $receipt.taskbarTouched -ne $false -or
        $receipt.webViewDataIsolated -ne $true -or
        $null -ne $receipt.error) {
        throw 'Renderer smoke receipt metadata is invalid.'
    }
    $releaseManifest = Join-Path (Split-Path -Parent $resolvedHost) 'version.json'
    if (($receipt.frontend -notin @('packaged', 'development')) -or
        ((Test-Path -LiteralPath $releaseManifest) -and $receipt.frontend -ne 'packaged')) {
        throw 'Renderer smoke did not use the expected packaged or development frontend.'
    }

    $requiredAssertions = @(
        'shellReady',
        'helpOpened',
        'helpClosed',
        'explorerOpened',
        'agentOpened',
        'linkedWorkspaceReady',
        'noticeAvoidsCriticalControls',
        'graphSurfaceResolved',
        'reducedMotionStylesApplied'
    )
    foreach ($assertion in $requiredAssertions) {
        if ($receipt.result.$assertion -ne $true) {
            throw "Renderer smoke assertion failed: $assertion"
        }
    }

    Assert-NativeTaskbarVisible
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw 'Renderer smoke host remained alive after producing its receipt.'
    }

    if ($MeasurePerformance) {
        $performanceReport = Join-Path $dataRoot 'receipts\performance.json'
        if (-not (Test-Path -LiteralPath $performanceReport)) { throw 'Native performance report was not produced.' }
        if ([string]::IsNullOrWhiteSpace($ReportPath)) {
            $ReportPath = Join-Path ([IO.Path]::GetTempPath()) "jarvis-native-performance-$nonce.json"
        }
        if (Test-Path -LiteralPath $ReportPath) { throw 'Refusing to overwrite an existing performance report.' }
        Copy-Item -LiteralPath $performanceReport -Destination $ReportPath
        Write-Output "Native performance report: $ReportPath"
    }
    if ($GraphicsRegression) {
        $graphicsReportFile = Join-Path $GraphicsReportPath 'report.json'
        if (-not (Test-Path -LiteralPath $graphicsReportFile -PathType Leaf)) { throw 'Native graphics regression report was not produced.' }
        $graphicsReport = Get-Content -LiteralPath $graphicsReportFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($graphicsReport.success -ne $true -or $graphicsReport.samples.Count -ne 8) { throw 'Native graphics regression did not pass all eight cases.' }
    }
}
finally {
    if ($null -ne $process -and -not $process.HasExited) {
        # Kill(bool) does not exist on Windows PowerShell 5.1's .NET Framework.
        # Restrict cleanup to the isolated process we started and its child tree.
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
        $process.WaitForExit(5000) | Out-Null
    }

    if (Test-Path -LiteralPath $dataRoot) {
        $resolvedDataRoot = [System.IO.Path]::GetFullPath($dataRoot)
        $resolvedParent = [System.IO.Path]::GetFullPath($smokeParent).TrimEnd('\') + '\'
        if (-not $resolvedDataRoot.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Renderer smoke cleanup target escaped its dedicated temp parent.'
        }
        $removed = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if (-not (Test-Path -LiteralPath $resolvedDataRoot)) {
                $removed = $true
                break
            }
            try {
                Assert-ValidationCleanupTree -Path $resolvedDataRoot
                Remove-Item -LiteralPath $resolvedDataRoot -Recurse -Force -ErrorAction Stop
                $removed = $true
                break
            }
            catch [System.IO.IOException] {
                Start-Sleep -Milliseconds 250
            }
            catch [System.UnauthorizedAccessException] {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $removed -and (Test-Path -LiteralPath $resolvedDataRoot)) {
            throw 'Renderer smoke WebView2 profile did not release its lock within 10 seconds.'
        }
    }

    if (Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue) {
        throw 'Renderer smoke left a JARVIS Host process running.'
    }
    Assert-NativeTaskbarVisible
}

Write-Output "renderer-smoke: PASS ($Culture)"
