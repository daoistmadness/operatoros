import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { History, RefreshCw, FileSpreadsheet } from "lucide-react";

import api from "../api";
import { getPageApiError } from "../lib/api/errors";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusStyles(status) {
  if (status === "success") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "partial") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-rose-100 text-rose-800";
}

function UploadHistory() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const fetchHistory = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError("");
      const response = await api.get("/api/uploads/history");
      setHistory(Array.isArray(response.data) ? response.data : []);
    } catch (fetchError) {
      setError(getPageApiError(fetchError, "Failed to load upload history."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Upload History</h1>
          <p className="text-slate-500 mt-2">Latest 20 upload attempts with status and import metrics.</p>
        </div>
        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
          className="px-4 py-2 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover disabled:opacity-60 flex items-center gap-2"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="card p-4 bg-rose-50 border border-rose-200 text-rose-800 font-medium">{error}</div>
      )}

      <div className="card p-6 bg-white">
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-500">Loading upload history...</div>
        ) : history.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-slate-500 gap-3">
            <History size={26} />
            <p>No uploads recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-3 pr-4 font-semibold">Uploaded At</th>
                  <th className="py-3 pr-4 font-semibold">Filename</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-4 font-semibold">Total</th>
                  <th className="py-3 pr-4 font-semibold">New Students</th>
                  <th className="py-3 pr-4 font-semibold">Late Entries</th>
                  <th className="py-3 pr-4 font-semibold">Failed Rows</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <motion.tr
                    key={item.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-3 pr-4 text-slate-700">{formatDateTime(item.uploaded_at)}</td>
                    <td className="py-3 pr-4 text-slate-800 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <FileSpreadsheet size={16} className="text-brand" />
                        {item.filename}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-1 rounded-[9999px] text-xs font-bold uppercase ${getStatusStyles(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{item.total_records}</td>
                    <td className="py-3 pr-4 text-slate-700">{item.new_students}</td>
                    <td className="py-3 pr-4 text-slate-700">{item.late_entries}</td>
                    <td className="py-3 pr-4 text-slate-700">{item.failed_rows}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadHistory;
