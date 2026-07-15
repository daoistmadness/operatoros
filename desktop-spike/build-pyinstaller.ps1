param([string]$Python = "python")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
& $Python -m PyInstaller --clean --noconfirm --distpath "$PSScriptRoot/output/pyinstaller" --workpath "$PSScriptRoot/build/pyinstaller" "$PSScriptRoot/spec/astryx_backend.spec"
