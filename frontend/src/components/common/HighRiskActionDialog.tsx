import React, { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

interface HighRiskActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  consequence: string;
  affectedRecordCount: number;
  historyPreserved?: boolean;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void> | void;
  requireReason?: boolean;
}

const FORBIDDEN_LABELS = new Set(["confirm", "submit", "ok", "yes"]);

export function HighRiskActionDialog({
  open,
  onOpenChange,
  title,
  consequence,
  affectedRecordCount,
  historyPreserved = true,
  confirmLabel,
  onConfirm,
  requireReason = true,
}: HighRiskActionDialogProps) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizedLabel = confirmLabel.trim().toLowerCase();
  if (FORBIDDEN_LABELS.has(normalizedLabel)) {
    throw new Error(
      `Forbidden confirmation label '${confirmLabel}'. High-risk dialogs must use descriptive action names (e.g., 'Apply 42 Student Updates', 'Apply Compensating Rollback').`
    );
  }

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) {
      setErrorMessage("Please enter a reason before proceeding.");
      return;
    }

    setErrorMessage(null);
    setIsPending(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (err: any) {
      setErrorMessage(err?.message || "An error occurred while executing the high-risk action.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg border-amber-200 bg-white">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-amber-700 font-bold">
            <AlertTriangle className="size-5" />
            <AlertDialogTitle className="text-lg font-bold text-slate-900">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-sm text-slate-600 space-y-3 mt-2">
            <p className="font-semibold text-slate-900">{consequence}</p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1 text-amber-900 font-medium">
              <div>• <strong className="font-bold">Affected records:</strong> {affectedRecordCount}</div>
              <div>
                • <strong className="font-bold">History preservation:</strong>{" "}
                {historyPreserved
                  ? "Preserved (append-only ledger audit trail)"
                  : "Non-historical mutation"}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Reason for this action {requireReason && <span className="text-rose-600">*</span>}
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            placeholder="Explain why this high-risk administrative action is required…"
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />

          {errorMessage && (
            <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 font-semibold">
              {errorMessage}
            </div>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="text-xs font-medium"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || (requireReason && !reason.trim())}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Processing…
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
