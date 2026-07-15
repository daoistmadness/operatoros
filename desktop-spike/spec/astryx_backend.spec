# Experimental PyInstaller specification. Run from the repository root.
from pathlib import Path

root = Path(SPECPATH).resolve().parents[1]
backend = root / "backend"
spike = root / "desktop-spike"

a = Analysis(
    [str(spike / "backend_entry.py")],
    pathex=[str(backend / "src")],
    binaries=[],
    datas=[
        (str(backend / "migrations" / "20260713_identity_schema_sqlite.sql"), "migrations"),
        (str(backend / "migrations" / "20260714_first_admin_setup_sqlite.sql"), "migrations"),
    ],
    hiddenimports=[
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on",
        "multipart", "argon2", "asyncpg",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["pytest", "httpx"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name="AstryxBackend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
