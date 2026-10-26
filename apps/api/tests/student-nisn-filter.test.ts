import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { openDatabase } from "@operatoros/db";
import { StudentListResponseSchema } from "@operatoros/contracts/students";
import { Value } from "@sinclair/typebox/value";
import { createApp } from "../src/app";
import { createGoldenFixture } from "./fixtures/golden";

const secret = "operatoros-nisn-filter-test-secret-32-chars";

describe("student management NISN input filter", () => {
  it("filters raw NISN values for list and complete CSV results", async () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-nisn-filter-"));
    const path = join(root, "operatoros.sqlite");
    const auditDir = join(root, "audit");
    const backupDir = join(root, "backups");
    mkdirSync(auditDir); mkdirSync(backupDir);
    createGoldenFixture(path, "academic-with-defaults");
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, backupDir, environment: "test", auth: { authCookieSecret: secret, auditDir } });
    try {
      const values = [["null", null], ["empty", ""], ["spaces", " \t\n"], ["unicode", "\u00a0\u2003"], ["nel", "\u0085"], ["bom", " \ufeff"], ["padded", " 12345\t"], ["other", "98765"]] as const;
      for (const [name, nisn] of values) database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, nisn, student_status) VALUES (?, ?, ?, ?, ?)", [`nisn-${name}`, `NISN ${name}`, `nisn ${name}`, nisn, name === "other" ? "inactive" : "active"]);
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const cookie = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
      if (!cookie) throw new Error("session cookie missing");
      const get = (path: string) => app.handle(new Request(`http://local${path}`, { headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" } }));
      const created = await app.handle(new Request("http://local/api/student-masters", { method: "POST", headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ identity: { full_name: "Optional NISN Student" } }) }));
      expect(created.status).toBe(201);
      const inputted = await get("/api/student-masters/management/list?nisn_status=inputted&page=1&page_size=1");
      expect(inputted.status).toBe(200);
      const inputBody = Value.Decode(StudentListResponseSchema, await inputted.json());
      expect(inputBody).toMatchObject({ total: 2, total_pages: 2, page: 1 });
      expect(inputBody.items.map((item) => item.id)).toEqual(["nisn-other"]);
      const secondPage = Value.Decode(StudentListResponseSchema, await (await get("/api/student-masters/management/list?nisn_status=inputted&page=2&page_size=1")).json());
      expect(secondPage).toMatchObject({ total: 2, total_pages: 2, page: 2 });
      expect(secondPage.items.map((item) => item.id)).toEqual(["nisn-padded"]);
      const notInputted = await get("/api/student-masters/management/list?nisn_status=not_inputted");
      expect(notInputted.status).toBe(200);
      const missingBody = Value.Decode(StudentListResponseSchema, await notInputted.json());
      expect(missingBody.total).toBe(9);
      expect(missingBody.items.map((item) => item.id).filter((id) => id.startsWith("nisn-")).sort()).toEqual(["nisn-bom", "nisn-empty", "nisn-nel", "nisn-null", "nisn-spaces", "nisn-unicode"]);
      const composed = await get("/api/student-masters/management/list?search=padded&status=active&nisn_status=inputted");
      expect(await composed.json()).toMatchObject({ total: 1, items: [{ id: "nisn-padded" }] });
      const excluded = await get("/api/student-masters/management/list?search=other&status=active&nisn_status=inputted");
      expect(await excluded.json()).toMatchObject({ total: 0, items: [] });
      const csv = await get("/api/student-masters/management/export.csv?nisn_status=inputted&page=99&page_size=1");
      const csvText = await csv.text(); expect(csvText).toContain("NISN padded"); expect(csvText).toContain("NISN other"); expect(csvText).not.toContain("NISN spaces");
      for (const endpoint of ["list", "export.csv"]) {
        const invalid = await get(`/api/student-masters/management/${endpoint}?nisn_status=unknown`);
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      }
      const all = await get("/api/student-masters/management/list");
      expect(await all.json()).toMatchObject({ total: 11 });
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
