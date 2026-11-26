#requires -Version 7.0
<#
.SYNOPSIS
Stages four version-pinned DSH bundles; -Install explicitly installs them into a closed Desktop profile.
.DESCRIPTION
The default run only downloads and verifies bundles. A missing Desktop CLI also leaves them staged.
The script does not start or stop Desktop, change PATH, or write profile files directly.
.PARAMETER Install
Run the installed Desktop CLI after all four assets have been verified. Desktop must be fully quit.
.PARAMETER DesktopInstallDir
Optional DeepSeek Harness program installation directory, not a profile directory.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [string]$DesktopInstallDir
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'This script is for Windows and requires PowerShell 7.' }
$tar = (Get-Command tar.exe -CommandType Application -ErrorAction Stop).Source
$launcher = $null
if ($Install) {
    if (-not $DesktopInstallDir -and $env:LOCALAPPDATA) {
        $DesktopInstallDir = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness'
    }
    if ($DesktopInstallDir) {
        $root = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DesktopInstallDir)
        $candidate = Join-Path $root 'resources/runtime/cli/bin/dsh.cmd'
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $root 'DeepSeek Harness.exe') -PathType Leaf)) {
            $launcher = $candidate
        }
    }
    if ($launcher -and (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
        throw 'Fully quit DeepSeek Harness Desktop, including its tray icon, before using -Install. Use the default mode to stage while it is running.'
    }
}

$owner = 'Leo19990721'
$bundles = @(
    @{ Repo = 'dsh-plugin-subscriptions-enhanced'; Version = '0.4.15'; Asset = 'dsh-subscriptions-enhanced-0.4.15.tgz'; Name = 'dsh-subscriptions-enhanced' }
    @{ Repo = 'dsh-toolbox-enhanced'; Version = '0.1.8'; Asset = 'dsh-toolbox-enhanced-0.1.8.tgz'; Name = '@local/dsh-toolbox-enhanced' }
    @{ Repo = 'dsh-remote-enhanced'; Version = '0.1.12'; Asset = 'dsh-remote-enhanced-0.1.12.tgz'; Name = '@local/dsh-remote-enhanced' }
    @{ Repo = 'dsh-harness-enhanced'; Version = '0.1.11'; Asset = 'local-dsh-harness-enhanced-0.1.11.tgz'; Name = '@local/dsh-harness-enhanced' }
)

$project = Split-Path -Parent $PSScriptRoot
$runId = '{0:yyyyMMdd-HHmmss}-{1:N}' -f [DateTime]::UtcNow, [Guid]::NewGuid()
$stage = Join-Path $project ".local-install/office-plugins/$runId"
# The shipped .cmd forwards arguments through cmd.exe. Do not interpolate paths that it can reinterpret.
if ($launcher -and ($launcher -match '[%"&|<>^!\r\n]' -or $stage -match '[%"&|<>^!\r\n]')) {
    Write-Warning 'The folder path contains unsupported cmd.exe characters. This run will only stage the assets.'
    $launcher = $null
}
[void][IO.Directory]::CreateDirectory($stage)
Write-Host "Staging directory: $stage"

$headers = @{ Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$paths = foreach ($bundle in $bundles) {
    $tag = 'v' + $bundle.Version
    $api = "https://api.github.com/repos/$owner/$($bundle.Repo)/releases/tags/$tag"
    $url = "https://github.com/$owner/$($bundle.Repo)/releases/download/$tag/$($bundle.Asset)"
    $release = Invoke-RestMethod -Uri $api -Headers $headers -UserAgent 'DSH-Office-Plugin-Staging' -MaximumRedirection 0 -TimeoutSec 30
    $matchingAssets = @($release.assets | Where-Object { $_.name -ceq $bundle.Asset })
    if ($release.tag_name -cne $tag -or $release.draft -ne $false -or $matchingAssets.Count -ne 1) {
        throw "The pinned GitHub release or asset is unavailable: $($bundle.Repo) $tag / $($bundle.Asset)."
    }
    $asset = $matchingAssets[0]
    if ($asset.state -ne 'uploaded' -or $asset.browser_download_url -cne $url -or $asset.size -le 0 -or
        $asset.digest -notmatch '\Asha256:[0-9a-f]{64}\z') {
        throw "Missing or invalid GitHub SHA-256, size, or source URL for $($bundle.Asset). No packages were installed."
    }

    $file = Join-Path $stage $bundle.Asset
    $partial = "$file.part"
    Write-Host "Downloading $($bundle.Asset)"
    Invoke-WebRequest -Uri $url -OutFile $partial -UserAgent 'DSH-Office-Plugin-Staging' -MaximumRedirection 5 -TimeoutSec 120 | Out-Null
    if ((Get-Item -LiteralPath $partial).Length -ne $asset.size -or
        (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $asset.digest.Substring(7)) {
        throw "Release size or SHA-256 mismatch for $($bundle.Asset). No packages were installed."
    }

    # Read only the manifest; never unpack or execute the downloaded bundle during verification.
    $manifestJson = & $tar -xOzf $partial 'package/package.json'
    if ($LASTEXITCODE -ne 0) { throw "Cannot read the bundle manifest in $($bundle.Asset)." }
    $manifest = ($manifestJson -join "`n") | ConvertFrom-Json
    if ($manifest.name -cne $bundle.Name -or $manifest.version -cne $bundle.Version -or -not $manifest.dsh.bundle.patch) {
        throw "Unexpected package identity or missing DSH bundle declaration in $($bundle.Asset)."
    }

    [IO.File]::Move($partial, $file)
    Write-Host "Verified $($bundle.Name)@$($bundle.Version)"
    $file
}

if (-not $Install -or -not $launcher) {
    if ($Install) { Write-Warning 'No usable installed Desktop CLI was found. The verified assets were staged, not installed.' }
    Write-Host 'To install manually later: Desktop > Plugins > Add plugin, then paste each absolute .tgz path.'
    $paths | ForEach-Object { Write-Host $_ }
    return
}

if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
    throw "Desktop is running. Fully quit it before installing the verified bundles at $stage."
}
# This is the shipped Desktop carrier's package-management mode, not a Host or GUI launch.
# Use one operation, do not authorize lifecycle scripts, and preserve the local tarballs.
& $launcher plugin --profile desktop add --ignore-scripts @paths
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    throw "Desktop CLI returned exit code $exitCode. Check its output and verify the profile state before retrying. Verified bundles remain at $stage."
}
Write-Host 'Desktop CLI completed. Keep the staged files and check versions and activation the next time you open Desktop.'
