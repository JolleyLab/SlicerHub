# Daily / on-demand host sync for Slicer addons (no new image push).
# Requires: docker, git, python3; SLICER_GUI_IMAGE built or pulled.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
        $k, $v = $_ -split '=', 2
        $k = $k.Trim()
        $v = $v.Trim().Trim('"').Trim("'")
        if ($k -and -not [Environment]::GetEnvironmentVariable($k)) {
            Set-Item -Path "Env:$k" -Value $v
        }
    }
}

python "$PSScriptRoot\sync-slicer-addons.py" @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
