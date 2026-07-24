import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, LockKeyhole, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

import api from "../api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";

const safeError = (error) => {
  const code = error?.response?.data?.detail?.code;
  if (code === "ATTENDANCE_CORRECTION_STALE") return "This request is stale. Refresh before taking another action.";
  if (code === "ATTENDANCE_PERIOD_FINALIZED") return "This attendance date is finalized. An authorized administrator must reopen it.";
  if (error?.response?.status === 403) return "Your account does not have permission for this action.";
  return "The attendance correction could not be completed. Your entered values have been preserved.";
};

export default function AttendanceCorrections() {
  const { user, can } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState({ status: "OPEN", version: 0, audit: [] });
  const [form, setForm] = useState({ attendance_id: "", proposed_status: "late", proposed_check_in: "", proposed_check_out: "", reason_code: "SCAN_REVIEW", explanation: "" });
  const [rejecting, setRejecting] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, status] = await Promise.all([
        api.get("/api/attendance-corrections"),
        api.get("/api/attendance-corrections/periods/status", { params: { attendance_date: attendanceDate } }),
      ]);
      setRequests(queue.data || []);
      setPeriod(status.data);
    } catch (err) { setError(safeError(err)); }
    finally { setLoading(false); }
  }, [attendanceDate]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key, action) => {
    if (busy) return;
    setBusy(key); setError("");
    try { await action(); await load(); }
    catch (err) { setError(safeError(err)); }
    finally { setBusy(""); }
  };

  const submitNew = async (event) => {
    event.preventDefault();
    await run("create", async () => {
      const response = await api.post("/api/attendance-corrections", {
        ...form, attendance_id: Number(form.attendance_id),
        proposed_check_in: form.proposed_check_in || null, proposed_check_out: form.proposed_check_out || null,
      });
      await api.post(`/api/attendance-corrections/${response.data.id}/submit`);
      setForm((current) => ({ ...current, attendance_id: "", explanation: "" }));
    });
  };

  const submitted = useMemo(() => requests.filter((item) => item.state === "SUBMITTED"), [requests]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 overflow-x-hidden">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">Attendance Corrections</h1>
        <p className="mt-1 text-slate-500">Maker-checker requests remain separate from approved attendance until a different authorized user approves them.</p>
      </header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</div>}

      <Card className="rounded-2xl p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Period governance</p>
            <div className="mt-2 flex items-center gap-2 font-bold">
              {period.status === "FINALIZED" ? <LockKeyhole className="text-amber-600" /> : <ShieldCheck className="text-emerald-600" />}
              {period.status === "FINALIZED" ? "Finalized" : "Open / reopened"}
            </div>
            <p className="mt-1 text-sm text-slate-500">Actor: {period.finalized_by || period.reopened_by || "No governance event"}</p>
          </div>
          <label className="text-sm font-semibold text-slate-700">Attendance date
            <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <div className="flex flex-wrap gap-2">
            {can("finalize_attendance_period") && period.status !== "FINALIZED" && <button type="button" disabled={Boolean(busy)} onClick={() => run("finalize", () => api.post("/api/attendance-corrections/periods/finalize", { attendance_date: attendanceDate, reason: "Attendance register reviewed and finalized", confirmation: "FINALIZE_ATTENDANCE_PERIOD" }))} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">Finalize</button>}
            {can("reopen_attendance_period") && period.status === "FINALIZED" && <button type="button" disabled={Boolean(busy)} onClick={() => run("reopen", () => api.post("/api/attendance-corrections/periods/reopen", { attendance_date: attendanceDate, reason: "Authorized correction review requires reopening", confirmation: "REOPEN_ATTENDANCE_PERIOD", expected_version: period.version }))} className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Reopen period</button>}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {can("request_attendance_correction") && (
          <Card className="rounded-2xl p-5">
            <h2 className="text-lg font-bold text-slate-900">Request a correction</h2>
            <form onSubmit={submitNew} className="mt-4 grid gap-4">
              <label className="text-sm font-semibold">Attendance record ID<input required inputMode="numeric" value={form.attendance_id} onChange={(e) => setForm({ ...form, attendance_id: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-sm font-semibold">Proposed status<select value={form.proposed_status} onChange={(e) => setForm({ ...form, proposed_status: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="on-time">On-time</option><option value="late">Late</option><option value="absent">Absent</option><option value="incomplete">Incomplete</option></select></label>
                <label className="text-sm font-semibold">Check-in<input type="time" value={form.proposed_check_in} onChange={(e) => setForm({ ...form, proposed_check_in: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-semibold">Check-out<input type="time" value={form.proposed_check_out} onChange={(e) => setForm({ ...form, proposed_check_out: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
              </div>
              <label className="text-sm font-semibold">Explanation<textarea required minLength={5} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
              <p className="text-sm text-slate-500">Requester (session): <strong>{user?.username}</strong></p>
              <button disabled={Boolean(busy) || period.status === "FINALIZED"} className="rounded-xl bg-brand px-4 py-2 font-bold text-white disabled:opacity-50">{busy === "create" ? "Submitting…" : "Create and submit"}</button>
            </form>
          </Card>
        )}

        <Card className="rounded-2xl p-5">
          <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Approval queue</h2><button aria-label="Refresh correction queue" onClick={load}><RefreshCw size={18} /></button></div>
          {loading ? <p className="mt-6 text-slate-500">Loading correction requests…</p> : submitted.length === 0 ? <p className="mt-6 text-slate-500">No submitted correction requests.</p> : (
            <div className="mt-4 space-y-4">
              {submitted.map((item) => {
                const self = item.requester === user?.username;
                return <article key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Request #{item.id}</h3><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{item.state}</span></div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3"><p className="font-bold text-slate-500">Original effective</p><p>{item.original_snapshot.status} · {item.original_snapshot.check_in || "—"}–{item.original_snapshot.check_out || "—"}</p></div><div className="rounded-lg bg-brand/5 p-3"><p className="font-bold text-slate-500">Proposed</p><p>{item.proposed_status} · {item.proposed_check_in || "—"}–{item.proposed_check_out || "—"}</p></div></div>
                  <p className="mt-3 text-sm">{item.explanation}</p><p className="mt-1 text-xs text-slate-500">Requested by {item.requester}</p>
                  {self && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle className="mr-1 inline" size={15} />Self-approval is unavailable.</p>}
                  {can("approve_attendance_correction") && <div className="mt-3 flex flex-wrap gap-2"><button disabled={self || Boolean(busy)} onClick={() => run(`approve-${item.id}`, () => api.post(`/api/attendance-corrections/${item.id}/approve`, { confirmation: "APPROVE_ATTENDANCE_CORRECTION" }))} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline" size={15} />Approve</button><button disabled={Boolean(busy)} onClick={() => setRejecting(item.id)} className="rounded-lg bg-rose-100 px-3 py-2 text-sm font-bold text-rose-800"><XCircle className="mr-1 inline" size={15} />Reject</button></div>}
                </article>;
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="rounded-2xl p-5"><h2 className="font-bold"><Clock className="mr-2 inline" />Audit timeline</h2><div className="mt-3 space-y-2 text-sm">{requests.flatMap((request) => request.audit.map((event, index) => <div key={`${request.id}-${index}`} className="border-l-2 border-slate-200 pl-3">Request #{request.id}: {event.action} by {event.actor} · {event.new_state}</div>))}</div></Card>

      {rejecting && <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><Card className="w-full max-w-md rounded-2xl p-5"><h2 id="reject-title" className="text-lg font-bold">Reject correction</h2><label className="mt-4 block text-sm font-semibold">Rejection reason<textarea autoFocus minLength={5} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 p-3" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => { setRejecting(null); setRejectionReason(""); }} className="rounded-lg border px-3 py-2">Cancel</button><button disabled={rejectionReason.trim().length < 5 || Boolean(busy)} onClick={() => run(`reject-${rejecting}`, async () => { await api.post(`/api/attendance-corrections/${rejecting}/reject`, { rejection_reason: rejectionReason.trim() }); setRejecting(null); setRejectionReason(""); })} className="rounded-lg bg-rose-600 px-3 py-2 font-bold text-white disabled:opacity-40">Confirm rejection</button></div></Card></div>}
    </div>
  );
}
