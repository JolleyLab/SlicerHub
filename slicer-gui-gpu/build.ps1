# Build base (heavy) then adapter (thin). Skip base rebuild when using a Hub tag.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$BaseImage = if ($env:SLICER_GUI_BASE_IMAGE) { $env:SLICER_GUI_BASE_IMAGE } else { "slicer-web-slicer-gui-base:local" }
$RuntimeImage = if ($env:SLICER_GUI_IMAGE) { $env:SLICER_GUI_IMAGE } else { "slicer-web-slicer-gui:local" }
$BuildBase = if ($env:SLICER_GUI_BUILD_BASE) { $env:SLICER_GUI_BUILD_BASE } else { "auto" }

function Should-BuildBase {
    switch ($BuildBase.ToLower()) {
        { $_ -in @("1", "true", "yes") } { return $true }
        { $_ -in @("0", "false", "no") } { return $false }
    }
    # auto: build local-looking tags; skip when BASE looks like a registry path
    if ($BaseImage -match "/") {
        return $false
    }
    return $true
}

if (Should-BuildBase) {
    Write-Host "Building base image: $BaseImage"
    docker build -f Dockerfile.base -t $BaseImage .
} else {
    Write-Host "Skipping base build; using published/prebuilt: $BaseImage"
    docker pull $BaseImage 2>$null
}

$Repo = if ($env:SLICER_HEART_VIEWER_REPO) { $env:SLICER_HEART_VIEWER_REPO } else { "" }
$Ref = if ($env:SLICER_HEART_VIEWER_REF) { $env:SLICER_HEART_VIEWER_REF } else { "" }

Write-Host "Building adapter image: $RuntimeImage (FROM $BaseImage)"
docker build -f Dockerfile `
  --build-arg "SLICER_GUI_BASE_IMAGE=$BaseImage" `
  --build-arg "SLICER_HEART_VIEWER_REPO=$Repo" `
  --build-arg "SLICER_HEART_VIEWER_REF=$Ref" `
  -t $RuntimeImage .

Write-Host "Done. Runtime image: $RuntimeImage"
