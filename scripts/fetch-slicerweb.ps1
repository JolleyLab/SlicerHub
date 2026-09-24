# Fetch the prebuilt SlicerWeb site (github.com/lassoan/slicerweb-app) at the commit pinned in
# slicerweb/VERSION, where nginx serves it at /slicerweb/.
#
# Destination: data/slicerweb/ (git-ignored), or $env:SLICERWEB_DIR when set. Set the same value in .env
# so docker compose mounts that folder.
#
# To upgrade: put a new commit SHA in slicerweb/VERSION and re-run.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$repoUrl = if ($env:SLICERWEB_REPO_URL) { $env:SLICERWEB_REPO_URL } else { 'https://github.com/lassoan/slicerweb-app.git' }
$sha = (Get-Content (Join-Path $root 'slicerweb/VERSION') -Raw).Trim()
$dest = if ($env:SLICERWEB_DIR) { $env:SLICERWEB_DIR } else { Join-Path $root 'data/slicerweb' }
$versionFile = Join-Path $dest '.version'

if ((Test-Path $versionFile) -and ((Get-Content $versionFile -Raw).Trim() -eq $sha)) {
    Write-Host "SlicerWeb $sha already present in $dest"
    return
}

try {
    New-Item -ItemType Directory -Force $dest | Out-Null
    $probe = Join-Path $dest '.write-test'
    Set-Content -Path $probe -Value '' ; Remove-Item $probe
} catch {
    throw "Cannot write to $dest. Set SLICERWEB_DIR to a folder you can write to (and in .env), then run this again."
}

# Work in the system temp folder, so nothing is needed beyond the destination itself.
$tmp = Join-Path ([IO.Path]::GetTempPath()) "slicerweb-fetch-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    git -C $tmp init -q
    git -C $tmp remote add origin $repoUrl
    # The upstream repo keeps one build and rewrites history; if this SHA is gone, pin a newer one.
    git -C $tmp fetch -q --depth 1 origin $sha
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch $sha from $repoUrl - update slicerweb/VERSION" }
    git -C $tmp checkout -q FETCH_HEAD
    Remove-Item -Recurse -Force (Join-Path $tmp '.git'), (Join-Path $tmp '.github') -ErrorAction SilentlyContinue

    # Replace the contents (not the folder itself, which may be a mount point or owned by someone else).
    Get-ChildItem $dest -Force | Remove-Item -Recurse -Force
    Get-ChildItem $tmp -Force | Copy-Item -Destination $dest -Recurse -Force
    Set-Content -Path $versionFile -Value $sha -NoNewline
    Write-Host "SlicerWeb $sha installed in $dest"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
