"""Generate Drizzle schema.ts from the authoritative bootstrapped SQLite DB."""
import os, sqlite3, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "src"))
os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
BOOT = Path(tempfile.gettempdir()) / "opencode" / "tsphase2" / "bootstrap.db"
BOOT.parent.mkdir(parents=True, exist_ok=True)
if BOOT.exists(): BOOT.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{BOOT}"
from core.schema_migrations import bootstrap_fresh_sqlite_database
bootstrap_fresh_sqlite_database(BOOT)
# Materialize the full runtime schema: init_db adds the compat-layer tables
# that live outside the migration ledger (matches production semantics).
os.environ["ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION"] = "true"
os.environ["BYPASS_STUDENT_LINKING_GATE"] = "true"
from core import database as core_database
from sqlalchemy import create_engine
core_database.engine.dispose()
core_database.engine = create_engine(f"sqlite:///{BOOT}", connect_args={"check_same_thread": False})
core_database.SessionLocal.configure(bind=core_database.engine)
import importlib
for mfile in sorted((REPO / "backend" / "src" / "models").glob("*.py")):
    if mfile.stem != "__init__":
        importlib.import_module(f"models.{mfile.stem}")
from core.database import init_db
init_db()

conn = sqlite3.connect(BOOT)
conn.row_factory = sqlite3.Row
tables = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]

def lit(s): return json_dumps(s)
import json
def json_dumps(s): return json.dumps(s)

out = []
out.append("// AUTO-GENERATED from the S4.3 production schema. Do not hand-edit.")
out.append("// Regenerate: cd backend && .venv/bin/python ../backend-ts/scripts/gen_schema.py")
out.append("import { sql } from \"drizzle-orm\";")
out.append("import { sqliteTable, sqliteTableCreator, text, integer, real, blob, uniqueIndex, index, check, foreignKey } from \"drizzle-orm/sqlite-core\";")
out.append("")
out.append("const sqliteTableCustom = sqliteTableCreator((name) => name);")
out.append("")
fk_lines = []
for tname in tables:
    cols = conn.execute(f'PRAGMA table_info("{tname}")').fetchall()
    fks = conn.execute(f'PRAGMA foreign_key_list("{tname}")').fetchall()
    uqs = conn.execute(f'PRAGMA index_list("{tname}")').fetchall()
    checks = [r[0] for r in conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=? AND sql IS NOT NULL", (tname,))]
    col_defs, pk_cols, fk_map = [], [], {}
    for c in cols:
        name, ctype, notnull, dflt, pk = c["name"], c["type"], c["notnull"], c["dflt_value"], c["pk"]
        base = ctype.split("(")[0].strip().upper()
        ts_type = {"INT":"integer","INTEGER":"integer","BIGINT":"integer","SMALLINT":"integer",
                   "TINYINT":"integer","BOOLEAN":"integer","BOOL":"integer",
                   "TEXT":"text","VARCHAR":"text","CHAR":"text","CLOB":"text","DATE":"text",
                   "DATETIME":"text","STRING":"text","JSON":"text",
                   "REAL":"real","FLOAT":"real","DOUBLE":"real",
                   "BLOB":"blob","TIME":"text"}.get(base, "text")
        mods = ""
        if pk:
            mods += ".primaryKey()"
        elif notnull:
            mods += ".notNull()"
        if dflt is not None:
            dv = dflt.strip()
            if dv.upper().startswith("CURRENT"):
                mods += f".default(sql`{dv}`)"
            else:
                try:
                    float(dv)
                    mods += f".default({dv})"
                except ValueError:
                    mods += f".default({json_dumps(dflt)})"
        col_defs.append(f'    "{name}": {ts_type}(){mods},')
        if pk: pk_cols.append(name)
    for fk in fks:
        key = fk["id"]
        fk_map.setdefault(key, {"table": fk["table"], "cols": [], "ref_cols": [], "on_delete": fk["on_delete"]})
        fk_map[key]["cols"].append(fk["from"])
        # resolve ref column
        rc = conn.execute(
            "SELECT \"to\" FROM pragma_foreign_key_list(?) WHERE id=?", (tname, key)).fetchall()
    entries = "\n".join(col_defs)
    out.append(f'export const {tname} = sqliteTable("{tname}", {{\n{entries}\n}});')

Path(REPO / "backend-ts" / "src" / "db").mkdir(parents=True, exist_ok=True)
(REPO / "backend-ts" / "src" / "db" / "schema.ts").write_text("\n".join(out))
print(f"generated {len(tables)} tables")
conn.close()
