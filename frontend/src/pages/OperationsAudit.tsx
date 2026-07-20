import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { apiRequest } from "../lib/api/client";

interface AuditItem {
  event_id: string;
  occurred_at: string;
  actor_id: string;
  actor_role: string;
  capability: string;
  entity_type: string;
  entity_reference: string;
  operation: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source: string;
  reason?: string;
  import_session_id?: string;
  import_action_id?: number;
  rollback_action_id?: number;
  export_scope?: string;
  success: boolean;
  failure_code?: string;
  changed_fields?: any;
  request_correlation_id?: string;
  details?: Record<string, any>;
}

interface AuditResponse {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  items: AuditItem[];
}

export default function OperationsAudit() {
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState("");
  const [operation, setOperation] = useState("");
  const [entityType, setEntityType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [rollbackOnly, setRollbackOnly] = useState(false);

  const queryParams = new URLSearchParams({
    page: page.toString(),
    page_size: "25",
    ...(actor && { actor }),
    ...(operation && { operation }),
    ...(entityType && { entity_type: entityType }),
    ...(riskLevel && { risk_level: riskLevel }),
    ...(highRiskOnly && { high_risk_only: "true" }),
    ...(rollbackOnly && { rollback_activity: "true" }),
  });

  const { data, isLoading, isError, error, refetch } = useQuery<AuditResponse>({
    queryKey: ["operations-audit", page, actor, operation, entityType, riskLevel, highRiskOnly, rollbackOnly],
    queryFn: () => apiRequest(`/api/students/operations?${queryParams.toString()}`),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Audit Log</h1>
          <p className="text-sm text-slate-600">Track and review administrative actions, import provenance, and high-risk events.</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className="size-4" /> Refresh
        </button>
      </header>

      {/* Filter Bar */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Filter className="size-4" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Actor username…"
            value={actor}
            onChange={(e) => { setActor(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <input
            type="text"
            placeholder="Operation name…"
            value={operation}
            onChange={(e) => { setOperation(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <select
            value={riskLevel}
            onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="">All Risk Levels</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <div className="flex items-center gap-4 py-1">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={highRiskOnly}
                onChange={(e) => { setHighRiskOnly(e.target.checked); setPage(1); }}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              High-Risk Only
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={rollbackOnly}
                onChange={(e) => { setRollbackOnly(e.target.checked); setPage(1); }}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              Rollbacks Only
            </label>
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      {isLoading ? (
        <div role="status" className="p-8 text-center bg-white border border-slate-200 rounded-xl text-slate-500 font-medium">
          Loading audit events…
        </div>
      ) : isError ? (
        <div role="alert" className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-semibold text-sm">
          Failed to load operations audit log: {(error as Error)?.message || "Unknown error"}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="p-8 text-center bg-white border border-slate-200 rounded-xl text-slate-500 font-medium">
          No audit events found matching the selected filters.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Operation</th>
                  <th className="px-4 py-3">Entity Type</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Correlation ID</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800 font-mono">
                {data.items.map((item) => (
                  <tr key={item.event_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-sans whitespace-nowrap text-slate-600">
                      {item.occurred_at ? new Date(item.occurred_at).toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 font-sans font-medium text-slate-900">
                      {item.actor_id} <span className="text-slate-400 font-normal">({item.actor_role})</span>
                    </td>
                    <td className="px-4 py-3 font-sans font-bold text-slate-900">{item.operation}</td>
                    <td className="px-4 py-3 font-sans text-slate-600">{item.entity_type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                          item.risk_level === "CRITICAL"
                            ? "bg-rose-100 text-rose-800"
                            : item.risk_level === "HIGH"
                            ? "bg-orange-100 text-orange-800"
                            : item.risk_level === "MEDIUM"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.risk_level}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-sans">
                      {item.success ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                          <ShieldCheck className="size-3.5" /> SUCCESS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                          <ShieldAlert className="size-3.5" /> FAILED ({item.failure_code || "ERROR"})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {item.request_correlation_id ? item.request_correlation_id.slice(0, 8) : "-"}
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-600 text-[11px]">
                      {item.reason && <p className="font-medium">{item.reason}</p>}
                      {item.details && (
                        <span className="text-slate-400">
                          {Object.keys(item.details).length > 0 ? JSON.stringify(item.details) : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs">
            <span className="text-slate-600 font-medium">
              Showing page {data.page} of {data.pages || 1} ({data.total} total events)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white border border-slate-300 rounded font-medium disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 bg-white border border-slate-300 rounded font-medium disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
