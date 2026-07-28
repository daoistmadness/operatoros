import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle, ShieldCheck, X } from 'lucide-react';
import { selfConfirmCorrection } from '../features/operator-work-queue';

type Correction = {
  id: number;
  version: number;
  original_snapshot?: { status?: string | null } | null;
  proposed_status?: string | null;
  explanation?: string | null;
};

type CorrectionSelfConfirmModalProps = {
  correction?: Correction | null;
  onClose: () => void;
  onSuccess?: (result: Record<string, unknown>) => void;
};

function errorField(error: unknown, field: 'code' | 'message'): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidates: unknown[] = [];
  if ('response' in error && error.response && typeof error.response === 'object' && 'data' in error.response) {
    candidates.push(error.response.data);
  }
  if ('data' in error) candidates.push(error.data);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || !('detail' in candidate)) continue;
    const detail = candidate.detail;
    if (detail && typeof detail === 'object' && field in detail) {
      const value = field === 'code'
        ? ('code' in detail ? detail.code : undefined)
        : ('message' in detail ? detail.message : undefined);
      if (typeof value === 'string') return value;
    }
  }
  return field === 'message' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : undefined;
}

export default function CorrectionSelfConfirmModal({
  correction,
  onClose,
  onSuccess,
}: CorrectionSelfConfirmModalProps) {
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!correction) return null;

  const isPhraseValid = confirmationPhrase.trim() === 'CONFIRM_CORRECTION';
  const isNoteValid = note.trim().length >= 3;
  const canSubmit = isPhraseValid && isNoteValid && !isSubmitting;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await selfConfirmCorrection(correction.id, {
        expected_version: correction.version,
        confirmation: confirmationPhrase.trim(),
        confirmation_note: note.trim(),
      });
      if (onSuccess) onSuccess(result);
      onClose();
    } catch (err: unknown) {
      const code = errorField(err, 'code');
      const message = errorField(err, 'message');
      if (code === 'CORRECTION_STALE_VERSION') {
        setErrorMessage('Versi permintaan telah berubah. Silakan segarkan halaman dan coba lagi.');
      } else {
        setErrorMessage(message || 'Gagal mengonfirmasi koreksi.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-semibold">Konfirmasi Mandiri Koreksi Kehadiran</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-950 dark:bg-rose-900/30 dark:text-rose-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Diffs */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-slate-500">Status Asli</span>
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  {correction.original_snapshot?.status || 'N/A'}
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">Proposed Status</span>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {correction.proposed_status}
                </p>
              </div>
            </div>
            <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
              <span className="text-xs text-slate-500">Penjelasan Pengajuan:</span>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{correction.explanation}</p>
            </div>
          </div>

          {/* Confirmation Phrase */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Ketik Kalimat Konfirmasi: <span className="font-mono font-bold text-emerald-600">CONFIRM_CORRECTION</span>
            </label>
            <input
              type="text"
              value={confirmationPhrase}
              onChange={(e) => setConfirmationPhrase(e.target.value)}
              placeholder="CONFIRM_CORRECTION"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Confirmation Note */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Catatan Konfirmasi Operator <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Jelaskan dasar konfirmasi mandiri (min. 3 karakter)..."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <span className="font-semibold">Perhatian:</span> Tindakan ini akan dicatat dalam audit append-only secara permanen dengan penanda konfirmasi mandiri.
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              {isSubmitting ? 'Terapkan...' : 'Konfirmasi & Terapkan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
