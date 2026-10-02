import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createStaff, fetchSensitiveStaff, fetchStaffDetail, updateStaff, type StaffPayload } from "../api/staff";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common/page-header";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { getPageApiError } from "../lib/api/errors";
import { queryKeys } from "../lib/query/queryKeys";

type Fields = Record<string, string>;
const empty: Fields = { full_name: "", source_staff_id: "", employment_status: "ACTIVE", nip: "", nuptk: "", job_title_raw: "", dapodik_status_raw: "", employment_start_date: "", birth_place: "", birth_date: "", nik: "", email: "", phone: "", address: "" };
const optionalFields = ["source_staff_id", "nip", "nuptk", "job_title_raw", "dapodik_status_raw", "employment_start_date"] as const;
const sensitiveFields = ["birth_place", "birth_date", "nik", "email", "phone", "address"] as const;

export default function StaffForm() {
  const { id = "" } = useParams();
  const isEdit = Boolean(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [fields, setFields] = useState<Fields>(empty);
  const detail = useQuery({ queryKey: queryKeys.staff.detail(id), queryFn: () => fetchStaffDetail(id), enabled: isEdit });
  const sensitive = useQuery({ queryKey: queryKeys.staff.sensitive(id), queryFn: () => fetchSensitiveStaff(id), enabled: isEdit && can("view_staff_sensitive") });
  useEffect(() => {
    if (!detail.data) return;
    setFields({
      ...empty, full_name: detail.data.full_name, source_staff_id: detail.data.source_staff_id ?? "",
      employment_status: detail.data.employment_status, nip: detail.data.identifiers.find((value) => value.identifier_type === "NIP")?.normalized_value ?? "",
      job_title_raw: detail.data.job_title_raw ?? "",
      dapodik_status_raw: detail.data.dapodik_status_raw ?? "", employment_start_date: detail.data.employment_start_date ?? "",
    });
  }, [detail.data]);
  useEffect(() => {
    if (!sensitive.data) return;
    const identities = sensitive.data.identifiers;
    setFields((current) => ({ ...current, nuptk: identities.find((value) => value.type === "NUPTK")?.normalized_value ?? "", birth_place: sensitive.data?.birth_place ?? "", birth_date: sensitive.data?.birth_date ?? "", nik: identities.find((value) => value.type === "NIK")?.normalized_value ?? "", email: sensitive.data?.contact?.email ?? "", phone: sensitive.data?.contact?.phone ?? "", address: sensitive.data?.contact?.address ?? "" }));
  }, [sensitive.data]);
  const mutation = useMutation({
    mutationFn: (payload: StaffPayload) => isEdit
      ? updateStaff(id, { ...payload, expected_updated_at: detail.data!.updated_at })
      : createStaff(payload),
    onSuccess: async (saved) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.staff.lists }),
        client.invalidateQueries({ queryKey: queryKeys.staff.analytics() }),
        ...(isEdit ? [client.invalidateQueries({ queryKey: queryKeys.staff.detail(id) })] : []),
      ]);
      navigate(`/staff/${saved.id}`);
    },
  });
  if (isEdit && detail.isPending) return <LoadingState title="Loading employee profile" />;
  if (isEdit && (detail.isError || !detail.data)) return <ErrorState title="Employee profile could not be loaded" description={detail.error?.message} />;
  const set = (key: string, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const showSensitive = can("edit_sensitive_staff_fields") && (!isEdit || can("view_staff_sensitive") && Boolean(sensitive.data));
  const input = (key: string, label: string, type = "text") => <div key={key}><Label htmlFor={key}>{label}{key === "full_name" && " *"}</Label><Input id={key} name={key} type={type} value={fields[key] ?? ""} required={key === "full_name"} maxLength={key === "full_name" ? 255 : undefined} onChange={(event) => { mutation.reset(); set(key, event.target.value); }} /></div>;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: StaffPayload = { full_name: fields.full_name.trim(), employment_status: isEdit ? undefined : fields.employment_status as "ACTIVE" | "FORMER" };
    for (const key of optionalFields) payload[key] = fields[key]?.trim() || null;
    if (showSensitive) for (const key of sensitiveFields) payload[key] = fields[key]?.trim() || null;
    if (isEdit) delete payload.employment_status;
    mutation.mutate(payload);
  };
  return <div className="space-y-6">
    <Link to={isEdit ? `/staff/${id}` : "/staff"} className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="size-4" />{isEdit ? "Back to profile" : "Back to Employees"}</Link>
    <PageHeader eyebrow="Employee management" title={isEdit ? "Edit employee" : "Add employee"} description="Identifiers remain text. Age and tenure are calculated from their source dates." />
    <form onSubmit={submit} aria-busy={mutation.isPending} className="space-y-4">
      <Card><CardHeader><CardTitle>Employment profile</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {input("full_name", "Full name")}{input("source_staff_id", "Source staff ID")}{input("nip", "NIP")}{input("nuptk", "NUPTK")}{input("job_title_raw", "Position title")}
        <div><Label htmlFor="dapodik_status_raw">DAPODIK status</Label><NativeSelect id="dapodik_status_raw" value={fields.dapodik_status_raw} onChange={(event) => set("dapodik_status_raw", event.target.value)}><option value="">Unknown / blank</option><option value="AKTIF">AKTIF</option><option value="BELUM">BELUM</option><option value="SUDAH">SUDAH</option><option value="TIDAK">TIDAK (preserved as unmapped)</option></NativeSelect></div>
        {input("employment_start_date", "Employment start date", "date")}{!isEdit && <div><Label htmlFor="employment_status">Status</Label><NativeSelect id="employment_status" value={fields.employment_status} onChange={(event) => set("employment_status", event.target.value)}><option value="ACTIVE">Active</option><option value="FORMER">Former</option></NativeSelect></div>}
      </CardContent></Card>
      {showSensitive && <Card><CardHeader><CardTitle>Sensitive personal details</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {input("birth_place", "Birth place")}{input("birth_date", "Birth date", "date")}{input("nik", "NIK")}{input("email", "Email", "email")}{input("phone", "Phone", "tel")}<div className="sm:col-span-2 lg:col-span-3">{input("address", "Address")}</div>
      </CardContent></Card>}
      {isEdit && can("edit_sensitive_staff_fields") && sensitive.isError && <p role="alert" className="text-sm text-rose-700">Sensitive fields could not be loaded. They will be left unchanged.</p>}
      {mutation.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{getPageApiError(mutation.error, "Employee could not be saved. Review your changes and try again.")}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending || isEdit && detail.data == null}>{mutation.isPending ? "Saving…" : "Save employee"}</Button><Button type="button" variant="outline" onClick={() => navigate(isEdit ? `/staff/${id}` : "/staff")} disabled={mutation.isPending}>Cancel</Button></div>
    </form>
  </div>;
}
