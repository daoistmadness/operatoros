import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, History, Loader2, X, AlertTriangle, CheckCircle2 } from "lucide-react";

import api from "../api";
import { cn } from "../lib/cn";

const STATUS_OPTIONS = ["on-time", "late", "incomplete", "absent"];

const getStatusBadgeClass = (status, effective = false) => {
  const base = "inline-flex items-center px-3 py-1 rounded-[9999px] text-xs font-bold tracking-wide uppercase";
  const strong = effective
    ? {
        "on-time": "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300/60",
        late: "bg-amber-100 text-amber-700 ring-1 ring-amber-300/60",
        incomplete: "bg-amber-100 text-amber-700 ring-1 ring-amber-300/60",
        absent: "bg-rose-100 text-rose-700 ring-1 ring-rose-300/60",
      }
    : {
        "on-time": "bg-emerald-50 text-emerald-700",
        late: "bg-amber-50 text-amber-700",
        incomplete: "bg-amber-50 text-amber-700",
        absent: "bg-rose-50 text-rose-700",
      };

  return cn(base, strong[status] || "bg-slate-100 text-slate-600");
};

function AttendanceReview() {
  const [classes, setClasses] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState("");
  const [selectedAcademicClassId, setSelectedAcademicClassId] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [activeRow, setActiveRow] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState("on-time");
  const [overrideNote, setOverrideNote] = useState("");
  const [reviewer, setReviewer] = useState("admin");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);

  const [massModalOpen, setMassModalOpen] = useState(false);
  const [massSubmitting, setMassSubmitting] = useState(false);
  const [massSuccessMsg, setMassSuccessMsg] = useState("");
  const [massOverrideNote, setMassOverrideNote] = useState("Mass override: student consistently does not scan out");
  const [massReviewer, setMassReviewer] = useState("");

  const fetchAcademicYears = useCallback(async () => {
    try {
      const response = await api.get("/api/academic-masters/academic-years");
      setAcademicYears(response.data || []);
      const defaultYear = response.data.find(y => y.is_default) || response.data[0];
      if (defaultYear) {
        setSelectedAcademicYearId(defaultYear.id);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load academic years.");
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    if (!selectedAcademicYearId) return;
    setLoadingClasses(true);
    try {
      const response = await api.get("/api/review/classes", {
        params: { academic_year_id: selectedAcademicYearId }
      });
      setClasses(response.data.classes || []);
      if (response.data.classes?.length > 0) {
        setSelectedAcademicClassId(response.data.classes[0].id);
      } else {
        setSelectedAcademicClassId("");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load classes.");
    } finally {
      setLoadingClasses(false);
    }
  }, [selectedAcademicYearId]);

  const loadAttendance = useCallback(async () => {
    if (!selectedDate || !selectedAcademicYearId || !selectedAcademicClassId) {
      return;
    }

    setLoadingRows(true);
    setError("");
    try {
      const response = await api.get("/api/review/attendance", {
        params: {
          date: selectedDate,
          academic_year_id: selectedAcademicYearId,
          academic_class_id: selectedAcademicClassId,
        },
      });
      setRows(response.data.items || []);
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.detail || "Failed to load attendance records.");
    } finally {
      setLoadingRows(false);
    }
  }, [selectedDate, selectedAcademicYearId, selectedAcademicClassId]);

  useEffect(() => {
    fetchAcademicYears();
  }, [fetchAcademicYears]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const openOverrideModal = (row) => {
    setActiveRow(row);
    setOverrideStatus(row.effective_status || row.original_status);
    setOverrideNote(row.override_note || "");
    setReviewer(row.reviewed_by || "admin");
    setModalOpen(true);
  };

  const closeOverrideModal = () => {
    setModalOpen(false);
    setActiveRow(null);
    setOverrideNote("");
  };

  const submitOverride = async () => {
    if (!activeRow) return;

    const trimmed = overrideNote.trim();
    if (trimmed.length < 5) {
      setError("Override note must be at least 5 characters.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.post(`/api/review/attendance/${activeRow.attendance_id}/override`, {
        override_status: overrideStatus,
        note: trimmed,
        reviewed_by: reviewer.trim() || "admin",
      });
      closeOverrideModal();
      await loadAttendance();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to submit override.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitMassOverride = async () => {
    const trimmedNote = massOverrideNote.trim();
    if (trimmedNote.length < 5) {
      setError("Override note must be at least 5 characters.");
      return;
    }
    const trimmedReviewer = massReviewer.trim();
    if (!trimmedReviewer) {
      setError("Reviewer is required.");
      return;
    }

    setMassSubmitting(true);
    setError("");
    setMassSuccessMsg("");

    try {
      const response = await api.post("/api/review/attendance/mass-override-incomplete", {
        override_status: "on-time",
        note: trimmedNote,
        reviewed_by: trimmedReviewer,
        role: "admin",
      });

      const { overridden } = response.data;
      setMassSuccessMsg(`✅ ${overridden} records overridden to on-time by ${trimmedReviewer}`);
      setMassModalOpen(false);
      setMassReviewer(""); 
      setMassOverrideNote("Mass override: student consistently does not scan out");
      await loadAttendance();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to submit mass override.");
    } finally {
      setMassSubmitting(false);
    }
  };

  const openHistoryDrawer = async (row) => {
    setActiveRow(row);
    setHistoryOpen(true);
    setHistoryItems([]);
    setHistoryLoading(true);
    setError("");
    try {
      const response = await api.get(`/api/review/attendance/${row.attendance_id}/history`);
      setHistoryItems(response.data.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load override history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const tableSummary = useMemo(() => {
    let overridden = 0;
    rows.forEach((row) => {
      if (row.override_status) overridden += 1;
    });

    return {
      total: rows.length,
      overridden,
    };
  }, [rows]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Attendance Manual Review</h1>
          <p className="text-slate-500 mt-1">Inspect imported attendance and apply audited manual overrides without mutating raw data.</p>
        </div>
        
        {/* Mass Override Button is always visible since it's global */}
        <div className="flex flex-col items-end shrink-0">
          <button
            onClick={() => setMassModalOpen(true)}
            className="px-4 py-2 bg-amber-100/50 hover:bg-amber-100 text-amber-700 hover:text-amber-800 border border-amber-200 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm"
          >
            <AlertTriangle size={18} />
            Mass Override Incomplete → On-time
          </button>
          <p className="text-[11px] font-medium text-slate-400 mt-1.5 uppercase tracking-wide">
            Applies to all incomplete records system-wide
          </p>
        </div>
      </header>

      {massSuccessMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm font-medium flex items-center gap-2">
          <CheckCircle2 size={18} />
          {massSuccessMsg}
        </div>
      ) : null}

      <section className="rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-xl shadow-slate-900/5 p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Academic Year</label>
            <select
              value={selectedAcademicYearId}
              onChange={(e) => {
                setSelectedAcademicYearId(e.target.value);
                setClasses([]);
                setSelectedAcademicClassId("");
              }}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">Select Year...</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label} {year.is_default ? "(Default)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Class</label>
            <select
              value={selectedAcademicClassId}
              onChange={(e) => setSelectedAcademicClassId(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
              disabled={loadingClasses || classes.length === 0}
            >
              {classes.length === 0 ? (
                <option value="">No classes available</option>
              ) : (
                classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div className="lg:col-span-2 flex items-end gap-3">
            <button
              onClick={loadAttendance}
              disabled={loadingRows || loadingClasses}
              className="px-6 py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
            >
              {loadingRows ? <Loader2 size={16} className="animate-spin" /> : null}
              Load
            </button>

            <div className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{tableSummary.total}</span> records • {" "}
              <span className="font-semibold text-brand">{tableSummary.overridden}</span> overridden
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm font-medium">{error}</div>
      ) : null}

      <section className="rounded-2xl bg-white/80 backdrop-blur-xl border border-white/60 shadow-xl shadow-slate-900/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead className="bg-slate-50/70">
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="text-left px-6 py-4">Name</th>
                <th className="text-left px-6 py-4">Scan In</th>
                <th className="text-left px-6 py-4">Scan Out</th>
                <th className="text-left px-6 py-4">Original Status</th>
                <th className="text-left px-6 py-4">Effective Status</th>
                <th className="text-right px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.attendance_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">{row.student_name}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{row.scan_in || "—"}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{row.scan_out || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={getStatusBadgeClass(row.original_status)}>{row.original_status}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={getStatusBadgeClass(row.effective_status, true)}>{row.effective_status}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openOverrideModal(row)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors text-xs font-bold"
                      >
                        <Edit3 size={14} />
                        Override
                      </button>
                      <button
                        type="button"
                        onClick={() => openHistoryDrawer(row)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors text-xs font-bold"
                      >
                        <History size={14} />
                        History
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loadingRows && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                    No attendance rows found for selected date/class.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen && activeRow ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={closeOverrideModal} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Override Attendance Status</h2>
                <p className="text-sm text-slate-500 mt-1">{activeRow.student_name} • {selectedDate}</p>
              </div>
              <button className="text-slate-400 hover:text-slate-700" onClick={closeOverrideModal}>
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-500 uppercase">Original</p>
                <span className={cn("mt-2", getStatusBadgeClass(activeRow.original_status))}>{activeRow.original_status}</span>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-500 uppercase">Current Effective</p>
                <span className={cn("mt-2", getStatusBadgeClass(activeRow.effective_status, true))}>{activeRow.effective_status}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">New Status</label>
              <select
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Reviewer</label>
              <input
                type="text"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="e.g. admin"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Justification Note (min. 5 chars)</label>
              <textarea
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                rows={4}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder="Explain why this override is necessary..."
              />
              <p className={cn("text-xs", overrideNote.trim().length >= 5 ? "text-emerald-600" : "text-amber-600")}>
                {overrideNote.trim().length >= 5
                  ? "Note validation passed"
                  : "Please enter at least 5 meaningful characters"}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeOverrideModal}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitOverride}
                disabled={submitting || overrideNote.trim().length < 5}
                className="px-5 py-2 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                Save Override
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {massModalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMassModalOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-amber-500" size={24} />
                <h2 className="text-xl font-bold text-slate-900">Mass Override: Incomplete → On-time</h2>
              </div>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setMassModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-2">
              <p>
                <strong>⚠️ Warning:</strong> This will override <strong>ALL</strong> incomplete attendance records across <strong>ALL</strong> students and <strong>ALL</strong> dates where a valid scan-in exists.
              </p>
              <p>
                This action is logged in the audit trail and can be reviewed per student.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Reviewed by (Admin)</label>
              <input
                type="text"
                value={massReviewer}
                onChange={(e) => setMassReviewer(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300/30 focus:border-amber-400"
                placeholder="e.g. admin"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Justification Note</label>
              <textarea
                value={massOverrideNote}
                onChange={(e) => setMassOverrideNote(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300/30 focus:border-amber-400"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMassModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitMassOverride}
                disabled={massSubmitting || !massReviewer.trim()}
                className="px-5 py-2 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {massSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                {massSubmitting ? "Overriding..." : "Confirm Override"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={cn(
        "fixed inset-y-0 right-0 z-[80] w-full max-w-md bg-white shadow-2xl border-l border-slate-200 transition-transform duration-200 ease-out",
        historyOpen ? "translate-x-0" : "translate-x-full"
      )}
      style={{ willChange: "transform" }}
      >
        <div className="h-full flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Override History</h3>
              <p className="text-xs text-slate-500 mt-1">{activeRow?.student_name || "Attendance record"}</p>
            </div>
            <button className="text-slate-400 hover:text-slate-700" onClick={() => setHistoryOpen(false)}>
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/70">
            {historyLoading ? (
              <div className="text-sm text-slate-500 inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Loading history...
              </div>
            ) : historyItems.length === 0 ? (
              <p className="text-sm text-slate-500">No override history available.</p>
            ) : (
              historyItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-white border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className={getStatusBadgeClass(item.new_status, true)}>{item.new_status}</span>
                    <span className="text-[11px] font-medium text-slate-500">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Previous: <span className="font-semibold text-slate-700">{item.previous_status || "none"}</span>
                  </p>
                  <p className="text-sm text-slate-700">{item.note}</p>
                  <p className="text-xs text-slate-500">Reviewed by {item.reviewed_by}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 bg-slate-900/30 z-[75]" onClick={() => setHistoryOpen(false)} />
      ) : null}
    </div>
  );
}

export default AttendanceReview;
