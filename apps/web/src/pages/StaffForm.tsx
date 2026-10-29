import { useEffect, useRef } from "react";
import { Type, type Static } from "@sinclair/typebox";
import { useForm, useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLink as Link } from '../components/AppLink';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft } from "lucide-react";
import { createStaff, fetchSensitiveStaff, fetchStaffDetail, updateStaff, type StaffDetail, type StaffPayload, type StaffSensitive } from "../api/staff";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common/page-header";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { DateField, SelectField, TextField } from "../components/forms/field-controls";
import { FormErrorSummary, SubmitButton } from "../components/forms/form-actions";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { getPageApiError, normalizeApiError } from "../lib/api/errors";
import { queryKeys } from "../lib/query/queryKeys";
import { mapServerFieldErrors } from "../lib/forms/server-errors";
import { typeboxValidator } from "../lib/forms/typebox-validator";
import { useDirtyNavigationBlocker } from "../lib/forms/use-dirty-navigation-blocker";

const staffFormSchema = Type.Object({
  full_name: Type.String({ minLength: 1, maxLength: 255 }),
  source_staff_id: Type.String(),
  employment_status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("FORMER")]),
  nip: Type.String(),
  nuptk: Type.String(),
  job_title_raw: Type.String(),
  dapodik_status_raw: Type.String(),
  employment_start_date: Type.String(),
  birth_place: Type.String(),
  birth_date: Type.String(),
  nik: Type.String(),
  email: Type.Union([
    Type.Literal(""),
    Type.String({ pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" }),
  ]),
  phone: Type.String(),
  address: Type.String(),
}, { additionalProperties: false });

type StaffFormValues = Static<typeof staffFormSchema>;

const empty: StaffFormValues = {
  full_name: "",
  source_staff_id: "",
  employment_status: "ACTIVE",
  nip: "",
  nuptk: "",
  job_title_raw: "",
  dapodik_status_raw: "",
  employment_start_date: "",
  birth_place: "",
  birth_date: "",
  nik: "",
  email: "",
  phone: "",
  address: "",
};

const optionalFields = ["source_staff_id", "nip", "nuptk", "job_title_raw", "dapodik_status_raw", "employment_start_date"] as const;
const sensitiveFields = ["birth_place", "birth_date", "nik", "email", "phone", "address"] as const;
const sensitiveFieldSet = new Set<keyof StaffFormValues>(sensitiveFields);
const staffFieldNames = Object.keys(empty).filter((key): key is keyof StaffFormValues => Object.hasOwn(empty, key));
const validateStaffValues = typeboxValidator<StaffFormValues>(staffFormSchema);

function formValuesFromQueries(detail?: StaffDetail, sensitive?: StaffSensitive): StaffFormValues {
  const sensitiveIdentifiers = sensitive?.identifiers ?? [];
  return {
    ...empty,
    full_name: detail?.full_name ?? "",
    source_staff_id: detail?.source_staff_id ?? "",
    employment_status: detail?.employment_status === "FORMER" ? "FORMER" : "ACTIVE",
    nip: detail?.identifiers.find((value) => value.identifier_type === "NIP")?.normalized_value ?? "",
    nuptk: sensitiveIdentifiers.find((value) => value.type === "NUPTK")?.normalized_value ?? "",
    job_title_raw: detail?.job_title_raw ?? "",
    dapodik_status_raw: detail?.dapodik_status_raw ?? "",
    employment_start_date: detail?.employment_start_date ?? "",
    birth_place: sensitive?.birth_place ?? "",
    birth_date: sensitive?.birth_date ?? "",
    nik: sensitiveIdentifiers.find((value) => value.type === "NIK")?.normalized_value ?? "",
    email: sensitive?.contact?.email ?? "",
    phone: sensitive?.contact?.phone ?? "",
    address: sensitive?.contact?.address ?? "",
  };
}

function staffPayloadFromValues(values: StaffFormValues, isEdit: boolean, includeSensitive: boolean): StaffPayload {
  const payload: StaffPayload = { full_name: values.full_name.trim() };
  if (!isEdit) payload.employment_status = values.employment_status;
  for (const key of optionalFields) payload[key] = values[key].trim() || null;
  if (includeSensitive) {
    for (const key of sensitiveFields) payload[key] = values[key].trim() || null;
  }
  return payload;
}

export default function StaffForm() {
  const { id = "" } = useParams({ strict: false });
  const isEdit = Boolean(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const submissionInFlight = useRef(false);
  const allowNextNavigation = useRef<() => void>(() => {});
  const detail = useQuery({ queryKey: queryKeys.staff.detail(id), queryFn: () => fetchStaffDetail(id), enabled: isEdit });
  const sensitive = useQuery({ queryKey: queryKeys.staff.sensitive(id), queryFn: () => fetchSensitiveStaff(id), enabled: isEdit && can("view_staff_sensitive") });
  const showSensitive = can("edit_sensitive_staff_fields") && (!isEdit || can("view_staff_sensitive") && Boolean(sensitive.data));

  const mutation = useMutation({
    mutationFn: (payload: StaffPayload) => {
      if (!isEdit) return createStaff(payload);
      if (!detail.data) throw new Error("Employee profile is not ready.");
      return updateStaff(id, { ...payload, expected_updated_at: detail.data.updated_at });
    },
  });

  const form = useForm({
    defaultValues: empty,
    validators: {
      onSubmit: ({ value }) => validateStaffValues({ ...value, full_name: value.full_name.trim() }),
    },
    onSubmit: async ({ value, formApi }) => {
      if (submissionInFlight.current) return;
      submissionInFlight.current = true;
      mutation.reset();

      try {
        let saved: Awaited<ReturnType<typeof createStaff>>;
        try {
          saved = await mutation.mutateAsync(staffPayloadFromValues(value, isEdit, showSensitive));
        } catch (error) {
          const normalized = normalizeApiError(error);
          const allowedFields = showSensitive
            ? staffFieldNames
            : staffFieldNames.filter((field) => !sensitiveFieldSet.has(field));
          formApi.setErrorMap({
            onSubmit: {
              form: getPageApiError(normalized, "Employee could not be saved. Review your changes and try again."),
              fields: mapServerFieldErrors<StaffFormValues>(normalized.fieldErrors, allowedFields),
            },
          });
          return;
        }

        formApi.reset(value);
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.staff.lists }),
          client.invalidateQueries({ queryKey: queryKeys.staff.analytics() }),
          ...(isEdit ? [
            client.invalidateQueries({ queryKey: queryKeys.staff.detail(id) }),
            client.invalidateQueries({ queryKey: queryKeys.staff.sensitive(id) }),
            client.invalidateQueries({ queryKey: queryKeys.staff.history(id) }),
          ] : []),
        ]);
        allowNextNavigation.current();
        await navigate({ to: '/staff/$id', params: { id: saved.id } });
      } finally {
        submissionInFlight.current = false;
      }
    },
  });
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

  const allowFormNavigation = useDirtyNavigationBlocker({
    isDirty: form.state.isDirty,
    isPending: mutation.isPending || isSubmitting,
    message: "You have unsaved employee changes. Leave without saving?",
  });
  allowNextNavigation.current = allowFormNavigation;

  useEffect(() => {
    if (isEdit && !detail.data) return;
    if (form.state.isDirty) return;
    form.reset(formValuesFromQueries(detail.data, sensitive.data));
  }, [detail.data, form, isEdit, sensitive.data]);

  if (isEdit && detail.isPending) return <LoadingState title="Loading employee profile" />;
  if (isEdit && can("edit_sensitive_staff_fields") && can("view_staff_sensitive") && sensitive.isPending) {
    return <LoadingState title="Loading employee profile" />;
  }
  if (isEdit && (detail.isError || !detail.data)) return <ErrorState title="Employee profile could not be loaded" description={detail.error?.message} />;

  const pending = mutation.isPending || isSubmitting;
  const clearSubmitErrors = () => {
    mutation.reset();
    form.setErrorMap({ onSubmit: undefined });
  };

  return (
    <div className="space-y-6">
      <Link to={isEdit ? `/staff/${id}` : "/staff"} className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline">
        <ArrowLeft className="size-4" />{isEdit ? "Back to profile" : "Back to Employees"}
      </Link>
      <PageHeader eyebrow="Employee management" title={isEdit ? "Edit employee" : "Add employee"} description="Identifiers remain text. Age and tenure are calculated from their source dates." />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        aria-busy={pending}
        className="space-y-4"
      >
        <Card>
          <CardHeader><CardTitle>Employment profile</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <form.Field name="full_name">
              {(field) => <TextField id="full_name" label="Full name" required maxLength={255} value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="source_staff_id">
              {(field) => <TextField id="source_staff_id" label="Source staff ID" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="nip">
              {(field) => <TextField id="nip" label="NIP" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="nuptk">
              {(field) => <TextField id="nuptk" label="NUPTK" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="job_title_raw">
              {(field) => <TextField id="job_title_raw" label="Position title" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="dapodik_status_raw">
              {(field) => <SelectField id="dapodik_status_raw" label="DAPODIK status" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }}>
                <option value="">Unknown / blank</option><option value="AKTIF">AKTIF</option><option value="BELUM">BELUM</option><option value="SUDAH">SUDAH</option><option value="TIDAK">TIDAK (preserved as unmapped)</option>
              </SelectField>}
            </form.Field>
            <form.Field name="employment_start_date">
              {(field) => <DateField id="employment_start_date" label="Employment start date" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            {!isEdit && <form.Field name="employment_status">
              {(field) => <SelectField id="employment_status" label="Status" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { if (value === "ACTIVE" || value === "FORMER") { clearSubmitErrors(); field.handleChange(value); } }}>
                <option value="ACTIVE">Active</option><option value="FORMER">Former</option>
              </SelectField>}
            </form.Field>}
          </CardContent>
        </Card>

        {showSensitive && <Card>
          <CardHeader><CardTitle>Sensitive personal details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <form.Field name="birth_place">
              {(field) => <TextField id="birth_place" label="Birth place" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="birth_date">
              {(field) => <DateField id="birth_date" label="Birth date" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="nik">
              {(field) => <TextField id="nik" label="NIK" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="email">
              {(field) => <TextField id="email" label="Email" type="email" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <form.Field name="phone">
              {(field) => <TextField id="phone" label="Phone" type="tel" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
            </form.Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <form.Field name="address">
                {(field) => <TextField id="address" label="Address" value={field.state.value} errors={field.state.meta.errors} disabled={pending} onBlur={field.handleBlur} onChange={(value) => { clearSubmitErrors(); field.handleChange(value); }} />}
              </form.Field>
            </div>
          </CardContent>
        </Card>}

        {isEdit && can("edit_sensitive_staff_fields") && sensitive.isError && <p role="alert" className="text-sm text-rose-700">Sensitive fields could not be loaded. They will be left unchanged.</p>}
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(submitError) => <>
            <FormErrorSummary message={submitError} />
            <div className="flex gap-2">
              <SubmitButton pending={pending}>Save employee</SubmitButton>
              <Button type="button" variant="outline" onClick={() => isEdit ? navigate({ to: '/staff/$id', params: { id } }) : navigate({ to: '/staff' })} disabled={pending}>Cancel</Button>
            </div>
          </>}
        </form.Subscribe>
      </form>
    </div>
  );
}
