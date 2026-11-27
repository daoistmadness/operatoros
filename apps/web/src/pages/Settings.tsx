import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldAlert, Trash2 } from "lucide-react";
import type { DataResetPreviewResponse, DataResetResult, DataResetScope } from "@operatoros/contracts/system";
import { AppLink as Link } from '../components/AppLink';
import { previewDataReset, commitDataReset } from "../api/system";
import { invalidateDataResetQueries } from "../lib/query/dataResetInvalidation";
import { cn } from "../lib/cn";
import { getSystemHealth } from "../lib/api/endpoints";
import { getPageApiError } from "../lib/api/errors";
import { useAuth } from "../context/AuthContext";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { PageHeader } from "../components/common/page-header";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
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
  const { preferences, setSidebarCollapsed, resetPreferences } = useUiPreferences();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const resetTitle = useRef<HTMLHeadingElement>(null);
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
  const [preferenceStatus, setPreferenceStatus] = useState("");

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

  const updateSidebarPreference = (value: boolean) => {
    const saved = setSidebarCollapsed(value);
    setPreferenceStatus(saved
      ? "Interface preference saved in this browser."
      : "Interface preference applies for this session only because browser storage is unavailable.");
  };

  const handleResetPreferences = () => {
    const reset = resetPreferences();
    setPreferenceStatus(reset
      ? "Interface preferences restored to their defaults."
      : "Interface preferences reset for this session. Browser storage is unavailable.");
  };

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-5">
      <PageHeader className="flex-row items-start justify-between" title="System Settings" description="Manage interface preferences, backups, and data integrity." actions={
        <Link to="/" className={cn(buttonVariants({ variant: "outline", size: "icon" }), "shrink-0")} aria-label="Back to dashboard">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      } />

      <div className="grid grid-cols-1 gap-4">
        <Card className="min-w-0 p-4">
          <div className="mb-4 border-b border-border pb-3">
            <h2 className="text-base font-semibold">Interface preferences</h2>
            <p className="mt-1 text-sm text-muted-foreground">These preferences stay in this browser and do not contain school or account data.</p>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="sidebar-collapsed"
              className="size-6 border-muted-foreground [&_span]:flex [&_span]:justify-center"
              aria-describedby="sidebar-collapsed-description"
              checked={preferences.sidebarCollapsed}
              onCheckedChange={(checked) => updateSidebarPreference(checked === true)}
            />
            <div className="min-w-0">
              <label htmlFor="sidebar-collapsed" className="block cursor-pointer text-sm font-semibold text-foreground">Use a compact sidebar on desktop</label>
              <p id="sidebar-collapsed-description" className="mt-1 text-sm text-muted-foreground">The mobile navigation drawer stays full width.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Button variant="outline" onClick={handleResetPreferences}>Restore defaults</Button>
            <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{preferenceStatus}</p>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 border-b border-border pb-3 text-base font-semibold">General Configuration</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-sm bg-surface-muted p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">System Version</p>
                <p className="text-xs text-muted-foreground">v1.2.4 stable</p>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
            {isAdmin && <Link to="/settings/backups" className={buttonVariants({ variant: "outline" })}>
              <span>Backup Management</span><span aria-hidden="true">→</span>
            </Link>}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <ShieldAlert className="size-4 text-danger" aria-hidden="true" />
            <h2 className="text-base font-semibold text-danger">Danger Zone</h2>
          </div>

          {resetControlsVisible ? (
            <div className="space-y-4">
              {RESET_ACTIONS.map((item, index) => (
                <section key={item.scope} className={cn("rounded-sm border bg-surface p-3 transition-colors", item.cardClass, index === 3 && "border-2")}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={cn("font-bold", index === 3 ? "text-rose-950" : "text-slate-900")}>{item.title}</h3>
                        <span className="rounded border border-current/15 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{item.severity}</span>
                      </div>
                      <p className="max-w-xl text-sm leading-relaxed text-slate-600">{item.description}</p>
                      <p className="max-w-xl text-xs leading-relaxed text-slate-500"><strong>Preserves:</strong> {item.preserves}</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={(event) => {
                        resetTrigger.current = event.currentTarget;
                        void handlePreview(item.scope);
                      }}
                      disabled={previewingScope !== null}
                      className={cn("shrink-0 disabled:cursor-wait", item.buttonClass)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {previewingScope === item.scope ? "Loading preview…" : "Preview reset"}
                    </Button>
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

      <Dialog restoreFocus={false} open={dialogOpen} onOpenChange={(open) => { if (!isResetting) setDialogOpen(open); }}>
        <DialogContent
          className="max-w-2xl p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            resetTitle.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            resetTrigger.current?.focus();
          }}
        >
          {action && preview && (
            <>
              <div className="border-b border-border bg-danger-surface p-4 pr-12">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                  <div className="min-w-0">
                    <DialogTitle ref={resetTitle} tabIndex={-1} className="text-lg font-semibold text-danger">{action.title}</DialogTitle>
                    <DialogDescription className="mt-1">Review the exact deletion and preservation counts before confirming.</DialogDescription>
                  </div>
                </div>
                {selectedScope === "ALL_SCHOOL_DATA" && <p className="mt-2 text-sm font-semibold">This removes all school records and academic structure. Administrator and staff login access remain.</p>}
              </div>

              <div className="space-y-4 p-4">
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
                    autoComplete="off"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && confirmation === action.confirmation) void handleReset(); }}
                    className="h-10 font-semibold"
                  />
                </div>

                {error && <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" disabled={isResetting} onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button
                    variant="danger"
                    disabled={confirmation !== action.confirmation || isResetting}
                    onClick={() => void handleReset()}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />{isResetting ? "Creating backup and resetting…" : "Create backup and reset"}
                  </Button>
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
