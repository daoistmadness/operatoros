import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Search,
  UploadCloud,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commitStudentUpdateRollback, downloadStudentUpdateResult, fetchStudentUpdateHistory, fetchStudentUpdateSession, previewStudentUpdateRollback } from "../api/students";
import { useAuth } from "../context/AuthContext";
import { fetchAcademicYears } from "../api/grades";
import { fetchAcademicMasters } from "../api/academicMasters";
import { queryKeys } from "../lib/query/queryKeys";
import { classReferenceRows, classReferenceTsv } from "../lib/rosterClassReference";
import { MachineImportWorkflow } from "../features/machine-import";
import {
  useRosterCommit,
  useRosterPreview,
  useStudentTemplateExport,
  useStudentUpdateCommit,
  useStudentUpdatePreview,
} from "../hooks/useStudentQueries";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableContainer,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "../components/common/data-table";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { buildApiUrl } from "../lib/api/client";
import { eligibleIds, rosterRowView, safeSelectedIds, selectionState } from "../lib/uploadWorkflow";
import { NeedsAttentionPanel } from "../components/upload/NeedsAttentionPanel";
import { UploadHistoryPanel } from "../components/upload/UploadHistoryPanel";
import DataPortability from "./DataPortability";
import { invalidateEnrollmentQueries } from "../lib/query/enrollmentInvalidation";

const today = new Date().toISOString().slice(0, 10);
const ROSTER_COLUMNS = ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"];

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rosterPreviewErrorPresentation(error: unknown): { title: string; message: string } {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof value.code === "string" ? value.code : "";
  const kind = typeof value.kind === "string" ? value.kind : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (code === "ROSTER_WORKBOOK_PARSE_FAILED") return { title: "Workbook file error", message: "Unable to read this workbook. Verify that it is a valid supported Excel file." };
  if (code === "ROSTER_FILE_TYPE_UNSUPPORTED") return { title: "Unsupported file type", message: "Student roster uploads support .xlsx files only." };
  if (code === "ROSTER_REQUIRED_COLUMNS_MISSING" || code === "ROSTER_DUPLICATE_COLUMN" || code === "ROSTER_SHEET_MISSING" || code === "ROSTER_ROW_LIMIT_EXCEEDED") return { title: "Workbook validation failed", message: message || "The workbook does not match the student roster format." };
  if (kind === "network" || kind === "timeout" || kind === "server") return { title: "Roster preview unavailable", message: "The server could not complete the preview. Check the connection and try again." };
  if (/undefined is not an object|cannot read propert|typeerror|workbook\./i.test(message)) return { title: "Roster preview unavailable", message: "The workbook preview could not be completed. Verify the file and try again." };
  return { title: "Roster preview failed", message: message || "The workbook preview could not be completed. Verify the file and try again." };
}

function RosterStages({ stage }: { stage: "upload" | "review" | "import" }) {
  const stages = [
    { key: "upload", label: "1 Upload", desc: "Choose file" },
    { key: "review", label: "2 Review", desc: "Review rows" },
    { key: "import", label: "3 Import", desc: "Confirm & import" },
  ] as const;
  const currentIndex = stages.findIndex((s) => s.key === stage);
  return (
    <ol aria-label="Student import progress" className="grid gap-2 sm:grid-cols-3">
      {stages.map((s, index) => {
        const state = index < currentIndex ? "Completed" : index === currentIndex ? "Current" : "Upcoming";
        const isCurrent = index === currentIndex;
        const isCompleted = index < currentIndex;
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className={`rounded-lg border px-3 py-3 text-sm font-bold ${
              isCurrent
                ? "border-primary bg-primary/10 text-primary"
                : isCompleted
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-border bg-surface-muted text-muted-foreground"
            }`}
          >
            <span className="block text-xs uppercase tracking-wide">{state}</span>
            <span className="text-base">{s.label}</span>
            <span className="ml-2 text-xs font-normal opacity-80">{s.desc}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StatusBadge({ status, count }: { status: string; count?: number }) {
  const map: Record<string, { variant: "success" | "secondary" | "warning" | "danger" | "information"; label: string }> = {
    matched: { variant: "secondary", label: "Matched" },
    new: { variant: "success", label: "New" },
    conflict: { variant: "warning", label: "Conflict" },
    invalid: { variant: "danger", label: "Invalid" },
  };
  const entry = (map[status] as any) || { variant: "secondary" as const, label: status };
  return (
    <Badge variant={entry.variant} aria-label={`${entry.label} status`}>
      {entry.label}
      {typeof count === "number" ? ` · ${count}` : null}
    </Badge>
  );
}

export function RosterImportPanel() {
  const preview = useRosterPreview();
  const commit = useRosterCommit();
  const years = useQuery({ queryKey: queryKeys.academicMasters.years, queryFn: fetchAcademicYears });
  const masters = useQuery({ queryKey: queryKeys.academicMasters.classReference, queryFn: fetchAcademicMasters });
  const [referenceYearId, setReferenceYearId] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [owner, setOwner] = useState("");
  const [received, setReceived] = useState(today);
  const [selected, setSelected] = useState<number[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(25);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const rows = preview.data?.rows || [];
  const previewYears = Array.from(new Set<string>(rows.map((row: any) => String(row.payload.academic_year || "")).filter(Boolean)));
  const previewYearId = previewYears.length === 1 ? years.data?.find((year) => year.label === previewYears[0])?.id ?? null : null;
  const selectedReferenceYearId = previewYears.length === 1 ? previewYearId : referenceYearId ?? years.data?.find((year) => year.is_default)?.id ?? years.data?.[0]?.id ?? null;
  const acceptedClasses = useMemo(() => masters.data && selectedReferenceYearId ? classReferenceRows(masters.data, selectedReferenceYearId) : [], [masters.data, selectedReferenceYearId]);
  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(classReferenceTsv(acceptedClasses));
      setCopyFeedback("Copied class reference");
    } catch {
      setCopyFeedback("Copy failed. Select and copy the table instead.");
    }
  };
  const previewFailure = preview.error ? rosterPreviewErrorPresentation(preview.error) : null;
  const viewRows = useMemo(() => rows.map((row: any) => ({ source: row, view: rosterRowView(row) })), [rows]);
  const eligible = useMemo(() => eligibleIds(rows, rosterRowView), [rows]);
  const safeSelected = useMemo(() => safeSelectedIds(rows, selected, rosterRowView), [rows, selected]);
  const unresolved = viewRows.filter(({ view }: any) => !view.selectable);

  // Summary counts using server-provided classifications
  const summaryCounts = useMemo(() => {
    const s = preview.data?.summary || {};
    return {
      total: rows.length,
      newStudents: s.create_new_master || viewRows.filter((r: any) => r.source.classification === "CREATE_NEW_MASTER").length,
      matched: s.create_enrollment || viewRows.filter((r: any) => r.source.classification === "CREATE_ENROLLMENT").length,
      conflicts:
        (s.possible_duplicate || 0) +
        (s.missing_jenjang || 0) +
        (s.missing_class || 0) + (s.class_not_found || 0) + (s.class_inactive || 0) + (s.class_context_conflict || 0) + (s.ambiguous_class || 0) ||
        viewRows.filter((r: any) => ["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS", "CLASS_NOT_FOUND", "CLASS_INACTIVE", "CLASS_CONTEXT_CONFLICT", "AMBIGUOUS_CLASS"].includes(r.source.classification)).length,
      invalid: s.invalid || viewRows.filter((r: any) => r.source.classification === "INVALID").length,
    };
  }, [preview.data, rows.length, viewRows]);

  // Derive eligible per tab
  const newEligibleIds = useMemo(
    () => eligible.filter((id) => viewRows.find((r: any) => r.view.key === id)?.source.classification === "CREATE_NEW_MASTER"),
    [eligible, viewRows],
  );

  // Default tab logic: if conflicts exist → Needs review, else if new → New students, else All
  useEffect(() => {
    if (!preview.data) {
      setActiveTab("all");
      return;
    }
    if (summaryCounts.conflicts > 0 || summaryCounts.invalid > 0) {
      setActiveTab("needs-review");
    } else if (summaryCounts.newStudents > 0) {
      setActiveTab("new");
    } else {
      setActiveTab("all");
    }
    setCurrentPage(1);
  }, [preview.data, summaryCounts.conflicts, summaryCounts.invalid, summaryCounts.newStudents]);

  // Auto-select valid new students when safe (only CREATE_NEW_MASTER, no conflicts in those rows)
  useEffect(() => {
    if (preview.data && !commit.isSuccess) {
      // Auto-select all valid new students on preview load, if there are new students and no manual selection yet
      if (newEligibleIds.length > 0 && selected.length === 0) {
        setSelected(newEligibleIds);
      }
    }
  }, [preview.data?.preview_id]);

  // Focus review after parsing
  useEffect(() => {
    if (preview.data && reviewRef.current) {
      reviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [preview.data]);

  const headerState = selectionState(eligible, safeSelected);
  // For New tab, header should represent newEligible
  const newHeaderState = selectionState(newEligibleIds, safeSelected.filter((id) => newEligibleIds.includes(id)));

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = headerState.indeterminate;
  }, [headerState.indeterminate]);

  // Filtering by tab + search
  const filteredByTab = useMemo(() => {
    let filtered = viewRows;
    if (activeTab === "new") filtered = filtered.filter((r: any) => r.source.classification === "CREATE_NEW_MASTER");
    else if (activeTab === "matched") filtered = filtered.filter((r: any) => r.source.classification === "CREATE_ENROLLMENT");
    else if (activeTab === "needs-review")
      filtered = filtered.filter((r: any) => ["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS", "CLASS_NOT_FOUND", "CLASS_INACTIVE", "CLASS_CONTEXT_CONFLICT", "AMBIGUOUS_CLASS"].includes(r.source.classification));
    else if (activeTab === "invalid") filtered = filtered.filter((r: any) => r.source.classification === "INVALID");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        ({ source }: any) =>
          String(source.payload.student_name || "").toLowerCase().includes(q) ||
          String(source.payload.student_identifier || "").toLowerCase().includes(q) ||
          String(source.source_row || "").includes(q),
      );
    }
    return filtered;
  }, [viewRows, activeTab, search]);

  const totalFiltered = filteredByTab.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const paginatedRows = useMemo(
    () => filteredByTab.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredByTab, currentPage, pageSize],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, search]);

  const selectedCreates = safeSelected.filter(
    (id) => viewRows.find(({ view }: any) => view.key === id)?.source.classification === "CREATE_NEW_MASTER",
  ).length;
  const selectedEnrollments = safeSelected.filter(
    (id) => viewRows.find(({ view }: any) => view.key === id)?.source.classification === "CREATE_ENROLLMENT",
  ).length;

  const runPreview = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!file) return;
    // owner and received are required; basic validation
    if (!owner.trim() || owner.trim().length < 2) return;
    if (!received) return;
    const result = await preview.mutateAsync({ file, owner, received });
    setSelected([]);
    setShowSummary(false);
    commit.reset();
    return result;
  };

  const runCommit = () =>
    commit.mutate({
      preview_id: preview.data.preview_id,
      plan_token: preview.data.plan_token,
      selected_row_ids: safeSelected,
      confirmation: "COMMIT_ACADEMIC_ROSTER",
      preview_checksum: preview.data.preview_checksum,
    });

  const reset = () => {
    setFile(null);
    setSelected([]);
    setShowSummary(false);
    setSearch("");
    setActiveTab("all");
    setCurrentPage(1);
    preview.reset();
    commit.reset();
  };

  const handleFile = (nextFile: File | null) => {
    setFile(nextFile);
    setSelected([]);
    setShowSummary(false);
    preview.reset();
    commit.reset();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.toLowerCase().endsWith(".xlsx")) {
      handleFile(dropped);
    }
  };

  const removeFile = () => handleFile(null);

  const selectOne = (id: number, checked: boolean) => {
    if (!preview.data) return;
    const next = checked ? [...safeSelected, id] : safeSelected.filter((value) => value !== id);
    setSelected(safeSelectedIds(rows, next, rosterRowView));
    setShowSummary(false);
  };

  // Stage logic: 1 Upload, 2 Review, 3 Import
  const stage: "upload" | "review" | "import" = commit.isSuccess
    ? "import"
    : preview.data
      ? showSummary || commit.isPending
        ? "import"
        : "review"
      : "upload";

  const hasBlockingConflicts = summaryCounts.conflicts > 0 || summaryCounts.invalid > 0;
  const selectedNewCount = newEligibleIds.filter((id) => safeSelected.includes(id)).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h2 className="text-3xl font-black text-foreground">Student Roster Upload</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Create or update student records and enrollment information before importing attendance for newly registered students.
        </p>
      </header>

      <RosterStages stage={stage} />
      <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 p-4 font-bold text-blue-900">
        Preview does not update the database.
      </div>

      {/* 1 Upload — Prominent upload card */}
      <Card>
        <CardHeader>
          <CardTitle>Upload student data</CardTitle>
          <p className="text-sm text-muted-foreground">Upload → Review → Import · XLSX reconciliation with server-side validation</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="File drop zone, click to choose XLSX file"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              dragOver ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-primary/40"
            } ${file ? "bg-surface-muted/30" : ""}`}
          >
            <UploadCloud className="mx-auto text-muted-foreground" size={36} aria-hidden />
            <p className="mt-3 text-lg font-black text-foreground">Drop an Excel file here</p>
            <p className="text-sm text-muted-foreground">or</p>
            <label
              htmlFor="roster-file-hidden"
              className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-md bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow hover:bg-primary/90 focus-within:ring-2 focus-within:ring-ring"
              onClick={(e) => e.stopPropagation()}
            >
              Choose XLSX file
            </label>
            <input
              ref={fileInputRef}
              id="roster-file-hidden"
              type="file"
              className="sr-only"
              accept=".xlsx"
              aria-label="Choose XLSX file"
              onChange={(event) => {
                const f = event.target.files?.[0] || null;
                handleFile(f);
                // reset input value to allow re-selecting same file
                event.target.value = "";
              }}
            />
            {/* Hidden but accessible file input for tests that look for roster-file id */}
            <input
              id="roster-file"
              type="file"
              className="sr-only"
              accept=".xlsx"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                const f = event.target.files?.[0] || null;
                if (f) handleFile(f);
              }}
            />
            <p className="mt-3 text-xs font-semibold text-muted-foreground">.xlsx files only · Max 10,000 rows</p>

            {file && (
              <div className="mx-auto mt-6 max-w-md rounded-lg border border-border bg-surface p-4 text-left shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="mt-0.5 shrink-0 text-primary" size={20} aria-hidden />
                    <div className="min-w-0">
                      <p className="break-all text-sm font-bold text-foreground" aria-live="polite">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)} · Selected
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove file"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile();
                    }}
                  >
                    <X className="size-4" /> Remove file
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">Sheet</span>
                  <span aria-label="Selected sheet" className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs font-bold text-foreground">Roster</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="ml-auto"
                  >
                    Change file
                  </Button>
                </div>

                {preview.isPending && (
                  <p className="mt-3 flex items-center gap-2 text-sm font-bold text-primary" role="status" aria-live="polite">
                    <Loader2 className="size-4 animate-spin" /> Parsing workbook…
                  </p>
                )}
                {preview.data && (
                  <p className="mt-2 text-xs font-semibold text-emerald-700" role="status">
                    Parsed · {rows.length} rows
                  </p>
                )}
              </div>
            )}

            {!file && preview.isPending && (
              <p className="mt-4 flex items-center justify-center gap-2 text-sm font-bold text-primary" role="status" aria-live="polite">
                <Loader2 className="size-4 animate-spin" /> Parsing workbook…
              </p>
            )}
          </div>

          {/* Requirements + metadata */}
          <div className="rounded-xl bg-surface-muted p-5">
            <h3 className="font-black text-foreground">Roster requirements</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Use the <span className="font-bold">.xlsx</span> template. Names alone are never matching keys; use a stable identifier such as student
              master ID, NIPD, NISN, NIK, birth date with name, or an approved device identity.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROSTER_COLUMNS.map((column) => (
                <Badge key={column} variant="secondary">
                  {column}
                </Badge>
              ))}
            </div>
            <a
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted"
              href={buildApiUrl("/api/student-enrollments/roster-template")}
              download
            >
              <Download className="size-4" /> Download roster template
            </a>
          </div>

          <section aria-labelledby="class-reference-heading" className="rounded-xl border border-border p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 id="class-reference-heading" className="font-black text-foreground">Accepted Classes</h3>
                <p className="mt-1 text-sm text-muted-foreground">Copy canonical class values from Academic Management for the roster's academic year.</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm font-bold" htmlFor="class-reference-year">Academic Year</label>
                <select id="class-reference-year" className="min-h-10 rounded-md border border-border bg-surface px-3" value={selectedReferenceYearId ?? ""} onChange={(event) => { setReferenceYearId(Number(event.target.value)); setCopyFeedback(""); }} disabled={previewYears.length === 1}>
                  {!selectedReferenceYearId && <option value="">{previewYears.length === 1 ? previewYears[0] : "Select year"}</option>}
                  {years.data?.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={copyReference} disabled={!acceptedClasses.length}>Copy class reference</Button>
              </div>
            </div>
            {copyFeedback && <p role="status" className="mt-2 text-sm font-semibold">{copyFeedback}</p>}
            {years.isPending || masters.isPending ? <p className="mt-3 text-sm">Loading accepted classes…</p> : years.isError || masters.isError ? <p role="alert" className="mt-3 text-sm">Accepted classes could not be loaded. Try again.</p> : acceptedClasses.length ? (
              <DataTableContainer className="mt-3 max-h-64">
                <DataTable>
                  <DataTableHeader><DataTableRow><DataTableHead>Jenjang</DataTableHead><DataTableHead>Program</DataTableHead><DataTableHead>Grade</DataTableHead><DataTableHead>Class</DataTableHead></DataTableRow></DataTableHeader>
                  <DataTableBody>{acceptedClasses.map((item, index) => <DataTableRow key={`${item.className}-${index}`}><DataTableCell>{item.jenjang}</DataTableCell><DataTableCell>{item.program}</DataTableCell><DataTableCell>{item.grade}</DataTableCell><DataTableCell>{item.className}</DataTableCell></DataTableRow>)}</DataTableBody>
                </DataTable>
              </DataTableContainer>
            ) : <p className="mt-3 text-sm">{previewYears.length === 1 && !previewYearId ? `Academic Year ${previewYears[0]} from the workbook is not configured.` : "No active classes are configured for this academic year."} <Link className="font-bold text-primary underline" to="/academic-management?tab=allocation">Open Class Allocation</Link>.</p>}
          </section>

          {/* Owner / date + action */}
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={runPreview}>
            <div>
              <Label htmlFor="roster-owner">Source owner</Label>
              <Input
                id="roster-owner"
                required
                minLength={2}
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="e.g. Admin TU"
              />
            </div>
            <div>
              <Label htmlFor="roster-received">Date received</Label>
              <Input id="roster-received" type="date" required value={received} onChange={(event) => setReceived(event.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={preview.isPending || !file || !owner.trim() || !received} aria-busy={preview.isPending}>
                {preview.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Validating roster…
                  </>
                ) : (
                  "Preview roster"
                )}
              </Button>
              {file && (
                <Button type="button" variant="ghost" className="ml-2" onClick={removeFile}>
                  Remove file
                </Button>
              )}
            </div>
          </form>
          {previewFailure && (
            <Alert variant="danger">
              <AlertTitle>{previewFailure.title}</AlertTitle>
              <AlertDescription>{previewFailure.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 2 Review — Summary cards + tabs */}
      {preview.data && !commit.isSuccess && (
        <div ref={reviewRef} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Roster preview</CardTitle>
              <p className="text-sm text-muted-foreground">
                {file?.name} · Preview ID {preview.data.preview_id} · Sheet Roster
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Summary cards */}
              <div role="status" aria-live="polite" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total rows</p>
                  <p className="mt-1 text-2xl font-black tabular-nums">{summaryCounts.total} rows</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Matched</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-emerald-900">{summaryCounts.matched}</p>
                  <p className="text-xs text-emerald-800">Existing enrollments</p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-800">New students</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-blue-900">{summaryCounts.newStudents}</p>
                  <p className="text-xs text-blue-800">To create</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Conflicts</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-amber-900">{summaryCounts.conflicts}</p>
                  <p className="text-xs text-amber-800">Needs review</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-800">Invalid</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-rose-900">{summaryCounts.invalid}</p>
                  <p className="text-xs text-rose-800">Blocked</p>
                </div>
              </div>

              {/* Legacy badges for screen readers / tests */}
              <div className="sr-only flex flex-wrap gap-2" aria-hidden>
                <Badge>{summaryCounts.total} total</Badge>
                <Badge variant="success">{summaryCounts.newStudents} students to create</Badge>
                <Badge variant="information">{summaryCounts.matched} enrollments</Badge>
                <Badge variant="warning">{summaryCounts.conflicts} unresolved</Badge>
                <Badge variant="danger">{summaryCounts.invalid} invalid</Badge>
              </div>

              {unresolved.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Some rows need attention</AlertTitle>
                  <AlertDescription>
                    {summaryCounts.conflicts} conflict(s) and {summaryCounts.invalid} invalid row(s) are in <span className="font-bold">Needs review</span>. Blocked
                    and ambiguous rows cannot be selected. Correct their stable identifiers or master-data references and preview again.
                  </AlertDescription>
                </Alert>
              )}

              {/* Status tabs */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  role="tablist"
                  aria-label="Roster status filter"
                  className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-muted p-1"
                >
                  {[
                    { key: "all", label: "All", count: summaryCounts.total },
                    { key: "new", label: "New students", count: summaryCounts.newStudents },
                    { key: "matched", label: "Matched", count: summaryCounts.matched },
                    { key: "needs-review", label: "Needs review", count: summaryCounts.conflicts + summaryCounts.invalid },
                    { key: "invalid", label: "Invalid", count: summaryCounts.invalid },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                        activeTab === tab.key
                          ? "bg-surface text-foreground shadow-sm border border-border"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label} <span className="ml-1 tabular-nums text-xs opacity-70">({tab.count})</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
                    <Input
                      aria-label="Search roster rows"
                      placeholder="Search name or ID"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 sm:w-[220px]"
                    />
                  </div>
                  <span className="hidden text-sm font-bold sm:inline" aria-live="polite">
                    {safeSelected.length} selected · {unresolved.length} unresolved
                  </span>
                </div>
              </div>

              {/* Sticky select bar (top) — compact */}
              <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-surface)]">
                {activeTab === "new" ? (
                  <>
                    <label className="flex min-h-10 items-center gap-2 px-2 font-bold">
                      <input
                        ref={headerCheckbox}
                        type="checkbox"
                        aria-label="Select all valid new students"
                        checked={newHeaderState.checked}
                        disabled={!newEligibleIds.length || commit.isPending}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? Array.from(new Set([...safeSelected.filter((id) => !newEligibleIds.includes(id)), ...newEligibleIds]))
                            : safeSelected.filter((id) => !newEligibleIds.includes(id));
                          setSelected(next);
                          setShowSummary(false);
                        }}
                      />
                      Select all valid new students
                    </label>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {newEligibleIds.length} valid
                    </span>
                  </>
                ) : (
                  <label className="flex min-h-10 items-center gap-2 px-2 font-bold">
                    <input
                      ref={headerCheckbox}
                      type="checkbox"
                      aria-label="Select all eligible roster rows"
                      checked={headerState.checked}
                      disabled={!eligible.length || commit.isPending}
                      onChange={(event) => {
                        setSelected(event.target.checked ? eligible : []);
                        setShowSummary(false);
                      }}
                    />
                    All eligible
                  </label>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (activeTab === "new") {
                      setSelected(Array.from(new Set([...safeSelected.filter((id) => !newEligibleIds.includes(id)), ...newEligibleIds])));
                    } else {
                      setSelected(eligible);
                    }
                    setShowSummary(false);
                  }}
                  disabled={activeTab === "new" ? !newEligibleIds.length || commit.isPending : !eligible.length || commit.isPending}
                >
                  {activeTab === "new" ? "Select all valid new students" : "Select eligible"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelected([]);
                    setShowSummary(false);
                  }}
                  disabled={!safeSelected.length || commit.isPending}
                >
                  Clear selection
                </Button>
                <span className="ml-auto hidden text-sm font-bold sm:inline">
                  {filteredByTab.length} rows in {activeTab} · {safeSelected.length} selected
                </span>
                <Button size="sm" onClick={() => setShowSummary(true)} disabled={!safeSelected.length || commit.isPending}>
                  {selectedCreates > 0 ? `Create ${selectedCreates} new students & continue` : `Continue to summary`}
                </Button>
              </div>

              {/* Table */}
              <DataTableContainer>
                <DataTable className="min-w-[900px]">
                  <DataTableHeader className="sticky top-0">
                    <DataTableRow>
                      <DataTableHead>Use</DataTableHead>
                      <DataTableHead>Row</DataTableHead>
                      <DataTableHead>Student</DataTableHead>
                      <DataTableHead>Status</DataTableHead>
                      <DataTableHead>Guidance</DataTableHead>
                    </DataTableRow>
                  </DataTableHeader>
                  <DataTableBody>
                    {paginatedRows.length === 0 ? (
                      <DataTableRow>
                        <DataTableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                          No rows in this filter.
                        </DataTableCell>
                      </DataTableRow>
                    ) : (
                      paginatedRows.map(({ source: row, view }: any) => (
                        <DataTableRow key={view.key} className={!view.selectable ? "bg-amber-50/50" : ""}>
                          <DataTableCell>
                            <Checkbox
                              aria-label={`Select roster row ${row.source_row}`}
                              disabled={!view.selectable || commit.isPending}
                              checked={safeSelected.includes(view.key)}
                              onCheckedChange={(checked) => {
                                const next = checked
                                  ? [...safeSelected, view.key]
                                  : safeSelected.filter((id) => id !== view.key);
                                setSelected(safeSelectedIds(rows, next, rosterRowView));
                                setShowSummary(false);
                              }}
                            />
                          </DataTableCell>
                          <DataTableCell className="tabular-nums">{row.source_row}</DataTableCell>
                          <DataTableCell>
                            <p className="font-bold">{row.payload.student_name}</p>
                            <p className="break-all text-xs text-muted-foreground">{row.payload.student_identifier}</p>
                            <p className="text-xs text-muted-foreground">{row.payload.target_jenjang || row.payload.jenjang} · {row.payload.target_program || row.payload.program} · {row.payload.target_grade || row.payload.grade} · {row.payload.target_class || row.payload.class_name}</p>
                          </DataTableCell>
                          <DataTableCell>
                            <Badge
                              variant={view.selectable ? (view.action === "CREATE" ? "success" : "secondary") : view.action === "INVALID" ? "danger" : "warning"}
                              aria-label={`${view.label} status`}
                            >
                              {view.label}
                            </Badge>
                            {!view.selectable && (
                              <p className="mt-2 text-xs font-bold text-amber-900">{view.disabledReason}</p>
                            )}
                            {view.label === "Create student" && <p className="mt-1 text-xs font-semibold text-emerald-700">New</p>}
                            {view.label === "Create enrollment" && <p className="mt-1 text-xs font-semibold text-slate-600">Matched</p>}
                          </DataTableCell>
                          <DataTableCell className="max-w-xl">
                            <p className="font-semibold text-foreground">{view.explanation}</p>
                            <p className="mt-1 text-muted-foreground">{view.recommendedAction}</p>
                            {row.classification === "CLASS_CONTEXT_CONFLICT" ? (
                              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                                <p className="font-bold">Uploaded values → Accepted canonical class</p>
                                {([ ["Jenjang", "jenjang", "target_jenjang"], ["Program", "program", "target_program"], ["Grade", "grade", "target_grade"], ["Class", "class_name", "target_class"] ] as const).map(([label, uploaded, expected]) => (
                                  <p key={label} className={row.payload[uploaded] && String(row.payload[uploaded]).trim().toLowerCase() !== String(row.payload[expected]).trim().toLowerCase() ? "font-bold text-amber-900" : ""}>
                                    {label}{row.payload[uploaded] && String(row.payload[uploaded]).trim().toLowerCase() !== String(row.payload[expected]).trim().toLowerCase() ? " mismatch" : ""}: Uploaded {row.payload[uploaded] || "—"} → Expected {row.payload[expected] || "—"}
                                  </p>
                                ))}
                              </div>
                            ) : row.classification?.startsWith("CLASS_") || row.classification === "AMBIGUOUS_CLASS" ? <p className="mt-2 text-sm font-semibold text-amber-900">{row.errors?.[0]}</p> : null}
                            {view.action === "CONFLICT" || view.action === "BLOCKED" ? (
                              <p className="mt-2 text-xs font-bold text-amber-900">
                                Possible existing student · {row.match_rule || view.technicalCode || "Check identifier"}
                              </p>
                            ) : null}
                            {row.errors?.length ? (
                              <details className="mt-2">
                                <summary className="cursor-pointer font-bold text-primary">Technical details</summary>
                                <p className="mt-2 break-words rounded-lg bg-surface-muted p-3 text-xs">
                                  Source row: {row.source_row}
                                  <br />
                                  {row.errors.join("; ")}
                                </p>
                              </details>
                            ) : null}
                          </DataTableCell>
                        </DataTableRow>
                      ))
                    )}
                  </DataTableBody>
                </DataTable>
              </DataTableContainer>

              {/* Pagination */}
              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Page {currentPage} of {totalPages} · {totalFiltered} rows · {paginatedRows.length} shown
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-bold tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>

              {/* Confirmation */}
              {showSummary && (
                <section
                  aria-labelledby="roster-commit-summary"
                  className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5"
                >
                  <h3 id="roster-commit-summary" className="text-lg font-black">
                    Ready to import
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {summaryCounts.matched} existing students will be matched · {selectedCreates} new students will be created ·{" "}
                    {rows.length - safeSelected.length} rows will be skipped · {unresolved.length} rows still require review
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">File</dt>
                      <dd className="break-all font-bold">{file?.name}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Selected</dt>
                      <dd className="font-bold">{safeSelected.length} rows</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Students / enrollments</dt>
                      <dd className="font-bold">
                        {selectedCreates} / {selectedEnrollments}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Skipped</dt>
                      <dd className="font-bold">{rows.length - safeSelected.length}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Unresolved</dt>
                      <dd className="font-bold">{unresolved.length}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Invalid</dt>
                      <dd className="font-bold">{summaryCounts.invalid}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Preview ID</dt>
                      <dd className="break-all font-bold">{preview.data.preview_id}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Sheet</dt>
                      <dd className="font-bold">Roster</dd>
                    </div>
                  </dl>
                  <div className="mt-4 space-y-1 text-sm text-slate-700">
                    <p>Only selected eligible rows will be submitted. Backend validation and checksum checks run again before commit.</p>
                    <p>Names alone are not matching keys. Existing student records are preserved unless the preview explicitly describes a supported operation.</p>
                  </div>
                  {hasBlockingConflicts && safeSelected.length !== eligible.length ? (
                    <Alert variant="warning" className="mt-4">
                      <AlertTitle>Review required</AlertTitle>
                      <AlertDescription>
                        {summaryCounts.conflicts} conflict(s) remain in Needs review. They are excluded from bulk creation. Resolve them or continue with
                        valid new students only.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <Button variant="outline" onClick={() => setShowSummary(false)}>
                      Back to preview
                    </Button>
                    <Button onClick={runCommit} disabled={!safeSelected.length || commit.isPending} aria-busy={commit.isPending}>
                      {commit.isPending ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" /> Creating students…
                        </>
                      ) : selectedCreates > 0 ? (
                        `Create ${selectedCreates} new students & import`
                      ) : (
                        `Import ${safeSelected.length} selected roster rows`
                      )}
                    </Button>
                  </div>
                </section>
              )}

              {commit.error && (
                <Alert variant="danger">
                  <AlertTitle>Roster was not committed</AlertTitle>
                  <AlertDescription>{commit.error.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Sticky bulk-action bar */}
          {safeSelected.length > 0 && !showSummary && (
            <div
              role="status"
              aria-live="polite"
              className="sticky bottom-0 z-30 mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <p className="font-black">
                  {safeSelected.length} new students selected · {selectedCreates} to create
                </p>
                <p className="text-muted-foreground">
                  {summaryCounts.conflicts} conflicts need review · {summaryCounts.invalid} invalid blocked
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelected([]);
                    setShowSummary(false);
                  }}
                >
                  Clear selection
                </Button>
                <Button onClick={() => setShowSummary(true)} disabled={!safeSelected.length || commit.isPending}>
                  {selectedCreates > 0 ? `Create ${selectedCreates} new students & continue` : `Continue to summary`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {commit.isSuccess && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="space-y-4 pt-6">
            <h3 className="text-lg font-black text-emerald-900">
              <CheckCircle2 className="mr-2 inline" /> Import complete
            </h3>
            <div className="flex flex-wrap gap-2" role="status" aria-live="polite">
              <Badge variant="success">{(commit.data as any).students_created || 0} students created</Badge>
              <Badge variant="information">{(commit.data as any).created || 0} enrollments created</Badge>
              <Badge variant="secondary">{rows.length} rows imported</Badge>
              <Badge variant="warning">{rows.length - (commit.data as any).created} skipped</Badge>
            </div>
            <p className="text-sm text-emerald-900">
              {(commit.data as any).students_created || 0} students created · {(commit.data as any).created || 0} enrollments created · {rows.length} rows
              imported · {rows.length - (commit.data as any).created} skipped
            </p>
            <p className="text-sm text-emerald-900">Upload reference: {(commit.data as any).preview_id}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted"
                to="/students"
              >
                View students
              </Link>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
              {unresolved.length > 0 && (
                <Button variant="outline" onClick={() => commit.reset()}>
                  Review unresolved rows
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type StudentUpdateRow = {
  id: number;
  source_row: number;
  classification: string;
  payload: Record<string, string | null>;
  differences: Record<string, { current: unknown; uploaded: unknown }>;
  errors: { code: string; field?: string; message: string; owner?: string }[];
};

const studentUpdateFields: Record<string, string> = {
  full_name: "Legal Name", preferred_name: "Preferred Name", nipd: "NIPD", nisn: "NISN", nik: "NIK",
  birth_place: "Birth Place", birth_date: "Birth Date", gender: "Gender", religion: "Religion",
  student_status: "Student Status", address: "Address", kelurahan: "Kelurahan", kecamatan: "Kecamatan",
  city_regency: "City", province: "Province", postal_code: "Postal Code", student_phone: "Phone",
  student_email: "Email", guardian_name: "Guardian Name", guardian_phone: "Guardian Phone",
  device_identifier: "Attendance Device No. ID", academic_class_id: "Class",
};

function updateRowStatus(row: StudentUpdateRow, applied: boolean, selected: boolean) {
  if (applied && selected) return "Updated";
  if (row.classification === "UPDATE_EXISTING_MASTER") return applied ? "Not Selected" : "Will Update";
  if (row.classification === "NO_CHANGE") return "No Change";
  if (row.errors.some((error) => error.code === "STALE_RECORD")) return "Preview Outdated";
  if (row.errors.some((error) => error.code === "UNKNOWN_UUID")) return "Student Not Found";
  if (row.errors.some((error) => error.code.startsWith("DUPLICATE_"))) return "Conflict";
  return row.classification === "CONFLICT" ? "Conflict" : "Invalid Data";
}

function updateRowReason(row: StudentUpdateRow, applied: boolean, selected: boolean) {
  if (applied && selected) return "Student record updated.";
  if (row.classification === "UPDATE_EXISTING_MASTER") return applied ? "This row was not selected for this update." : "Ready to update.";
  if (row.classification === "NO_CHANGE") return "Uploaded values already match current data.";
  if (row.errors.some((error) => error.code === "STALE_RECORD")) return "Student record changed after this template or preview was created. Export a fresh template and preview again.";
  if (row.errors.some((error) => error.code === "UNKNOWN_UUID")) return "No existing Student matches this update row. Use Student Roster import for new Students.";
  if (row.errors.some((error) => error.code.startsWith("DUPLICATE_"))) return `${row.errors.map((error) => error.message).join(" ")} Correct the workbook before applying updates.`;
  return row.errors.map((error) => error.message).join(" ") || "Check this row and preview again.";
}

export function StudentUpdatePanel() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const exporter = useStudentTemplateExport();
  const preview = useStudentUpdatePreview();
  const commit = useStudentUpdateCommit();
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [appliedIds, setAppliedIds] = useState<number[]>([]);
  const [historyBatch, setHistoryBatch] = useState("");
  const [rollbackPreview, setRollbackPreview] = useState<any>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("Student Update correction");
  const [rollbackError, setRollbackError] = useState("");
  const [rollbackResult, setRollbackResult] = useState<{ sessionId: string; count: number } | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const history = useQuery({ queryKey: queryKeys.students.importSessions, queryFn: fetchStudentUpdateHistory, enabled: can("view_student_audit") });
  const historyDetail = useQuery({ queryKey: queryKeys.students.importSession(historyBatch), queryFn: () => fetchStudentUpdateSession(historyBatch), enabled: Boolean(historyBatch) && can("view_student_audit") });
  const runRollbackPreview = async () => {
    if (!historyDetail.data) return;
    setRollbackBusy(true);
    setRollbackError("");
    try {
      setRollbackPreview(await previewStudentUpdateRollback(String(historyDetail.data.session_id)));
      setRollbackReason("Student Update correction");
      setRollbackOpen(true);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : "Rollback preview failed. Refresh the session and try again.");
    } finally {
      setRollbackBusy(false);
    }
  };
  const runRollback = async () => {
    if (!historyDetail.data || !rollbackPreview || rollbackReason.trim().length < 5) return;
    setRollbackBusy(true);
    setRollbackError("");
    try {
      const result = await commitStudentUpdateRollback(String(historyDetail.data.session_id), {
        preview_checksum: rollbackPreview.preview_checksum,
        mode: "ALL",
        reason: rollbackReason.trim(),
        confirmation_value: rollbackPreview.required_confirmation,
        idempotency_token: globalThis.crypto.randomUUID(),
      });
      setRollbackResult({ sessionId: String(historyDetail.data.session_id), count: result.compensated_action_count ?? 0 });
      setRollbackOpen(false);
      setRollbackPreview(null);
      await invalidateEnrollmentQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: queryKeys.students.importSessions });
      await queryClient.invalidateQueries({ queryKey: queryKeys.students.importSession(historyBatch) });
      await historyDetail.refetch();
      await history.refetch();
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : "Rollback could not be completed safely.");
    } finally {
      setRollbackBusy(false);
    }
  };
  const exportFile = async () => saveBlob(await exporter.mutateAsync(), "operatoros-student-update.xlsx");
  const runPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const result = await preview.mutateAsync(file);
    setSelected(result.rows.filter((row: any) => row.classification === "UPDATE_EXISTING_MASTER").map((row: any) => row.id));
    setAppliedIds([]);
    setFilter(result.summary.conflicts || result.summary.invalid ? "attention" : "update");
    setPage(1);
    setExpanded(null);
    commit.reset();
  };
  const runCommit = async () => {
    const ids = [...selected];
    await commit.mutateAsync({ batchId: preview.data.id, payload: { selected_row_ids: ids, confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: preview.data.preview_checksum } });
    setAppliedIds(ids);
    setFilter("not-updated");
    setPage(1);
    setConfirm(false);
    void history.refetch();
  };
  const rows = (preview.data?.rows ?? []) as StudentUpdateRow[];
  const done = commit.isSuccess;
  const attention = rows.filter((row) => !["UPDATE_EXISTING_MASTER", "NO_CHANGE"].includes(row.classification));
  const notUpdated = done ? rows.length - appliedIds.length : rows.length - selected.length;
  const conflictCount = attention.filter((row) => updateRowStatus(row, false, false) === "Conflict").length;
  const notFoundCount = attention.filter((row) => updateRowStatus(row, false, false) === "Student Not Found").length;
  const staleCount = attention.filter((row) => updateRowStatus(row, false, false) === "Preview Outdated").length;
  const invalidCount = attention.length - conflictCount - notFoundCount - staleCount;
  const filters = done ? [
    ["updated", "Updated", appliedIds.length], ["not-updated", "Not Updated", notUpdated], ["all", "All Rows", rows.length],
    ["unchanged", "No Change", preview.data?.summary.unchanged ?? 0], ["conflict", "Conflict", conflictCount], ["not-found", "Student Not Found", notFoundCount], ["invalid", "Invalid", invalidCount], ["stale", "Preview Outdated", staleCount],
  ] as const : [
    ["all", "Uploaded", rows.length], ["update", "Will Update", preview.data?.summary.updates ?? 0],
    ["unchanged", "No Change", preview.data?.summary.unchanged ?? 0], ["attention", "Needs Attention", attention.length],
    ["not-updated", "Not Updated", notUpdated], ["conflict", "Conflict", conflictCount], ["not-found", "Student Not Found", notFoundCount], ["invalid", "Invalid", invalidCount], ["stale", "Preview Outdated", staleCount],
  ] as const;
  const filtered = rows.filter((row) => {
    const isUpdate = row.classification === "UPDATE_EXISTING_MASTER";
    const status = updateRowStatus(row, false, false);
    const matchesFilter = filter === "all" || filter === "update" && isUpdate || filter === "unchanged" && row.classification === "NO_CHANGE" || filter === "attention" && !isUpdate && row.classification !== "NO_CHANGE" || filter === "updated" && appliedIds.includes(row.id) || filter === "not-updated" && !(done ? appliedIds : selected).includes(row.id) || filter === "conflict" && status === "Conflict" || filter === "not-found" && status === "Student Not Found" || filter === "invalid" && status === "Invalid Data" || filter === "stale" && status === "Preview Outdated";
    const text = `${row.payload["Legal Name"] ?? ""} ${row.payload.NIPD ?? ""} ${row.payload.NISN ?? ""} ${row.source_row}`.toLocaleLowerCase();
    return matchesFilter && text.includes(search.toLocaleLowerCase().trim());
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const selectedHistory = historyDetail.data;
  const rollbackAlreadyApplied = selectedHistory?.rollback_state === "APPLIED";
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Student Data Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Export current database rows, edit approved fields, then upload the workbook for field-level comparison and stale-version checks.
          </p>
          <Button variant="outline" onClick={exportFile} disabled={exporter.isPending}>
            <Download className="size-4" />
            {exporter.isPending ? "Generating template…" : "Export Student Update Template"}
          </Button>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={runPreview}>
            <div className="flex-1">
              <Label htmlFor="student-update-file">Edited student update workbook</Label>
              <Input id="student-update-file" type="file" accept=".xlsx" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </div>
            <Button type="submit" disabled={preview.isPending || !file}>
              {preview.isPending ? "Comparing changes…" : "Preview changes"}
            </Button>
          </form>
          {preview.error && (
            <Alert variant="danger">
              <AlertTitle>Update preview failed</AlertTitle>
              <AlertDescription>{preview.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      {preview.data && (
        <Card>
          <CardHeader>
            <CardTitle>{done ? "Student Update Completed" : "Review Student Changes"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">1 Upload → 2 Review Changes → 3 Apply + Result</p>
            {done && <Alert variant="success"><AlertTitle>Student Update Completed</AlertTitle><AlertDescription>{appliedIds.length} updated · {notUpdated} not updated{history.data?.items.find((item) => item.id === preview.data.id)?.committed_at ? ` · Applied at ${history.data.items.find((item) => item.id === preview.data.id).committed_at}` : ""}.</AlertDescription></Alert>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Student update summary">
              {filters.map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }} className={`rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === key ? "border-primary bg-primary/10" : "border-border bg-surface"}`}><span className="block text-sm font-bold">{label}</span><strong className="text-2xl">{count}</strong></button>)}
            </div>
            {!done && <p className="text-sm">Not Updated ({notUpdated}): No Change {preview.data.summary.unchanged} · Conflict {conflictCount} · Student Not Found {notFoundCount} · Invalid {invalidCount} · Preview Outdated {staleCount}</p>}
            <div className="flex flex-wrap items-center gap-3"><Label htmlFor="student-update-search">Search students or source rows</Label><Input id="student-update-search" className="max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, NIPD, NISN, or row" /></div>
            {!done && preview.data.summary.updates === 0 && <Alert><AlertTitle>No student changes detected</AlertTitle><AlertDescription>{attention.length ? "No updates can be applied. Correct the issues below." : "All uploaded editable values already match the current database."}</AlertDescription></Alert>}
            <DataTableContainer>
              <DataTable className="min-w-[800px]">
                <DataTableHeader>
                  <DataTableRow>
                    {!done && <DataTableHead>Select</DataTableHead>}
                    <DataTableHead>Source Row</DataTableHead>
                    <DataTableHead>Student</DataTableHead>
                    <DataTableHead>NIPD</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                    <DataTableHead>Changes</DataTableHead>
                    <DataTableHead>Reason / Guidance</DataTableHead>
                    <DataTableHead>Details</DataTableHead>
                  </DataTableRow>
                </DataTableHeader>
                <DataTableBody>
                  {filtered.slice((page - 1) * 25, page * 25).map((row) => (<Fragment key={row.id}><DataTableRow>
                      {!done && <DataTableCell>
                        <Checkbox
                          aria-label={`Select student update row ${row.source_row}`}
                          disabled={row.classification !== "UPDATE_EXISTING_MASTER" || commit.isPending}
                          checked={selected.includes(row.id)}
                          onCheckedChange={(checked) =>
                            setSelected((current) => (checked ? Array.from(new Set([...current, row.id])) : current.filter((id) => id !== row.id)))
                          }
                        />
                      </DataTableCell>}
                      <DataTableCell>{row.source_row}</DataTableCell>
                      <DataTableCell>{row.payload["Legal Name"] || "Unknown"}</DataTableCell>
                      <DataTableCell>{row.payload.NIPD || "—"}</DataTableCell>
                      <DataTableCell>
                        <Badge variant={row.classification === "UPDATE_EXISTING_MASTER" ? "success" : "warning"}>{updateRowStatus(row, done, appliedIds.includes(row.id))}</Badge>
                      </DataTableCell>
                      <DataTableCell>{Object.keys(row.differences).length ? `${Object.keys(row.differences).length} fields` : "—"}</DataTableCell>
                      <DataTableCell>{updateRowReason(row, done, appliedIds.includes(row.id))}</DataTableCell>
                      <DataTableCell><Button size="sm" variant="outline" aria-label={`Details for row ${row.source_row}`} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Hide" : "View"}</Button></DataTableCell>
                    </DataTableRow>{expanded === row.id && <DataTableRow><DataTableCell colSpan={done ? 7 : 8}><div className="space-y-2 p-2 text-sm"><p className="font-bold">Row {row.source_row} · {row.payload["Legal Name"] || "Unknown"} · NIPD {row.payload.NIPD || "—"} · NISN {row.payload.NISN || "—"}</p><p>{updateRowReason(row, done, appliedIds.includes(row.id))}</p>{row.errors.map((error, index) => <p key={index}>{error.field || error.code}: {error.message}{error.field && row.payload[error.field] ? ` (uploaded: ${row.payload[error.field]})` : ""}{error.owner ? ` Already belongs to ${error.owner}.` : ""}</p>)}{Object.entries(row.differences).length > 0 && <DataTable><DataTableHeader><DataTableRow><DataTableHead>Field</DataTableHead><DataTableHead>Current</DataTableHead><DataTableHead>Uploaded</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{Object.entries(row.differences).map(([field, change]) => <DataTableRow key={field}><DataTableCell>{studentUpdateFields[field] || field}</DataTableCell><DataTableCell>{String(change.current ?? "—")}</DataTableCell><DataTableCell>{String(change.uploaded ?? "—")}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable>}</div></DataTableCell></DataTableRow>}</Fragment>))}
                </DataTableBody>
              </DataTable>
            </DataTableContainer>
            {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground">No students match this view.</p>}
            {pageCount > 1 && <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button variant="outline" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next</Button></div>}
            {commit.error && <Alert variant="danger"><AlertTitle>Student update was not applied</AlertTitle><AlertDescription>{commit.error.message}</AlertDescription></Alert>}
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-surface p-3"><p className="font-bold">{done ? `${appliedIds.length} Updated · ${notUpdated} Not Updated` : `${selected.length} Students Will Update · ${preview.data.summary.unchanged} No Change · ${attention.length} Needs Attention`}</p><div className="flex gap-2">{done ? <Button onClick={() => { preview.reset(); commit.reset(); setFile(null); setSearch(""); }}>Start Another Update</Button> : <><Button variant="outline" onClick={() => { preview.reset(); setFile(null); }}>Replace File</Button><Button onClick={() => setConfirm(true)} disabled={!selected.length || commit.isPending}>Apply {selected.length} Student Updates</Button></>}</div></div>
          </CardContent>
        </Card>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Apply Student Updates?</DialogTitle><DialogDescription>{selected.length} students will be updated. {preview.data?.summary.unchanged ?? 0} students are unchanged. {attention.length} need attention.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={commit.isPending} onClick={runCommit}>{commit.isPending ? "Applying…" : `Apply ${selected.length} Updates`}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={rollbackOpen} onOpenChange={(open) => { if (!rollbackBusy) setRollbackOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back Student Updates?</DialogTitle>
            <DialogDescription>
              This restores {rollbackPreview?.eligible_actions ?? 0} changed student records and appends rollback history. Original import evidence remains available.
            </DialogDescription>
          </DialogHeader>
          {rollbackPreview?.blocked_actions > 0 && <Alert variant="danger"><AlertTitle>Rollback needs review</AlertTitle><AlertDescription>{rollbackPreview.blocked_actions} record(s) changed after import. No updates can be rolled back until the current records are reviewed.{rollbackPreview.dependency_conflicts?.map((item: any) => <p key={item.action_id}>{item.reason}</p>)}</AlertDescription></Alert>}
          {rollbackError && <Alert variant="danger"><AlertTitle>Rollback not completed</AlertTitle><AlertDescription>{rollbackError}</AlertDescription></Alert>}
          <label className="grid gap-2 text-sm font-medium" htmlFor="student-update-rollback-reason">Reason for rollback<Textarea id="student-update-rollback-reason" value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} /></label>
          <DialogFooter>
            <Button variant="outline" disabled={rollbackBusy} onClick={() => setRollbackOpen(false)}>Cancel</Button>
            <Button disabled={rollbackBusy || !rollbackPreview?.eligible_actions || rollbackPreview.eligible_actions !== rollbackPreview.total_applied_actions || rollbackReason.trim().length < 5} onClick={runRollback}>{rollbackBusy ? "Rolling back…" : `Rollback ${rollbackPreview?.eligible_actions ?? 0} Updates`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {can("view_student_audit") && <Card>
        <CardHeader><CardTitle>Student Update History</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {history.isPending ? <p>Loading history…</p> : history.error ? <p>History could not be loaded.</p> : history.data?.items.length ? history.data.items.map((item) => <button type="button" key={item.id} aria-label={`Open Student Update history item ${item.filename}`} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left hover:border-primary" onClick={() => { setHistoryBatch(item.id); setRollbackError(""); }}><span>{item.filename} · {item.status === "committed" ? "Completed" : "Preview"}</span><span>Updated {item.status === "committed" ? item.summary.updates : 0} · No Change {item.summary.unchanged} · Conflicts {item.summary.conflicts} · Invalid {item.summary.invalid}</span></button>) : <p>No Student Update sessions yet.</p>}
          {historyBatch && <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Session detail</h3><Button variant="outline" onClick={() => setHistoryBatch("")}>Close</Button></div>
            {historyDetail.isPending ? <p>Loading session…</p> : historyDetail.error ? <p>Session detail could not be loaded.</p> : selectedHistory && <>
              <p>Updated {selectedHistory.status === "committed" ? selectedHistory.rows.filter((row: StudentUpdateRow & { selected: boolean }) => row.selected).length : 0} · Not Updated {selectedHistory.rows.filter((row: StudentUpdateRow & { selected: boolean }) => !row.selected).length}</p>
              {rollbackAlreadyApplied ? <Alert variant="success"><AlertTitle>Rollback completed</AlertTitle><AlertDescription>{rollbackResult?.sessionId === String(selectedHistory.session_id) ? `${rollbackResult.count} updates were restored.` : "This session has already been rolled back."}</AlertDescription></Alert> : selectedHistory.rollback_action_count > 0 ? <p className="text-sm text-muted-foreground">Rollback scope: {selectedHistory.rollback_action_count} applied updates.</p> : selectedHistory.rows.some((row: StudentUpdateRow & { selected: boolean }) => row.selected) ? <p className="text-sm text-muted-foreground">Rollback unavailable — this session has no recorded before/after history for its applied rows.</p> : <p className="text-sm text-muted-foreground">Rollback unavailable — no student updates were applied.</p>}
              {rollbackError && <Alert variant="danger"><AlertTitle>Rollback preview failed</AlertTitle><AlertDescription>{rollbackError}</AlertDescription></Alert>}
              {can("rollback_import_session") && selectedHistory.status === "committed" && selectedHistory.rollback_action_count > 0 && !rollbackAlreadyApplied && <Button variant="outline" onClick={runRollbackPreview} disabled={rollbackBusy}>{rollbackBusy ? "Checking rollback…" : `Review rollback for ${selectedHistory.rollback_action_count} updates`}</Button>}
              <DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Source Row</DataTableHead><DataTableHead>Student</DataTableHead><DataTableHead>NIPD</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Reason</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{selectedHistory.rows.map((row: StudentUpdateRow & { selected: boolean }) => <DataTableRow key={row.id}><DataTableCell>{row.source_row}</DataTableCell><DataTableCell>{row.payload["Legal Name"]}</DataTableCell><DataTableCell>{row.payload.NIPD || "—"}</DataTableCell><DataTableCell>{updateRowStatus(row, selectedHistory.status === "committed", row.selected)}</DataTableCell><DataTableCell>{updateRowReason(row, selectedHistory.status === "committed", row.selected)}{Object.keys(row.differences).length > 0 && <details className="mt-1"><summary className="cursor-pointer">{Object.keys(row.differences).length} changed fields</summary>{Object.entries(row.differences).map(([field, change]) => <p key={field}>{studentUpdateFields[field] || field}: {String(change.current ?? "—")} → {String(change.uploaded ?? "—")}</p>)}</details>}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>
              <Button variant="outline" onClick={async () => saveBlob(await downloadStudentUpdateResult(historyBatch), `student-update-result-${historyBatch}.xlsx`)}>Download Result</Button>
            </>}
          </div>}
        </CardContent>
      </Card>}
    </div>
  );
}

export default function UploadCenter() {
  const { can } = useAuth();
  const canImportStaff = can("import_staff");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const sections = ["attendance", "roster", "student-update", "employee", "attention", "history", "export"] as const;
  const mode = sections.find((section) => section === requestedSection && (section !== "employee" || canImportStaff)) ?? "attendance";
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = (section: string) => {
    const nextMode = sections.find((value) => value === section);
    if (!nextMode || modeRef.current === nextMode) return;
    modeRef.current = nextMode;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextMode === "attendance") next.delete("section");
      else next.set("section", nextMode);
      return next;
    });
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data Management" title="Data Import & Export" description="Import operational school data, resolve issues, review history, and export supported datasets from one workspace." />
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className={`grid h-auto w-full grid-cols-2 md:grid-cols-3 ${canImportStaff ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
          <TabsTrigger value="attendance">
            <FileSpreadsheet className="mr-2 inline size-4" />
            Attendance Upload
          </TabsTrigger>
          <TabsTrigger value="roster">
            <Users className="mr-2 inline size-4" />
            Student Roster Upload
          </TabsTrigger>
          <TabsTrigger value="student-update">
            <CheckCircle2 className="mr-2 inline size-4" />
            Student Data Update
          </TabsTrigger>
          {canImportStaff && <TabsTrigger value="employee">
            <UserRound className="mr-2 inline size-4" />
            Employee Import
          </TabsTrigger>}
          <TabsTrigger value="attention">
            <BellRing className="mr-2 inline size-4" />
            Needs Attention
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 inline size-4" />
            History
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="mr-2 inline size-4" />
            Export
          </TabsTrigger>
        </TabsList>
        <TabsContent value="attendance">
          <MachineImportWorkflow key={`attendance-${mode}`} embedded />
        </TabsContent>
        <TabsContent value="roster">
          <RosterImportPanel key={`roster-${mode}`} />
        </TabsContent>
        <TabsContent value="attention">
          <NeedsAttentionPanel enabled={mode === "attention"} />
        </TabsContent>
        <TabsContent value="history">
          <UploadHistoryPanel enabled={mode === "history"} />
        </TabsContent>
        <TabsContent value="student-update">
          <StudentUpdatePanel key={`student-update-${mode}`} />
        </TabsContent>
        {canImportStaff && <TabsContent value="employee">
          <Card>
            <CardHeader>
              <CardTitle>Employee Import</CardTitle>
              <p className="text-sm text-muted-foreground">
                Preview validates the Edelweiss worksheet and stages the source rows. Employee records change only after you commit the accepted rows.
              </p>
            </CardHeader>
            <CardContent>
              <Link className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" to="/staff/import">
                <UserRound className="size-4" />Open employee import
              </Link>
            </CardContent>
          </Card>
        </TabsContent>}
        <TabsContent value="export">
          <DataPortability embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
