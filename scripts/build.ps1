<#
.SYNOPSIS
    The one build script, used by developers and by CI.

.DESCRIPTION
    Restore, license check, typecheck, lint, tests, package (Firefox and Chrome),
    web-ext lint, checksums, smoke test of the packaged build.
    Exits non-zero on any real failure. Coverage is reported by the test run and
    is never a gate.

    Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less files as ANSI.
    It requires these package.json scripts (created in milestone M0):
    check:licenses, typecheck, lint, test, zip:firefox, zip:chrome, smoke.

.EXAMPLE
    .\scripts\build.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$packageDir = Join-Path $root 'dist\packages'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Stop-Build {
    param([string]$Message)
    Write-Host "BUILD FAILED: $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Stop-Build "$Name (exit code $LASTEXITCODE)"
    }
}

# Windows antivirus can lock freshly written zip files; retry a few times.
function Invoke-WithRetry {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [int]$Attempts = 3
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        $global:LASTEXITCODE = 0
        & $Action
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Write-Host "$Name failed (attempt $i of $Attempts)" -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
    Stop-Build "$Name failed after $Attempts attempts"
}

function Get-Sha256Line {
    param([System.IO.FileInfo]$File)
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File.FullName).Hash.ToLowerInvariant()
    return "$hash *$($File.Name)"
}

function Get-PackageFiles {
    $files = Get-ChildItem -LiteralPath $packageDir -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' }
    $names = @($files | ForEach-Object { $_.Name })
    [Array]::Sort($names, [System.StringComparer]::Ordinal)
    return @($names | ForEach-Object { Get-Item -LiteralPath (Join-Path $packageDir $_) })
}

function Write-Checksums {
    $lines = @(Get-PackageFiles | ForEach-Object { Get-Sha256Line $_ })
    if ($lines.Count -eq 0) {
        Stop-Build 'no packages found to checksum'
    }
    $sumsPath = Join-Path $packageDir 'SHA256SUMS.txt'
    [System.IO.File]::WriteAllText($sumsPath, (($lines -join "`n") + "`n"), $utf8NoBom)

    # Verify what was written by hashing again and comparing line by line.
    $written = @([System.IO.File]::ReadAllLines($sumsPath))
    $again = @(Get-PackageFiles | ForEach-Object { Get-Sha256Line $_ })
    if (($written -join "`n") -ne ($again -join "`n")) {
        Stop-Build 'SHA256SUMS.txt does not match the package files'
    }
    Write-Host "Checksums written and verified for $($lines.Count) file(s)."
}

Invoke-Step 'Restore dependencies' { pnpm install --frozen-lockfile }
Invoke-Step 'Check dependency licenses' { pnpm run check:licenses }
Invoke-Step 'Typecheck' { pnpm run typecheck }
Invoke-Step 'Lint (warnings are errors)' { pnpm run lint }
Invoke-Step 'Unit tests' { pnpm run test }

if (Test-Path -LiteralPath $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

Invoke-WithRetry 'Package Firefox' { pnpm run zip:firefox }
Invoke-WithRetry 'Package Chrome' { pnpm run zip:chrome }

# WXT writes its zips to .output; copy them to the folder CI uploads from.
$zips = @(Get-ChildItem -LiteralPath (Join-Path $root '.output') -Filter '*.zip' -File)
if ($zips.Count -eq 0) {
    Stop-Build 'no zip files found in .output'
}
foreach ($zip in $zips) {
    Copy-Item -LiteralPath $zip.FullName -Destination $packageDir
}

Write-Checksums

if (-not $SkipSmoke) {
    Invoke-Step 'Smoke test the packages' { pnpm run smoke }
}

Write-Host 'BUILD OK' -ForegroundColor Green
exit 0
