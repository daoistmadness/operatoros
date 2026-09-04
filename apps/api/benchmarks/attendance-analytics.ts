import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { python } from "../tests/python";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "operatoros-benchmark-cookie-secret-32-chars";
const dates = Array.from({ length: 20 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);

function seed(path: string, students: number): void {
  const script = `from pathlib import Path
import sqlite3, sys, uuid
sys.path.insert(0, 'backend/src')
from core.schema_migrations import bootstrap_fresh_sqlite_database
path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)
from core import database as core_database
from sqlalchemy import create_engine
core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)
import importlib
from pathlib import Path as P
[importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']
core_database.init_db(); core_database.engine.dispose()
from argon2 import PasswordHasher
db = sqlite3.connect(path)
ph = PasswordHasher()
db.execute("INSERT INTO users (username, password_hash, role, is_active) VALUES ('benchmark-admin', ?, 'admin', 1)", (ph.hash('benchmark-admin-pass-1'),))
year_id = db.execute('SELECT id FROM academic_years WHERE is_default = 1').fetchone()[0]
jenjang_id = db.execute("SELECT id FROM jenjangs ORDER BY id LIMIT 1").fetchone()[0]
program_id = db.execute("INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, 'BENCH', 1)", (jenjang_id,)).lastrowid
grade_id = db.execute("INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (?, ?, 'Benchmark', 1, 1)", (jenjang_id, program_id)).lastrowid
class_ids = [db.execute("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, ?, ?, 1)", (year_id, grade_id, f'B{index + 1}', str(index + 1))).lastrowid for index in range(10)]
master_ids = [str(uuid.uuid4()) for _ in range(${students})]
db.executemany("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')", [(master_id, f'Benchmark Student {index + 1}', f'benchmark student {index + 1}') for index, master_id in enumerate(master_ids)])
db.executemany("INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, ?, ?)", [(100000 + index, f'Benchmark Student {index + 1}', 'SD', f'B{index % 10 + 1}') for index in range(${students})])
db.executemany("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, 1, '2026-07-01', 'ACTIVE')", [(100000 + index, master_ids[index], year_id, jenjang_id, class_ids[index % 10], f'B{index % 10 + 1}') for index in range(${students})])
rows = []
for student in range(${students}):
  for day, date in enumerate(${JSON.stringify(dates)}):
    status = 'late' if (student + day) % 17 == 0 else ('sakit' if (student + day) % 53 == 0 else ('alfa' if (student + day) % 71 == 0 else 'on-time'))
    rows.append((100000 + student, date, '07:10:00', '16:00:00', 0, 'benchmark', 0 if status in ('on-time', 'late') else 1, status))
db.executemany('INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', rows)
db.commit(); db.close()`;
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function benchmark(students: number) {
  const path = `/tmp/operatoros-attendance-analytics-benchmark-${students}-${process.pid}.db`;
  seed(path, students);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-analytics-benchmark-audit-${process.pid}` } });
  const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "benchmark-admin", password: "benchmark-admin-pass-1" }) }));
  const session = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!session) throw new Error("benchmark login failed");
  const headers = { cookie: `astyx_session=${session}` };
  const query = "academic_year_id=1&date_from=2026-08-01&date_to=2026-08-20";
  const timings: Record<string, number> = {};
  for (const [name, pathSuffix] of [["overview", "overview"], ["classes", "classes"], ["daily", "daily"], ["students", "students?page_size=50"], ["export", "export-excel"]]) {
    const started = performance.now();
    const response = await app.handle(new Request(`http://local/api/analytics/attendance/${pathSuffix}${pathSuffix.includes("?") ? "&" : "?"}${query}`, { headers }));
    if (response.status !== 200) throw new Error(`${name} returned ${response.status}`);
    await response.arrayBuffer();
    timings[name] = Number((performance.now() - started).toFixed(2));
  }
  database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
  return { students, records: students * dates.length, timings };
}

for (const students of [100, 500, 1000]) console.log(JSON.stringify(await benchmark(students)));
