[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$RuntimeDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'third_party\pi\runtime.json') -Raw |
    ConvertFrom-Json
$runtimeRoot = [IO.Path]::GetFullPath($RuntimeDirectory)
$executable = Join-Path $runtimeRoot $manifest.executable.relativePath
if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or
    (Get-Item -LiteralPath $executable).Length -ne [long]$manifest.executable.sizeBytes -or
    (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.executable.sha256) {
    throw 'The Pi executable does not match the pinned runtime manifest.'
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'theme\dark.json') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'theme\light.json') -PathType Leaf)) {
    throw 'The Pi runtime package assets are missing.'
}

$parent = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'jarvis-pi-rpc-validation'))
$dataRoot = Join-Path $parent ([Guid]::NewGuid().ToString('N'))
$agentDirectory = Join-Path $dataRoot 'Agent'
$workingDirectory = Join-Path $dataRoot 'Working'
$process = $null
try {
    [IO.Directory]::CreateDirectory($agentDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($workingDirectory) | Out-Null
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $executable
    $start.WorkingDirectory = $workingDirectory
    $start.Arguments = '--mode rpc --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --no-themes --no-approve --offline'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($name in @($start.EnvironmentVariables.Keys)) {
        if ($name -match '(?i)(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)') {
            $start.EnvironmentVariables.Remove($name)
        }
    }
    $start.EnvironmentVariables['PI_CODING_AGENT_DIR'] = $agentDirectory
    $start.EnvironmentVariables['PI_PACKAGE_DIR'] = $runtimeRoot
    $start.EnvironmentVariables['PI_SKIP_VERSION_CHECK'] = '1'
    $start.EnvironmentVariables['PI_TELEMETRY'] = '0'
    $start.EnvironmentVariables['PI_OFFLINE'] = '1'

    $process = [Diagnostics.Process]::Start($start)
    if ($null -eq $process) { throw 'Pi did not start.' }
    $stderr = $process.StandardError.ReadToEndAsync()
    $commands = @('get_state', 'get_messages', 'new_session')
    $responses = [Collections.Generic.List[string]]::new()
    foreach ($command in $commands) {
        $id = "jarvis-qa-$command"
        $process.StandardInput.WriteLine((@{ id = $id; type = $command } | ConvertTo-Json -Compress))
        $process.StandardInput.Flush()
        $found = $false
        for ($eventCount = 0; $eventCount -lt 128; $eventCount++) {
            $read = $process.StandardOutput.ReadLineAsync()
            if (-not $read.Wait(10000)) { throw "Pi did not answer $command within 10 seconds." }
            $line = $read.Result
            if ($null -eq $line) { throw "Pi exited before answering $command." }
            $event = $line | ConvertFrom-Json
            if ($event.type -ne 'response' -or $event.id -ne $id) { continue }
            if ($event.command -ne $command -or $event.success -ne $true) {
                throw "Pi rejected the local $command RPC command."
            }
            $responses.Add($command)
            $found = $true
            break
        }
        if (-not $found) { throw "Pi produced too many events before answering $command." }
    }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(5000) -or $process.ExitCode -ne 0) {
        throw 'Pi did not exit cleanly after the local RPC probe.'
    }
    [pscustomobject]@{
        Status = 'passed'
        RuntimeVersion = $manifest.version
        Commands = $responses.ToArray()
        PackageDirectory = 'verified runtime root'
        ProviderInference = 'not requested'
    }
}
finally {
    if ($null -ne $process) {
        if (-not $process.HasExited) { $process.Kill() }
        $process.WaitForExit(5000) | Out-Null
        $process.Dispose()
    }
    $safeRoot = [IO.Path]::GetFullPath($dataRoot)
    if ([IO.Path]::GetDirectoryName($safeRoot) -ne $parent -or
        [IO.Path]::GetFileName($safeRoot) -notmatch '\A[0-9a-f]{32}\z') {
        throw 'Refusing to clean a path outside the isolated Pi validation root.'
    }
    if ([IO.Directory]::Exists($safeRoot)) {
        for ($ancestor = $safeRoot; -not [string]::IsNullOrEmpty($ancestor);
            $ancestor = [IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))) {
            if ([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Refusing to clean a Pi validation path through a reparse point.'
            }
        }
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push($safeRoot)
        while ($pending.Count -gt 0) {
            foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
                $attributes = [IO.File]::GetAttributes($entry)
                if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw 'Refusing to clean Pi validation data containing a reparse point.'
                }
                if ($attributes -band [IO.FileAttributes]::Directory) { $pending.Push($entry) }
            }
        }
        [IO.Directory]::Delete($safeRoot, $true)
    }
}
