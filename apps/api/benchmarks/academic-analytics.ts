import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createApp } from "../src/app";
import { python } from "../tests/python";
import { openDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-academic-benchmark-cookie-secret-32";

function seed(path: string, studentCount: number): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); count = int(sys.argv[2]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
    "db = sqlite3.connect(path); year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]; jenjang_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]; grade_id = db.execute(\"SELECT id FROM academic_grades WHERE jenjang_id = ?\", (jenjang_id,)).fetchone()[0]; class_ids = [db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ?\", (year_id,)).fetchone()[0]]",
    "for index in range(1, 5): db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, ?, ?, 1)\", (year_id, grade_id, f'7{chr(65 + index)}', chr(65 + index))); class_ids.append(db.execute('SELECT last_insert_rowid()').fetchone()[0])",
    "subjects = []; components = [];\nfor subject_index in range(5):\n db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES (?, ?, 1, 1)\", (f'Subject {subject_index + 1}', jenjang_id)); subject_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; subjects.append(subject_id);\n for component_index, kind in enumerate(('formatif', 'formatif', 'sumatif', 'sumatif')):\n  db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES (?, ?, ?)\", (f'Assessment {component_index + 1}', kind, subject_id)); components.append((subject_id, db.execute('SELECT last_insert_rowid()').fetchone()[0]))",
    "students = []; enrollments = []; grades = [];\nfor index in range(count):\n sid = 10000 + index; master_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'academic-benchmark-{count}-{index}')); class_id = class_ids[index % len(class_ids)]; name = f'Benchmark Student {index:04d}'; db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", (master_id, name, name.lower())); db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, 'SMP', ?)\", (sid, name, f'7{chr(65 + index % len(class_ids))}')); db.execute(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, 1, '2026-07-01', 'ACTIVE')\", (sid, master_id, year_id, jenjang_id, class_id, f'7{chr(65 + index % len(class_ids))}')); enrollment_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; enrollments.append(enrollment_id);\n for component_index, (subject_id, component_id) in enumerate(components):\n  score = None if (index + component_index) % 10 == 0 else 60 + ((index * 3 + component_index * 7) % 41); grades.append((enrollment_id, subject_id, component_id, score))",
    "db.executemany(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, ?)\", grades); db.commit(); db.close()",
  ].join("\n");
  const result = Bun.spawnSync([python, "-c", script, path, String(studentCount)], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

async function run(studentCount: number): Promise<void> {
  const path = `/tmp/operatoros-academic-benchmark-${studentCount}-${process.pid}.db`;
  seed(path, studentCount);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-academic-benchmark-audit-${process.pid}` } });
  try {
    const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
    const token = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
    if (!token) throw new Error("benchmark login failed");
    const headers = { cookie: `astyx_session=${token}` };
    const query = "?academic_year_id=2";
    const measure = async (pathName: string, consume: (response: Response) => Promise<unknown>, suffix = "") => {
      const samples: number[] = [];
      await consume(await app.handle(new Request(`http://local${pathName}${query}${suffix}`, { headers })));
      for (let index = 0; index < 3; index++) { const start = performance.now(); await consume(await app.handle(new Request(`http://local${pathName}${query}${suffix}`, { headers }))); samples.push(performance.now() - start); }
      return median(samples);
    };
    const overviewMs = await measure("/api/analytics/academic/overview", async (response) => response.json());
    const studentsMs = await measure("/api/analytics/academic/students", async (response) => response.json(), "&page_size=200");
    const exportMs = await measure("/api/analytics/academic/export-excel", async (response) => response.arrayBuffer());
    console.log(JSON.stringify({ students: studentCount, scoreRows: studentCount * 20, overviewMs: Number(overviewMs.toFixed(1)), studentsMs: Number(studentsMs.toFixed(1)), exportMs: Number(exportMs.toFixed(1)), queryFamilies: { overview: 8, students: 3, export: 12 } }));
  } finally { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); }
}

for (const count of [100, 500, 1000]) await run(count);
