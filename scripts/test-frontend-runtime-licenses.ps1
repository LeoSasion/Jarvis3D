[CmdletBinding()]
param(
    [string]$FrontendRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($FrontendRoot)) {
    $FrontendRoot = Join-Path $repositoryRoot 'frontend'
}
elseif (-not [System.IO.Path]::IsPathRooted($FrontendRoot)) {
    $FrontendRoot = Join-Path $repositoryRoot $FrontendRoot
}
$FrontendRoot = [System.IO.Path]::GetFullPath($FrontendRoot)
$stager = Join-Path $PSScriptRoot 'stage-frontend-runtime-licenses.mjs'
$policyPath = Join-Path $PSScriptRoot 'licenses\frontend-runtime-policy.json'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$testParent = Join-Path $repositoryRoot 'tmp\frontend-runtime-license-tests'
$testRoot = Join-Path $testParent ([Guid]::NewGuid().ToString('N'))
$licenseDirectory = Join-Path $testRoot 'licenses'

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-NodeChecked {
    param(
        [Parameter(Mandatory)] [string[]]$Arguments
    )

    $output = & $node @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "node exited with code $LASTEXITCODE."
    }
    return $output
}

function Invoke-NodeExpectedFailure {
    param(
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [string]$Pattern,
        [Parameter(Mandatory)] [string]$Label
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $hasNativeErrorPreference = Test-Path Variable:\PSNativeCommandUseErrorActionPreference
    $previousNativeErrorPreference = if ($hasNativeErrorPreference) {
        $PSNativeCommandUseErrorActionPreference
    }
    else {
        $null
    }
    try {
        # Windows PowerShell exposes native stderr as non-terminating ErrorRecords.
        # Capture those records without letting the test harness stop before it can
        # inspect the process exit code and diagnostic.
        $ErrorActionPreference = 'Continue'
        if ($hasNativeErrorPreference) {
            $PSNativeCommandUseErrorActionPreference = $false
        }
        $output = (& $node @Arguments 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($hasNativeErrorPreference) {
            $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
        }
        $ErrorActionPreference = $previousErrorActionPreference
    }

    Assert-True ($exitCode -ne 0) "$Label unexpectedly passed verification."
    Assert-True ($output -match $Pattern) "$Label failed for the wrong reason: $output"
}

function Write-Receipt {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [object]$Receipt
    )

    [System.IO.File]::WriteAllText(
        $Path,
        ($Receipt | ConvertTo-Json -Depth 10) + "`n",
        [System.Text.UTF8Encoding]::new($false))
}

function New-FrontendStateFixture {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)]
        [ValidateSet('PresentRootOptional', 'MissingRootOptional', 'UnreviewedRootOptional')]
        [string]$Scenario
    )

    # Windows PowerShell's ConvertFrom-Json rejects package-lock's required
    # empty-string root key. Use the same Node runtime as the stager to build
    # deterministic lockfile fixtures without weakening that real structure.
    $fixtureBuilder = @'
const fs = require("node:fs");
const path = require("node:path");
const [frontendRoot, outputRoot, scenario] = process.argv.slice(2);
const packageJson = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const rootLock = packageLock.packages[""];
packageJson.optionalDependencies ??= {};
rootLock.optionalDependencies ??= {};

if (scenario === "PresentRootOptional") {
  packageJson.optionalDependencies.graphology = packageJson.dependencies.graphology;
  rootLock.optionalDependencies.graphology = rootLock.dependencies.graphology;
  delete packageJson.dependencies.graphology;
  delete rootLock.dependencies.graphology;
} else if (scenario === "MissingRootOptional") {
  packageJson.optionalDependencies["fixture-missing-optional"] = "1.0.0";
  rootLock.optionalDependencies["fixture-missing-optional"] = "1.0.0";
} else if (scenario === "UnreviewedRootOptional") {
  packageJson.optionalDependencies["fixture-installed-optional"] = "1.0.0";
  rootLock.optionalDependencies["fixture-installed-optional"] = "1.0.0";
  packageLock.packages["node_modules/fixture-installed-optional"] = {
    version: "1.0.0",
    license: "MIT",
    integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    optional: true,
  };
} else {
  throw new Error(`Unknown fixture scenario: ${scenario}`);
}

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`);
'@
    $fixtureBuilderPath = Join-Path $testRoot 'frontend-state-fixture.cjs'
    [System.IO.File]::WriteAllText(
        $fixtureBuilderPath,
        $fixtureBuilder,
        [System.Text.UTF8Encoding]::new($false))
    $null = Invoke-NodeChecked -Arguments @(
        $fixtureBuilderPath,
        $FrontendRoot,
        $Path,
        $Scenario)
}

function New-LicenseVerificationFixture {
    param(
        [Parameter(Mandatory)] [string]$FrontendFixture,
        [Parameter(Mandatory)] [string]$Name
    )

    $directory = Join-Path $testRoot $Name
    Copy-Item -LiteralPath $licenseDirectory -Destination $directory -Recurse
    $receiptPath = Join-Path $directory 'FRONTEND-RUNTIME-LICENSES.json'
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $receipt.packageJsonSha256 = (Get-FileHash `
        -LiteralPath (Join-Path $FrontendFixture 'package.json') `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    $receipt.packageLockSha256 = (Get-FileHash `
        -LiteralPath (Join-Path $FrontendFixture 'package-lock.json') `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Receipt -Path $receiptPath -Receipt $receipt
    return $directory
}

[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$passed = [System.Collections.Generic.List[string]]::new()
try {
    $null = Invoke-NodeChecked -Arguments @(
        $stager,
        '--frontend-root', $FrontendRoot,
        '--destination', $licenseDirectory)
    $passed.Add('staged reviewed production dependency closure licenses')

    $verification = Invoke-NodeChecked -Arguments @(
        $stager,
        'verify',
        '--frontend-root', $FrontendRoot,
        '--directory', $licenseDirectory) | ConvertFrom-Json
    Assert-True ($verification.status -eq 'verified') 'License verification did not return verified status.'

    $packageJson = Get-Content -LiteralPath (Join-Path $FrontendRoot 'package.json') -Raw | ConvertFrom-Json
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    $expectedCount = @($policy.packages).Count
    $directCount = @($packageJson.dependencies.PSObject.Properties).Count
    Assert-True ($verification.packages -eq $expectedCount) 'License package count does not cover the reviewed production closure.'
    Assert-True ($expectedCount -gt $directCount) 'License policy did not add any transitive production dependencies.'
    $passed.Add('verified receipt coverage and file hashes')

    $installerSource = [System.IO.File]::ReadAllText(
        (Join-Path $repositoryRoot 'installer\JARVIS.iss'))
    Assert-True `
        ($installerSource.Contains('#ifnexist SourceDir + "\ThirdPartyLicenses\frontend\FRONTEND-RUNTIME-LICENSES.json"')) `
        'Installer does not fail closed when the frontend runtime license receipt is missing.'
    Assert-True `
        ($installerSource.Contains('Type: filesandordirs; Name: "{app}\ThirdPartyLicenses"')) `
        'Installer upgrade cleanup does not replace the previous frontend runtime license closure.'
    $passed.Add('guarded and replaced the installer frontend license closure')

    $receiptPath = Join-Path $licenseDirectory 'FRONTEND-RUNTIME-LICENSES.json'
    $originalReceiptText = Get-Content -LiteralPath $receiptPath -Raw
    $receipt = $originalReceiptText | ConvertFrom-Json
    foreach ($transitiveName in @('@griffel/core', 'd3-dispatch', 'scheduler', 'zustand')) {
        Assert-True (
            @($receipt.packages | Where-Object name -eq $transitiveName).Count -eq 1) `
            "Transitive production dependency $transitiveName is missing from the runtime license receipt."
    }
    $passed.Add('covered representative bundled transitive dependencies')

    $presentOptionalFrontend = Join-Path $testRoot 'frontend-present-root-optional'
    New-FrontendStateFixture `
        -Path $presentOptionalFrontend `
        -Scenario 'PresentRootOptional'
    $presentOptionalLicenses = New-LicenseVerificationFixture `
        -FrontendFixture $presentOptionalFrontend `
        -Name 'licenses-present-root-optional'
    $presentOptionalVerification = Invoke-NodeChecked -Arguments @(
        $stager,
        'verify',
        '--frontend-root', $presentOptionalFrontend,
        '--directory', $presentOptionalLicenses) | ConvertFrom-Json
    Assert-True `
        ($presentOptionalVerification.packages -eq $expectedCount) `
        'A present root optional dependency was omitted from the reviewed closure.'
    $passed.Add('included a present root optional dependency in the closure')

    $missingOptionalFrontend = Join-Path $testRoot 'frontend-missing-root-optional'
    New-FrontendStateFixture `
        -Path $missingOptionalFrontend `
        -Scenario 'MissingRootOptional'
    $missingOptionalLicenses = New-LicenseVerificationFixture `
        -FrontendFixture $missingOptionalFrontend `
        -Name 'licenses-missing-root-optional'
    $missingOptionalVerification = Invoke-NodeChecked -Arguments @(
        $stager,
        'verify',
        '--frontend-root', $missingOptionalFrontend,
        '--directory', $missingOptionalLicenses) | ConvertFrom-Json
    Assert-True `
        ($missingOptionalVerification.packages -eq $expectedCount) `
        'A missing root optional dependency changed the reviewed closure.'
    $passed.Add('skipped a missing root optional dependency')

    $unreviewedOptionalFrontend = Join-Path $testRoot 'frontend-unreviewed-root-optional'
    New-FrontendStateFixture `
        -Path $unreviewedOptionalFrontend `
        -Scenario 'UnreviewedRootOptional'
    Invoke-NodeExpectedFailure `
        -Label 'Unreviewed present root optional dependency' `
        -Pattern 'Frontend production dependency closure does not match' `
        -Arguments @(
            $stager,
            'verify',
            '--frontend-root', $unreviewedOptionalFrontend,
            '--directory', $licenseDirectory)
    $passed.Add('rejected an unreviewed present root optional dependency')

    $three = @($receipt.packages | Where-Object name -eq 'three')
    Assert-True ($three.Count -eq 1) 'Three.js is missing from the runtime license receipt.'
    $threeOriginalFile = [string]$three[0].file
    $threeTamperedFile = $threeOriginalFile.Replace('-0.182.0-', '-999.0.0-')
    Assert-True ($threeTamperedFile -ne $threeOriginalFile) 'Three.js receipt test could not derive a tampered file name.'
    [System.IO.File]::Move(
        (Join-Path $licenseDirectory $threeOriginalFile),
        (Join-Path $licenseDirectory $threeTamperedFile))
    $three[0].version = '999.0.0'
    $three[0].file = $threeTamperedFile
    Write-Receipt -Path $receiptPath -Receipt $receipt
    Invoke-NodeExpectedFailure `
        -Label 'Tampered locked version' `
        -Pattern 'version is unreviewed' `
        -Arguments @(
            $stager,
            'verify',
            '--frontend-root', $FrontendRoot,
            '--directory', $licenseDirectory)
    [System.IO.File]::Move(
        (Join-Path $licenseDirectory $threeTamperedFile),
        (Join-Path $licenseDirectory $threeOriginalFile))
    [System.IO.File]::WriteAllText(
        $receiptPath,
        $originalReceiptText,
        [System.Text.UTF8Encoding]::new($false))
    $receipt = $originalReceiptText | ConvertFrom-Json
    $passed.Add('rejected renamed license with forged locked version')

    $three = @($receipt.packages | Where-Object name -eq 'three')
    $three[0].integrity = 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
    Write-Receipt -Path $receiptPath -Receipt $receipt
    Invoke-NodeExpectedFailure `
        -Label 'Tampered lock integrity' `
        -Pattern 'integrity is unreviewed' `
        -Arguments @(
            $stager,
            'verify',
            '--frontend-root', $FrontendRoot,
            '--directory', $licenseDirectory)
    [System.IO.File]::WriteAllText(
        $receiptPath,
        $originalReceiptText,
        [System.Text.UTF8Encoding]::new($false))
    $receipt = $originalReceiptText | ConvertFrom-Json
    $passed.Add('rejected forged package integrity metadata')

    $receipt.packageLockSha256 = ('0' * 64)
    Write-Receipt -Path $receiptPath -Receipt $receipt
    Invoke-NodeExpectedFailure `
        -Label 'Tampered package-lock binding' `
        -Pattern 'not bound to the current package-lock.json' `
        -Arguments @(
            $stager,
            'verify',
            '--frontend-root', $FrontendRoot,
            '--directory', $licenseDirectory)
    [System.IO.File]::WriteAllText(
        $receiptPath,
        $originalReceiptText,
        [System.Text.UTF8Encoding]::new($false))
    $receipt = $originalReceiptText | ConvertFrom-Json
    $passed.Add('rejected forged package-lock binding')

    $noto = @($receipt.packages | Where-Object name -eq '@fontsource/noto-sans-sc')
    Assert-True ($noto.Count -eq 1) 'Noto Sans SC is missing from the runtime license receipt.'
    Assert-True ($noto[0].license -eq 'OFL-1.1') 'Noto Sans SC receipt has the wrong license.'
    $notoText = Get-Content -LiteralPath (Join-Path $licenseDirectory $noto[0].file) -Raw
    Assert-True ($notoText -match 'SIL OPEN FONT LICENSE Version 1\.1') 'Noto Sans SC package does not contain the full OFL 1.1 text.'
    Assert-True ($notoText -match 'Google Inc\.') 'Noto Sans SC package does not contain its copyright notice.'
    $passed.Add('retained Noto Sans SC copyright and full OFL text')

    [System.IO.File]::AppendAllText(
        (Join-Path $licenseDirectory $noto[0].file),
        'tampered',
        [System.Text.UTF8Encoding]::new($false))
    $noto[0].sha256 = (Get-FileHash -LiteralPath (Join-Path $licenseDirectory $noto[0].file) -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Receipt -Path $receiptPath -Receipt $receipt
    Invoke-NodeExpectedFailure `
        -Label 'Tampered packaged license with forged receipt hash' `
        -Pattern 'sha256 is unreviewed' `
        -Arguments @(
            $stager,
            'verify',
            '--frontend-root', $FrontendRoot,
            '--directory', $licenseDirectory)
    $passed.Add('rejected tampered license with forged self-reported hash')

    [pscustomobject]@{
        Status = 'passed'
        Tests = $passed.Count
        Receipts = @($passed)
        RuntimeDependencies = $expectedCount
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
    if ((Test-Path -LiteralPath $testParent) -and
        (Get-ChildItem -LiteralPath $testParent -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $testParent -Force
    }
}
