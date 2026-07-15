import React, { useMemo, useState } from "react";
import api from "../api";
import { Link, useNavigate } from "react-router-dom";
import { 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Info, 
  ArrowRight,
  AlertTriangle,
  Download,
  RotateCcw,
  LayoutDashboard,
  ArrowUpRight,
  Ban
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { buildApiUrl } from "../lib/api/client";

function Upload() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null); // string | { error, message, hint } | null
  const [copied, setCopied] = useState(false);

  const summaryMetrics = useMemo(() => {
    const safe = report || {};
    const rowsInserted = Number(safe.rows_inserted || 0);
    const rowsUpdated = Number(safe.rows_updated || 0);
    const skippedEmpty = Number(safe.skipped_empty || 0);
    const failedRows = Number(safe.failed_rows || 0);
    const nullOverwriteBlocked = Number(safe.null_overwrite_blocked || 0);
    const parseWarnings = Number(safe.scans_coerced_to_null || 0) + Number(safe.dates_coerced_to_null || 0);

    return {
      recordsImported: rowsInserted + rowsUpdated,
      rowsUpdated,
      skippedEmpty,
      failedRows,
      nullOverwriteBlocked,
      parseWarnings,
      pendingCategorizationCount: Number(safe.pending_categorization_count || 0),
      rowErrors: Array.isArray(safe.row_errors) ? safe.row_errors : [],
    };
  }, [report]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError(null);
    setReport(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setReport(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await api.post("/uploads/upload", formData);
      setReport(response.data.report);
      setFile(null);
    } catch (err) {
      setReport(null);
      // detail can be a string (400) or an object (500)
      const detail = err.response?.data?.detail;
      if (detail && typeof detail === "object") {
        setError(detail);
      } else {
        setError(detail || "An unexpected error occurred. Check the browser console and backend logs.");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleCopyError = () => {
    const text = typeof error === "object"
      ? `${error.error}: ${error.message}`
      : error;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleUploadAnother = () => {
    setFile(null);
    setReport(null);
    setError(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Import Attendance Data</h1>
        <p className="text-slate-500 max-w-md mx-auto">Sync your biometric machine logs with the OperatorOS analytics engine.</p>
      </header>

      <div className="card p-10 bg-white border-2 border-dashed border-slate-200 hover:border-brand/40 transition-all duration-200 group">
        <div className="flex flex-col items-center justify-center space-y-6 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300 group-hover:bg-brand/10 group-hover:text-brand transition-all duration-200">
            <UploadCloud size={40} />
          </div>
          
          <div className="space-y-2">
            <p className="text-xl font-bold text-slate-800">
              {file ? file.name : "Select or drag Excel file"}
            </p>
            <p className="text-slate-400 text-sm italic">Supports .xlsx and .xls (Attendance Machine Export)</p>
          </div>

          <label className="btn-primary cursor-pointer group-hover:scale-105 transition-transform">
            Browse Files
            <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      <AnimatePresence>
        {file && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center justify-between p-4 bg-brand/5 border border-brand/20 rounded-2xl"
          >
            <div className="flex items-center gap-3">
              <FileText className="text-brand" />
              <span className="font-medium text-slate-700">{file.name}</span>
            </div>
            <button 
              onClick={handleUpload}
              disabled={uploading}
              className="px-6 py-2 bg-brand text-white font-bold rounded-xl hover:bg-brand-hover disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? "Processing..." : "Process Import"}
              {!uploading && <ArrowRight size={18} />}
            </button>
          </motion.div>
        )}

        {report && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-8 bg-green-50 border-green-100 shadow-lg shadow-green-900/5 ring-1 ring-green-600/10"
          >
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle2 className="text-green-600" size={28} />
              <h3 className="text-xl font-bold text-green-900">Upload Complete</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <ReportStat label="Records Imported" value={summaryMetrics.recordsImported} />
              <ReportStat label="Updated" value={summaryMetrics.rowsUpdated} />
              <ReportStat label="Skipped Empty" value={summaryMetrics.skippedEmpty} />
              <ReportStat label="Failed Rows" value={summaryMetrics.failedRows} />
              <ReportStat label="Null Overwrites Blocked" value={summaryMetrics.nullOverwriteBlocked} />
              <ReportStat label="Parse Warnings" value={summaryMetrics.parseWarnings} />
            </div>

            {summaryMetrics.pendingCategorizationCount > 0 && (
              <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    ⚠️ {summaryMetrics.pendingCategorizationCount} students have no class assigned.
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Some charts and reports will be incomplete until classes are mapped.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/mapping")}
                  className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors inline-flex items-center gap-1"
                >
                  Go to Class Mapping <ArrowUpRight size={14} />
                </button>
              </div>
            )}

            {summaryMetrics.rowErrors.length > 0 && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <h4 className="text-sm font-bold text-slate-800">
                    ⚠️ {summaryMetrics.rowErrors.length} rows had issues (showing first 10):
                  </h4>
                </div>
                <div className="bg-white rounded-2xl border border-amber-100 overflow-hidden">
                  <div className="max-h-56 overflow-y-auto divide-y divide-amber-50 font-mono text-xs">
                    {summaryMetrics.rowErrors.slice(0, 10).map((row, idx) => (
                      <div key={`${row.excel_row}-${idx}`} className="px-4 py-3 space-y-1.5">
                        <div className="text-slate-700">
                          Row {row.excel_row ?? "?"} — {row.no_id ?? "N/A"} {row.nama ?? "Unknown"}
                        </div>
                        <div className="text-slate-500">Date: {row.date || "N/A"}</div>
                        <div className="text-rose-600">Reason: {row.reason || "Unknown parsing issue"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleUploadAnother}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <RotateCcw size={14} /> Upload Another File
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-hover inline-flex items-center gap-2"
              >
                <LayoutDashboard size={14} /> Go to Dashboard
              </button>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card overflow-hidden border-red-200"
          >
            {/* Error header */}
            <div className="bg-red-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <XCircle className="text-white flex-shrink-0" size={22} />
                <h4 className="font-bold text-white text-lg">Import Failed</h4>
              </div>
              <button
                onClick={handleCopyError}
                title="Copy error to clipboard"
                className="text-red-200 hover:text-white text-xs font-semibold border border-red-400 hover:border-white px-3 py-1 rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Copy error"}
              </button>
            </div>

            <div className="p-6 bg-red-50 space-y-4">
              {/* Error body — object (500) or string (400) */}
              {typeof error === "object" ? (
                <>
                  <div className="bg-white rounded-xl border border-red-200 divide-y divide-red-100">
                    <div className="px-4 py-3 flex gap-3">
                      <span className="text-xs font-bold text-red-400 uppercase tracking-widest w-20 pt-0.5 flex-shrink-0">Type</span>
                      <code className="text-red-800 text-sm font-mono">{error.error}</code>
                    </div>
                    <div className="px-4 py-3 flex gap-3">
                      <span className="text-xs font-bold text-red-400 uppercase tracking-widest w-20 pt-0.5 flex-shrink-0">Message</span>
                      <p className="text-red-900 text-sm">{error.message}</p>
                    </div>
                    {error.hint && (
                      <div className="px-4 py-3 flex gap-3">
                        <span className="text-xs font-bold text-red-400 uppercase tracking-widest w-20 pt-0.5 flex-shrink-0">Hint</span>
                        <p className="text-red-700 text-sm">{error.hint}</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-white rounded-xl border border-red-200 px-4 py-3">
                  <p className="text-red-900 text-sm">{error}</p>
                </div>
              )}

              {/* Common causes checklist */}
              <div className="pt-2">
                <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3">Common causes</p>
                <ul className="space-y-2">
                  {[
                    "File is not .xlsx or .xls (CSV not supported)",
                    "Required column is missing or misspelled (No. ID, Nama, Tanggal, Scan Masuk, Terlambat)",
                    "'Tanggal' column contains text, not a real date",
                    "File is password-protected or corrupted",
                    "Sheet has merged header rows or extra blank rows at the top",
                  ].map((cause, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                      <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>
                      {cause}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadAnother}
                  className="px-3 py-2 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 inline-flex items-center gap-1"
                >
                  <RotateCcw size={13} /> Try Another Upload
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 inline-flex items-center gap-1"
                >
                  <Ban size={13} /> Back to Dashboard
                </button>
              </div>

              <p className="text-xs text-red-500 pt-1">
                If the file looks correct, check the backend terminal for the full stack trace.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card p-6 bg-slate-50 border-slate-200 border-dashed">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
              <Info size={18} className="text-brand" />
              Expected Format
            </h4>
            <p className="text-slate-500 text-sm leading-relaxed">
              The system expects biometric export columns: <code className="bg-white px-1 border rounded text-brand font-bold">No. ID</code>, <code className="bg-white px-1 border rounded text-brand font-bold">Nama</code>, <code className="bg-white px-1 border rounded text-brand font-bold">Tanggal</code>, <code className="bg-white px-1 border rounded text-brand font-bold">Scan Masuk</code>, and <code className="bg-white px-1 border rounded text-brand font-bold">Terlambat</code>.
            </p>
          </div>
          <a
            href={buildApiUrl("/uploads/sample-template")}
            download="attendance_template.xlsx"
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-brand text-white font-semibold rounded-xl hover:bg-brand-hover transition-colors shadow-sm text-sm"
          >
            <Download size={16} />
            Download Template
          </a>
        </div>
      </div>
    </div>
  );
}

const ReportStat = ({ label, value }) => (
  <div className="bg-white p-4 rounded-2xl shadow-sm border border-green-100">
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-800 leading-tight">{value}</p>
    </div>
  </div>
);

export default Upload;
