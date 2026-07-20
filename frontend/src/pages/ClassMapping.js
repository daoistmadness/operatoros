import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Users,
  GraduationCap,
  CheckCircle2,
  AlertTriangle,
  X,
  UserPlus,
} from "lucide-react";


import api from "../api";
import { getPageApiError } from "../lib/api/errors";
import { cn } from "../lib/cn";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";

const JENJANG_OPTIONS = ["Primary", "Secondary", "Kiddy", "Kindergarten"];

function ClassMapping() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [jenjangFilter, setJenjangFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("unassigned");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [selectedStudents, setSelectedStudents] = useState({});
  const [bulkJenjang, setBulkJenjang] = useState("");
  const [bulkClassName, setBulkClassName] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentJenjang, setStudentJenjang] = useState("");
  const [studentClassName, setStudentClassName] = useState("");
  const [addStudentError, setAddStudentError] = useState("");
  const [addStudentSuccess, setAddStudentSuccess] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);

  const fetchClasses = useCallback(async () => {
    try {
      const response = await api.get("/api/students/classes");
      setClasses(Array.isArray(response.data) ? response.data : []);
    } catch (_error) {
      setClasses([]);
    }
  }, []);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = {
        page,
        page_size: pageSize,
      };

      if (search.trim()) {
        params.search = search.trim();
      }
      if (jenjangFilter !== "all") {
        params.jenjang = jenjangFilter;
      }
      if (classFilter !== "all") {
        params.class_name = classFilter;
      }

      const response = await api.get("/api/students", { params });
      setStudents(response.data?.students || []);
      setTotal(response.data?.total || 0);
      setTotalPages(response.data?.total_pages || 0);
    } catch (fetchError) {
      setError(getPageApiError(fetchError, "Failed to load students."));
      setStudents([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, jenjangFilter, classFilter]);

  const handleCreateStudent = async (e) => {
    e.preventDefault();
    if (!studentName.trim()) {
      setAddStudentError("Student name is required.");
      return;
    }

    setAddingStudent(true);
    setAddStudentError("");
    setAddStudentSuccess("");

    try {
      const payload = {
        name: studentName.trim(),
        jenjang: studentJenjang ? studentJenjang : null,
        class_name: studentClassName.trim() ? studentClassName.trim() : null,
      };

      if (studentId.trim()) {
        const idInt = parseInt(studentId.trim(), 10);
        if (isNaN(idInt) || idInt <= 0) {
          setAddStudentError("Student ID must be a positive integer.");
          setAddingStudent(false);
          return;
        }
        payload.id = idInt;
      }

      await api.post("/api/students", payload);
      setAddStudentSuccess("Student created successfully!");
      setStudentId("");
      setStudentName("");
      setStudentJenjang("");
      setStudentClassName("");
      setPage(1);
      setTimeout(() => {
        setShowAddModal(false);
        setAddStudentSuccess("");
        fetchStudents();
        fetchClasses();
      }, 1000);
    } catch (saveError) {
      setAddStudentError(saveError.response?.data?.detail || "Failed to create student.");
    } finally {
      setAddingStudent(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const selectedIdsOnPage = useMemo(
    () => students.map((student) => student.id).filter((id) => selectedStudents[id]),
    [students, selectedStudents]
  );

  const allOnPageSelected = students.length > 0 && selectedIdsOnPage.length === students.length;

  const selectedList = useMemo(
    () => Object.values(selectedStudents).sort((a, b) => a.name.localeCompare(b.name)),
    [selectedStudents]
  );

  const handleToggleStudent = useCallback((student) => {
    setSelectedStudents((prev) => {
      if (prev[student.id]) {
        const next = { ...prev };
        delete next[student.id];
        return next;
      }
      return {
        ...prev,
        [student.id]: {
          id: student.id,
          name: student.name,
        },
      };
    });
  }, []);

  const handleToggleSelectAllPage = useCallback(() => {
    setSelectedStudents((prev) => {
      const next = { ...prev };

      if (allOnPageSelected) {
        students.forEach((student) => {
          delete next[student.id];
        });
      } else {
        students.forEach((student) => {
          next[student.id] = {
            id: student.id,
            name: student.name,
          };
        });
      }

      return next;
    });
  }, [allOnPageSelected, students]);

  const resetToFirstPage = useCallback(() => {
    setPage(1);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedStudents({});
  }, []);

  const handleUnselectStudent = useCallback((id) => {
    setSelectedStudents((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);


  const handleAssignClass = useCallback(async () => {
    if (selectedList.length === 0) {
      return;
    }

    const className = bulkClassName.trim();
    const jenjang = bulkJenjang.trim();

    if (!className || !jenjang) {
      return;
    }

    setAssigning(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await api.patch("/api/students/assign-class", {
        student_ids: selectedList.map((student) => student.id),
        class_name: className,
        jenjang,
      });

      const updated = response.data?.updated ?? selectedList.length;
      setSuccessMessage(`${updated} students assigned to ${jenjang} - ${className}`);
      setSelectedStudents({});
      setBulkJenjang("");
      setBulkClassName("");
      setPage(1);
      await Promise.all([fetchStudents(), fetchClasses()]);
    } catch (assignError) {
      setError(assignError.response?.data?.detail || "Failed to assign class in bulk.");
    } finally {
      setAssigning(false);
    }
  }, [selectedList, bulkClassName, bulkJenjang, fetchStudents, fetchClasses]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Class Mapping</h1>
          <p className="text-slate-500 mt-1">Bulk assign jenjang and class to imported students.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddStudentError("");
            setAddStudentSuccess("");
            setStudentId("");
            setStudentName("");
            setStudentJenjang("");
            setStudentClassName("");
            setShowAddModal(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover transition-colors inline-flex items-center gap-2 self-start sm:self-auto shadow-sm"
        >
          <UserPlus size={16} />
          Add Manual Student
        </button>
      </header>

      {successMessage && (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3 text-emerald-800">
          <CheckCircle2 size={20} />
          <p className="font-medium">{successMessage}</p>
        </Card>
      )}

      {error && (
        <Card className="rounded-2xl border-rose-200 bg-rose-50 p-4 flex items-center gap-3 text-rose-800">
          <AlertTriangle size={20} />
          <p className="font-medium">{error}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <Card className="rounded-2xl xl:col-span-2 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative md:col-span-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  resetToFirstPage();
                }}
                placeholder="Search student name"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>

            <select
              value={jenjangFilter}
              onChange={(event) => {
                setJenjangFilter(event.target.value);
                resetToFirstPage();
              }}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="all">All Jenjang</option>
              {JENJANG_OPTIONS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>

            <select
              value={classFilter}
              onChange={(event) => {
                setClassFilter(event.target.value);
                resetToFirstPage();
              }}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="all">All Classes</option>
              <option value="unassigned">Unassigned</option>
              {classes.map((className) => (
                <option key={className} value={className}>{className}</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={handleToggleSelectAllPage}
                  className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                Select all on this page
              </label>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{total} students</span>
            </div>

            <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-slate-500">Loading students...</div>
              ) : students.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No students found for current filters.</div>
              ) : (
                students.map((student) => {
                  const selected = Boolean(selectedStudents[student.id]);
                  const assigned = Boolean(student.class_name);

                  return (
                    <label
                      key={student.id}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                        selected ? "bg-brand/5" : "hover:bg-slate-50",
                        assigned ? "text-slate-600" : "text-slate-900"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => handleToggleStudent(student)}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                      />

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/attendance/students/${student.id}`);
                            }}
                            className="hover:text-brand hover:underline transition-colors text-left"
                          >
                            {student.name}
                          </button>
                        </p>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                          <span>Jenjang: {student.jenjang || "—"}</span>
                          <span>Class: {student.class_name || "—"}</span>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <ChevronLeft size={16} /> Prev
            </button>

            <p className="text-sm font-semibold text-slate-600">
              Page {page} of {totalPages || 1}
            </p>

            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages || 1, prev + 1))}
              disabled={page >= (totalPages || 1)}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </Card>

        <Card className="rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <CheckSquare size={20} className="text-brand" />
                Assign Class
              </h3>
              <p className="text-sm text-slate-500 mt-1">{selectedList.length} students selected</p>
            </div>
            {selectedList.length > 0 && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg transition-colors capitalize"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-2 max-h-48 overflow-y-auto custom-scrollbar shadow-inner shadow-slate-100">
            {selectedList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-100">
                <Users size={24} className="text-slate-300 mb-2" />
                <p className="text-xs font-medium text-slate-400">Select students from the left panel to begin mapping.</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {selectedList.map((student) => (
                  <li 
                    key={student.id} 
                    className="group flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-[9999px] bg-brand/40" />
                      <span className="text-sm font-semibold text-slate-700 truncate">{student.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnselectStudent(student.id)}
                      className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>


          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Jenjang</label>
            <div className="grid grid-cols-2 gap-2">
              {JENJANG_OPTIONS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setBulkJenjang(level)}
                  className={cn(
                    "px-3 py-2 rounded-xl border text-sm font-semibold transition-colors",
                    bulkJenjang === level
                      ? "bg-brand text-white border-brand"
                      : "bg-white text-slate-700 border-slate-200 hover:border-brand/40 hover:bg-brand/5"
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Class Name</label>
            <div className="relative">
              <GraduationCap size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={bulkClassName}
                onChange={(event) => setBulkClassName(event.target.value)}
                placeholder="e.g. 7-A, P1A"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
            {classes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {classes.map((className) => (
                  <button
                    key={className}
                    type="button"
                    onClick={() => setBulkClassName(className)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 hover:bg-brand/5 hover:border-brand/40"
                  >
                    {className}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleAssignClass}
            disabled={assigning || selectedList.length === 0 || !bulkJenjang || !bulkClassName.trim()}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Users size={16} />
            {assigning ? "Assigning..." : "Assign Class"}
          </button>
        </Card>
      </div>

      <Dialog open={showAddModal} onOpenChange={(open) => { if (!open && !addingStudent) setShowAddModal(false); }}>
          <DialogContent showClose={false} className="max-w-md overflow-hidden p-0">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus size={20} className="text-brand" />
                  Add Manual Student
                </DialogTitle>
                <DialogDescription>Create a student in the master student pool</DialogDescription>
              </div>
              <button
                type="button"
                aria-label="Close add student dialog"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleCreateStudent} className="p-6 space-y-4">
              {addStudentError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0" />
                  <p className="font-semibold">{addStudentError}</p>
                </div>
              )}

              {addStudentSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={14} className="flex-shrink-0" />
                  <p className="font-semibold">{addStudentSuccess}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Student ID / No. ID (Optional)</label>
                <input
                  type="number"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="e.g. 900001 (auto-generated if empty)"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Name *</label>
                <input
                  type="text"
                  required
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="e.g. Manual Student Name"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Jenjang</label>
                <select
                  value={studentJenjang}
                  onChange={(e) => setStudentJenjang(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30 text-sm"
                >
                  <option value="">Select Jenjang</option>
                  {JENJANG_OPTIONS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Source Class / Class Name</label>
                <input
                  type="text"
                  value={studentClassName}
                  onChange={(e) => setStudentClassName(e.target.value)}
                  placeholder="e.g. P1A"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={addingStudent}
                  className="px-4 py-2 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingStudent || !studentName.trim()}
                  className="px-4 py-2 bg-brand text-white hover:bg-brand-hover font-bold rounded-xl text-sm transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  {addingStudent ? "Saving..." : "Save Student"}
                </button>
              </div>
            </form>
          </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClassMapping;
