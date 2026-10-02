#Requires -Version 7.0
[CmdletBinding()]
param()

# Synthetic files only. This suite never starts a Host, installer, or uninstaller.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryParent = Join-Path ([IO.Path]::GetTempPath()) 'jarvis-release-verifier-tests'
$fixtureRoot = Join-Path $temporaryParent ([Guid]::NewGuid().ToString('N'))
$fixtureScripts = Join-Path $fixtureRoot 'scripts'
$releaseRoot = Join-Path $fixtureRoot 'artifacts\release'
$packageRoot = Join-Path $releaseRoot 'JARVIS-0.1.0-win-x64'
$installerRoot = Join-Path $fixtureRoot 'artifacts\installer'
$archivePath = Join-Path $releaseRoot 'JARVIS-0.1.0-win-x64.zip'
$installerPath = Join-Path $installerRoot 'JARVIS-Setup-0.1.0-win-x64.exe'
$expectedCommit = 'a' * 40
$results = [Collections.Generic.List[object]]::new()
$junctions = [Collections.Generic.List[string]]::new()

function Assert-Rejected {
    param([string]$Name, [scriptblock]$Action, [string]$MessagePattern)
    $rejected = $false
    try { & $Action | Out-Null }
    catch {
        $rejected = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "$Name failed for an unexpected reason: $($_.Exception.Message)"
        }
    }
    if (-not $rejected) { throw "$Name was unexpectedly accepted." }
    $results.Add([ordered]@{ case = $Name; passed = $true })
}

function Write-VersionManifest {
    param([string]$Commit = $expectedCommit, [object]$Dirty = $false)
    $manifest = [ordered]@{
        product = 'JARVIS'; version = '0.1.0'; runtime = 'win-x64'
        sourceCommit = $Commit; sourceDirty = $Dirty
    }
    [IO.File]::WriteAllText((Join-Path $packageRoot 'version.json'), ($manifest | ConvertTo-Json))
}

function New-ArchiveFixture {
    param([string]$Variant = 'valid')
    $archiveStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
    $archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $packageRoot -File -Recurse) {
            $name = $file.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
            if (($Variant -eq 'missing-file' -and $name -eq 'AgentRuntime/pi.exe') -or
                ($Variant -eq 'missing-receipt' -and $name -eq 'SHA256SUMS.txt')) { continue }
            if ($Variant -eq 'case-alias' -and $name -eq 'frontend/index.html') { $name = 'Frontend/index.html' }
            $entry = $archive.CreateEntry($name)
            if ($Variant -eq 'symbolic-link' -and $name -eq 'AgentRuntime/pi.exe') {
                $entry.ExternalAttributes = 0xa000 -shl 16
            }
            $stream = $entry.Open()
            try {
                $bytes = if ($Variant -eq 'wrong-bytes' -and $name -eq 'frontend/index.html') {
                    [Text.Encoding]::UTF8.GetBytes('other frontend')
                } else { [IO.File]::ReadAllBytes($file.FullName) }
                $stream.Write($bytes, 0, $bytes.Length)
            }
            finally { $stream.Dispose() }
        }
        $extra = switch ($Variant) {
            'extra-file' { 'unexpected.txt' }
            'duplicate-file' { 'frontend/index.html' }
            'duplicate-case' { 'FRONTEND/index.html' }
            'file-directory-collision' { 'frontend/index.html/' }
            'parent-traversal' { '../outside.txt' }
            'nested-traversal' { 'frontend/../outside.txt' }
            'absolute-path' { '/outside.txt' }
            'drive-path' { 'C:/outside.txt' }
            'backslash-path' { 'frontend\outside.txt' }
            'alternate-stream' { 'frontend/index.html:stream' }
            'empty-segment' { 'frontend//outside.txt' }
            'trailing-dot' { 'frontend/outside.txt.' }
            'device-path' { 'frontend/NUL.txt' }
            'unexpected-directory' { 'unexpected/' }
            'valid-directory' { 'frontend/' }
            default { $null }
        }
        if ($null -ne $extra) { [void]$archive.CreateEntry($extra) }
    }
    finally { $archive.Dispose(); $archiveStream.Dispose() }
    $packages = @{}
    foreach ($pair in @(@('portable', $archivePath), @('installer', $installerPath))) {
        $file = Get-Item -LiteralPath $pair[1]
        $packages[$pair[0]] = [ordered]@{
            fileName = $file.Name; sizeBytes = $file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'JARVIS-update-manifest.json'),
        (@{ product = 'JARVIS'; version = '0.1.0'; runtime = 'win-x64'; packages = $packages } | ConvertTo-Json -Depth 5))
}

try {
    foreach ($directory in @($fixtureScripts, $packageRoot, $installerRoot,
            (Join-Path $packageRoot 'frontend'), (Join-Path $packageRoot 'AgentRuntime'))) {
        [IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $verifierPath = Join-Path $fixtureScripts 'verify-release-artifacts.ps1'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verify-release-artifacts.ps1') -Destination $verifierPath
    $installerVerifierPath = Join-Path $PSScriptRoot 'verify-installer-lifecycle.ps1'
    foreach ($scriptPath in @($verifierPath, $installerVerifierPath)) {
        $tokens = $null; $parseErrors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) { throw "PowerShell parser rejected $scriptPath." }
        if ($scriptPath -eq $installerVerifierPath) { $installerAst = $ast }
    }
    $commitParameter = @($installerAst.ParamBlock.Parameters | Where-Object {
        $_.Name.VariablePath.UserPath -eq 'ExpectedCommit'
    })
    if ($commitParameter.Count -ne 1 -or @($commitParameter[0].Attributes | Where-Object {
            $_.TypeName.Name -eq 'Parameter' -and @($_.NamedArguments | Where-Object ArgumentName -eq 'Mandatory').Count -eq 1
        }).Count -ne 1) { throw 'Installer ExpectedCommit must be mandatory before any script action.' }
    foreach ($name in @('Assert-InstalledReleaseProvenance', 'Assert-PinnedPiLicense', 'Assert-ChildPath')) {
        $definition = $installerAst.Find({ param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
        }, $true)
        if ($null -eq $definition) { throw "Missing installer assertion $name." }
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $results.Add([ordered]@{ case = 'script AST and mandatory commit'; passed = $true })

    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
        $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
    }
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Windows .NET Framework fixture compiler is unavailable.' }
    $sourcePath = Join-Path $fixtureRoot 'VersionFixture.cs'
    $hostPath = Join-Path $packageRoot 'Jarvis.Host.exe'
    foreach ($commitPrefix in @('aaaaaaaaaaaa', 'bbbbbbbbbbbb')) {
        [IO.File]::WriteAllText($sourcePath,
            "using System.Reflection; [assembly: AssemblyInformationalVersion(`"0.1.0+$commitPrefix`")] public static class VersionFixture { public static void Main() {} }")
        $fixtureExecutable = Join-Path $fixtureRoot "$commitPrefix.exe"
        & $compiler /nologo /target:exe "/out:$fixtureExecutable" $sourcePath
        if ($LASTEXITCODE -ne 0) { throw 'Synthetic version-resource compilation failed.' }
    }
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'aaaaaaaaaaaa.exe') -Destination $hostPath
    [IO.File]::WriteAllText((Join-Path $packageRoot 'frontend/index.html'), 'valid frontend')
    [IO.File]::WriteAllText((Join-Path $packageRoot 'frontend/graphics-regression.html'), 'synthetic graphics')
    [IO.File]::WriteAllText((Join-Path $packageRoot 'AgentRuntime/pi.exe'), 'synthetic runtime, never executed')
    [IO.File]::WriteAllText($installerPath, 'synthetic installer, never executed')
    Write-VersionManifest
    $checksums = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | ForEach-Object {
        (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' +
        $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    }
    [IO.File]::WriteAllLines((Join-Path $packageRoot 'SHA256SUMS.txt'), [string[]]$checksums)

    foreach ($variant in @('valid', 'valid-directory')) {
        New-ArchiveFixture -Variant $variant
        $receipt = (& $verifierPath -Version '0.1.0' -ExpectedCommit $expectedCommit | Out-String) | ConvertFrom-Json
        if ($receipt.status -ne 'PASS' -or $receipt.checkedPortableFiles -ne ($receipt.checkedPackageFiles + 1)) {
            throw 'A matching synthetic portable package failed validation.'
        }
        $results.Add([ordered]@{ case = "portable $variant"; passed = $true })
    }
    foreach ($variant in @('missing-file', 'missing-receipt', 'wrong-bytes', 'extra-file',
            'duplicate-file', 'duplicate-case', 'case-alias', 'file-directory-collision',
            'parent-traversal', 'nested-traversal', 'absolute-path', 'drive-path', 'backslash-path',
            'alternate-stream', 'empty-segment', 'trailing-dot', 'device-path',
            'unexpected-directory', 'symbolic-link')) {
        New-ArchiveFixture -Variant $variant
        Assert-Rejected -Name "portable $variant" -MessagePattern 'portable|package path' -Action {
            & $verifierPath -Version '0.1.0' -ExpectedCommit $expectedCommit
        }
    }

    $provenance = Assert-InstalledReleaseProvenance -Directory $packageRoot -ReleaseVersion '0.1.0' -SourceCommit $expectedCommit
    if ($provenance.informationalVersion -cne '0.1.0+aaaaaaaaaaaa') { throw 'Valid installed provenance was not returned.' }
    $results.Add([ordered]@{ case = 'installed expected commit'; passed = $true })
    Write-VersionManifest -Commit ('b' * 40)
    Assert-Rejected -Name 'installed wrong commit' -MessagePattern 'requested clean source commit' -Action {
        Assert-InstalledReleaseProvenance -Directory $packageRoot -ReleaseVersion '0.1.0' -SourceCommit $expectedCommit
    }
    foreach ($dirty in @($true, 'false', 0)) {
        Write-VersionManifest -Dirty $dirty
        Assert-Rejected -Name "installed invalid sourceDirty $dirty" -MessagePattern 'requested clean source commit' -Action {
            Assert-InstalledReleaseProvenance -Directory $packageRoot -ReleaseVersion '0.1.0' -SourceCommit $expectedCommit
        }
    }
    Write-VersionManifest
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'bbbbbbbbbbbb.exe') -Destination $hostPath -Force
    Assert-Rejected -Name 'installed executable wrong commit' -MessagePattern 'executable version' -Action {
        Assert-InstalledReleaseProvenance -Directory $packageRoot -ReleaseVersion '0.1.0' -SourceCommit $expectedCommit
    }

    $licenseReference = Join-Path $fixtureRoot 'license-reference.txt'
    $licenseInstalled = Join-Path $fixtureRoot 'license-installed.txt'
    $licenseText = "Synthetic license`nKeep this text intact.`n"
    $licenseBytes = [Text.UTF8Encoding]::new($false).GetBytes($licenseText)
    [IO.File]::WriteAllBytes($licenseInstalled, $licenseBytes)
    $licenseHash = (Get-FileHash -LiteralPath $licenseInstalled -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($referenceCase in @('LF', 'CRLF', 'CR', 'no-final-newline')) {
        $referenceText = switch ($referenceCase) {
            'CRLF' { $licenseText.Replace("`n", "`r`n") }
            'CR' { $licenseText.Replace("`n", "`r") }
            'no-final-newline' { $licenseText.TrimEnd("`n") }
            default { $licenseText }
        }
        [IO.File]::WriteAllText($licenseReference, $referenceText, [Text.UTF8Encoding]::new($false))
        Assert-PinnedPiLicense -InstalledPath $licenseInstalled -ReferencePath $licenseReference -ExpectedHash $licenseHash
        $results.Add([ordered]@{ case = "Pi license reference $referenceCase"; passed = $true })
    }
    [IO.File]::WriteAllText($licenseReference, $licenseText, [Text.UTF8Encoding]::new($false))
    $tamperedLicense = [byte[]]$licenseBytes.Clone()
    $tamperedLicense[0] = $tamperedLicense[0] -bxor 1
    [IO.File]::WriteAllBytes($licenseInstalled, $tamperedLicense)
    Assert-Rejected -Name 'Pi license installed byte tamper' -MessagePattern 'installed Pi license bytes' -Action {
        Assert-PinnedPiLicense -InstalledPath $licenseInstalled -ReferencePath $licenseReference -ExpectedHash $licenseHash
    }
    [IO.File]::WriteAllText($licenseInstalled, $licenseText.Replace("`n", "`r`n"), [Text.UTF8Encoding]::new($false))
    Assert-Rejected -Name 'Pi license installed CRLF bytes' -MessagePattern 'installed Pi license bytes' -Action {
        Assert-PinnedPiLicense -InstalledPath $licenseInstalled -ReferencePath $licenseReference -ExpectedHash $licenseHash
    }
    [IO.File]::WriteAllBytes($licenseInstalled, $licenseBytes)
    [IO.File]::WriteAllText($licenseReference, $licenseText.Replace('intact', 'edited'), [Text.UTF8Encoding]::new($false))
    Assert-Rejected -Name 'Pi license retained reference tamper' -MessagePattern 'retained Pi license' -Action {
        Assert-PinnedPiLicense -InstalledPath $licenseInstalled -ReferencePath $licenseReference -ExpectedHash $licenseHash
    }

    $safetyParent = Join-Path $fixtureRoot 'path-safety'
    $outsideDirectory = Join-Path $fixtureRoot 'outside-target'
    $safeDirectory = Join-Path $safetyParent 'real-target'
    foreach ($directory in @($safetyParent, $outsideDirectory, $safeDirectory)) {
        [IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $outsideDirectory 'sentinel.txt'), 'must remain untouched')
    [void](Assert-ChildPath -Path $safeDirectory -Parent $safetyParent)
    Assert-Rejected -Name 'cleanup outside expected parent' -MessagePattern 'outside the expected test root' -Action {
        Assert-ChildPath -Path $outsideDirectory -Parent $safetyParent
    }
    $targetJunction = Join-Path $safetyParent 'linked-target'
    New-Item -ItemType Junction -Path $targetJunction -Target $outsideDirectory | Out-Null
    $junctions.Add($targetJunction)
    Assert-Rejected -Name 'cleanup target junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path $targetJunction -Parent $safetyParent
    }
    Assert-Rejected -Name 'cleanup parent junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path (Join-Path $targetJunction 'new-child') -Parent $safetyParent
    }
    $descendantJunction = Join-Path $safeDirectory 'linked-child'
    New-Item -ItemType Junction -Path $descendantJunction -Target $outsideDirectory | Out-Null
    $junctions.Add($descendantJunction)
    Assert-Rejected -Name 'cleanup descendant junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path $safeDirectory -Parent $safetyParent
    }
    if ([IO.File]::ReadAllText((Join-Path $outsideDirectory 'sentinel.txt')) -cne 'must remain untouched') {
        throw 'The junction target was unexpectedly changed.'
    }

    $publishTokens = $null; $publishErrors = $null
    $publishAst = [Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot 'publish-release.ps1'), [ref]$publishTokens, [ref]$publishErrors)
    if ($publishErrors.Count -gt 0) { throw 'PowerShell parser rejected publish-release.ps1.' }
    $publishGuard = $publishAst.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-ChildPath'
    }, $true)
    if ($null -eq $publishGuard) { throw 'Missing release publish path guard.' }
    . ([scriptblock]::Create($publishGuard.Extent.Text))
    $cleanTarget = Join-Path $safetyParent 'clean-target'
    [IO.Directory]::CreateDirectory($cleanTarget) | Out-Null
    [void](Assert-ChildPath -Path $cleanTarget -Parent $safetyParent)
    $results.Add([ordered]@{ case = 'publish cleanup clean target'; passed = $true })
    Assert-Rejected -Name 'publish cleanup outside expected parent' -MessagePattern 'outside the expected release root' -Action {
        Assert-ChildPath -Path $outsideDirectory -Parent $safetyParent
    }
    Assert-Rejected -Name 'publish cleanup target junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path $targetJunction -Parent $safetyParent
    }
    Assert-Rejected -Name 'publish cleanup parent junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path (Join-Path $targetJunction 'new-child') -Parent $safetyParent
    }
    Assert-Rejected -Name 'publish cleanup descendant junction' -MessagePattern 'reparse point' -Action {
        Assert-ChildPath -Path $safeDirectory -Parent $safetyParent
    }
}
finally {
    foreach ($junction in $junctions) {
        if (Test-Path -LiteralPath $junction) { Remove-Item -LiteralPath $junction -Force }
    }
    if ([IO.Directory]::Exists($fixtureRoot)) {
        $safeRoot = [IO.Path]::GetFullPath($fixtureRoot)
        if ([IO.Path]::GetDirectoryName($safeRoot) -cne [IO.Path]::GetFullPath($temporaryParent) -or
            [IO.Path]::GetFileName($safeRoot) -notmatch '\A[0-9a-f]{32}\z') { throw 'Unsafe synthetic fixture cleanup path.' }
        $safeRoot = Assert-ChildPath -Path $safeRoot -Parent $temporaryParent
        Remove-Item -LiteralPath $safeRoot -Recurse -Force
    }
}

[ordered]@{ status = 'PASS'; realInstallerExecuted = $false; cases = @($results.ToArray()) } | ConvertTo-Json -Depth 5
