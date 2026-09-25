import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Settings as SettingsIcon, ShieldAlert, Trash2 } from "lucide-react";
import type { DataResetPreviewResponse, DataResetResult, DataResetScope } from "@operatoros/contracts/system";
import { Link } from "react-router-dom";
import { previewDataReset, commitDataReset } from "../api/system";
import { invalidateDataResetQueries } from "../lib/query/dataResetInvalidation";
import { cn } from "../lib/cn";
import { getSystemHealth } from "../lib/api/endpoints";
import { getPageApiError } from "../lib/api/errors";
import { useAuth } from "../context/AuthContext";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const RESET_ACTIONS: readonly {
  scope: DataResetScope;
  title: string;
  description: string;
  preserves: string;
  confirmation: string;
  severity: string;
  cardClass: string;
  buttonClass: string;
}[] = [
  {
    scope: "ATTENDANCE",
    title: "Reset Attendance Data",
    description: "Delete attendance records, corrections, follow-up cases, and attendance import history.",
    preserves: "Students, enrollments, classes, Attendance Calendar, academic results, report setup, and staff access.",
    confirmation: "RESET ATTENDANCE",
    severity: "Scoped reset",
    cardClass: "border-amber-200 hover:border-amber-300",
    buttonClass: "border-amber-300 text-amber-800 hover:bg-amber-50",
  },
  {
    scope: "ACADEMIC_RESULTS",
    title: "Reset Academic Results",
    description: "Delete recorded assessment results and derived academic intervention records.",
    preserves: "Students, enrollments, attendance, assessment setup, school structure, report setup, and staff access.",
    confirmation: "RESET ACADEMICS",
    severity: "Scoped reset",
    cardClass: "border-orange-200 hover:border-orange-300",
    buttonClass: "border-orange-300 text-orange-800 hover:bg-orange-50",
  },
  {
    scope: "STUDENTS",
    title: "Reset Students & Enrollments",
    description: "Delete the Student roster, enrollments, linked identities, and all student-dependent attendance and academic data.",
    preserves: "Academic years, Programs, Jenjang, Grades, Classes, terms, calendars, report setup, and staff access.",
    confirmation: "RESET STUDENTS",
    severity: "High impact",
    cardClass: "border-rose-300 hover:border-rose-400",
    buttonClass: "border-rose-400 text-rose-800 hover:bg-rose-50",
  },
  {
    scope: "ALL_SCHOOL_DATA",
    title: "Reset All School Data",
    description: "Delete all Student, attendance, academic, staff profile, import, report setup, and school structure data.",
    preserves: "Administrator and staff login accounts, authorization, system and backup configuration, audit log, and encrypted backups.",
    confirmation: "RESET ALL SCHOOL DATA",
    severity: "Critical · all school data",
    cardClass: "border-rose-500 bg-rose-50/50 hover:border-rose-600",
    buttonClass: "border-rose-700 bg-rose-700 text-white hover:bg-rose-800",
  },
];

function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<DataResetScope | null>(null);
  const [preview, setPreview] = useState<DataResetPreviewResponse | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [previewingScope, setPreviewingScope] = useState<DataResetScope | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ result: DataResetResult; preserved: string[]; title: string } | null>(null);
  const [error, setError] = useState("");
  const [destructiveOperationsEnabled, setDestructiveOperationsEnabled] = useState(false);
  const [healthLoaded, setHealthLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    getSystemHealth().then((health) => {
      if (mounted) setDestructiveOperationsEnabled(Boolean(health?.destructive_operations_enabled));
    }).catch(() => {
      if (mounted) setDestructiveOperationsEnabled(false);
    }).finally(() => {
      if (mounted) setHealthLoaded(true);
    });
    return () => { mounted = false; };
  }, []);

  const handlePreview = async (scope: DataResetScope) => {
    setPreviewingScope(scope);
    setError("");
    setResetResult(null);
    setSelectedScope(scope);
    setConfirmation("");
    try {
      setPreview(await previewDataReset(scope));
      setDialogOpen(true);
    } catch (err: unknown) {
      setError(getPageApiError(err, "Reset preview could not be loaded. No data was changed."));
    } finally {
      setPreviewingScope(null);
    }
  };

  const handleReset = async () => {
    if (!selectedScope || !preview) return;
    const action = RESET_ACTIONS.find((value) => value.scope === selectedScope);
    if (!action || confirmation !== action.confirmation) return;
    setIsResetting(true);
    setError("");
    try {
      const result = await commitDataReset({ scope: selectedScope, confirmation });
      setDialogOpen(false);
      setResetResult({ result, preserved: preview.will_preserve, title: action.title });
      setConfirmation("");
      try {
        await invalidateDataResetQueries(queryClient, selectedScope);
      } catch {
        setError("Reset completed, but some data views did not refresh. Reopen the affected page to load current data.");
      }
    } catch (err: unknown) {
      setError(getPageApiError(err, "The reset could not be completed."));
    } finally {
      setIsResetting(false);
    }
  };

  const action = RESET_ACTIONS.find((value) => value.scope === selectedScope);
  const resetControlsVisible = isAdmin && healthLoaded && destructiveOperationsEnabled;

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex items-center gap-4">
        <Link to="/" className="rounded-xl border border-slate-200 bg-white p-2 transition-colors hover:bg-slate-50" aria-label="Back to dashboard">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">System Settings</h1>
          <p className="mt-1 text-slate-500">Manage global system configurations and data integrity.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6">
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
            <SettingsIcon size={20} className="text-brand" />
            <h2 className="font-bold text-slate-800 underline decoration-brand/30 decoration-2 underline-offset-4">General Configuration</h2>
          </div>
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div>
                <p className="text-sm font-bold text-slate-900">System Version</p>
                <p className="text-xs font-medium text-slate-500">v1.2.4 stable</p>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
            {isAdmin && <Link to="/settings/backups" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 font-bold text-slate-800 transition hover:border-brand hover:text-brand">
              <span>Backup Management</span><span aria-hidden="true">→</span>
            </Link>}
          </div>
        </Card>

        <Card className={cn("border p-6", resetControlsVisible ? "border-rose-200 bg-rose-50/20" : "border-slate-200 bg-slate-50")}>
          <div className="mb-6 flex items-center gap-3 border-b border-rose-100 pb-4">
            <ShieldAlert size={20} className="text-rose-500" />
            <h2 className="font-bold text-rose-900 underline decoration-rose-500/30 decoration-2 underline-offset-4">Danger Zone</h2>
          </div>

          {resetControlsVisible ? (
            <div className="space-y-4">
              {RESET_ACTIONS.map((item, index) => (
                <section key={item.scope} className={cn("rounded-2xl border bg-white p-5 shadow-sm transition-colors", item.cardClass, index === 3 && "border-2")}>
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={cn("font-bold", index === 3 ? "text-rose-950" : "text-slate-900")}>{item.title}</h3>
                        <span className="rounded border border-current/15 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{item.severity}</span>
                      </div>
                      <p className="max-w-xl text-sm leading-relaxed text-slate-600">{item.description}</p>
                      <p className="max-w-xl text-xs leading-relaxed text-slate-500"><strong>Preserves:</strong> {item.preserves}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handlePreview(item.scope)}
                      disabled={previewingScope !== null}
                      className={cn("flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold transition disabled:cursor-wait disabled:opacity-60", item.buttonClass)}
                    >
                      <Trash2 size={17} />
                      {previewingScope === item.scope ? "Loading preview…" : "Preview reset"}
                    </button>
                  </div>
                </section>
              ))}
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Every reset creates an encrypted backup immediately before the transaction. The reset is blocked if the backup cannot be created.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              {!healthLoaded ? "Checking destructive-operation availability…" : destructiveOperationsEnabled && !isAdmin
                ? "Only an authorized administrator can use destructive reset controls."
                : "Destructive operations are disabled in this environment. Reset controls stay unavailable until the backend explicitly enables them."}
            </div>
          )}
        </Card>
      </div>

      {error && !dialogOpen && <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}

      {resetResult && (
        <Alert variant="success" className="space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
            <div>
              <p className="font-bold">{resetResult.title} completed</p>
              <p className="text-xs font-medium opacity-80">The reset transaction committed at {new Date(resetResult.result.completed_at).toLocaleString()}.</p>
            </div>
          </div>
          <div className="pl-8 text-sm">
            <p className="font-semibold">Deleted</p>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(resetResult.result.deleted_counts).map(([domain, count]) => <li key={domain}>{domain}: {count.toLocaleString()}</li>)}
            </ul>
            <p className="mt-3 font-semibold">Preserved</p>
            <ul className="mt-1 list-disc pl-5">{resetResult.preserved.map((value) => <li key={value}>{value}</li>)}</ul>
            <p className="mt-3 text-xs text-slate-600">Encrypted pre-reset backup: {resetResult.result.backup_filename}</p>
          </div>
        </Alert>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isResetting) setDialogOpen(open); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
          {action && preview && (
            <>
              <div className={cn("px-7 py-6 text-white", selectedScope === "ALL_SCHOOL_DATA" ? "bg-rose-800" : selectedScope === "STUDENTS" ? "bg-rose-600" : selectedScope === "ACADEMIC_RESULTS" ? "bg-orange-600" : "bg-amber-600")}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="rounded-full border border-white/30 bg-white/15 p-3"><AlertTriangle size={24} /></div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-white/75">Review before reset</p>
                    <DialogTitle className="text-xl font-black">{action.title}</DialogTitle>
                    <DialogDescription className="text-sm text-white/80">Review the exact deletion and preservation counts before confirming.</DialogDescription>
                  </div>
                </div>
                {selectedScope === "ALL_SCHOOL_DATA" && <p className="rounded-lg bg-black/15 p-3 text-sm font-semibold">This removes all school records and academic structure. Administrator and staff login access remain.</p>}
              </div>

              <div className="space-y-6 p-7">
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <h4 className="text-xs font-black uppercase tracking-wider text-rose-900">WILL DELETE</h4>
                    <ul className="mt-3 space-y-2 text-sm text-rose-900">
                      {preview.will_delete.map(({ domain, count }) => <li key={domain} className="flex justify-between gap-3"><span>{domain}</span><strong className="tabular-nums">{count.toLocaleString()}</strong></li>)}
                    </ul>
                  </section>
                  <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <h4 className="text-xs font-black uppercase tracking-wider text-emerald-900">WILL PRESERVE</h4>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-900">{preview.will_preserve.map((value) => <li key={value}>{value}</li>)}</ul>
                  </section>
                </div>

                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  An encrypted pre-reset backup is created before the reset transaction. If backup creation fails, no reset is performed. You can also manage backups in <Link to="/settings/backups" className="font-bold underline">Backup Management</Link>.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirmation" className="text-xs font-bold uppercase tracking-widest">Type exactly: {action.confirmation}</Label>
                  <Input
                    id="reset-confirmation"
                    type="text"
                    autoFocus
                    autoComplete="off"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && confirmation === action.confirmation) void handleReset(); }}
                    className="h-12 font-bold"
                  />
                </div>

                {error && <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button type="button" disabled={isResetting} onClick={() => setDialogOpen(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
                  <button
                    type="button"
                    disabled={confirmation !== action.confirmation || isResetting}
                    onClick={() => void handleReset()}
                    className={cn("flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50", selectedScope === "ALL_SCHOOL_DATA" ? "bg-rose-800 hover:bg-rose-900" : selectedScope === "STUDENTS" ? "bg-rose-600 hover:bg-rose-700" : selectedScope === "ACADEMIC_RESULTS" ? "bg-orange-600 hover:bg-orange-700" : "bg-amber-600 hover:bg-amber-700")}
                  >
                    <Trash2 size={17} />{isResetting ? "Creating backup and resetting…" : "Create backup and reset"}
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Settings;
