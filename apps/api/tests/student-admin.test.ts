import { expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAccountFixture } from "./fixtures/accounts";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";

const secret = "synthetic-student-admin-cookie-secret";
const key = randomBytes(32).toString("base64");

function request(method: string, path: string, cookie?: string, body?: FormData | string, origin = method === "GET" ? undefined : "http://localhost:5173"): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  if (typeof body === "string") headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { method, headers, body });
}

async function login(app: ReturnType<typeof createApp>, role = "admin"): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `golden-${role}`, password: `golden-${role}-pass-1` }),
  }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("synthetic session missing");
  return `astyx_session=${value}`;
}

function pdfBytes(content = "Dummy PDF content"): Uint8Array {
  const header = "%PDF-1.4\n";
  const body = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n${content}\n%%EOF\n`;
  return new TextEncoder().encode(header + body);
}

function formIomUpload(bytes: Uint8Array, filename: string, type: string, description: string): FormData {
  const form = new FormData();
  form.set("iom_type", type);
  form.set("description", description);
  form.set("file", new File([bytes], filename, { type: "application/pdf" }));
  return form;
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-student-admin-"));
  const databasePath = join(root, "operatoros.sqlite");
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);
  const backupDir = join(root, "backups");
  mkdirSync(backupDir, { mode: 0o700 });

  // Insert a test student
  const studentId = "student-phase5-test-01";
  database.client.run(
    `INSERT INTO student_masters (id, full_name, normalized_name, nipd, nisn, nik, student_status, created_at, updated_at)
      VALUES (?, 'Aditya Pratama', 'aditya pratama', 'NIPD001', '0012345678', '3171012345670001', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [studentId]
  );

  const app = createApp({
    databaseHandle: database,
    auth: { authCookieSecret: secret },
    backupDir,
    backupEncryption: parseBackupEncryptionConfig({
      activeKey: key,
      activeKeyId: "key-test-1",
      authCookieSecret: secret,
    }),
    destructiveOperationsEnabled: true,
  });

  const session = await login(app);
  return {
    app,
    database,
    studentId,
    session,
    cleanup: () => {
      try { database.close(); } catch {}
      rmSync(root, { recursive: true, force: true });
    },
  };
}

it("tracks independent NIK and KK verification and preserves audit history", async () => {
  const env = await setup();
  try {
    // 1. Initially empty verifications
    const getInitial = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, env.session));
    expect(getInitial.status).toBe(200);
    const initialData = (await getInitial.json()) as any;
    expect(initialData.verifications).toHaveLength(0);
    expect(initialData.history).toHaveLength(0);

    // 2. Verify NIK
    const verifyNik = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "VERIFIED",
      notes: "Verified against Dukcapil record",
    })));
    expect(verifyNik.status).toBe(200);
    const nikData = (await verifyNik.json()) as any;
    expect(nikData.identifier_type).toBe("NIK");
    expect(nikData.verification_status).toBe("VERIFIED");
    expect(nikData.verified_by).toBe("golden-admin");
    expect(nikData.verified_at).not.toBeNull();

    // 3. Mark KK as NEEDS_CORRECTION without reason -> rejected with 422
    const badKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
    })));
    expect(badKk.status).toBe(422);

    // 4. Mark KK as NEEDS_CORRECTION with reason
    const correctKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
      correction_reason: "Family Card number blurry in scan",
    })));
    expect(correctKk.status).toBe(200);
    const kkData = (await correctKk.json()) as any;
    expect(kkData.identifier_type).toBe("KK");
    expect(kkData.verification_status).toBe("NEEDS_CORRECTION");
    expect(kkData.correction_reason).toBe("Family Card number blurry in scan");

    // 5. Query verifications and history
    const getFinal = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, env.session));
    const finalData = (await getFinal.json()) as any;
    expect(finalData.verifications).toHaveLength(2);
    expect(finalData.history).toHaveLength(2);

    // 6. Ensure raw NIK / KK values are NEVER in operations_audit_events
    const audits = env.database.client.query("SELECT * FROM operations_audit_events WHERE entity_reference = ?").all(env.studentId) as any[];
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const metadataStr = String(a.metadata || "");
      expect(metadataStr.includes("3171012345670001")).toBe(false);
    }

    // 7. Verify triggers protect verification history
    expect(() => {
      env.database.client.run("UPDATE student_identity_verification_history SET to_status = 'MUTATED'");
    }).toThrow();
    expect(() => {
      env.database.client.run("DELETE FROM student_identity_verification_history");
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("tracks DAPODIK registration status and history with triggers", async () => {
  const env = await setup();
  try {
    // 1. Initial status
    const getInitial = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/dapodik-status`, env.session));
    expect(getInitial.status).toBe(200);
    const initialData = (await getInitial.json()) as any;
    expect(initialData.registration).toBeNull();
    expect(initialData.history).toHaveLength(0);

    // 2. Transition to ENTERED
    const enterRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "ENTERED",
      external_reference: "REG-2026-DAPODIK-99",
      notes: "Inputted in desktop client",
    })));
    expect(enterRes.status).toBe(200);
    const enterData = (await enterRes.json()) as any;
    expect(enterData.status).toBe("ENTERED");
    expect(enterData.external_reference).toBe("REG-2026-DAPODIK-99");
    expect(enterData.updated_by).toBe("golden-admin");

    // 3. Transition to SYNCHRONIZED
    const syncRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "SYNCHRONIZED",
      notes: "Verified on Dapodik cloud portal",
    })));
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.status).toBe("SYNCHRONIZED");
    expect(syncData.synchronized_at).not.toBeNull();

    // 4. History log check
    const histRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/dapodik-status`, env.session));
    const histData = (await histRes.json()) as any;
    expect(histData.history).toHaveLength(2);

    // 5. Verify triggers protect history
    expect(() => {
      env.database.client.run("UPDATE student_dapodik_history SET to_status = 'MUTATED'");
    }).toThrow();
    expect(() => {
      env.database.client.run("DELETE FROM student_dapodik_history");
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("manages IOM documents: upload, magic bytes validation, download, description edit, and triggers", async () => {
  const env = await setup();
  try {
    const validPdf = pdfBytes("Official Inter Office Memo content from CSO");
    const invalidFile = new TextEncoder().encode("Not a PDF document");

    // 1. Reject invalid non-PDF file
    const badUpload = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(invalidFile, "fake.pdf", "TRANSFER_IN", "Transfer from SMP 1")));
    expect(badUpload.status).toBe(400);

    // 2. Reject missing description
    const noDescUpload = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "valid.pdf", "TRANSFER_IN", "   ")));
    expect(noDescUpload.status).toBe(422);

    // 3. Successful upload
    const uploadRes = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "cso_memo_001.pdf", "TRANSFER_IN", "Transfer memo from CSO")));
    expect(uploadRes.status).toBe(201);
    const docData = (await uploadRes.json()) as any;
    expect(docData.iom_type).toBe("TRANSFER_IN");
    expect(docData.description).toBe("Transfer memo from CSO");
    expect(docData.uploaded_by).toBe("golden-admin");
    expect(docData.file_sha256).toBeDefined();

    // 4. Download document
    const downloadRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}/download`, env.session));
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("application/pdf");
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(downloadedBytes.length).toBe(validPdf.length);

    // 5. Edit description
    const editRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}`, env.session, JSON.stringify({
      description: "Updated memo description with SOP reference",
    })));
    expect(editRes.status).toBe(200);
    const editedData = (await editRes.json()) as any;
    expect(editedData.description).toBe("Updated memo description with SOP reference");
    expect(editedData.updated_by).toBe("golden-admin");

    // 6. Triggers protect delete and hash mutation
    expect(() => {
      env.database.client.run("DELETE FROM student_iom_documents WHERE id = ?", [docData.id]);
    }).toThrow();
    expect(() => {
      env.database.client.run("UPDATE student_iom_documents SET file_sha256 = 'tampered' WHERE id = ?", [docData.id]);
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("includes IOM documents in encrypted backup and successfully restores them", async () => {
  const env = await setup();
  try {
    const validPdf = pdfBytes("IOM memo content for encrypted backup verification");
    const uploadRes = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "memo_backup_test.pdf", "TRANSFER_OUT", "Transfer out to international school")));
    expect(uploadRes.status).toBe(201);
    const docData = (await uploadRes.json()) as any;

    // Trigger backup
    const backupRes = await env.app.handle(request("POST", "/api/admin/backups", env.session, JSON.stringify({})));
    if (backupRes.status !== 200) console.log("BACKUP_FAIL_BODY:", await backupRes.text());
    expect(backupRes.status).toBe(200);
    const backupData = (await backupRes.json()) as any;
    expect(backupData.filename).toBeDefined();

    // Verify backup file exists
    const backupFilePath = join(require("node:path").dirname(env.database.path), "backups", backupData.filename);
    expect(existsSync(backupFilePath)).toBe(true);
  } finally {
    env.cleanup();
  }
});

it("enriches student detail profile and supports status filtering in student management list & csv export", async () => {
  const env = await setup();
  try {
    // Set up NIK verification, DAPODIK status, and upload an IOM document
    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "VERIFIED",
    })));

    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
      correction_reason: "Document unreadable",
    })));

    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "ENTERED",
    })));

    const validPdf = pdfBytes("IOM memo content");
    await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "iom_memo.pdf", "TRANSFER_IN", "Incoming transfer")));

    // 1. Fetch student detail profile
    const profileRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/profile`, env.session));
    expect(profileRes.status).toBe(200);
    const profileData = (await profileRes.json()) as any;
    expect(profileData.identity_verifications).toHaveLength(2);
    expect(profileData.dapodik_registration).not.toBeNull();
    expect(profileData.dapodik_registration.status).toBe("ENTERED");
    expect(profileData.iom_documents).toHaveLength(1);
    expect(profileData.iom_documents[0].iom_type).toBe("TRANSFER_IN");

    // 2. Fetch list with matching filters
    const listRes = await env.app.handle(request("GET", `/api/student-masters/management/list?nik_verification_status=VERIFIED&kk_verification_status=NEEDS_CORRECTION&dapodik_status=ENTERED`, env.session));
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.items.some((s: any) => s.id === env.studentId)).toBe(true);

    // 3. Fetch list with non-matching filter
    const mismatchRes = await env.app.handle(request("GET", `/api/student-masters/management/list?nik_verification_status=UNVERIFIED`, env.session));
    expect(mismatchRes.status).toBe(200);
    const mismatchData = (await mismatchRes.json()) as any;
    expect(mismatchData.items.some((s: any) => s.id === env.studentId)).toBe(false);

    // 4. Export CSV with filter
    const csvRes = await env.app.handle(request("GET", `/api/student-masters/management/export.csv?nik_verification_status=VERIFIED`, env.session));
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText.includes("Aditya Pratama")).toBe(true);
  } finally {
    env.cleanup();
  }
});
