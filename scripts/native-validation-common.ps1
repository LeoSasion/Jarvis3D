# Shared by native checks. Only generated per-run roots under this temp parent
# are accepted by the Host, and every child watchdog inherits the same root.
function Set-ValidationProcessEnvironment {
    param([Diagnostics.ProcessStartInfo]$StartInfo, [string]$DataRoot)
    foreach ($name in @($StartInfo.EnvironmentVariables.Keys)) {
        if ($name.StartsWith('WEBVIEW2_', [StringComparison]::OrdinalIgnoreCase)) {
            $StartInfo.EnvironmentVariables.Remove($name)
        }
    }
    foreach ($name in @(
        'JARVIS_FRONTEND_DIST',
        'JARVIS_ALLOW_EXTERNAL_PI_RUNTIME',
        'JARVIS_PI_EXECUTABLE',
        'JARVIS_PI_EXECUTABLE_SHA256',
        'JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS',
        'JARVIS_TASKBAR_DIAGNOSTIC_TOGGLE_SEQUENCE',
        'JARVIS_TASKBAR_DIAGNOSTIC_SHOW_DESKTOP_SEQUENCE',
        'JARVIS_DIAGNOSTIC_SHELL_PANEL',
        'JARVIS_WINDOW_SWITCHER_DIAGNOSTIC',
        'JARVIS_WEBVIEW2_DEVTOOLS'
    )) { $StartInfo.EnvironmentVariables.Remove($name) }
    $StartInfo.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $DataRoot 'WebView2'
}

function New-NativeValidationDataRoot {
    $root = Join-Path (Join-Path ([IO.Path]::GetTempPath()) 'jarvis-native-validation') ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
    return $root
}

function Start-NativeValidationHost {
    param([string]$HostPath, [string]$DataRoot, [switch]$SafeMode, [switch]$StartupTimeout)
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = [IO.Path]::GetFullPath($HostPath)
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    Set-ValidationProcessEnvironment -StartInfo $startInfo -DataRoot $DataRoot
    if ($DataRoot.Contains('"')) { throw 'Invalid validation data path.' }
    $startInfo.Arguments = "--native-validation-data-root=`"$DataRoot`""
    $startInfo.EnvironmentVariables.Remove('JARVIS_KEEP_NATIVE_TASKBAR')
    $startInfo.EnvironmentVariables.Remove('JARVIS_SAFE_MODE_REASON')
    if ($SafeMode) { $startInfo.Arguments += ' --safe-mode' }
    if ($StartupTimeout) { $startInfo.Arguments += ' --native-validation-startup-timeout' }
    return [Diagnostics.Process]::Start($startInfo)
}

function Remove-NativeValidationDataRoot {
    param([string]$DataRoot)
    $root = [IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
    $parent = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'jarvis-native-validation')).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($root) -ine $parent -or
        [IO.Path]::GetFileName($root) -notmatch '\A[0-9a-f]{32}\z') {
        throw 'Refusing cleanup outside an isolated native validation root.'
    }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Test-Path -LiteralPath $root)) { return }
        try {
            Assert-ValidationCleanupTree -Path $root
            Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
            return
        }
        catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
        catch [UnauthorizedAccessException] { Start-Sleep -Milliseconds 250 }
    }
    throw 'The isolated native validation root remained locked after cleanup.'
}

function Assert-ValidationCleanupTree {
    param([string]$Path)
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $ancestor = $resolvedPath
    while (-not [string]::IsNullOrEmpty($ancestor)) {
        try {
            if ([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Refusing validation cleanup through a reparse point.'
            }
        }
        catch [IO.FileNotFoundException] { }
        catch [IO.DirectoryNotFoundException] { }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))
    }
    if ([IO.Directory]::Exists($resolvedPath)) {
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push($resolvedPath)
        while ($pending.Count -gt 0) {
            foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
                $attributes = [IO.File]::GetAttributes($entry)
                if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw 'Refusing validation cleanup of a tree containing a reparse point.'
                }
                if ($attributes -band [IO.FileAttributes]::Directory) { $pending.Push($entry) }
            }
        }
    }
}
