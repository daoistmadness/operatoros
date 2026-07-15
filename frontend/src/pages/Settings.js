import React, { useEffect, useState } from "react";
import { 
  Settings as SettingsIcon, 
  Trash2, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  X, 
  ArrowLeft 
} from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api";
import { cn } from "../lib/cn";
import { getSystemHealth } from "../lib/api/endpoints";
import { useAuth } from "../context/AuthContext";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const RESET_CONFIRMATION = "CLEAR_ALL_ATTENDANCE_DATA";

function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetMode, setResetMode] = useState("attendance");
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [error, setError] = useState("");
  const [destructiveOperationsEnabled, setDestructiveOperationsEnabled] = useState(false);
  const [healthLoaded, setHealthLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadHealth = async () => {
      try {
        const health = await getSystemHealth();
        if (mounted) {
          setDestructiveOperationsEnabled(Boolean(health?.destructive_operations_enabled));
        }
      } catch (_err) {
        if (mounted) {
          setDestructiveOperationsEnabled(false);
        }
      } finally {
        if (mounted) {
          setHealthLoaded(true);
        }
      }
    };

    loadHealth();

    return () => {
      mounted = false;
    };
  }, []);


  const handleResetData = async () => {
    if (confirmText !== RESET_CONFIRMATION) return;
    
    setIsResetting(true);
    setError("");
    
    try {
      await api.post("/api/system/clear-data", {
        mode: resetMode,
        confirmation: confirmText,
      });
      setResetSuccess(true);
      setShowResetModal(false);

      // Auto-refresh or redirect could happen here, but for now we'll show success state
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to reset database. Check console for details.");
    } finally {
      setIsResetting(false);
    }
  };

  const resetControlsVisible = isAdmin && healthLoaded && destructiveOperationsEnabled;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex items-center gap-4">
        <Link to="/" className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Settings</h1>
          <p className="text-slate-500 mt-1">Manage global system configurations and data integrity.</p>
        </div>
      </header>

      {/* Main Settings Sections */}
      <div className="grid grid-cols-1 gap-6">
        {/* Info Card */}
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <SettingsIcon size={20} className="text-brand" />
            <h2 className="font-bold text-slate-800 underline decoration-brand/30 decoration-2 underline-offset-4">General Configuration</h2>
          </div>
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div>
                <p className="font-bold text-slate-900 text-sm">System Version</p>
                <p className="text-xs text-slate-500 font-medium">v1.2.4 stable</p>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
            {isAdmin && <Link to="/settings/backups" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 font-bold text-slate-800 transition hover:border-brand hover:text-brand">
              <span>Backup Management</span><span aria-hidden="true">→</span>
            </Link>}
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className={cn("p-6", resetControlsVisible ? "bg-rose-50/30 border-rose-100" : "bg-slate-50 border-slate-200")}>
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-rose-100">
            <ShieldAlert size={20} className="text-rose-500" />
            <h2 className="font-bold text-rose-900 underline decoration-rose-500/30 decoration-2 underline-offset-4">
              Danger Zone
            </h2>
          </div>

          {resetControlsVisible ? (
            <div className="space-y-4">
              <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-emerald-200 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900">Reset Attendance (Keep Sakit/Izin/Alfa)</h3>
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded border border-emerald-100 uppercase tracking-tighter">
                        Smart Mode
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed max-w-md">
                      Wipes standard attendance (Hadir, Late) but preserves your manual edits for Sakit, Izin, and Alfa. Ideal when re-uploading Excel data.
                    </p>
                  </div>
                  <button
                    onClick={() => { setResetMode("attendance_keep_exceptions"); setShowResetModal(true); setConfirmText(""); }}
                    className="px-6 py-3 bg-white text-emerald-600 border-2 border-emerald-100 font-bold rounded-xl hover:bg-emerald-50 hover:border-emerald-200 transition-all flex items-center gap-2 flex-shrink-0"
                  >
                    <Trash2 size={18} />
                    Clear Standard Attendance
                  </button>
                </div>
              </div>

              <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-amber-200 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900">Reset All Attendance</h3>
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded border border-amber-100 uppercase tracking-tighter">
                        Safe Mode
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed max-w-md">
                      Wipes ALL attendance logs including Sakit/Izin/Alfa and upload history, but preserves student master data. Ideal for starting a new period.
                    </p>
                  </div>
                  <button
                    onClick={() => { setResetMode("attendance"); setShowResetModal(true); setConfirmText(""); }}
                    className="px-6 py-3 bg-white text-amber-600 border-2 border-amber-100 font-bold rounded-xl hover:bg-amber-50 hover:border-amber-200 transition-all flex items-center gap-2 flex-shrink-0"
                  >
                    <Trash2 size={18} />
                    Clear All Attendance
                  </button>
                </div>
              </div>

              <div className="p-6 bg-white border border-rose-200 rounded-2xl shadow-sm hover:border-rose-300 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-rose-900">Full System Reset</h3>
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold rounded border border-rose-100 uppercase tracking-tighter">
                        Nuclear Option
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed max-w-md">
                      Warning: This action will permanently delete everything in the reset scope. This cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => { setResetMode("full"); setShowResetModal(true); setConfirmText(""); }}
                    className="px-6 py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-colors shadow-lg shadow-rose-600/20 flex items-center gap-2 flex-shrink-0"
                  >
                    <Trash2 size={18} />
                    Factory Reset
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Destructive operations are disabled in this environment. The reset controls stay hidden until the backend explicitly enables them.
            </div>
          )}
        </Card>

      </div>

      {resetSuccess && (
        <Alert variant="success" className="flex items-center gap-3 animate-in zoom-in-95 duration-500">
          <CheckCircle2 size={20} className="text-emerald-500" />
          <div>
            <p className="font-bold">System successfully reset!</p>
            <p className="text-xs font-medium opacity-80">All data has been wiped. You can now start fresh by uploading new documents.</p>
          </div>
        </Alert>
      )}

      {/* Reset Confirmation Modal */}
      <Dialog open={showResetModal} onOpenChange={(open) => !isResetting && setShowResetModal(open)}>
        <DialogContent className="max-w-md overflow-hidden p-0">
            {/* Header - Red Alert */}
            <div className={cn(
              "px-8 py-8 text-white text-center flex-shrink-0 transition-colors duration-500",
              resetMode === "full" ? "bg-rose-600" : "bg-amber-600"
            )}>
              <div className="w-16 h-16 bg-white/20 rounded-[9999px] flex items-center justify-center mx-auto mb-4 border-2 border-white/30 shadow-inner">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black tracking-tight mb-1 uppercase">
                {resetMode === "full" ? "Factory Reset" : "Clear Attendance"}
              </h3>
              <p className="text-white/80 text-sm font-medium">Selected: {resetMode === "full" ? "Complete Wipe" : "Attendance Only"}</p>
            </div>

            {/* Modal Body */}
            <div className="p-8 space-y-6">
              <div className={cn(
                "p-5 rounded-2xl border text-sm font-medium leading-relaxed transition-colors duration-500",
                resetMode === "full" 
                  ? "bg-rose-50 border-rose-100 text-rose-800" 
                  : "bg-amber-50 border-amber-100 text-amber-800"
              )}>
                {resetMode === "full"
                  ? "You are about to delete EVERYTHING in the reset scope, including students, attendance, overrides, and upload logs."
                  : "Students and classes will be kept. Only attendance history, overrides, and upload logs will be cleared."}
                <div className="mt-3 block text-[10px] uppercase font-black opacity-60">Verification Required</div>
                <div className="mt-1">
                  Please type <span className={cn(
                    "font-extrabold px-2 py-0.5 rounded ring-1",
                    resetMode === "full" ? "bg-rose-200/60 ring-rose-300" : "bg-amber-200/60 ring-amber-300"
                  )}>{RESET_CONFIRMATION}</span> below.
                </div>
              </div>


              <div className="space-y-3">
                <Label htmlFor="reset-confirmation" className="block px-1 text-xs uppercase tracking-widest">Confirmation Key</Label>
                <Input
                  id="reset-confirmation"
                  type="text"
                  autoFocus
                  placeholder={`Type "${RESET_CONFIRMATION}"...`}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmText === RESET_CONFIRMATION && handleResetData()}
                  className="h-14 text-center font-bold tracking-[.25em]"
                />
              </div>

              {error && (
                <p className="text-xs text-rose-600 font-bold bg-rose-50 py-2 px-3 rounded-lg border border-rose-100 text-center animate-pulse">{error}</p>
              )}

              <div className="flex gap-4 pt-2">
                <Button
                  variant="secondary"
                  disabled={isResetting}
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 uppercase tracking-widest"
                >
                  Cancel
                </Button>
                 <Button
                  onClick={handleResetData}
                  disabled={confirmText !== RESET_CONFIRMATION || isResetting}
                  variant={resetMode === "full" ? "danger" : "warning"}
                  className="flex-1 uppercase tracking-widest"
                >

                  {isResetting ? "Wiping..." : "Confirm Reset"}
                </Button>
              </div>
            </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

export default Settings;
