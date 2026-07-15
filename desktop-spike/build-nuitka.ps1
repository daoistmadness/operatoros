param([string]$Python = "python")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$OutputRoot = Join-Path $env:TEMP "astryx-nuitka-spike"
if (Test-Path $OutputRoot) { Remove-Item -LiteralPath $OutputRoot -Recurse -Force }
$Root = (Get-Item $Root).FullName
$env:PYTHONPATH = "$Root/backend/src"
& $Python -m nuitka --mode=standalone --assume-yes-for-downloads --output-dir="$OutputRoot" --output-filename=AstryxBackend.exe --include-data-file="$Root/backend/migrations/20260713_identity_schema_sqlite.sql=migrations/20260713_identity_schema_sqlite.sql" --include-data-file="$Root/backend/migrations/20260714_first_admin_setup_sqlite.sql=migrations/20260714_first_admin_setup_sqlite.sql" --include-module=uvicorn.logging --include-module=uvicorn.loops.auto --include-module=uvicorn.protocols.http.auto --include-module=uvicorn.protocols.websockets.auto --include-module=uvicorn.lifespan.on --nofollow-import-to=pytest --nofollow-import-to=httpx "$PSScriptRoot/backend_entry.py"
Write-Output "Nuitka spike output: $OutputRoot"
