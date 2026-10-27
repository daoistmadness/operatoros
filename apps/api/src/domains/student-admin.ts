import { randomUUID } from "node:crypto";
import { t } from "elysia";
import { inTransaction } from "@operatoros/db";
import type { AuthContext, CurrentUser } from "../auth/service";
import type { BackendConfig } from "../config";
import { actor } from "./core";

function rows(client: AuthContext["database"]["client"], sql: string, params: any[] = []): Row[] {
  return client.query(sql).all(...params) as Row[];
}

function row(client: AuthContext["database"]["client"], sql: string, params: any[] = []): Row | null {
  return (client.query(sql).get(...params) as Row | null) ?? null;
}

function error(set: any, status: number, detail: any) {
  set.status = status;
  return typeof detail === "string" ? { detail } : detail;
}
import { getIomPdfFilePath, isPdfDocument, sanitizeIomFilename, storeIomPdfFile } from "./student-iom-files";
import {
  IdentifierTypeSchema,
  IdentityVerificationStatusSchema,
  DapodikRegistrationStatusSchema,
  IomTypeSchema,
  type IdentityVerificationStatus,
  type DapodikRegistrationStatus,
} from "@operatoros/contracts/students";

type Row = Record<string, unknown>;
type Context = any;

function canTransitionIdentity(from: IdentityVerificationStatus, to: IdentityVerificationStatus): boolean {
  if (from === to) return true;
  switch (from) {
    case "UNVERIFIED": return to === "IDENTIFIER_ENTERED" || to === "NEEDS_CORRECTION";
    case "IDENTIFIER_ENTERED": return to === "UNVERIFIED" || to === "VERIFIED" || to === "NEEDS_CORRECTION";
    case "VERIFIED": return to === "IDENTIFIER_ENTERED" || to === "NEEDS_CORRECTION";
    case "NEEDS_CORRECTION": return to === "UNVERIFIED" || to === "IDENTIFIER_ENTERED";
  }
}

function canTransitionDapodik(from: DapodikRegistrationStatus, to: DapodikRegistrationStatus): boolean {
  if (from === to) return true;
  switch (from) {
    case "NOT_STARTED": return to === "PENDING_EXTERNAL_PROCESSING";
    case "PENDING_EXTERNAL_PROCESSING": return to === "ENTERED" || to === "NEEDS_CORRECTION";
    case "ENTERED": return to === "SYNCHRONIZED" || to === "NEEDS_CORRECTION";
    case "SYNCHRONIZED": return to === "NEEDS_CORRECTION";
    case "NEEDS_CORRECTION": return to === "PENDING_EXTERNAL_PROCESSING";
  }
}


function audit(
  context: AuthContext,
  user: CurrentUser,
  operation: string,
  studentMasterId: string,
  changed: string[],
  metadata: Record<string, unknown>
): void {
  context.database.client.run(
    `INSERT INTO operations_audit_events
      (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation,
       risk_level, source, reason, success, failure_code, changed_fields, metadata, schema_version)
      VALUES (?, ?, ?, 'edit_student', 'STUDENT_MASTER', ?, ?, 'MEDIUM', 'API', NULL, 1, NULL, ?, ?, '1')`,
    [
      randomUUID(),
      user.username,
      user.role,
      studentMasterId,
      operation,
      JSON.stringify(changed),
      JSON.stringify(metadata),
    ]
  );
}

export function registerStudentAdmin(app: any, context: AuthContext, config: BackendConfig): void {
  const maxIomFileSizeBytes = config.studentIomMaxFileSizeBytes ?? 25 * 1024 * 1024;
  // Identity verification routes
  app.get(
    "/api/student-masters/:student_master_id/identity-verifications",
    ({ params, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "view_sensitive_student_fields" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      const verifications = rows(
        client,
        "SELECT * FROM student_identity_verifications WHERE student_master_id = ? ORDER BY identifier_type",
        [params.student_master_id]
      );
      const history = rows(
        client,
        "SELECT * FROM student_identity_verification_history WHERE student_master_id = ? ORDER BY occurred_at DESC, id DESC",
        [params.student_master_id]
      );

      return { verifications, history };
    },
    { params: t.Object({ student_master_id: t.String() }) }
  );

  app.patch(
    "/api/student-masters/:student_master_id/identity-verifications",
    ({ params, body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "edit_student" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id, nik FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      const { identifier_type, verification_status, notes, correction_reason } = body;
      if (verification_status === "NEEDS_CORRECTION" && (!correction_reason || !correction_reason.trim())) {
        return error(set, 422, "Correction reason is required when status is NEEDS_CORRECTION");
      }

      try {
        const outcome = inTransaction(client, () => {
          const existing = row(
            client,
            "SELECT * FROM student_identity_verifications WHERE student_master_id = ? AND identifier_type = ?",
            [params.student_master_id, identifier_type]
          );
          const fromStatus = (existing?.verification_status ?? "UNVERIFIED") as IdentityVerificationStatus;
          if (!canTransitionIdentity(fromStatus, verification_status)) return { error: "transition" as const };
          if (identifier_type === "NIK" && ["IDENTIFIER_ENTERED", "VERIFIED"].includes(verification_status) && !String(student.nik ?? "").trim()) {
            return { error: "identifier" as const };
          }
          if (verification_status === "VERIFIED" && fromStatus !== "IDENTIFIER_ENTERED") return { error: "transition" as const };
          const now = (context.now?.() ?? new Date()).toISOString();
          const verifiedAt = verification_status === "VERIFIED" ? String(existing?.verified_at ?? now) : null;
          const verifiedBy = verification_status === "VERIFIED" ? String(existing?.verified_by ?? user.username) : null;
          const correctionReason = verification_status === "NEEDS_CORRECTION" ? correction_reason?.trim() || null : null;
          let result: Row | null = null;
          client.run(
            `INSERT INTO student_identity_verification_history
              (student_master_id, identifier_type, from_status, to_status, changed_by, correction_reason, notes, occurred_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              params.student_master_id,
              identifier_type,
              fromStatus,
              verification_status,
              user.username,
              correctionReason,
              notes?.trim() || null,
              now,
            ]
          );

          if (existing) {
            client.run(
              `UPDATE student_identity_verifications
                SET verification_status = ?, verified_at = ?, verified_by = ?, notes = ?, correction_reason = ?, updated_at = ?
                WHERE id = ?`,
              [
                verification_status,
                verifiedAt,
                verifiedBy,
                notes?.trim() || null,
                correctionReason,
                now,
                existing.id,
              ]
            );
            result = row(client, "SELECT * FROM student_identity_verifications WHERE id = ?", [existing.id]);
          } else {
            const inserted = client.run(
              `INSERT INTO student_identity_verifications
                (student_master_id, identifier_type, verification_status, verified_at, verified_by, notes, correction_reason, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                params.student_master_id,
                identifier_type,
                verification_status,
                verifiedAt,
                verifiedBy,
                notes?.trim() || null,
                correctionReason,
                now,
                now,
              ]
            );
            result = row(client, "SELECT * FROM student_identity_verifications WHERE id = ?", [Number(inserted.lastInsertRowid)]);
          }

          // Strict privacy: raw NIK and KK values are NEVER in the audit log or metadata
          audit(
            context,
            user,
            "UPDATE_IDENTITY_VERIFICATION",
            params.student_master_id,
            ["identifier_type", "verification_status"],
            {
              identifier_type,
              from_status: fromStatus,
              to_status: verification_status,
              has_notes: Boolean(notes?.trim()),
              has_correction_reason: Boolean(correction_reason?.trim()),
            }
          );
          return { result };
        });
        if ("error" in outcome) {
          return error(set, 409, outcome.error === "transition"
            ? "Invalid identity verification status transition"
            : "Enter the identifier before marking it verified");
        }
        return outcome.result;
      } catch (err) {  
        return error(set, 409, "Failed to update identity verification");
      }
    },
    {
      params: t.Object({ student_master_id: t.String() }),
      body: t.Object({
        identifier_type: IdentifierTypeSchema,
        verification_status: IdentityVerificationStatusSchema,
        notes: t.Optional(t.Nullable(t.String())),
        correction_reason: t.Optional(t.Nullable(t.String())),
      }),
    }
  );

  // DAPODIK registration tracking routes
  app.get(
    "/api/student-masters/:student_master_id/dapodik-status",
    ({ params, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "view_student" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      const registration = row(
        client,
        "SELECT * FROM student_dapodik_registrations WHERE student_master_id = ?",
        [params.student_master_id]
      );
      const history = rows(
        client,
        "SELECT * FROM student_dapodik_history WHERE student_master_id = ? ORDER BY occurred_at DESC, id DESC",
        [params.student_master_id]
      );

      return { registration: registration ?? null, history };
    },
    { params: t.Object({ student_master_id: t.String() }) }
  );

  app.patch(
    "/api/student-masters/:student_master_id/dapodik-status",
    ({ params, body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "edit_student" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      const { status, external_reference, notes, correction_reason } = body;
      if (status === "NEEDS_CORRECTION" && (!correction_reason || !correction_reason.trim())) {
        return error(set, 422, "Correction reason is required when status is NEEDS_CORRECTION");
      }

      try {
        const outcome = inTransaction(client, () => {
          const existing = row(
            client,
            "SELECT * FROM student_dapodik_registrations WHERE student_master_id = ?",
            [params.student_master_id]
          );
          const fromStatus = (existing?.status ?? "NOT_STARTED") as DapodikRegistrationStatus;
          if (!canTransitionDapodik(fromStatus, status)) return { error: "transition" as const };
          const now = (context.now?.() ?? new Date()).toISOString();
          const synchronizedAt = status === "SYNCHRONIZED" ? String(existing?.synchronized_at ?? now) : null;
          const correctionReason = status === "NEEDS_CORRECTION" ? correction_reason?.trim() || null : null;
          let result: Row | null = null;
          client.run(
            `INSERT INTO student_dapodik_history
              (student_master_id, from_status, to_status, changed_by, notes, correction_reason, occurred_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              params.student_master_id,
              fromStatus,
              status,
              user.username,
              notes?.trim() || null,
              correctionReason,
              now,
            ]
          );

          if (existing) {
            client.run(
              `UPDATE student_dapodik_registrations
                SET status = ?, external_reference = ?, updated_by = ?, notes = ?, correction_reason = ?, synchronized_at = ?, updated_at = ?
                WHERE id = ?`,
              [
                status,
                external_reference?.trim() || null,
                user.username,
                notes?.trim() || null,
                correctionReason,
                synchronizedAt,
                now,
                existing.id,
              ]
            );
            result = row(client, "SELECT * FROM student_dapodik_registrations WHERE id = ?", [existing.id]);
          } else {
            const inserted = client.run(
              `INSERT INTO student_dapodik_registrations
                (student_master_id, status, external_reference, updated_by, notes, correction_reason, synchronized_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                params.student_master_id,
                status,
                external_reference?.trim() || null,
                user.username,
                notes?.trim() || null,
                correctionReason,
                synchronizedAt,
                now,
                now,
              ]
            );
            result = row(client, "SELECT * FROM student_dapodik_registrations WHERE id = ?", [Number(inserted.lastInsertRowid)]);
          }

          audit(
            context,
            user,
            "UPDATE_DAPODIK_REGISTRATION",
            params.student_master_id,
            ["status"],
            {
              from_status: fromStatus,
              to_status: status,
              has_external_reference: Boolean(external_reference?.trim()),
            }
          );
          return { result };
        });
        if ("error" in outcome) return error(set, 409, "Invalid DAPODIK status transition");
        return outcome.result;
      } catch (err) {  
        return error(set, 409, "Failed to update DAPODIK registration status");
      }
    },
    {
      params: t.Object({ student_master_id: t.String() }),
      body: t.Object({
        status: DapodikRegistrationStatusSchema,
        external_reference: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
        correction_reason: t.Optional(t.Nullable(t.String())),
      }),
    }
  );

  // IOM Document Archive routes
  app.get(
    "/api/student-masters/:student_master_id/iom-documents",
    ({ params, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "view_sensitive_student_fields" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      return rows(
        client,
        "SELECT * FROM student_iom_documents WHERE student_master_id = ? ORDER BY uploaded_at DESC",
        [params.student_master_id]
      );
    },
    { params: t.Object({ student_master_id: t.String() }) }
  );

  app.post(
    "/api/student-masters/:student_master_id/iom-documents",
    async ({ params, body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "edit_student" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const student = row(client, "SELECT id FROM student_masters WHERE id = ?", [params.student_master_id]);
      if (!student) return error(set, 404, "Student master not found");

      if (!config.dataPaths) return error(set, 500, "Storage paths unavailable");

      const { iom_type, description, file } = body as { iom_type: string; description: string; file: File };
      if (!description || !description.trim()) {
        return error(set, 422, "Description is required for IOM document");
      }
      if (!["TRANSFER_IN", "TRANSFER_OUT"].includes(iom_type)) {
        return error(set, 422, "Invalid IOM type. Must be TRANSFER_IN or TRANSFER_OUT");
      }
      if (!file || typeof file.arrayBuffer !== "function") {
        return error(set, 400, "Valid file upload is required");
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) {
        return error(set, 400, "File is empty");
      }
      if (bytes.length > maxIomFileSizeBytes) {
        return error(set, 413, "File exceeds the configured maximum size");
      }
      if (!(await isPdfDocument(bytes))) {
        return error(set, 400, "Uploaded file must be a valid PDF document");
      }

      const originalFilename = sanitizeIomFilename(file.name || "iom_document.pdf");
      const docId = randomUUID();
      const now = new Date().toISOString();

      try {
        const stored = storeIomPdfFile(config.dataPaths.dataDir, bytes);
        const document = inTransaction(client, () => {
          client.run(
            `INSERT INTO student_iom_documents
              (id, student_master_id, iom_type, description, file_sha256, file_size_bytes, original_filename, uploaded_by, uploaded_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [docId, params.student_master_id, iom_type, description.trim(), stored.sha256, stored.sizeBytes, originalFilename, user.username, now, now]
          );
          audit(context, user, "UPLOAD_IOM_DOCUMENT", params.student_master_id, ["iom_type", "original_filename", "file_sha256"], {
            doc_id: docId, iom_type, original_filename: originalFilename, file_sha256: stored.sha256, file_size_bytes: stored.sizeBytes,
          });
          return row(client, "SELECT * FROM student_iom_documents WHERE id = ?", [docId]);
        });
        set.status = 201;
        return document;
      } catch (err) {  
        return error(set, 409, "Failed to save IOM document record");
      }
    },
    {
      params: t.Object({ student_master_id: t.String() }),
      body: t.Object({
        iom_type: IomTypeSchema,
        description: t.String({ minLength: 1 }),
        file: t.File({ maxSize: maxIomFileSizeBytes }),
      }),
    }
  );

  app.get(
    "/api/student-masters/:student_master_id/iom-documents/:doc_id/download",
    ({ params, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "view_sensitive_student_fields" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const doc = row(
        client,
        "SELECT * FROM student_iom_documents WHERE id = ? AND student_master_id = ?",
        [params.doc_id, params.student_master_id]
      );
      if (!doc) return error(set, 404, "IOM document not found");

      if (!config.dataPaths) return error(set, 500, "Storage paths unavailable");

      try {
        const filePath = getIomPdfFilePath(config.dataPaths.dataDir, {
          sha256: String(doc.file_sha256),
          sizeBytes: Number(doc.file_size_bytes),
        });

        return new Response(Bun.file(filePath), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="${encodeURIComponent(String(doc.original_filename))}"`,
          },
        });
      } catch (err) {  
        return error(set, 404, "Document file not found in storage");
      }
    },
    {
      params: t.Object({
        student_master_id: t.String(),
        doc_id: t.String(),
      }),
    }
  );

  app.patch(
    "/api/student-masters/:student_master_id/iom-documents/:doc_id",
    ({ params, body, set, ...ctx }: Context) => {
      const user = actor(context, { set, ...ctx }, { capability: "edit_student" });
      if (!user) return { detail: "Insufficient permissions" };

      const client = context.database.client;
      const doc = row(
        client,
        "SELECT * FROM student_iom_documents WHERE id = ? AND student_master_id = ?",
        [params.doc_id, params.student_master_id]
      );
      if (!doc) return error(set, 404, "IOM document not found");

      const description = body.description?.trim();
      if (!description) return error(set, 422, "Description cannot be empty");

      const now = new Date().toISOString();
      try {
        return inTransaction(client, () => {
          client.run(
            "UPDATE student_iom_documents SET description = ?, updated_by = ?, updated_at = ? WHERE id = ?",
            [description, user.username, now, params.doc_id]
          );
          audit(context, user, "UPDATE_IOM_DOCUMENT_DESCRIPTION", params.student_master_id, ["description"], {
            doc_id: params.doc_id, previous_description: doc.description, description,
          });
          return row(client, "SELECT * FROM student_iom_documents WHERE id = ?", [params.doc_id]);
        });
      } catch (err) {  
        return error(set, 409, "Failed to update IOM document description");
      }
    },
    {
      params: t.Object({
        student_master_id: t.String(),
        doc_id: t.String(),
      }),
      body: t.Object({
        description: t.String({ minLength: 1 }),
      }),
    }
  );
}
