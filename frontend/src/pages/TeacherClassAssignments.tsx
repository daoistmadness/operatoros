import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCheck,
  Plus,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserX,
  BookOpen,
  Calendar,
  Layers,
} from "lucide-react";
import { apiRequest } from "../lib/api/client";
import {
  fetchTeacherClassAssignments,
  createTeacherClassAssignment,
  deactivateTeacherClassAssignment,
  reactivateTeacherClassAssignment,
  type TeacherClassAssignment,
  type TeacherClassAssignmentCreatePayload,
} from "../api/teacherClassAssignments";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { FormField, FieldLabel } from "../components/ui/field";

interface UserOption {
  id: number;
  username: string;
  full_name?: string | null;
  role: string;
}

interface AcademicYearOption {
  id: number;
  label: string;
  status: string;
}

interface AcademicClassOption {
  id: number;
  class_name: string;
  academic_year_id: number;
  active: boolean;
}

interface SubjectOption {
  id: number;
  name: string;
}

export default function TeacherClassAssignments() {
  const queryClient = useQueryClient();
  const [filterYearId, setFilterYearId] = useState<string>("");
  const [filterClassId, setFilterClassId] = useState<string>("");
  const [filterActiveOnly, setFilterActiveOnly] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [userId, setUserId] = useState<string>("");
  const [academicYearId, setAcademicYearId] = useState<string>("");
  const [academicClassId, setAcademicClassId] = useState<string>("");
  const [classRole, setClassRole] = useState<"HOMEROOM_TEACHER" | "SUBJECT_TEACHER">("HOMEROOM_TEACHER");
  const [subjectId, setSubjectId] = useState<string>("");
  const [effectiveFrom, setEffectiveFrom] = useState<string>("");
  const [effectiveTo, setEffectiveTo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Queries
  const { data: assignments = [], isLoading, error, refetch } = useQuery<TeacherClassAssignment[]>({
    queryKey: ["teacherClassAssignments", filterYearId, filterClassId, filterActiveOnly],
    queryFn: () =>
      fetchTeacherClassAssignments({
        academic_year_id: filterYearId ? Number(filterYearId) : undefined,
        academic_class_id: filterClassId ? Number(filterClassId) : undefined,
        is_active: filterActiveOnly ? true : undefined,
      }),
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ["usersOptions"],
    queryFn: async () => {
      try {
        const res = await apiRequest({ path: "/api/users" });
        return Array.isArray(res.data) ? res.data : res.data?.items || [];
      } catch {
        return [];
      }
    },
  });

  const { data: academicYears = [] } = useQuery<AcademicYearOption[]>({
    queryKey: ["academicYearsOptions"],
    queryFn: async () => {
      try {
        const res = await apiRequest({ path: "/api/grades/academic-years" });
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
  });

  const { data: academicClasses = [] } = useQuery<AcademicClassOption[]>({
    queryKey: ["academicClassesOptions"],
    queryFn: async () => {
      try {
        const res = await apiRequest({ path: "/api/grades/classes" });
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
  });

  const { data: subjects = [] } = useQuery<SubjectOption[]>({
    queryKey: ["subjectsOptions"],
    queryFn: async () => {
      try {
        const res = await apiRequest({ path: "/api/grades/subjects" });
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload: TeacherClassAssignmentCreatePayload) => createTeacherClassAssignment(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacherClassAssignments"] });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      const msg = err?.detail?.message || err?.message || "Gagal membuat penugasan guru.";
      setFormError(msg);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateTeacherClassAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacherClassAssignments"] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: number) => reactivateTeacherClassAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacherClassAssignments"] });
    },
  });

  const resetForm = () => {
    setUserId("");
    setAcademicYearId("");
    setAcademicClassId("");
    setClassRole("HOMEROOM_TEACHER");
    setSubjectId("");
    setEffectiveFrom("");
    setEffectiveTo("");
    setNotes("");
    setFormError(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!userId || !academicYearId || !academicClassId || !effectiveFrom) {
      setFormError("Guru, Tahun Ajaran, Kelas, dan Tanggal Efektif Mulai wajib diisi.");
      return;
    }

    if (classRole === "SUBJECT_TEACHER" && !subjectId) {
      setFormError("Mata pelajaran wajib dipilih untuk Guru Mata Pelajaran.");
      return;
    }

    createMutation.mutate({
      user_id: Number(userId),
      academic_year_id: Number(academicYearId),
      academic_class_id: Number(academicClassId),
      class_role: classRole,
      subject_id: subjectId ? Number(subjectId) : undefined,
      effective_from: effectiveFrom,
      effective_to: effectiveTo || undefined,
      notes: notes || undefined,
    });
  };

  const filteredAssignments = assignments.filter((item) => {
    if (!searchQuery) return true;
    const term = searchQuery.toLowerCase();
    return (
      (item.full_name && item.full_name.toLowerCase().includes(term)) ||
      (item.username && item.username.toLowerCase().includes(term)) ||
      (item.class_name && item.class_name.toLowerCase().includes(term)) ||
      (item.subject_name && item.subject_name.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <UserCheck className="h-7 w-7 text-indigo-600" />
            Penugasan Guru & Kelas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Kelola penugasan wali kelas dan guru mata pelajaran untuk pembatasan hak akses absensi berbasis kelas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="h-4 w-4" />
            Tambah Penugasan
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <FieldLabel className="text-xs font-semibold text-slate-600 mb-1">Cari Guru / Kelas</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Cari nama guru, kelas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>

          <div>
            <FieldLabel className="text-xs font-semibold text-slate-600 mb-1">Tahun Ajaran</FieldLabel>
            <NativeSelect
              value={filterYearId}
              onChange={(e) => setFilterYearId(e.target.value)}
              className="text-sm"
            >
              <option value="">Semua Tahun Ajaran</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label} ({y.status})
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <FieldLabel className="text-xs font-semibold text-slate-600 mb-1">Kelas</FieldLabel>
            <NativeSelect
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="text-sm"
            >
              <option value="">Semua Kelas</option>
              {academicClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.class_name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <FieldLabel className="text-xs font-semibold text-slate-600 mb-1">Status Penugasan</FieldLabel>
            <NativeSelect
              value={filterActiveOnly ? "true" : "false"}
              onChange={(e) => setFilterActiveOnly(e.target.value === "true")}
              className="text-sm"
            >
              <option value="true">Hanya Aktif</option>
              <option value="false">Semua (Termasuk Non-Aktif)</option>
            </NativeSelect>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Memuat data penugasan...</div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">Gagal memuat data penugasan guru.</div>
        ) : filteredAssignments.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Belum ada penugasan guru yang terdaftar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Guru</th>
                  <th className="px-4 py-3">Tahun Ajaran</th>
                  <th className="px-4 py-3">Kelas</th>
                  <th className="px-4 py-3">Peran Class</th>
                  <th className="px-4 py-3">Mata Pelajaran</th>
                  <th className="px-4 py-3">Periode Efektif</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssignments.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div>{item.full_name || item.username}</div>
                      <div className="text-xs text-slate-400">@{item.username}</div>
                    </td>
                    <td className="px-4 py-3">{item.academic_year_label || item.academic_year_id}</td>
                    <td className="px-4 py-3 font-semibold text-indigo-900">{item.class_name || item.academic_class_id}</td>
                    <td className="px-4 py-3">
                      {item.class_role === "HOMEROOM_TEACHER" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          Wali Kelas
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                          Guru Mapel
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.subject_name || "-"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {item.effective_from} s.d. {item.effective_to || "Seterusnya"}
                    </td>
                    <td className="px-4 py-3">
                      {item.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Aktif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-500">
                          <XCircle className="h-3.5 w-3.5" /> Non-Aktif
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.is_active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => deactivateMutation.mutate(item.id)}
                          disabled={deactivateMutation.isPending}
                        >
                          <UserX className="mr-1 h-3.5 w-3.5" /> Nonaktifkan
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                          onClick={() => reactivateMutation.mutate(item.id)}
                          disabled={reactivateMutation.isPending}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aktifkan
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-indigo-600" />
                Tambah Penugasan Guru
              </h3>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  resetForm();
                }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 flex items-center gap-2 border border-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <FieldLabel className="text-xs font-semibold text-slate-700">Guru</FieldLabel>
                <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)} required>
                  <option value="">Pilih Guru...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.username} (@{u.username})
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">Tahun Ajaran</FieldLabel>
                  <NativeSelect
                    value={academicYearId}
                    onChange={(e) => setAcademicYearId(e.target.value)}
                    required
                  >
                    <option value="">Pilih Tahun...</option>
                    {academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">Kelas</FieldLabel>
                  <NativeSelect
                    value={academicClassId}
                    onChange={(e) => setAcademicClassId(e.target.value)}
                    required
                  >
                    <option value="">Pilih Kelas...</option>
                    {academicClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.class_name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">Peran Guru</FieldLabel>
                  <NativeSelect
                    value={classRole}
                    onChange={(e) => setClassRole(e.target.value as any)}
                  >
                    <option value="HOMEROOM_TEACHER">Wali Kelas</option>
                    <option value="SUBJECT_TEACHER">Guru Mata Pelajaran</option>
                  </NativeSelect>
                </div>

                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">
                    Mata Pelajaran {classRole === "HOMEROOM_TEACHER" && "(Opsional)"}
                  </FieldLabel>
                  <NativeSelect value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                    <option value="">Pilih Mapel...</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">Efektif Mulai</FieldLabel>
                  <Input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <FieldLabel className="text-xs font-semibold text-slate-700">Efektif Sampai (Opsional)</FieldLabel>
                  <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
                </div>
              </div>

              <div>
                <FieldLabel className="text-xs font-semibold text-slate-700">Catatan (Opsional)</FieldLabel>
                <Input
                  placeholder="Catatan penugasan..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    resetForm();
                  }}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Menyimpan..." : "Simpan Penugasan"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
