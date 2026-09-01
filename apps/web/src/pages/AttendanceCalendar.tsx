import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { fetchAcademicYears } from "../api/grades";
import { deleteAttendanceCalendarException, saveAttendanceCalendarException, saveAttendanceCalendarWeekday, type AttendanceCalendarRuleValue } from "../api/attendanceCalendar";
import { useAttendanceCalendarQuery } from "../hooks/useAttendanceCalendarQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/query/queryKeys";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const reasons = ["HOLIDAY", "SCHOOL_BREAK", "SCHOOL_CLOSED", "NON_INSTRUCTIONAL_DAY", "PROGRAM_NOT_IN_SESSION", "REPLACEMENT_SCHOOL_DAY", "SPECIAL_INSTRUCTIONAL_DAY"] as const;
type Reason = typeof reasons[number];
type Form = { id?: number; date: string; expectation: AttendanceCalendarRuleValue; reason: Reason };

function reasonLabel(value: string): string { return value.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "); }

export default function AttendanceCalendar() {
  const { user, can } = useAuth();
  const allowed = can("view_attendance");
  const canEdit = user?.role === "admin";
  const years = useQuery({ queryKey: ["attendance", "calendar", "years"], queryFn: fetchAcademicYears, enabled: allowed });
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ date: "", expectation: "NOT_EXPECTED", reason: "HOLIDAY" });
  const calendar = useAttendanceCalendarQuery(academicYearId, allowed);
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.attendance.calendar(academicYearId) });
  const saveWeekday = useMutation({ mutationFn: saveAttendanceCalendarWeekday, onSuccess: invalidate });
  const saveException = useMutation({ mutationFn: saveAttendanceCalendarException, onSuccess: () => { setForm({ date: "", expectation: "NOT_EXPECTED", reason: "HOLIDAY" }); void invalidate(); } });
  const deleteException = useMutation({ mutationFn: deleteAttendanceCalendarException, onSuccess: invalidate });
  const selectedJenjang = useMemo(() => calendar.data?.jenjangs.find((item) => item.id === jenjangId) ?? calendar.data?.jenjangs[0] ?? null, [calendar.data?.jenjangs, jenjangId]);

  useEffect(() => {
    if (academicYearId === null && years.data?.length) setAcademicYearId((years.data.find((year) => year.is_default) ?? years.data[0]).id);
  }, [academicYearId, years.data]);
  useEffect(() => {
    if (selectedJenjang && selectedJenjang.id !== jenjangId) setJenjangId(selectedJenjang.id);
  }, [jenjangId, selectedJenjang]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view attendance expectation rules." />;
  if (years.isPending || calendar.isPending) return <LoadingState title="Loading attendance calendar" description="Preparing the configured expectation authority." />;
  if (years.error || calendar.error) return <ErrorState title="Attendance calendar could not be loaded" description="The configured expectation authority is unavailable." action={<Button onClick={() => { void years.refetch(); void calendar.refetch(); }}>Try again</Button>} />;
  if (!calendar.data || calendar.data.jenjangs.length === 0) return <EmptyState title="No active jenjang" description="Create an active jenjang before configuring attendance expectation." />;
  const year = calendar.data.scope;
  const current = selectedJenjang ?? calendar.data.jenjangs[0];
  const updateWeekday = (weekday: number, value: string) => { saveWeekday.mutate({ academic_year_id: year.academicYearId, jenjang_id: current.id, weekday, expectation: (value || null) as AttendanceCalendarRuleValue | null }); };
  const submitException = (event: React.FormEvent) => { event.preventDefault(); if (!form.date) return; saveException.mutate({ ...form, academic_year_id: year.academicYearId, jenjang_id: current.id }); };
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Attendance Administration" title="Attendance Calendar" description="Configure when attendance is expected for each jenjang. An unconfigured date remains unknown; this does not establish a submission deadline." />
    <Card><CardHeader><CardTitle>Calendar scope</CardTitle><p className="text-sm text-muted-foreground">Rules use the school date exactly as entered. Date exceptions override the recurring weekday rule.</p></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor="calendar-year">Academic year</FieldLabel><NativeSelect id="calendar-year" value={year.academicYearId} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setJenjangId(null); }}><option value="">Select year</option>{years.data?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><p className="mt-1 text-xs text-muted-foreground">{year.startDate} to {year.endDate}</p></div><div><FieldLabel htmlFor="calendar-jenjang">Jenjang</FieldLabel><NativeSelect id="calendar-jenjang" value={current.id} onChange={(event) => setJenjangId(Number(event.target.value))}>{calendar.data.jenjangs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Recurring weekdays · {current.name}</CardTitle><p className="text-sm text-muted-foreground">Choose Expected, Not expected, or Not configured. Not configured resolves to UNKNOWN.</p></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{current.weekdays.map((item) => <div key={item.weekday}><FieldLabel htmlFor={`weekday-${item.weekday}`}>{weekdays[item.weekday]}</FieldLabel><NativeSelect id={`weekday-${item.weekday}`} value={item.expectation ?? ""} onChange={(event) => updateWeekday(item.weekday, event.target.value)} disabled={!canEdit || saveWeekday.isPending}><option value="">Not configured</option><option value="EXPECTED">Expected</option><option value="NOT_EXPECTED">Not expected</option></NativeSelect></div>)}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Date exceptions</CardTitle><p className="text-sm text-muted-foreground">Use an exception for holidays, closures, breaks, or replacement instructional days.</p></CardHeader><CardContent>{canEdit && <form className="grid gap-4 md:grid-cols-4 md:items-end" onSubmit={submitException}><div><FieldLabel htmlFor="exception-date">Date</FieldLabel><input id="exception-date" type="date" min={year.startDate} max={year.endDate} value={form.date} onChange={(event) => setForm((value) => ({ ...value, date: event.target.value }))} required className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div><div><FieldLabel htmlFor="exception-expectation">Expectation</FieldLabel><NativeSelect id="exception-expectation" value={form.expectation} onChange={(event) => setForm((value) => ({ ...value, expectation: event.target.value as AttendanceCalendarRuleValue }))}><option value="EXPECTED">Expected</option><option value="NOT_EXPECTED">Not expected</option></NativeSelect></div><div><FieldLabel htmlFor="exception-reason">Reason</FieldLabel><NativeSelect id="exception-reason" value={form.reason} onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value as Reason }))}>{reasons.map((reason) => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}</NativeSelect></div><Button type="submit" disabled={saveException.isPending}>{form.id ? "Save exception" : "Add exception"}</Button></form>}{!canEdit && <p className="text-sm text-muted-foreground">Calendar rules are read-only for this account. Contact an administrator to change them.</p>}{current.exceptions.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No date exceptions are configured for this jenjang.</p> : <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><caption className="sr-only">Attendance calendar date exceptions</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Expectation</th><th scope="col" className="px-2 py-3">Reason</th><th scope="col" className="px-2 py-3">Actions</th></tr></thead><tbody>{current.exceptions.map((item) => <tr key={item.id} className="border-b border-border"><th scope="row" className="px-2 py-3 text-left">{item.date}</th><td className="px-2 py-3">{item.expectation === "EXPECTED" ? "Expected" : "Not expected"}</td><td className="px-2 py-3">{reasonLabel(item.reason)}</td><td className="px-2 py-3">{canEdit ? <div className="flex gap-3"><Button variant="outline" size="sm" onClick={() => setForm({ id: item.id, date: item.date, expectation: item.expectation, reason: item.reason })}>Edit</Button><Button variant="outline" size="sm" onClick={() => { if (window.confirm("Remove this calendar exception?")) deleteException.mutate(item.id); }}>Remove</Button></div> : <span className="text-muted-foreground">Read only</span>}</td></tr>)}</tbody></table></div>}</CardContent></Card>
    <p className="text-sm text-muted-foreground">Daily Attendance uses this authority independently from recording coverage: Expected, Not expected, and Calendar expectation unavailable are descriptive calendar states.</p>
  </div>;
}
