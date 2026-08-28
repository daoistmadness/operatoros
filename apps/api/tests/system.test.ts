import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = "from pathlib import Path; import sqlite3, sys; sys.path.insert(0, 'backend/src'); from core.schema_migrations import bootstrap_fresh_sqlite_database; from argon2 import PasswordHasher; path=Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db=sqlite3.connect(path); ph=PasswordHasher(); db.execute('INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)', ('golden-admin',ph.hash('golden-admin-pass-1'),'admin')); db.execute(\"INSERT INTO students (id,name,jenjang,class_name) VALUES (1,'Andi','SMP','7A')\"); db.execute(\"INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (1,'2026-08-26','07:30:00','15:00:00',0,'none',0,'on-time')\"); db.commit(); db.close()";
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("system clear-data candidate", () => {
  it("keeps the destructive flag and confirmation gates", async () => {
    const path = `/tmp/operatoros-system-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    try {
      const disabled = createApp({ databaseHandle: database, auth: { authCookieSecret: secret }, destructiveOperationsEnabled: false });
      const login = await disabled.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      const guarded = await disabled.handle(new Request("http://local/api/system/clear-data", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ mode: "attendance", confirmation: "CLEAR_ALL_ATTENDANCE_DATA" }) }));
      expect(guarded.status).toBe(403);
      const enabled = createApp({ databaseHandle: database, auth: { authCookieSecret: secret }, destructiveOperationsEnabled: true });
      const invalid = await enabled.handle(new Request("http://local/api/system/clear-data", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ mode: "attendance", confirmation: "wrong" }) }));
      expect(invalid.status).toBe(400);
      const cleared = await enabled.handle(new Request("http://local/api/system/clear-data", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ mode: "attendance", confirmation: "CLEAR_ALL_ATTENDANCE_DATA" }) })); const body = await cleared.json() as any;
      expect(cleared.status, JSON.stringify(body)).toBe(200); expect(body).toMatchObject({ status: "success", deleted_counts: { attendance: 1, upload_logs: 0 } }); expect((database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count).toBe(0);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
