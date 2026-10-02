#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$Version,
    [Parameter(Mandatory)]
    [ValidatePattern('\A[0-9a-f]{40}\z')]
    [string]$ExpectedCommit,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-PackageRelativePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or
        $Path -match '[<>:"\\|?*\x00-\x1f]') {
        throw 'A package path is not a safe canonical relative path.'
    }
    foreach ($segment in $Path.Split('/')) {
        if ([string]::IsNullOrEmpty($segment) -or $segment -in @('.', '..') -or
            $segment.EndsWith('.') -or $segment.EndsWith(' ') -or
            $segment -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)') {
            throw 'A package path contains an unsafe or ambiguous segment.'
        }
    }
}

function Get-ArchiveEntryHash {
    param([IO.Compression.ZipArchiveEntry]$Entry, [long]$ExpectedLength)
    if ($Entry.Length -ne $ExpectedLength) { throw "Portable entry size differs: $($Entry.FullName)" }
    $stream = $Entry.Open()
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $buffer = [byte[]]::new(65536)
        $total = 0L
        while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt $ExpectedLength) { throw 'Portable entry exceeded its verified size.' }
            $hasher.AppendData($buffer, 0, $count)
        }
        if ($total -ne $ExpectedLength) { throw 'Portable entry ended before its verified size.' }
        return [Convert]::ToHexString($hasher.GetHashAndReset()).ToLowerInvariant()
    }
    finally { $hasher.Dispose(); $stream.Dispose() }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = Join-Path $repositoryRoot 'artifacts\release'
$packageName = "JARVIS-$Version-win-x64"
$packageRoot = Join-Path $releaseRoot $packageName
$versionManifest = Get-Content -LiteralPath (Join-Path $packageRoot 'version.json') -Raw | ConvertFrom-Json
$updateManifest = Get-Content -LiteralPath (Join-Path $releaseRoot 'JARVIS-update-manifest.json') -Raw | ConvertFrom-Json
if ($versionManifest.product -cne 'JARVIS' -or $versionManifest.version -cne $Version -or
    $versionManifest.sourceCommit -cne $ExpectedCommit -or
    $versionManifest.sourceDirty -isnot [bool] -or $versionManifest.sourceDirty -ne $false -or
    $versionManifest.runtime -cne 'win-x64' -or $updateManifest.version -cne $Version) {
    throw 'Release metadata does not identify the requested clean source commit and version.'
}
$expectedProductVersion = "$Version+$($ExpectedCommit.Substring(0, 12))"
if ((Get-Item -LiteralPath (Join-Path $packageRoot 'Jarvis.Host.exe')).VersionInfo.ProductVersion -cne $expectedProductVersion) {
    throw 'The packaged Host product version does not match the release provenance.'
}
$checkedFiles = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
$packagePrefix = [IO.Path]::GetFullPath($packageRoot).TrimEnd('\') + '\'
$packageEntries = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -Force)
if ((Get-Item -LiteralPath $packageRoot).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    @($packageEntries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) {
    throw 'The published directory must not contain reparse points.'
}
$packageDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($entry in $packageEntries) {
    $relativePath = $entry.FullName.Substring($packagePrefix.Length).Replace('\', '/')
    Assert-PackageRelativePath -Path $relativePath
    if ($entry.PSIsContainer) { [void]$packageDirectories.Add($relativePath) }
}
foreach ($line in Get-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt')) {
    if ($line -notmatch '\A([0-9a-f]{64})  (.+)\z') { throw 'Invalid package checksum entry.' }
    $expectedHash = $Matches[1]
    $relativePath = $Matches[2]
    Assert-PackageRelativePath -Path $relativePath
    $filePath = [IO.Path]::GetFullPath((Join-Path $packageRoot $relativePath))
    if (-not $filePath.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        $relativePath -ieq 'SHA256SUMS.txt' -or $checkedFiles.ContainsKey($relativePath)) {
        throw 'Package checksum path escapes the package or appears twice.'
    }
    $file = Get-Item -LiteralPath $filePath
    if ($file.PSIsContainer -or $file.FullName.Substring($packagePrefix.Length).Replace('\', '/') -cne $relativePath) {
        throw 'Package checksum path does not exactly identify a published file.'
    }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedHash) {
        throw "A packaged file failed its checksum: $relativePath"
    }
    $checkedFiles.Add($relativePath, [pscustomobject]@{ path = $relativePath; length = $file.Length; hash = $expectedHash })
}
if (@($packageEntries | Where-Object { -not $_.PSIsContainer }).Count -ne $checkedFiles.Count + 1) {
    throw 'The published directory contains files absent from SHA256SUMS.txt.'
}
$checkedPackageFiles = $checkedFiles.Count
$checksumFile = Get-Item -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt')
$checkedFiles.Add('SHA256SUMS.txt', [pscustomobject]@{
    path = 'SHA256SUMS.txt'; length = $checksumFile.Length
    hash = (Get-FileHash -LiteralPath $checksumFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
})
foreach ($required in @('Jarvis.Host.exe', 'version.json', 'frontend/index.html', 'frontend/graphics-regression.html', 'AgentRuntime/pi.exe')) {
    if (-not $checkedFiles.ContainsKey($required)) { throw "Published directory is missing $required." }
}

$verified = [Collections.Generic.List[object]]::new()
foreach ($kind in @('portable', 'installer')) {
    $record = $updateManifest.packages.$kind
    if ($null -eq $record) { throw "The $kind release package is missing." }
    $expectedName = if ($kind -eq 'portable') { "$packageName.zip" } else { "JARVIS-Setup-$Version-win-x64.exe" }
    if ($record.fileName -cne $expectedName) { throw "The $kind manifest filename is invalid." }
    $directory = if ($kind -eq 'portable') { $releaseRoot } else { Join-Path $repositoryRoot 'artifacts\installer' }
    $path = Join-Path $directory $expectedName
    $item = Get-Item -LiteralPath $path
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($item.Length -ne $record.sizeBytes -or $hash -cne $record.sha256) { throw "The $kind package does not match its published checksum." }
    $verified.Add([ordered]@{ kind = $kind; fileName = $expectedName; sizeBytes = $item.Length; sha256 = $hash })
}

$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $releaseRoot "$packageName.zip"))
try {
    $archivePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $archiveFileCount = 0
    foreach ($entry in $archive.Entries) {
        $isDirectory = $entry.FullName.EndsWith('/')
        $relativePath = if ($isDirectory) { $entry.FullName.Substring(0, $entry.FullName.Length - 1) } else { $entry.FullName }
        Assert-PackageRelativePath -Path $relativePath
        if (-not $archivePaths.Add($relativePath)) { throw 'The portable archive contains a duplicate path.' }
        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xf000
        if (($entry.ExternalAttributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ($unixType -ne 0 -and $unixType -ne $(if ($isDirectory) { 0x4000 } else { 0x8000 }))) {
            throw 'The portable archive contains a link or unsupported entry type.'
        }
        if ($isDirectory) {
            if ($entry.Length -ne 0 -or -not $packageDirectories.Contains($relativePath)) {
                throw 'The portable archive contains an unexpected directory.'
            }
            continue
        }
        if (-not $checkedFiles.ContainsKey($relativePath) -or $checkedFiles[$relativePath].path -cne $relativePath) {
            throw "The portable archive contains an unexpected file: $relativePath"
        }
        $expected = $checkedFiles[$relativePath]
        if ((Get-ArchiveEntryHash -Entry $entry -ExpectedLength $expected.length) -cne $expected.hash) {
            throw "Portable file contents differ from the verified directory: $relativePath"
        }
        $archiveFileCount++
    }
    if ($archiveFileCount -ne $checkedFiles.Count) {
        throw 'The portable archive is missing verified published files.'
    }
}
finally { $archive.Dispose() }

$result = [ordered]@{
    schemaVersion = 1
    status = 'PASS'
    version = $Version
    sourceCommit = $ExpectedCommit
    sourceDirty = $false
    hostProductVersion = $expectedProductVersion
    checkedPackageFiles = $checkedPackageFiles
    checkedPortableFiles = $archiveFileCount
    packages = @($verified.ToArray())
    portableContentsVerified = $true
}
$json = $result | ConvertTo-Json -Depth 5
if ($OutputPath) {
    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($resolvedOutput)) -Force | Out-Null
    [IO.File]::WriteAllText($resolvedOutput, $json)
}
$json
