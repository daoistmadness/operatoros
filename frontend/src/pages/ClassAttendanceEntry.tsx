import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Save,
  CheckCheck,
  Lock,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  fetchAssignedClasses,
  fetchClassAttendanceForDate,
  submitClassAttendanceEntries,
  type AssignedClassSummary,
  type ClassDateAttendanceResponse,
  type StudentRosterItem,
  type AttendanceEntryPayload,
} from "../api/teacherClassAssignments";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { FieldLabel } from "../components/ui/field";

type AttendanceStatus = "on-time" | "late" | "sick" | "leave" | "absent";

interface RosterFormState {
  [studentId: number]: {
    status: AttendanceStatus;
    checkIn: string;
    checkOut: string;
    note: string;
  };
}

const STATUS_CONFIG: Record<
  AttendanceStatus,
  { label: string; bg: string; text: string; border: string; activeBg: string }
> = {
  "on-time": {
    label: "Hadir",
    bg: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    text: "text-emerald-700",
    border: "border-emerald-200",
    activeBg: "bg-emerald-600 text-white border-emerald-600",
  },
  late: {
    label: "Terlambat",
    bg: "bg-orange-50 text-orange-700 hover:bg-orange-100",
    text: "text-orange-700",
    border: "border-orange-200",
    activeBg: "bg-orange-600 text-white border-orange-600",
  },
  sick: {
    label: "Sakit",
    bg: "bg-blue-50 text-blue-700 hover:bg-blue-100",
    text: "text-blue-700",
    border: "border-blue-200",
    activeBg: "bg-blue-600 text-white border-blue-600",
  },
  leave: {
    label: "Izin",
    bg: "bg-amber-50 text-amber-700 hover:bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-200",
    activeBg: "bg-amber-600 text-white border-amber-600",
  },
  absent: {
    label: "Alfa",
    bg: "bg-rose-50 text-rose-700 hover:bg-rose-100",
    text: "text-rose-700",
    border: "border-rose-200",
    activeBg: "bg-rose-600 text-white border-rose-600",
  },
};

export default function ClassAttendanceEntry() {
  const queryClient = useQueryClient();

  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [formState, setFormState] = useState<RosterFormState>({});
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Assigned classes query
  const { data: assignedClasses = [], isLoading: loadingClasses } = useQuery<AssignedClassSummary[]>({
    queryKey: ["assignedClasses"],
    queryFn: fetchAssignedClasses,
  });

  // Auto-select first class when loaded
  useEffect(() => {
    if (assignedClasses.length > 0 && !selectedClassId) {
      setSelectedClassId(String(assignedClasses[0].id));
    }
  }, [assignedClasses, selectedClassId]);

  // Roster query for selected class and date
  const classIdNum = selectedClassId ? Number(selectedClassId) : null;
  const {
    data: rosterData,
    isLoading: loadingRoster,
    error: rosterError,
    refetch: refetchRoster,
  } = useQuery<ClassDateAttendanceResponse>({
    queryKey: ["classAttendanceRoster", classIdNum, selectedDate],
    queryFn: () => fetchClassAttendanceForDate(classIdNum!, selectedDate),
    enabled: !!classIdNum && !!selectedDate,
  });

  // Initialize form state when roster loaded
  useEffect(() => {
    if (rosterData?.items) {
      const initial: RosterFormState = {};
      rosterData.items.forEach((st) => {
        initial[st.student_id] = {
          status: (st.status as AttendanceStatus) || "on-time",
          checkIn: st.check_in || "",
          checkOut: st.check_out || "",
          note: st.note || "",
        };
      });
      setFormState(initial);
      setIsDirty(false);
    }
  }, [rosterData]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: (entries: AttendanceEntryPayload[]) =>
      submitClassAttendanceEntries(classIdNum!, selectedDate, entries),
    onSuccess: (res) => {
      setSaveSuccess(`Berhasil menyimpan ${res.total_submitted} data absensi.`);
      setSaveError(null);
      setIsDirty(false);
      refetchRoster();
      setTimeout(() => setSaveSuccess(null), 4000);
    },
    onError: (err: any) => {
      const msg = err?.detail?.message || err?.message || "Gagal menyimpan absensi kelas.";
      setSaveError(msg);
      setSaveSuccess(null);
    },
  });

  const handleStatusChange = (studentId: number, status: AttendanceStatus) => {
    if (rosterData?.is_finalized) return;
    setFormState((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { checkIn: "", checkOut: "", note: "" }),
        status,
      },
    }));
    setIsDirty(true);
  };

  const handleInputChange = (studentId: number, field: "checkIn" | "checkOut" | "note", val: string) => {
    if (rosterData?.is_finalized) return;
    setFormState((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { status: "on-time" }),
        [field]: val,
      },
    }));
    setIsDirty(true);
  };

  const handleMarkAllOnTime = () => {
    if (rosterData?.is_finalized || !rosterData?.items) return;
    const updated: RosterFormState = { ...formState };
    rosterData.items.forEach((st) => {
      updated[st.student_id] = {
        ...(updated[st.student_id] || { checkIn: "", checkOut: "", note: "" }),
        status: "on-time",
      };
    });
    setFormState(updated);
    setIsDirty(true);
  };

  const handleSave = () => {
    if (!classIdNum || !selectedDate || !rosterData) return;
    const entries: AttendanceEntryPayload[] = Object.entries(formState).map(([sId, state]) => ({
      student_id: Number(sId),
      status: state.status,
      check_in: state.checkIn || undefined,
      check_out: state.checkOut || undefined,
      note: state.note || undefined,
    }));

    submitMutation.mutate(entries);
  };

  const isFinalized = rosterData?.is_finalized ?? false;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <CalendarDays className="h-7 w-7 text-indigo-600" />
            Input Absensi Kelas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pencatatan absensi harian siswa untuk kelas terdaftar dalam wewenang penugasan guru.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchRoster()}
            className="gap-2"
            disabled={loadingRoster}
          >
            <RefreshCw className={`h-4 w-4 ${loadingRoster ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isFinalized || submitMutation.isPending || !classIdNum}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
          >
            <Save className="h-4 w-4" />
            {submitMutation.isPending ? "Menyimpan..." : "Simpan Absensi"}
          </Button>
        </div>
      </div>

      {/* Class & Date Selector Header Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel className="text-xs font-semibold text-slate-700 mb-1">Kelas Terdaftar</FieldLabel>
            {loadingClasses ? (
              <div className="text-xs text-slate-400">Memuat kelas terdaftar...</div>
            ) : assignedClasses.length === 0 ? (
              <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 border border-amber-200 flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0" />
                Anda belum ditugaskan ke kelas manapun. Hubungi administrator.
              </div>
            ) : (
              <NativeSelect
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="text-sm font-semibold text-slate-800"
              >
                {assignedClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.class_name} ({cls.class_role === "HOMEROOM_TEACHER" ? "Wali Kelas" : `Guru Mapel: ${cls.subject_name || '-'}`})
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>

          <div>
            <FieldLabel className="text-xs font-semibold text-slate-700 mb-1">Tanggal Absensi</FieldLabel>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm font-semibold text-slate-800"
            />
          </div>
        </div>

        {/* Finalized Banner */}
        {isFinalized && (
          <div className="rounded-lg bg-amber-50 p-3 border border-amber-200 text-amber-800 flex items-center gap-2 text-xs font-medium">
            <Lock className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              Tanggal ini telah <strong>DIFINALISASI</strong> oleh administrator. Data absensi dikunci untuk perubahan langsung. Silakan ajukan koreksi jika terdapat kekeliruan.
            </span>
          </div>
        )}

        {/* Success/Error Alerts */}
        {saveSuccess && (
          <div className="rounded-lg bg-emerald-50 p-3 border border-emerald-200 text-emerald-800 flex items-center gap-2 text-xs font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{saveSuccess}</span>
          </div>
        )}
        {saveError && (
          <div className="rounded-lg bg-rose-50 p-3 border border-rose-200 text-rose-800 flex items-center gap-2 text-xs font-medium">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      {/* Roster Section */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-800">
              Daftar Siswa ({rosterData?.items?.length || 0})
            </span>
          </div>
          {!isFinalized && rosterData?.items && rosterData.items.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllOnTime}
              className="text-xs gap-1.5 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tandai Semua Hadir
            </Button>
          )}
        </div>

        {loadingRoster ? (
          <div className="p-8 text-center text-slate-500 text-sm">Memuat daftar siswa kelas...</div>
        ) : rosterError ? (
          <div className="p-8 text-center text-rose-600 text-sm">
            Gagal memuat data absensi. Pastikan Anda memiliki penugasan aktif untuk kelas ini.
          </div>
        ) : !rosterData?.items || rosterData.items.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            Tidak ada siswa aktif terdaftar pada kelas dan tanggal ini.
          </div>
        ) : (
          <div>
            {/* Desktop Table View (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-12">No</th>
                    <th className="px-4 py-3 min-w-[200px]">Nama Siswa</th>
                    <th className="px-4 py-3 min-w-[320px]">Status Absensi</th>
                    <th className="px-4 py-3 w-28">Scan Masuk</th>
                    <th className="px-4 py-3 w-28">Scan Pulang</th>
                    <th className="px-4 py-3 min-w-[150px]">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rosterData.items.map((st, idx) => {
                    const currentState = formState[st.student_id] || {
                      status: "on-time",
                      checkIn: "",
                      checkOut: "",
                      note: "",
                    };

                    return (
                      <tr key={st.student_id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div>{st.full_name}</div>
                          {st.nisn && <div className="text-xs font-normal text-slate-400">NISN: {st.nisn}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {(["on-time", "late", "sick", "leave", "absent"] as AttendanceStatus[]).map((stKey) => {
                              const cfg = STATUS_CONFIG[stKey];
                              const isSelected = currentState.status === stKey;

                              return (
                                <button
                                  key={stKey}
                                  type="button"
                                  disabled={isFinalized}
                                  onClick={() => handleStatusChange(st.student_id, stKey)}
                                  className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-all ${
                                    isSelected ? cfg.activeBg : `${cfg.bg} ${cfg.border}`
                                  } ${isFinalized ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                                >
                                  {cfg.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="time"
                            disabled={isFinalized}
                            value={currentState.checkIn}
                            onChange={(e) => handleInputChange(st.student_id, "checkIn", e.target.value)}
                            className="text-xs h-8"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="time"
                            disabled={isFinalized}
                            value={currentState.checkOut}
                            onChange={(e) => handleInputChange(st.student_id, "checkOut", e.target.value)}
                            className="text-xs h-8"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="text"
                            placeholder="Catatan..."
                            disabled={isFinalized}
                            value={currentState.note}
                            onChange={(e) => handleInputChange(st.student_id, "note", e.target.value)}
                            className="text-xs h-8"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View (< 768px / 390px) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {rosterData.items.map((st, idx) => {
                const currentState = formState[st.student_id] || {
                  status: "on-time",
                  checkIn: "",
                  checkOut: "",
                  note: "",
                };

                return (
                  <div key={st.student_id} className="p-4 space-y-3 bg-white">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                      <span className="text-xs text-slate-400 font-mono">{st.nisn ? `NISN: ${st.nisn}` : ""}</span>
                    </div>

                    <div className="font-semibold text-slate-900 text-sm">{st.full_name}</div>

                    {/* Status Button Grid */}
                    <div className="grid grid-cols-5 gap-1">
                      {(["on-time", "late", "sick", "leave", "absent"] as AttendanceStatus[]).map((stKey) => {
                        const cfg = STATUS_CONFIG[stKey];
                        const isSelected = currentState.status === stKey;

                        return (
                          <button
                            key={stKey}
                            type="button"
                            disabled={isFinalized}
                            onClick={() => handleStatusChange(st.student_id, stKey)}
                            className={`py-1.5 text-center text-xs font-bold rounded-md border transition-all ${
                              isSelected ? cfg.activeBg : `${cfg.bg} ${cfg.border}`
                            } ${isFinalized ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Time & Note Inputs */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <FieldLabel className="text-[10px] text-slate-500 mb-0.5">Masuk</FieldLabel>
                        <Input
                          type="time"
                          disabled={isFinalized}
                          value={currentState.checkIn}
                          onChange={(e) => handleInputChange(st.student_id, "checkIn", e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      <div>
                        <FieldLabel className="text-[10px] text-slate-500 mb-0.5">Pulang</FieldLabel>
                        <Input
                          type="time"
                          disabled={isFinalized}
                          value={currentState.checkOut}
                          onChange={(e) => handleInputChange(st.student_id, "checkOut", e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Floating Mobile Save Bar */}
      {isDirty && !isFinalized && (
        <div className="fixed bottom-4 left-4 right-4 z-40 md:hidden bg-slate-900/90 backdrop-blur-md text-white p-3 rounded-xl shadow-2xl flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Perubahan belum disimpan</span>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={submitMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
          >
            {submitMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      )}
    </div>
  );
}
