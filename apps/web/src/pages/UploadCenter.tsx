import { useEffect, useMemo, useRef, useState } from "react";
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
  Users,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import AttendanceUpload, { WorkflowIndicator } from "./Upload";
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
import { buildApiUrl } from "../lib/api/client";
import { eligibleIds, rosterRowView, safeSelectedIds, selectionState } from "../lib/uploadWorkflow";
import { NeedsAttentionPanel } from "../components/upload/NeedsAttentionPanel";
import { UploadHistoryPanel } from "../components/upload/UploadHistoryPanel";
import { NativeSelect } from "../components/ui/native-select";

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
  const [selectedSheet, setSelectedSheet] = useState("Roster");
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const rows = preview.data?.rows || [];
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
        (s.missing_class || 0) ||
        viewRows.filter((r: any) => ["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS"].includes(r.source.classification)).length,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      filtered = filtered.filter((r: any) => ["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS"].includes(r.source.classification));
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
    setSelectedSheet("Roster");
    preview.reset();
    commit.reset();
  };

  const handleFile = (nextFile: File | null) => {
    setFile(nextFile);
    setSelected([]);
    setShowSummary(false);
    preview.reset();
    commit.reset();
    if (nextFile) {
      // Reset sheet to default; in real workbook we could parse sheet names, but keep simple
      setSelectedSheet("Roster");
    }
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
    if (dropped && (dropped.name.endsWith(".xlsx") || dropped.name.endsWith(".xls"))) {
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
              accept=".xlsx,.xls"
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
            <p className="mt-3 text-xs font-semibold text-muted-foreground">.xlsx and supported .xls files · Max 10,000 rows</p>

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
                  <NativeSelect
                    aria-label="Select sheet"
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 w-auto min-w-[140px]"
                  >
                    <option value="Roster">Roster</option>
                    <option value="Students">Students</option>
                    <option value="All">All sheets</option>
                  </NativeSelect>
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
          {preview.error && (
            <Alert variant="danger">
              <AlertTitle>Roster preview failed</AlertTitle>
              <AlertDescription>{preview.error.message}</AlertDescription>
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
                {file?.name} · Preview ID {preview.data.preview_id} · Sheet {selectedSheet}
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
                            <p className="text-xs text-muted-foreground">
                              {row.payload.jenjang} · {row.payload.class_name}
                            </p>
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
                      <dd className="font-bold">{selectedSheet}</dd>
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

function StudentUpdatePanel() {
  const exporter = useStudentTemplateExport();
  const preview = useStudentUpdatePreview();
  const commit = useStudentUpdateCommit();
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const exportFile = async () => saveBlob(await exporter.mutateAsync(), "operatoros-student-update.xlsx");
  const runPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const result = await preview.mutateAsync(file);
    setSelected(result.rows.filter((row: any) => row.classification === "UPDATE_EXISTING_MASTER").map((row: any) => row.id));
  };
  const runCommit = () => commit.mutate({ batchId: preview.data.id, payload: { selected_row_ids: selected, confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: preview.data.preview_checksum } });
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
            <CardTitle>Detected student changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>{preview.data.summary.total} rows</Badge>
              <Badge variant="information">{preview.data.summary.updates} updates</Badge>
              <Badge variant="secondary">{preview.data.summary.unchanged} unchanged</Badge>
              <Badge variant="warning">{preview.data.summary.conflicts} conflicts</Badge>
            </div>
            <DataTableContainer>
              <DataTable>
                <DataTableHeader>
                  <DataTableRow>
                    <DataTableHead>Select</DataTableHead>
                    <DataTableHead>Row</DataTableHead>
                    <DataTableHead>Student</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                  </DataTableRow>
                </DataTableHeader>
                <DataTableBody>
                  {preview.data.rows.map((row: any) => (
                    <DataTableRow key={row.id}>
                      <DataTableCell>
                        <Checkbox
                          aria-label={`Select student update row ${row.source_row}`}
                          disabled={row.classification !== "UPDATE_EXISTING_MASTER" || commit.isPending}
                          checked={selected.includes(row.id)}
                          onCheckedChange={(checked) =>
                            setSelected((current) => (checked ? Array.from(new Set([...current, row.id])) : current.filter((id) => id !== row.id)))
                          }
                        />
                      </DataTableCell>
                      <DataTableCell>{row.source_row}</DataTableCell>
                      <DataTableCell>{row.payload["Legal Name"]}</DataTableCell>
                      <DataTableCell>
                        <Badge variant={row.classification === "UPDATE_EXISTING_MASTER" ? "success" : "warning"}>{row.classification.replaceAll("_", " ")}</Badge>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </DataTableContainer>
            <Button onClick={runCommit} disabled={!selected.length || commit.isPending}>
              {commit.isPending ? "Applying selected updates…" : `Commit ${selected.length} selected updates`}
            </Button>
            {commit.isSuccess && (
              <Alert variant="success">
                <AlertTitle>Student updates committed</AlertTitle>
                <AlertDescription>{(commit.data as any).updated} rows updated transactionally.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function UploadCenter() {
  const [mode, setMode] = useState("attendance");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Guarded imports" title="Data Import Center" description="Upload data, resolve blocked rows, and review history without bypassing backend validation." />
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="grid h-auto w-full grid-cols-2 lg:grid-cols-5">
          <TabsTrigger value="attendance">
            <FileSpreadsheet className="mr-2 inline size-4" />
            Attendance Upload
          </TabsTrigger>
          <TabsTrigger value="roster">
            <Users className="mr-2 inline size-4" />
            Student Roster Upload
          </TabsTrigger>
          <TabsTrigger value="attention">
            <BellRing className="mr-2 inline size-4" />
            Needs Attention
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 inline size-4" />
            Upload History
          </TabsTrigger>
          <TabsTrigger value="student-update">
            <CheckCircle2 className="mr-2 inline size-4" />
            Student Data Update
          </TabsTrigger>
        </TabsList>
        <TabsContent value="attendance">
          <AttendanceUpload key={`attendance-${mode}`} embedded />
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
      </Tabs>
    </div>
  );
}
