# Fetch the prebuilt SlicerWeb site (github.com/lassoan/slicerweb-app) at the commit pinned in
# slicerweb/VERSION into data/slicerweb/ (git-ignored), where nginx serves it at /slicerweb/.
# To upgrade: put a new commit SHA in slicerweb/VERSION and re-run.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$repoUrl = if ($env:SLICERWEB_REPO_URL) { $env:SLICERWEB_REPO_URL } else { 'https://github.com/lassoan/slicerweb-app.git' }
$sha = (Get-Content (Join-Path $root 'slicerweb/VERSION') -Raw).Trim()
$dest = Join-Path $root 'data/slicerweb'
$tmp = Join-Path $root 'data/.slicerweb-fetch'
$versionFile = Join-Path $dest '.version'

if ((Test-Path $versionFile) -and ((Get-Content $versionFile -Raw).Trim() -eq $sha)) {
    Write-Host "SlicerWeb $sha already present in data/slicerweb"
    return
}

if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force $tmp | Out-Null
git -C $tmp init -q
git -C $tmp remote add origin $repoUrl
# The upstream repo keeps one build and rewrites history; if this SHA is gone, pin a newer one.
git -C $tmp fetch -q --depth 1 origin $sha
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Recurse -Force $tmp
    throw "Could not fetch $sha from $repoUrl - update slicerweb/VERSION"
}
git -C $tmp checkout -q FETCH_HEAD

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Remove-Item -Recurse -Force (Join-Path $tmp '.git'), (Join-Path $tmp '.github') -ErrorAction SilentlyContinue
Move-Item $tmp $dest
Set-Content -Path $versionFile -Value $sha -NoNewline
Write-Host "SlicerWeb $sha installed in data/slicerweb"
