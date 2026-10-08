# Fetch a prebuilt SlicerWeb channel into its local data directory.
#
# Usage:
#   scripts/fetch-slicerweb.ps1                  # stable channel (default)
#   scripts/fetch-slicerweb.ps1 --channel stable
#   scripts/fetch-slicerweb.ps1 --channel latest
#
# The channel maps to a git branch in the deploy repo:
#   stable  →  deploy/stable   →  data/slicerweb-stable/
#   latest  →  deploy/latest   →  data/slicerweb-latest/
#
# Override the destination with $env:SLICERWEB_STABLE_DIR or $env:SLICERWEB_LATEST_DIR.
# Set the same value in .env so docker compose mounts the same folder.
#
# The deploy branches are single-commit histories that are force-pushed on each build,
# so we fetch by branch name rather than a pinned SHA.
param(
    [string]$Channel = 'stable'
)
$ErrorActionPreference = 'Stop'

if ($Channel -notin @('stable', 'latest')) {
    throw "Unknown channel '$Channel'. Use 'stable' or 'latest'."
}

$root    = Split-Path -Parent $PSScriptRoot
$repoUrl = if ($env:SLICERWEB_REPO_URL) { $env:SLICERWEB_REPO_URL } else { 'https://github.com/lassoan/slicerweb-app.git' }
$ref     = "deploy/$Channel"

$destEnvVar = if ($Channel -eq 'stable') { $env:SLICERWEB_STABLE_DIR } else { $env:SLICERWEB_LATEST_DIR }
$dest    = if ($destEnvVar) { $destEnvVar } else { Join-Path $root "data/slicerweb-$Channel" }
$versionFile = Join-Path $dest '.version'

try {
    New-Item -ItemType Directory -Force $dest | Out-Null
    $probe = Join-Path $dest '.write-test'
    Set-Content -Path $probe -Value '' ; Remove-Item $probe
} catch {
    throw "Cannot write to $dest. Set SLICERWEB_$($Channel.ToUpper())_DIR to a folder you can write to (and in .env), then run this again."
}

# Fetch the latest SHA on the branch so we can skip if already current.
Write-Host "Resolving latest SHA for $ref ..."
$tmp = Join-Path ([IO.Path]::GetTempPath()) "slicerweb-fetch-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    git -C $tmp init -q
    git -C $tmp remote add origin $repoUrl
    git -C $tmp fetch -q --depth 1 origin $ref
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch $ref from $repoUrl" }
    $sha = (git -C $tmp rev-parse FETCH_HEAD).Trim()

    if ((Test-Path $versionFile) -and ((Get-Content $versionFile -Raw).Trim() -eq $sha)) {
        Write-Host "SlicerWeb $Channel ($sha) already present in $dest"
        return
    }

    git -C $tmp checkout -q FETCH_HEAD
    Remove-Item -Recurse -Force (Join-Path $tmp '.git'), (Join-Path $tmp '.github') -ErrorAction SilentlyContinue

    # Replace contents (not the folder itself — may be a mount point).
    Get-ChildItem $dest -Force | Remove-Item -Recurse -Force
    Get-ChildItem $tmp -Force | Copy-Item -Destination $dest -Recurse -Force
    Set-Content -Path $versionFile -Value $sha -NoNewline
    Write-Host "SlicerWeb $Channel $($sha.Substring(0,12)) installed in $dest"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
