import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PtkRequiredDocuments, PtkSubmissionLabels, type PtkDocumentSlotDto, type PtkPreparationDto } from "@operatoros/contracts/staff";
import { downloadStaffPtk, fetchStaffPtk, saveStaffPtk, uploadStaffPtk, type StaffDetail, type StaffSensitive } from "../api/staff";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { getPageApiError } from "../lib/api/errors";
import { saveBlob } from "../lib/download";
import { queryKeys } from "../lib/query/queryKeys";

const sections = ["Identitas", "Alamat", "Kepegawaian", "Penugasan", "Dokumen"];
const identitas = { gender: "Jenis Kelamin", mother: "Nama Ibu Kandung", religion: "Agama", marital: "Status Perkawinan" };
const alamat = { city: "Kabupaten/Kota", district: "Kecamatan", village: "Desa/Kelurahan", citizenship: "Kewarganegaraan",
  postal: "Kode Pos (opsional)", street: "Alamat Jalan", rt: "RT (opsional)", rw: "RW (opsional)", extraVillage: "Nama Desa/Kelurahan tambahan (opsional)" };
const kepegawaian = { employment: "Status Kepegawaian", title: "Jabatan PTK", specialNeeds: "Kebutuhan Khusus",
  appointingBody: "Lembaga Pengangkat", appointmentNumber: "Nomor SK Pengangkatan", appointmentStart: "TMT Pengangkatan",
  salarySource: "Sumber Gaji" };
const penugasan = { taskNumber: "Nomor Surat Tugas", taskDate: "Tanggal Surat Tugas", taskStart: "TMT Tugas" };
const external = { submissionDate: "Tanggal pengajuan (opsional)", externalReference: "Referensi eksternal (opsional)", notes: "Catatan (opsional)" };
const slots: Record<PtkDocumentSlotDto, string> = { ...PtkRequiredDocuments, ktp: "KTP", kk: "KK", appointment: "SK Pengangkatan", other: "Dokumen lain" };
type TextKey = Exclude<keyof PtkPreparationDto, "schoolUnitId" | "academicYearId" | "submission" | "principalLicense">;

export default function StaffPtk({ member, sensitive, editable, editProfile }: {
  member: StaffDetail; sensitive?: StaffSensitive; editable: boolean; editProfile: React.ReactNode;
}) {
  const id = member.id;
  const queryClient = useQueryClient();
  const key = queryKeys.staff.ptk(id);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchStaffPtk(id, signal) });
  const [section, setSection] = useState(0);
  const [draft, setDraft] = useState<{ revision: number; preparation: PtkPreparationDto }>();
  const [review, setReview] = useState(false);
  const [fileError, setFileError] = useState("");
  const [otherLabel, setOtherLabel] = useState("");
  const data = query.data;
  const p = draft?.preparation ?? data?.preparation ?? {};
  const contextChanged = Boolean(data?.contextId && (
    p.schoolUnitId !== data.preparation.schoolUnitId || p.academicYearId !== data.preparation.academicYearId ||
    (p.externalSchool ?? "").trim() !== (data.preparation.externalSchool ?? "")
  ));
  const save = useMutation({
    mutationFn: () => {
      if (!data) throw new Error("Muat persiapan terlebih dahulu.");
      const values = { ...p };
      for (const field of Object.keys(values) as TextKey[]) {
        const value = values[field];
        if (typeof value === "string") values[field] = value.trim();
      }
      return saveStaffPtk(id, draft?.revision ?? data.revision, values);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
      setDraft(undefined);
      setReview(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.history(id) });
    },
  });
  const upload = useMutation({
    mutationFn: ({ slot, file, label }: { slot: PtkDocumentSlotDto; file: File; label?: string }) =>
      uploadStaffPtk(id, data?.contextId ?? "", slot, file, label),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.history(id) });
    },
  });
  function set<K extends keyof PtkPreparationDto>(field: K, value: PtkPreparationDto[K]) {
    if (!data) return;
    setDraft({ revision: draft?.revision ?? data.revision, preparation: { ...p, [field]: value } });
  }
  function fields(labels: Partial<Record<TextKey, string>>) {
    return (Object.entries(labels) as [TextKey, string][]).map(([field, label]) => (
      <label key={field} className="space-y-1">
        <span>{label}</span>
        <Input value={p[field] ?? ""} disabled={!editable} maxLength={field === "notes" ? 2000 : 255}
          placeholder={field === "street" ? sensitive?.contact?.address ?? undefined : undefined}
          type={field.endsWith("Date") || field.endsWith("Start") ? "date" : "text"}
          onChange={(event) => set(field, event.target.value)} />
      </label>
    ));
  }
  async function download(documentId: string) {
    setFileError("");
    try {
      const blob = await downloadStaffPtk(id, documentId);
      saveBlob(blob, `ptk-document.${blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg"}`);
    } catch (error) {
      setFileError(getPageApiError(error, "Dokumen tidak dapat diunduh."));
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setReview(true);
  }
  return <Card>
    <CardHeader><CardTitle>Administrasi PTK</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {query.isPending && <p>Memuat administrasi PTK…</p>}
      {query.isError && <p role="alert">{getPageApiError(query.error, "Administrasi PTK tidak dapat dimuat.")}</p>}
      {data && <form onSubmit={submit} className="space-y-4">
        <p><strong>{data.ready ? "Siap Verval" : "Belum Lengkap"}</strong> · Data tersimpan. Pemeriksaan lokal.</p>
        <nav aria-label="Bagian Administrasi PTK" className="flex flex-wrap gap-2">
          {sections.map((name, index) => <Button key={name} type="button" variant={index === section ? "primary" : "outline"}
            aria-pressed={index === section} onClick={() => setSection(index)}>{name} · {data.missing[index]?.length || "Lengkap"}</Button>)}
        </nav>
        {data.missing[section]?.length ? <p>Perlu dilengkapi atau diperbaiki: {data.missing[section]?.join(", ")}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {section === 0 && <>
            <dl>
              <dt>NIK</dt><dd>{sensitive?.identifiers.find(({ type }) => type === "NIK")?.normalized_value || "—"}</dd>
              <dt>Nama Lengkap</dt><dd>{member.full_name}</dd>
              <dt>Tempat Lahir</dt><dd>{sensitive?.birth_place || "—"}</dd>
              <dt>Tanggal Lahir</dt><dd>{sensitive?.birth_date || "—"}</dd>
              <dt>Email</dt><dd>{sensitive?.contact?.email || "—"}</dd>
            </dl>
            <div>{editProfile}</div>{fields(identitas)}
          </>}
          {section === 1 && fields(alamat)}
          {section === 2 && <>
            <div>NIP (opsional): {member.identifiers.find(({ identifier_type }) => identifier_type === "NIP")?.normalized_value || "—"} {editProfile}</div>
            {fields(kepegawaian)}
            <label>Lisensi Kepala Sekolah
              <NativeSelect disabled={!editable} value={p.principalLicense ?? ""} onChange={(e) => {
                const v = e.target.value;
                if (v === "" || v === "Ya" || v === "Tidak") set("principalLicense", v);
              }}><option value="">Pilih</option><option>Ya</option><option>Tidak</option></NativeSelect>
            </label>
          </>}
          {section === 3 && <>
            <label>Sekolah (unit yang sesuai)
              <NativeSelect disabled={!editable} value={p.schoolUnitId ?? ""} onChange={(e) => {
                if (!data) return;
                setDraft({ revision: draft?.revision ?? data.revision,
                  preparation: { ...p, schoolUnitId: Number(e.target.value) || undefined, externalSchool: "" } });
              }}>
                <option value="">Gunakan nama sekolah di Verval</option>
                {data.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </NativeSelect>
            </label>
            {!p.schoolUnitId && fields({ externalSchool: "Nama sekolah di Verval" })}
            <label>Tahun Ajaran
              <NativeSelect disabled={!editable} value={p.academicYearId ?? ""} onChange={(e) => set("academicYearId", Number(e.target.value) || undefined)}>
                <option value="">Pilih tahun ajaran</option>
                {data.years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
              </NativeSelect>
            </label>
            {contextChanged ? <p className="sm:col-span-2">Simpan perubahan sekolah atau tahun ajaran terlebih dahulu. Surat tugas dan status pengajuan lama akan tetap tersedia di riwayat.</p> : <>
              {fields(penugasan)}
              <label>Status pengajuan Verval
                <NativeSelect disabled={!editable} value={p.submission ?? PtkSubmissionLabels[0]} onChange={(e) =>
                  set("submission", PtkSubmissionLabels.find((label) => label === e.target.value))}>
                  {PtkSubmissionLabels.map((status) => <option key={status}>{status}</option>)}
                </NativeSelect>
              </label>
              {fields(external)}
            </>}
            {data.priorContexts.length > 0 && <details className="sm:col-span-2"><summary>Riwayat penugasan dan pengajuan</summary>
              <ul>{data.priorContexts.map((prior, index) => <li key={index} className="my-2">
                {[prior.school, prior.year, prior.taskNumber, prior.taskDate, prior.taskStart, prior.submission,
                  prior.submissionDate, prior.externalReference, prior.notes].filter(Boolean).join(" · ")}
              </li>)}</ul>
            </details>}
          </>}
          {section === 4 && <div className="space-y-3 sm:col-span-2">
            {!data.contextId && <p>Simpan persiapan untuk mulai mengunggah dokumen.</p>}
            {Object.entries(slots).map(([slot, label]) => {
              const docs = data.documents.filter((doc) => doc.slot === slot);
              return <div key={slot} className="space-y-2 rounded-md border p-3">
                <p className="font-semibold">{label} · {Object.hasOwn(PtkRequiredDocuments, slot) ? "Wajib" : "Opsional"}</p>
                <p>{docs.some((doc) => doc.current) ? "Tersedia" : "Belum ada"}</p>
                {editable && data.contextId && <>
                  {slot === "other" && <label>Nama dokumen <Input value={otherLabel} maxLength={100} onChange={(event) => setOtherLabel(event.target.value)} /></label>}
                  <label>{docs.some((doc) => doc.current) ? "Unggah atau ganti" : "Unggah"} · PDF, JPEG, PNG · maks. 5 MB
                    <Input type="file" aria-label={`Unggah ${label}`} accept=".pdf,.jpg,.jpeg,.png"
                      disabled={upload.isPending || (slot === "task" && contextChanged) || (slot === "other" && !otherLabel.trim())}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate({ slot: slot as PtkDocumentSlotDto, file, label: otherLabel });
                        event.target.value = "";
                      }} />
                  </label>
                </>}
                {docs.filter((doc) => doc.current).map((doc) => <Button key={doc.id} type="button" variant="outline" onClick={() => void download(doc.id)}>
                  Unduh {slot === "other" ? doc.label : label}
                </Button>)}
                {docs.some((doc) => !doc.current) && <details><summary>Versi sebelumnya</summary>
                  {docs.filter((doc) => !doc.current).map((doc) => <Button key={doc.id} type="button" variant="outline" onClick={() => void download(doc.id)}>
                    Unduh {slot === "other" ? doc.label : label} · v{doc.version} · {doc.uploaded_at.slice(0, 10)}
                  </Button>)}
                </details>}
              </div>;
            })}
            {upload.isPending && <p>Mengunggah…</p>}
            {(upload.error || fileError) && <p role="alert">{fileError || getPageApiError(upload.error, "Unggahan gagal.")}</p>}
          </div>}
        </div>
        {editable && <Button type="submit">Periksa &amp; Simpan</Button>}
      </form>}
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogHeader><DialogTitle>Periksa &amp; Simpan</DialogTitle>
            <DialogDescription>Tinjau perubahan sebelum menyimpan. Pemeriksaan kelengkapan diperbarui setelah penyimpanan.</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-3 overflow-auto">
            <p>Data tersimpan: {data?.ready ? "Siap Verval" : "Belum Lengkap"}</p>
            {sections.map((name, index) => <div key={name}>
              <strong>{name}</strong>
              {data?.missing[index]?.length ? <p>Perlu dilengkapi: {data.missing[index].join(", ")}</p> : <p>Lengkap</p>}
            </div>)}
            <strong>Perubahan yang akan disimpan</strong>
            {draft && <dl>{Object.entries({ ...identitas, ...alamat, ...kepegawaian,
              principalLicense: "Lisensi Kepala Sekolah", externalSchool: "Nama sekolah di Verval",
              schoolUnitId: "Unit sekolah", academicYearId: "Tahun Ajaran",
              ...(!contextChanged ? { ...penugasan, ...external, submission: "Status pengajuan Verval" } : {}),
            }).map(([field, label]) => {
              const key = field as keyof PtkPreparationDto;
              if (p[key] === data?.preparation[key]) return null;
              const value = key === "schoolUnitId" ? data?.schools.find(({ id }) => id === p.schoolUnitId)?.name
                : key === "academicYearId" ? data?.years.find(({ id }) => id === p.academicYearId)?.label : p[key];
              return <div key={key}><dt>{label}</dt><dd>{value || "—"}</dd></div>;
            })}</dl>}
          </div>
          {contextChanged && <p>Perubahan sekolah atau tahun ajaran memindahkan surat tugas dan status pengajuan lama ke riwayat.</p>}
          {save.error && <p role="alert">{getPageApiError(save.error, "Persiapan tidak dapat disimpan.")}</p>}
          {save.error && <Button variant="outline" onClick={() => { setDraft(undefined); save.reset(); void query.refetch(); }}>Muat ulang data tersimpan</Button>}
          <DialogFooter><Button variant="outline" onClick={() => setReview(false)}>Kembali</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>Simpan persiapan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
