import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { fetchAcademicYears } from "../api/grades";
import { applyAttendanceCalendarPeriod, deleteAttendanceCalendarException, previewAttendanceCalendarPeriod, saveAttendanceCalendarException, saveAttendanceCalendarWeekdays, saveAttendanceSubmissionDeadline, type AttendanceCalendarRuleValue } from "../api/attendanceCalendar";
import { getPageApiError } from "../lib/api/errors";
import type { AttendanceCalendarOverview, AttendanceCalendarPeriodPreviewResponse, AttendanceCalendarWeekdaysRequest } from "@operatoros/contracts/attendance";
import { useAttendanceCalendarQuery } from "../hooks/useAttendanceCalendarQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAttendanceCalendarQueries } from "../lib/query/attendanceInvalidation";
import { queryKeys } from "../lib/query/queryKeys";
import { invalidateReadiness } from "../features/readiness";
import { registerAttendanceCalendarNavigationGuard } from "../lib/attendanceCalendarNavigationGuard";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const reasons = ["HOLIDAY", "SCHOOL_BREAK", "SCHOOL_CLOSED", "NON_INSTRUCTIONAL_DAY", "PROGRAM_NOT_IN_SESSION", "REPLACEMENT_SCHOOL_DAY", "SPECIAL_INSTRUCTIONAL_DAY"] as const;
type Reason = typeof reasons[number];
type Form = { id?: number; expectation: AttendanceCalendarRuleValue; reason: Reason };
type WeekdayRule = AttendanceCalendarWeekdaysRequest["weekdays"][number];
type WeekdayDraft = { scope: string; weekdays: WeekdayRule[] };
type HistoryEntry = { href: string; index: number | null; state: unknown };

const emptyExceptionForm: Form = { expectation: "NOT_EXPECTED", reason: "HOLIDAY" };

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInYear(value: string | null, startDate: string, endDate: string): value is string {
  return validDate(value) && value >= startDate && value <= endDate;
}

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== "object" || !("idx" in state)) return null;
  return typeof state.idx === "number" ? state.idx : null;
}

function reasonLabel(value: string): string { return value.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "); }
function sameWeekdays(left: WeekdayRule[] | undefined, right: WeekdayRule[] | undefined): boolean {
  return Boolean(left && right && left.length === right.length && left.every((value, index) => value.weekday === right[index]?.weekday && value.expectation === right[index]?.expectation));
}

function CalendarRulesSummary({ scope, jenjangName, rules, exceptionCount }: { scope: string; jenjangName: string; rules: WeekdayRule[]; exceptionCount: number }) {
  const namesFor = (expectation: AttendanceCalendarRuleValue | null) => rules.filter((value) => value.expectation === expectation).map((value) => weekdays[value.weekday]).join(", ") || "None";
  const notConfigured = rules.filter((value) => value.expectation === null).map((value) => weekdays[value.weekday]).join(", ") || "None";
  return <Card><CardHeader><CardTitle>Calendar Rules Summary</CardTitle><p className="text-sm text-muted-foreground">Saved rules for {scope} · {jenjangName}</p></CardHeader><CardContent className="space-y-2 text-sm"><p><strong>Expected:</strong> {namesFor("EXPECTED")}</p><p><strong>Not expected:</strong> {namesFor("NOT_EXPECTED")}</p><p><strong>Not configured:</strong> {notConfigured} · unresolved dates remain unknown.</p><p>{exceptionCount ? `${exceptionCount} date-specific exception${exceptionCount === 1 ? "" : "s"}` : "No date-specific exceptions"}; date exceptions take precedence over recurring weekdays. <a className="font-bold text-brand hover:underline" href="#date-exceptions">Review exceptions</a></p><a className="inline-block font-bold text-brand hover:underline" href="#recurring-weekdays">Edit recurring days</a></CardContent></Card>;
}

export default function AttendanceCalendar() {
  const { user, can } = useAuth();
  const allowed = can("view_attendance");
  const canEdit = user?.role === "admin";
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const years = useQuery({ queryKey: queryKeys.academicMasters.years, queryFn: fetchAcademicYears, enabled: allowed });
  const requestedYearId = positiveId(searchParams.get("academic_year_id"));
  const selectedYear = years.data?.find((item) => item.id === requestedYearId)
    ?? years.data?.find((item) => item.is_default)
    ?? years.data?.[0]
    ?? null;
  const academicYearId = selectedYear?.id ?? null;
  const [weekdayDraft, setWeekdayDraft] = useState<WeekdayDraft | null>(null);
  const [form, setForm] = useState<Form>(emptyExceptionForm);
  const [period, setPeriod] = useState({ start_date: "", end_date: "", expectation: "NOT_EXPECTED" as AttendanceCalendarRuleValue, reason: "SCHOOL_BREAK" as Reason });
  const [periodPreview, setPeriodPreview] = useState<AttendanceCalendarPeriodPreviewResponse | null>(null);
  const [periodConfirmed, setPeriodConfirmed] = useState(false);
  const calendar = useAttendanceCalendarQuery(academicYearId, allowed);
  const calendarMatchesYear = calendar.data?.scope.academicYearId === academicYearId;
  const requestedJenjangId = positiveId(searchParams.get("jenjang_id"));
  const selectedJenjang = calendarMatchesYear
    ? calendar.data?.jenjangs.find((item) => item.id === requestedJenjangId) ?? calendar.data?.jenjangs[0] ?? null
    : null;
  const year = calendarMatchesYear ? calendar.data?.scope : undefined;
  const dateParam = searchParams.get("date");
  const calendarDate = year && dateInYear(dateParam, year.startDate, year.endDate) ? dateParam : "";
  const client = useQueryClient();
  const historyEntry = useRef<HistoryEntry | null>(null);
  const invalidateCalendar = async (yearId: number, includeReadiness: boolean) => {
    await invalidateAttendanceCalendarQueries(client, yearId);
    if (includeReadiness) await invalidateReadiness(client);
  };
  const saveWeekdays = useMutation({ mutationFn: saveAttendanceCalendarWeekdays, onSuccess: async (saved) => {
    const key = `${saved.academicYearId}:${saved.jenjangId}`;
    setWeekdayDraft({ scope: key, weekdays: saved.weekdays });
    client.setQueryData<AttendanceCalendarOverview>(queryKeys.attendance.calendar(saved.academicYearId), (previous) => previous && ({ ...previous, jenjangs: previous.jenjangs.map((item) => item.id === saved.jenjangId ? { ...item, weekdays: saved.weekdays } : item) }));
    await Promise.all([invalidateAttendanceCalendarQueries(client, saved.academicYearId), invalidateReadiness(client)]);
  } });
  const saveException = useMutation({ mutationFn: saveAttendanceCalendarException, onSuccess: async (_saved, request) => { setForm(emptyExceptionForm); await invalidateCalendar(request.academic_year_id, true); } });
  const deleteException = useMutation({ mutationFn: ({ id }: { id: number; academicYearId: number }) => deleteAttendanceCalendarException(id), onSuccess: async (_saved, request) => { setForm(emptyExceptionForm); await invalidateCalendar(request.academicYearId, true); } });
  const saveDeadline = useMutation({ mutationFn: saveAttendanceSubmissionDeadline, onSuccess: (_saved, request) => invalidateCalendar(request.academic_year_id, false) });
  const previewPeriod = useMutation({ mutationFn: previewAttendanceCalendarPeriod, onSuccess: (value) => { setPeriodPreview(value); setPeriodConfirmed(false); } });
  const applyPeriod = useMutation({ mutationFn: applyAttendanceCalendarPeriod, onSuccess: async (_saved, request) => { setPeriodPreview(null); setPeriodConfirmed(false); await invalidateCalendar(request.academic_year_id, true); } });
  const current = selectedJenjang;
  const exceptionPending = saveException.isPending || deleteException.isPending;
  const weekdayScope = year && current ? `${year.academicYearId}:${current.id}` : null;
  const persistedWeekdays = current?.weekdays;
  const draftWeekdays = weekdayScope && weekdayDraft?.scope === weekdayScope ? weekdayDraft.weekdays : persistedWeekdays;
  const weekdayDraftByNumber = new Map(draftWeekdays?.map((value) => [value.weekday, value.expectation]) ?? []);
  const hasUnsavedWeekdays = Boolean(persistedWeekdays && draftWeekdays && !sameWeekdays(persistedWeekdays, draftWeekdays));

  useLayoutEffect(() => {
    historyEntry.current = { href: window.location.href, index: historyIndex(window.history.state), state: window.history.state };
  }, [location.hash, location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!selectedYear) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const set = (key: string, value: string | null) => {
      if (value === null) {
        const existed = next.has(key);
        next.delete(key);
        changed = existed || changed;
      } else if (next.get(key) !== value) {
        next.set(key, value);
        changed = true;
      }
    };
    set("academic_year_id", String(selectedYear.id));
    if (calendarMatchesYear) {
      if (selectedJenjang) set("jenjang_id", String(selectedJenjang.id));
      else set("jenjang_id", null);
      if (dateParam && !dateInYear(dateParam, year!.startDate, year!.endDate)) set("date", null);
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [calendarMatchesYear, dateParam, searchParams, selectedJenjang, selectedYear, setSearchParams, year]);

  useEffect(() => {
    if (!hasUnsavedWeekdays && !saveWeekdays.isPending) return undefined;
    const leaveMessage = "You have unsaved recurring-day changes. Leave without saving?";
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || (destination.pathname === window.location.pathname && destination.search === window.location.search)) return;
      const mayLeave = !saveWeekdays.isPending && window.confirm(leaveMessage);
      if (mayLeave) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onPopState = (event: PopStateEvent) => {
      const current = historyEntry.current;
      if (!current || current.href === window.location.href) return false;
      const targetIndex = historyIndex(event.state);
      const mayLeave = !saveWeekdays.isPending && window.confirm(leaveMessage);
      if (mayLeave) {
        setWeekdayDraft(null);
        saveWeekdays.reset();
        return false;
      }
      const delta = current.index !== null && targetIndex !== null ? current.index - targetIndex : null;
      if (delta !== null) window.setTimeout(() => window.history.go(delta), 0);
      else window.history.pushState(current.state, "", current.href);
      return true;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onLinkClick, true);
    const unregisterNavigationGuard = registerAttendanceCalendarNavigationGuard(onPopState);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onLinkClick, true); unregisterNavigationGuard(); };
  }, [hasUnsavedWeekdays, saveWeekdays.isPending, saveWeekdays.reset]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view attendance expectation rules." />;
  if (years.isPending || calendar.isPending) return <LoadingState title="Loading attendance calendar" description="Preparing the configured expectation authority." />;
  if (years.error || calendar.error) return <ErrorState title="Attendance calendar could not be loaded" description="The configured expectation authority is unavailable." action={<Button onClick={() => { void years.refetch(); void calendar.refetch(); }}>Try again</Button>} />;
  if (!calendar.data || calendar.data.jenjangs.length === 0 || !year || !current) return <EmptyState title="No active jenjang" description="Create an active jenjang before configuring attendance expectation." />;
  const updateWeekday = (weekday: number, value: string) => {
    saveWeekdays.reset();
    const next = (draftWeekdays ?? current.weekdays).map((item) => item.weekday === weekday ? { ...item, expectation: (value || null) as AttendanceCalendarRuleValue | null } : item);
    setWeekdayDraft({ scope: weekdayScope!, weekdays: next });
  };
  const confirmScopeChange = () => {
    if (saveWeekdays.isPending || (hasUnsavedWeekdays && !window.confirm("You have unsaved recurring-day changes. Discard them and switch calendar scope?"))) return false;
    setWeekdayDraft(null);
    saveWeekdays.reset();
    return true;
  };
  const updateCalendarParam = (key: string, value: string) => setSearchParams((existing) => {
    const next = new URLSearchParams(existing);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  });
  const submitException = (event: React.FormEvent) => { event.preventDefault(); if (!calendarDate) return; saveException.reset(); deleteException.reset(); saveException.mutate({ ...form, date: calendarDate, academic_year_id: year.academicYearId, jenjang_id: current.id }); };
  const submitDeadline = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("submission-deadline"); saveDeadline.reset(); saveDeadline.mutate({ academic_year_id: year.academicYearId, jenjang_id: current.id, cutoff_time: value ? String(value) : null }); };
  const submitPeriod = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); applyPeriod.reset(); previewPeriod.mutate({ ...period, academic_year_id: year.academicYearId, jenjang_id: current.id }); };
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Attendance Administration" title="Attendance Calendar" description="Configure when attendance is expected for each jenjang. An unconfigured date remains unknown; this does not establish a submission deadline." actions={<div className="flex flex-wrap gap-2"><Link className="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-surface-muted" to="/attendance/daily">Open Daily Attendance</Link>{can("import_attendance") && <Link className="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-surface-muted" to="/upload">Open Attendance Upload</Link>}</div>} />
    <Card><CardHeader><CardTitle>Calendar scope</CardTitle><p className="text-sm text-muted-foreground">Rules use the school date exactly as entered. Date exceptions override the recurring weekday rule.</p></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor="calendar-year">Academic year</FieldLabel><NativeSelect id="calendar-year" value={year.academicYearId} onChange={(event) => { if (!confirmScopeChange()) return; const nextYear = years.data?.find((item) => item.id === Number(event.target.value)); if (!nextYear) return; setForm(emptyExceptionForm); saveException.reset(); deleteException.reset(); saveDeadline.reset(); setSearchParams((existing) => { const next = new URLSearchParams(existing); next.set("academic_year_id", String(nextYear.id)); if (!dateInYear(next.get("date"), nextYear.start_date, nextYear.end_date)) next.delete("date"); return next; }); }}><option value="">Select year</option>{years.data?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><p className="mt-1 text-xs text-muted-foreground">{year.startDate} to {year.endDate}</p></div><div><FieldLabel htmlFor="calendar-jenjang">Jenjang</FieldLabel><NativeSelect id="calendar-jenjang" value={current.id} onChange={(event) => { if (!confirmScopeChange()) return; setForm(emptyExceptionForm); saveException.reset(); deleteException.reset(); saveDeadline.reset(); updateCalendarParam("jenjang_id", event.target.value); }}>{calendar.data.jenjangs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div></div></CardContent></Card>
    <CalendarRulesSummary scope={year.academicYearLabel} jenjangName={current.name} rules={current.weekdays} exceptionCount={current.exceptions.length} />
    <Card><CardHeader><CardTitle id="recurring-weekdays">Recurring weekdays · {current.name}</CardTitle><p className="text-sm text-muted-foreground">Changes are not active until saved. Recurring rules define the normal weekly attendance expectation. Unconfigured weekdays resolve to Unknown until a recurring rule or date exception applies.</p></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{weekdayOrder.map((weekday) => {
      const expectation = weekdayDraftByNumber.get(weekday) ?? null;
      return <div key={weekday}><FieldLabel htmlFor={"weekday-" + weekday}>{weekdays[weekday]}</FieldLabel><NativeSelect id={"weekday-" + weekday} value={expectation ?? ""} onChange={(event) => updateWeekday(weekday, event.target.value)} disabled={!canEdit || saveWeekdays.isPending}><option value="">Not configured</option><option value="EXPECTED">Expected</option><option value="NOT_EXPECTED">Not expected</option></NativeSelect></div>;
    })}</div>{canEdit && <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="button" disabled={!hasUnsavedWeekdays || saveWeekdays.isPending} onClick={() => saveWeekdays.mutate({ academic_year_id: year.academicYearId, jenjang_id: current.id, weekdays: draftWeekdays ?? current.weekdays })}>{saveWeekdays.isPending ? "Saving…" : "Save recurring days"}</Button><p role="status" aria-live="polite" className="text-sm font-semibold">{saveWeekdays.isPending ? "Saving" : hasUnsavedWeekdays ? "Unsaved changes" : "Saved"}</p>{saveWeekdays.error && <p role="alert" className="text-sm font-semibold text-rose-700">Save failed. Changes were not saved. Your edits are still visible.</p>}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Submission deadline · {current.name}</CardTitle><p className="text-sm text-muted-foreground">Same-day local cutoff for expected attendance. Timezone: Asia/Jakarta. An unset deadline stays unavailable.</p></CardHeader><CardContent><form key={`${year.academicYearId}-${current.id}-${current.submissionDeadlineLocalTime ?? "unset"}`} className="flex flex-wrap items-end gap-4" onSubmit={submitDeadline}><div><FieldLabel htmlFor="submission-deadline">Cutoff time</FieldLabel><input id="submission-deadline" name="submission-deadline" type="time" step="60" defaultValue={current.submissionDeadlineLocalTime ?? ""} onChange={() => saveDeadline.reset()} disabled={!canEdit || saveDeadline.isPending} className="h-11 rounded-md border border-border bg-surface px-3 text-sm" /></div>{canEdit && <><Button type="submit" disabled={saveDeadline.isPending}>{saveDeadline.isPending ? "Saving…" : "Save deadline"}</Button><Button type="button" variant="outline" disabled={saveDeadline.isPending || current.submissionDeadlineLocalTime === null} onClick={() => { saveDeadline.reset(); saveDeadline.mutate({ academic_year_id: year.academicYearId, jenjang_id: current.id, cutoff_time: null }); }}>{saveDeadline.isPending && saveDeadline.variables?.cutoff_time === null ? "Clearing…" : "Clear"}</Button></>}<p className="text-sm text-muted-foreground">{current.submissionDeadlineLocalTime ? `Configured: ${current.submissionDeadlineLocalTime} Asia/Jakarta` : "Submission deadline not configured"}</p>{saveDeadline.isPending && <p role="status" className="text-sm font-semibold">Saving deadline…</p>}{saveDeadline.isSuccess && <p role="status" className="text-sm font-semibold text-emerald-700">{saveDeadline.variables?.cutoff_time === null ? "Deadline cleared." : "Deadline saved."}</p>}{saveDeadline.error && <p role="alert" className="text-sm font-semibold text-rose-700">Deadline was not saved. {getPageApiError(saveDeadline.error, "The deadline could not be saved. Your change remains in the form.")}</p>}</form>{!canEdit && <p className="mt-3 text-sm text-muted-foreground">Deadline configuration is read-only for this account.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Calendar period</CardTitle><p className="text-sm text-muted-foreground">Preview a multi-day expectation change before creating date exceptions. The range includes every date, including weekends.</p></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-5 md:items-end" onSubmit={submitPeriod}><div><FieldLabel htmlFor="period-start">Start date</FieldLabel><input id="period-start" type="date" min={year.startDate} max={year.endDate} value={period.start_date} onChange={(event) => { setPeriod((value) => ({ ...value, start_date: event.target.value })); setPeriodPreview(null); }} required className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div><div><FieldLabel htmlFor="period-end">End date</FieldLabel><input id="period-end" type="date" min={year.startDate} max={year.endDate} value={period.end_date} onChange={(event) => { setPeriod((value) => ({ ...value, end_date: event.target.value })); setPeriodPreview(null); }} required className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div><div><FieldLabel htmlFor="period-expectation">Expectation</FieldLabel><NativeSelect id="period-expectation" value={period.expectation} onChange={(event) => { setPeriod((value) => ({ ...value, expectation: event.target.value as AttendanceCalendarRuleValue })); setPeriodPreview(null); }}><option value="NOT_EXPECTED">Not expected</option><option value="EXPECTED">Expected</option></NativeSelect></div><div><FieldLabel htmlFor="period-reason">Reason</FieldLabel><NativeSelect id="period-reason" value={period.reason} onChange={(event) => { setPeriod((value) => ({ ...value, reason: event.target.value as Reason })); setPeriodPreview(null); }}>{reasons.map((reason) => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}</NativeSelect></div><Button type="submit" disabled={!canEdit || previewPeriod.isPending}>{previewPeriod.isPending ? "Preparing preview…" : "Preview period"}</Button></form>{!canEdit && <p className="mt-3 text-sm text-muted-foreground">Period changes are available only to administrators.</p>}{previewPeriod.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{previewPeriod.error.message}</p>}{periodPreview && <section className="mt-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5" aria-labelledby="period-preview-title"><h3 id="period-preview-title" className="text-lg font-black">Period preview</h3><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">Dates</dt><dd className="font-bold">{periodPreview.summary.totalDates}</dd></div><div><dt className="text-muted-foreground">Create</dt><dd className="font-bold">{periodPreview.summary.creates}</dd></div><div><dt className="text-muted-foreground">Same / no-op</dt><dd className="font-bold">{periodPreview.summary.noops}</dd></div><div><dt className="text-muted-foreground">Conflicts</dt><dd className="font-bold">{periodPreview.summary.conflicts}</dd></div></dl><p className="mt-4 text-sm text-slate-700">Existing conflicting exceptions remain unchanged. Applying this period only creates dates classified as safe by the server.</p>{periodPreview.summary.conflicts > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><caption className="sr-only">Conflicting calendar exceptions in period preview</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-2">Date</th><th scope="col" className="px-2 py-2">Current expectation</th><th scope="col" className="px-2 py-2">Reason</th></tr></thead><tbody>{periodPreview.rows.filter((value) => value.classification === "CONFLICT_EXISTING_EXCEPTION").map((value) => <tr key={value.date} className="border-b border-border"><th scope="row" className="px-2 py-2 text-left">{value.date}</th><td className="px-2 py-2">{value.existingExpectation === "EXPECTED" ? "Expected" : "Not expected"}</td><td className="px-2 py-2">{value.existingReason ? reasonLabel(value.existingReason) : "Not recorded"}</td></tr>)}</tbody></table></div>}<label className="mt-5 flex items-start gap-3 text-sm font-semibold"><input id="period-confirmation" type="checkbox" checked={periodConfirmed} onChange={(event) => setPeriodConfirmed(event.target.checked)} disabled={!periodPreview.summary.creates || applyPeriod.isPending} className="mt-1 size-4" />I confirm that the server preview is correct and want to create the safe date exceptions.</label><Button className="mt-4" disabled={!periodConfirmed || !periodPreview.summary.creates || applyPeriod.isPending} onClick={() => applyPeriod.mutate({ ...periodPreview.request, preview_digest: periodPreview.previewDigest, confirmation: "APPLY_ATTENDANCE_CALENDAR_PERIOD" })}>{applyPeriod.isPending ? "Applying period…" : `Create ${periodPreview.summary.creates} date exceptions`}</Button>{applyPeriod.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{applyPeriod.error.message}</p>}</section>}{applyPeriod.data && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">Period applied: {applyPeriod.data.summary.created} created, {applyPeriod.data.summary.noops} same-state no-ops, {applyPeriod.data.summary.conflicts} conflicts preserved.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle id="date-exceptions">Date exceptions</CardTitle><p className="text-sm text-muted-foreground">Use a date-specific override when this date differs from the recurring weekly rule. A date-specific exception overrides the recurring weekday rule for that date.</p></CardHeader><CardContent>
      {canEdit ? <form className="grid gap-4 md:grid-cols-4 md:items-end" onSubmit={submitException}>
        <div><FieldLabel htmlFor="exception-date">Date</FieldLabel><input id="exception-date" type="date" min={year.startDate} max={year.endDate} value={calendarDate} onChange={(event) => { saveException.reset(); deleteException.reset(); updateCalendarParam("date", event.target.value); }} required disabled={exceptionPending} className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div>
        <div><FieldLabel htmlFor="exception-expectation">Expectation</FieldLabel><NativeSelect id="exception-expectation" value={form.expectation} onChange={(event) => { saveException.reset(); deleteException.reset(); setForm((value) => ({ ...value, expectation: event.target.value as AttendanceCalendarRuleValue })); }} disabled={exceptionPending}><option value="EXPECTED">Expected</option><option value="NOT_EXPECTED">Not expected</option></NativeSelect></div>
        <div><FieldLabel htmlFor="exception-reason">Reason</FieldLabel><NativeSelect id="exception-reason" value={form.reason} onChange={(event) => { saveException.reset(); deleteException.reset(); setForm((value) => ({ ...value, reason: event.target.value as Reason })); }} disabled={exceptionPending}>{reasons.map((reason) => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}</NativeSelect></div>
        <Button type="submit" disabled={!calendarDate || exceptionPending}>{saveException.isPending ? "Saving…" : form.id ? "Save exception" : "Add exception"}</Button>
        {saveException.isPending && <p role="status" className="text-sm font-semibold">Saving date exception…</p>}
        {saveException.isSuccess && <p role="status" className="text-sm font-semibold text-emerald-700">Date exception saved.</p>}
        {saveException.error && <p role="alert" className="text-sm font-semibold text-rose-700">Date exception was not saved. {getPageApiError(saveException.error, "The date exception could not be saved. Your changes remain in the form.")}</p>}
        {deleteException.isPending && <p role="status" className="text-sm font-semibold">Removing date exception…</p>}
        {deleteException.isSuccess && <p role="status" className="text-sm font-semibold text-emerald-700">Date exception removed.</p>}
        {deleteException.error && <p role="alert" className="text-sm font-semibold text-rose-700">Date exception was not removed. {getPageApiError(deleteException.error, "The date exception could not be removed.")}</p>}
      </form> : <p className="text-sm text-muted-foreground">Calendar rules are read-only for this account. Contact an administrator to change them.</p>}
      {current.exceptions.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No date exceptions are configured for this jenjang.</p> : <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><caption className="sr-only">Attendance calendar date exceptions</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Expectation</th><th scope="col" className="px-2 py-3">Reason</th><th scope="col" className="px-2 py-3">Actions</th></tr></thead><tbody>{current.exceptions.map((item) => <tr key={item.id} className="border-b border-border"><th scope="row" className="px-2 py-3 text-left">{item.date}</th><td className="px-2 py-3">{item.expectation === "EXPECTED" ? "Expected" : "Not expected"}</td><td className="px-2 py-3">{reasonLabel(item.reason)}</td><td className="px-2 py-3">{canEdit ? <div className="flex gap-3"><Button variant="outline" size="sm" disabled={exceptionPending} onClick={() => { saveException.reset(); deleteException.reset(); setForm({ id: item.id, expectation: item.expectation, reason: item.reason }); updateCalendarParam("date", item.date); }}>Edit</Button><Button variant="outline" size="sm" disabled={exceptionPending} onClick={() => { if (window.confirm("Remove this calendar exception?")) { saveException.reset(); deleteException.reset(); deleteException.mutate({ id: item.id, academicYearId: year.academicYearId }); } }}>{deleteException.isPending ? "Removing…" : "Remove"}</Button></div> : <span className="text-muted-foreground">Read only</span>}</td></tr>)}</tbody></table></div>}
    </CardContent></Card>
    <p className="text-sm text-muted-foreground">Daily Attendance uses this authority independently from recording coverage: Expected, Not expected, and Calendar expectation unavailable are descriptive calendar states.</p>
  </div>;
}
