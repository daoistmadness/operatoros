import { randomUUID, createHash } from "node:crypto";
import { Elysia, t } from "elysia";
import { Value } from "@sinclair/typebox/value";
import { inTransaction } from "@operatoros/db";
import {
  PtkDocumentSlot, PtkPreparation, PtkRequiredDocuments, PtkResponse, PtkSave,
  type PtkPreparationDto, type PtkResponseDto, type SchoolUnitResponseDto,
} from "@operatoros/contracts/staff";
import type { AuthContext } from "../auth/service";
import { actor, staffMutationAudit } from "./core";
import { isPdfDocument } from "./student-iom-files";
import { storeReportFile, storedReportFile } from "./upp-report-files";

const LIMIT = 5_000_000;
const staffParams = t.Object({ staff_id: t.String({ minLength: 1, maxLength: 64 }) });
const problem = t.Object({ detail: t.String() });
const responses = { 401: problem, 403: problem, 404: problem, 409: problem, 422: problem, 503: problem };
const defaults: PtkPreparationDto = { specialNeeds: "Tidak Ada", principalLicense: "Tidak", submission: "Belum Diajukan" };
const contextFields = ["taskNumber", "taskDate", "taskStart", "submission", "submissionDate", "externalReference", "notes"] as const;

type Saved = { revision: number; context_id: string; preparation: string; prior_contexts: string };
type DocumentRow = Omit<PtkResponseDto["documents"][number], "current"> & {
  context_id: string; file_sha256: string; file_size_bytes: number; media_type: string;
};
type StaffFields = {
  full_name: string; birth_place: string | null; birth_date: string | null;
  email: string | null; address: string | null; nik: string | null; nip: string | null;
};

function validDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function missingFields(staff: StaffFields, p: PtkPreparationDto, documents: PtkResponseDto["documents"]): string[][] {
  const sections: Array<Array<[string, unknown]>> = [
    [["NIK", /^\d{16}$/.test(staff.nik ?? "")], ["Nama Lengkap", staff.full_name.trim()],
      ["Tempat Lahir", staff.birth_place?.trim()], ["Tanggal Lahir", validDate(staff.birth_date)],
      ["Jenis Kelamin", p.gender], ["Nama Ibu Kandung", p.mother], ["Agama", p.religion],
      ["Status Perkawinan", p.marital], ["Email", /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(staff.email ?? "")]],
    [["Kabupaten/Kota", p.city], ["Kecamatan", p.district], ["Desa/Kelurahan", p.village],
      ["Kewarganegaraan", p.citizenship], ["Alamat Jalan", p.street || staff.address?.trim()]],
    [["Status Kepegawaian", p.employment], ["Jabatan PTK", p.title], ["Kebutuhan Khusus", p.specialNeeds],
      ["Lembaga Pengangkat", p.appointingBody], ["Nomor SK Pengangkatan", p.appointmentNumber],
      ["TMT Pengangkatan", validDate(p.appointmentStart)], ["Sumber Gaji", p.salarySource],
      ["Lisensi Kepala Sekolah", p.principalLicense], ["NIP (format)", !staff.nip || /^(?:\d{8}|\d{18})$/.test(staff.nip)]],
    [["Sekolah", p.schoolUnitId || p.externalSchool], ["Tahun Ajaran", p.academicYearId],
      ["Nomor Surat Tugas", p.taskNumber], ["Tanggal Surat Tugas", validDate(p.taskDate)], ["TMT Tugas", validDate(p.taskStart)]],
    Object.entries(PtkRequiredDocuments).map(([slot, label]) => [label, documents.some((doc) => doc.slot === slot && doc.current)]),
  ];
  return sections.map((section) => section.filter(([, present]) => !present).map(([label]) => label));
}

function validPng(buffer: Buffer): boolean {
  if (buffer.length < 45 || !buffer.subarray(0, 16).equals(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")) ||
    !buffer.readUInt32BE(16) || !buffer.readUInt32BE(20)) return false;
  let hasImageData = false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    const dataEnd = offset + 8 + size;
    if (dataEnd + 4 > buffer.length) return false;
    if (Bun.hash.crc32(buffer.subarray(offset + 4, dataEnd)) !== buffer.readUInt32BE(dataEnd)) return false;
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT" && size) hasImageData = true;
    if (type === "IEND") return hasImageData && size === 0 && dataEnd + 4 === buffer.length;
    offset = dataEnd + 4;
  }
  return false;
}

function validJpeg(buffer: Buffer): boolean {
  if (buffer.length < 12 || buffer.readUInt16BE(0) !== 0xffd8 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) return false;
  let hasFrame = false;
  for (let offset = 2; offset + 4 < buffer.length;) {
    if (buffer[offset] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === undefined || offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11 || !buffer.readUInt16BE(offset + 3) || !buffer.readUInt16BE(offset + 5)) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && length >= 8 && offset + length < buffer.length - 2;
    offset += length;
  }
  return false;
}

async function documentType(file: File, bytes: Uint8Array): Promise<string | undefined> {
  const suffix = file.name.split(".").pop()?.toLowerCase();
  if (suffix === "pdf" && await isPdfDocument(bytes)) return "application/pdf";
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (suffix === "png" && validPng(buffer)) return "image/png";
  if ((suffix === "jpg" || suffix === "jpeg") && validJpeg(buffer)) return "image/jpeg";
  return undefined;
}

export function staffPtkRoutes(context: AuthContext, storageDir?: string) {
  const db = context.database.client;
  const staffRow = (id: string) => db.query<StaffFields, [string]>(`
    SELECT s.full_name,s.birth_place,s.birth_date,c.email,c.address,
      (SELECT normalized_value FROM staff_identifiers WHERE staff_member_id=s.id AND identifier_type='NIK' ORDER BY id LIMIT 1) AS nik,
      (SELECT normalized_value FROM staff_identifiers WHERE staff_member_id=s.id AND identifier_type='NIP' ORDER BY id LIMIT 1) AS nip
    FROM staff_members s LEFT JOIN staff_contact_details c ON c.staff_member_id=s.id WHERE s.id=?`).get(id);
  const saved = (id: string) => db.query<Saved, [string]>(
    "SELECT revision,context_id,preparation,prior_contexts FROM staff_ptk_administration WHERE staff_member_id=?",
  ).get(id);
  const preparation = (row: Saved | null): PtkPreparationDto => row
    ? Value.Parse(PtkPreparation, JSON.parse(row.preparation))
    : { ...defaults };
  const years = () => db.query<{ id: number; label: string }, []>("SELECT id,label FROM academic_years ORDER BY start_date DESC").all();
  const schools = () => db.query<SchoolUnitResponseDto, []>(
    "SELECT id,name,status,version,created_at,updated_at FROM school_units ORDER BY name",
  ).all();
  function read(id: string, staff: StaffFields): PtkResponseDto {
    const row = saved(id);
    const p = preparation(row);
    const latest = new Set<string>();
    const documents = db.query<DocumentRow, [string]>(`
      SELECT id,slot,label,context_id,uploaded_at,version FROM staff_ptk_documents
      WHERE staff_member_id=? ORDER BY version DESC,id`).all(id).map((doc) => {
      const key = doc.slot;
      const current = (doc.slot !== "task" || row?.context_id === doc.context_id) && !latest.has(key);
      if (current) latest.add(key);
      return { id: doc.id, slot: doc.slot.startsWith("other:") ? "other" : doc.slot, label: doc.label, uploaded_at: doc.uploaded_at, version: doc.version, current };
    });
    const missing = missingFields(staff, p, documents);
    return { revision: row?.revision ?? 0, contextId: row?.context_id ?? "", preparation: p,
      priorContexts: row ? JSON.parse(row.prior_contexts) : [], documents, missing,
      ready: missing.every((section) => !section.length), years: years(), schools: schools() };
  }

  const base = "/api/staff/:staff_id/ptk";
  return new Elysia({ name: "staff-ptk" })
    .get(base, (ctx) => {
      const user = actor(context, ctx, { capability: "view_staff_sensitive" });
      if (!user) return { detail: "Insufficient permissions" };
      const id = ctx.params.staff_id;
      const staff = staffRow(id);
      if (!staff) return ctx.status(404, { detail: "Staff member not found" });
      ctx.set.headers["cache-control"] = "private, no-store";
      staffMutationAudit(db, user, "STAFF_PTK_READ", "STAFF", id, [], {}, "view_staff_sensitive");
      return read(id, staff);
    }, { params: staffParams, response: { 200: PtkResponse, ...responses } })
    .put(base, (ctx) => {
      const user = actor(context, ctx, { capability: "manage_staff" });
      if (!user || !actor(context, ctx, { capability: "edit_sensitive_staff_fields" }) ||
        !actor(context, ctx, { capability: "view_staff_sensitive" })) return { detail: "Insufficient permissions" };
      const id = ctx.params.staff_id;
      const staff = staffRow(id);
      if (!staff) return ctx.status(404, { detail: "Staff member not found" });
      const p = ctx.body.preparation;
      for (const value of Object.values(p)) if (typeof value === "string" && value !== value.trim()) {
        return ctx.status(422, { detail: "Remove leading and trailing spaces before saving." });
      }
      if ((p.schoolUnitId && (p.externalSchool || !schools().some((item) => item.id === p.schoolUnitId))) ||
        (p.academicYearId && !years().some((item) => item.id === p.academicYearId))) {
        return ctx.status(422, { detail: "Choose a valid school and academic year." });
      }
      if ([p.appointmentStart, p.taskDate, p.taskStart, p.submissionDate].some((date) => date && !validDate(date))) {
        return ctx.status(422, { detail: "Enter valid dates." });
      }
      const result = inTransaction(db, () => {
        const previous = saved(id);
        if ((previous?.revision ?? 0) !== ctx.body.revision) return false;
        const before = preparation(previous);
        const changed = previous && (before.schoolUnitId !== p.schoolUnitId || (before.externalSchool ?? "") !== (p.externalSchool ?? "") ||
          before.academicYearId !== p.academicYearId);
        const prior: PtkResponseDto["priorContexts"] = previous ? JSON.parse(previous.prior_contexts) : [];
        if (changed && (before.externalSchool || before.schoolUnitId || before.academicYearId ||
          contextFields.some((field) => field !== "submission" && before[field]) ||
          (before.submission && before.submission !== "Belum Diajukan") ||
          db.query("SELECT 1 FROM staff_ptk_documents WHERE staff_member_id=? AND context_id=? LIMIT 1").get(id, previous.context_id))) {
          prior.push({
            school: before.externalSchool || schools().find((item) => item.id === before.schoolUnitId)?.name || "",
            year: years().find((item) => item.id === before.academicYearId)?.label || "",
            taskNumber: before.taskNumber ?? "", taskDate: before.taskDate ?? "", taskStart: before.taskStart ?? "",
            submission: before.submission ?? defaults.submission ?? "", submissionDate: before.submissionDate ?? "",
            externalReference: before.externalReference ?? "", notes: before.notes ?? "",
          });
        }
        if (changed) {
          for (const field of contextFields) delete p[field];
          p.submission = "Belum Diajukan";
        }
        db.run(`INSERT INTO staff_ptk_administration (staff_member_id,revision,context_id,preparation,prior_contexts)
          VALUES (?,?,?,?,?) ON CONFLICT(staff_member_id) DO UPDATE SET revision=excluded.revision,
          context_id=excluded.context_id,preparation=excluded.preparation,prior_contexts=excluded.prior_contexts`,
        [id, ctx.body.revision + 1, !previous || changed ? randomUUID() : previous.context_id, JSON.stringify(p), JSON.stringify(prior)]);
        staffMutationAudit(db, user, "STAFF_PTK_SAVE", "STAFF", id, ["ptk_preparation"], { context_changed: Boolean(changed) }, "edit_sensitive_staff_fields");
        return true;
      });
      if (!result) return ctx.status(409, { detail: "Preparation changed. Reload before saving." });
      ctx.set.headers["cache-control"] = "private, no-store";
      return read(id, staff);
    }, { params: staffParams, body: PtkSave, response: { 200: PtkResponse, ...responses } })
    .post(base + "/documents", async (ctx) => {
      const user = actor(context, ctx, { capability: "manage_staff" });
      if (!user || !actor(context, ctx, { capability: "edit_sensitive_staff_fields" }) ||
        !actor(context, ctx, { capability: "view_staff_sensitive" })) return { detail: "Insufficient permissions" };
      const id = ctx.params.staff_id;
      const { slot, file, contextId } = ctx.body;
      const label = slot === "other" ? ctx.body.label?.trim() : slot;
      if (!label) return ctx.status(422, { detail: "Enter a document label." });
      if (!staffRow(id)) return ctx.status(404, { detail: "Staff member not found" });
      if (!storageDir) return ctx.status(503, { detail: "Private attachment storage is unavailable." });
      if (!file.size || file.size > LIMIT) return ctx.status(422, { detail: "Choose a file no larger than 5 MB." });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mediaType = await documentType(file, bytes);
      if (!mediaType) return ctx.status(422, { detail: "Choose a valid PDF, JPEG or PNG." });
      const fileContext = slot === "task" ? contextId : "";
      const hash = createHash("sha256").update(bytes).digest("hex");
      try {
        const accepted = inTransaction(db, () => {
          const current = saved(id);
          if (!current || current.context_id !== contextId) return false;
          const group = slot === "other" ? "other:" + label : slot;
          const last = db.query<{ version: number; file_sha256: string }, [string, string, string]>(`
            SELECT version,file_sha256 FROM staff_ptk_documents WHERE staff_member_id=? AND context_id=? AND slot=?
            ORDER BY version DESC LIMIT 1`).get(id, fileContext, group);
          // Uploads may write a durable object before the SQLite commit. If the commit
          // fails, leave the unreferenced object safely in place for a retry.
          const meta = storeReportFile(storageDir, bytes);
          if (last?.file_sha256 === hash) return true;
          db.run(`INSERT INTO staff_ptk_documents
            (id,staff_member_id,slot,context_id,label,media_type,file_sha256,file_size_bytes,uploaded_at,version)
            VALUES (?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), id, group, fileContext, label, mediaType,
            meta.sha256, meta.sizeBytes, new Date().toISOString(), (last?.version ?? 0) + 1]);
          staffMutationAudit(db, user, "STAFF_PTK_UPLOAD", "STAFF", id, ["ptk_document"], { slot }, "edit_sensitive_staff_fields");
          return true;
        });
        if (!accepted) return ctx.status(409, { detail: "Save or reload the preparation before uploading." });
        return { saved: true };
      } catch {
        return ctx.status(503, { detail: "Document could not be saved. Retry the upload." });
      }
    }, { params: staffParams, body: t.Object({ slot: PtkDocumentSlot, label: t.Optional(t.String({maxLength: 100})), contextId: t.String(), file: t.File({ maxSize: LIMIT }) }),
      response: { 200: t.Object({ saved: t.Boolean() }), ...responses } })
    .get(base + "/documents/:document_id", (ctx) => {
      const user = actor(context, ctx, { capability: "view_staff_sensitive" });
      if (!user) return { detail: "Insufficient permissions" };
      const doc = db.query<DocumentRow, [string, string]>(
        "SELECT * FROM staff_ptk_documents WHERE staff_member_id=? AND id=?",
      ).get(ctx.params.staff_id, ctx.params.document_id);
      if (!doc) return ctx.status(404, { detail: "Document not found" });
      if (!storageDir) return ctx.status(503, { detail: "Private attachment storage is unavailable." });
      try {
        const path = storedReportFile(storageDir, { sha256: doc.file_sha256, sizeBytes: doc.file_size_bytes });
        const suffix = doc.media_type === "application/pdf" ? "pdf" : doc.media_type === "image/jpeg" ? "jpg" : "png";
        staffMutationAudit(db, user, "STAFF_PTK_DOWNLOAD", "STAFF", ctx.params.staff_id, [], {}, "view_staff_sensitive");
        return new Response(Bun.file(path), { headers: {
          "content-type": doc.media_type, "content-disposition": `attachment; filename="ptk-document.${suffix}"`,
          "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        } });
      } catch {
        return ctx.status(503, { detail: "Document could not be read from private storage." });
      }
    }, { params: t.Object({ ...staffParams.properties, document_id: t.String({ maxLength: 64 }) }), response: responses });
}
