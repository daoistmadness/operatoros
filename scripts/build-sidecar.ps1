param(
    [string]$Python = "py -3.12"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $env:LOCALAPPDATA "OperatorOSBuild\sidecar"
$Venv = Join-Path $BuildRoot "venv"
$Dist = Join-Path $Root "dist"
$TauriResources = Join-Path $Root "frontend\src-tauri\resources"
$LocalDist = Join-Path $BuildRoot "dist"
$Work = Join-Path $BuildRoot "work"
$Spec = Join-Path $BuildRoot "spec"

if (-not (Test-Path (Join-Path $Root "frontend\build\index.html"))) {
    throw "frontend/build is missing. Run the approved frontend build before packaging the sidecar."
}

if (Test-Path $BuildRoot) {
    Remove-Item -Recurse -Force -LiteralPath $BuildRoot
}
New-Item -ItemType Directory -Force -Path $BuildRoot, $Dist, $TauriResources, $LocalDist, $Work, $Spec | Out-Null

$pythonParts = $Python -split " ", 2
if ($pythonParts.Count -eq 2) {
    & $pythonParts[0] $pythonParts[1] -m venv $Venv
} else {
    & $pythonParts[0] -m venv $Venv
}
if ($LASTEXITCODE -ne 0) { throw "Python virtual environment creation failed with exit code $LASTEXITCODE" }

$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $Root "backend\requirements.txt") "pyinstaller==6.16.0"
if ($LASTEXITCODE -ne 0) { throw "Sidecar dependency installation failed with exit code $LASTEXITCODE" }

& $VenvPython -m PyInstaller `
    --clean `
    --noconfirm `
    --onefile `
    --console `
    --name "operatoros-sidecar" `
    --paths (Join-Path $Root "backend\src") `
    --add-data "$(Join-Path $Root 'backend\migrations');migrations" `
    --add-data "$(Join-Path $Root 'frontend\build');frontend" `
    --hidden-import "uvicorn.logging" `
    --hidden-import "uvicorn.loops.auto" `
    --hidden-import "uvicorn.protocols.http.auto" `
    --hidden-import "uvicorn.protocols.websockets.auto" `
    --hidden-import "uvicorn.lifespan.on" `
    --hidden-import "multipart" `
    --hidden-import "argon2" `
    --hidden-import "asyncpg" `
    --distpath $LocalDist `
    --workpath $Work `
    --specpath $Spec `
    (Join-Path $Root "backend\src\sidecar_main.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }

$LocalExecutable = Join-Path $LocalDist "operatoros-sidecar.exe"
if (-not (Test-Path $LocalExecutable)) {
    throw "PyInstaller completed without producing $LocalExecutable"
}
Copy-Item -Force -LiteralPath $LocalExecutable -Destination (Join-Path $Dist "operatoros-sidecar.exe")
Copy-Item -Force -LiteralPath $LocalExecutable -Destination (Join-Path $TauriResources "operatoros-sidecar.exe")
$Executable = Join-Path $Dist "operatoros-sidecar.exe"
Write-Output "Built $Executable and staged the Tauri bundle resource"
