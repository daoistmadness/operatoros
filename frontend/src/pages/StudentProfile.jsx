import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  TrendingUp,
  UserX,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import api from '../api';
import { cn } from '../lib/cn';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className={cn(
      'rounded-2xl border border-slate-200 bg-white shadow-sm p-5 flex items-start gap-4 border-l-4 transition-all duration-200 ease-out hover:border-brand/20 hover:shadow-md',
      color === 'green'  && 'border-l-emerald-400',
      color === 'amber'  && 'border-l-amber-400',
      color === 'red'    && 'border-l-rose-400',
      color === 'brand'  && 'border-l-brand',
    )}>
      <div className={cn(
        'p-2.5 rounded-xl shrink-0',
        color === 'green' && 'bg-emerald-50 text-emerald-600',
        color === 'amber' && 'bg-amber-50 text-amber-600',
        color === 'red'   && 'bg-rose-50 text-rose-600',
        color === 'brand' && 'bg-brand/10 text-brand',
      )}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-3xl font-extrabold text-slate-900 mt-0.5 tabular-nums">{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Calendar Heatmap ─────────────────────────────────────────────────────────
function CalendarHeatmap({ breakdown, year, month }) {
  const byDate = useMemo(() => {
    const map = {};
    for (const row of breakdown) {
      if (row.date) map[row.date] = row;
    }
    return map;
  }, [breakdown]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=Sun

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, date: dateStr, record: byDate[dateStr] || null });
  }

  function cellColor(record) {
    if (!record) return 'bg-slate-100 text-slate-300';
    if (record.status === 'on-time')   return 'bg-emerald-100 text-emerald-700';
    if (record.status === 'late')      return 'bg-amber-100 text-amber-700';
    if (record.status === 'absent')    return 'bg-rose-100 text-rose-600';
    if (record.status === 'incomplete') return 'bg-orange-100 text-orange-600';
    return 'bg-slate-100 text-slate-400';
  }

  function cellLabel(record) {
    if (!record) return '';
    if (record.status === 'on-time')   return '✓';
    if (record.status === 'late')      return '⏱';
    if (record.status === 'absent')    return '✗';
    if (record.status === 'incomplete') return '?';
    return '';
  }

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) =>
          cell === null ? (
            <div key={`empty-${idx}`} />
          ) : (
            <div
              key={cell.date}
              title={cell.record ? `${cell.date} — ${cell.record.status}${cell.record.scan_masuk ? ` · In: ${cell.record.scan_masuk}` : ''}${cell.record.terlambat ? ` · Late: ${cell.record.terlambat}` : ''}` : cell.date}
              className={cn(
                'aspect-square rounded-lg flex flex-col items-center justify-center cursor-default select-none transition-transform hover:scale-110',
                'text-xs font-bold',
                cellColor(cell.record),
              )}
            >
              <span className="text-[10px] opacity-70">{cell.day}</span>
              <span className="text-[9px]">{cellLabel(cell.record)}</span>
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-4 mt-3 flex-wrap justify-end">
        {[
          { label: 'On Time', cls: 'bg-emerald-100 text-emerald-700' },
          { label: 'Late', cls: 'bg-amber-100 text-amber-700' },
          { label: 'Absent', cls: 'bg-rose-100 text-rose-600' },
          { label: 'Incomplete', cls: 'bg-orange-100 text-orange-600' },
          { label: 'No Data', cls: 'bg-slate-100 text-slate-400' },
        ].map(({ label, cls }) => (
          <span key={label} className={cn('px-2 py-0.5 rounded text-[10px] font-semibold', cls)}>{label}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');

  // Month selector state — derived from history once loaded
  const [selectedMonth, setSelectedMonth] = useState(null); // { year, month }

  // ── Fetch monthly-history (for trend chart + month selector) ──────────────
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.get(`/api/students/${id}/monthly-history`);
      const data = res.data;
      setHistory(data);
      // Default to the last/most recent month
      if (data.history && data.history.length > 0) {
        const last = data.history[data.history.length - 1];
        setSelectedMonth({ year: last.year, month: last.month });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load attendance history.');
    } finally {
      setLoadingHistory(false);
    }
  }, [id]);

  // ── Fetch attendance summary for selected month ────────────────────────────
  const fetchSummary = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadingSummary(true);
    try {
      const res = await api.get(`/api/students/${id}/attendance-summary`, {
        params: { month: selectedMonth.month, year: selectedMonth.year },
      });
      setSummary(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load attendance summary.');
    } finally {
      setLoadingSummary(false);
    }
  }, [id, selectedMonth]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Trend Chart Data ──────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!history?.history?.length) return null;
    const labels = history.history.map(h => h.month_label);
    const rates = history.history.map(h =>
      h.attendance_rate !== null ? Math.round(h.attendance_rate * 100) : null
    );
    const lates = history.history.map(h => h.late);

    return {
      labels,
      datasets: [
        {
          label: 'Attendance Rate %',
          data: rates,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          label: 'Late Days',
          data: lates,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.07)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.35,
          yAxisID: 'y1',
        },
      ],
    };
  }, [history]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { boxWidth: 12, font: { size: 11 }, color: '#64748b' },
      },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ctx.dataset.label === 'Attendance Rate %'
              ? ` ${ctx.raw ?? '—'}%`
              : ` ${ctx.raw ?? '—'} days`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { font: { size: 11 }, color: '#94a3b8' },
      },
      y: {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 100,
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { callback: (v) => `${v}%`, font: { size: 11 }, color: '#94a3b8' },
      },
      y1: {
        type: 'linear',
        position: 'right',
        min: 0,
        grid: { drawOnChartArea: false },
        ticks: { font: { size: 11 }, color: '#f59e0b' },
      },
    },
  }), []);

  // ── Derived student info ───────────────────────────────────────────────────
  const studentName = history?.nama || summary?.nama || '—';
  const className   = history?.class_name || summary?.class_name || '—';
  const jenjang     = history?.jenjang || summary?.jenjang || '—';

  const ratePercent = summary?.attendance_rate !== null && summary?.attendance_rate !== undefined
    ? `${Math.round(summary.attendance_rate * 100)}%`
    : '—';

  const rateColor =
    summary?.attendance_rate >= 0.9 ? 'green'
    : summary?.attendance_rate >= 0.75 ? 'amber'
    : 'red';

  const allMonths = history?.history ?? [];

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle size={32} className="text-rose-400" />
          <p className="font-semibold text-slate-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── Back button ────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
            <GraduationCap size={28} className="text-brand" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight truncate">
              {loadingHistory ? (
                <span className="inline-block w-48 h-6 bg-slate-100 rounded animate-pulse" />
              ) : studentName}
            </h1>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1">
              <span className="text-sm text-slate-500 font-medium">
                Class <span className="font-bold text-slate-700">{className}</span>
              </span>
              <span className="text-sm text-slate-500 font-medium">
                Jenjang <span className="font-bold text-slate-700">{jenjang}</span>
              </span>
            </div>
          </div>
          <div className="sm:ml-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand bg-brand/10 px-3 py-1.5 rounded-[9999px]">
              <BarChart3 size={12} /> Attendance Profile
            </span>
          </div>
        </div>
      </div>

      {/* ── Month Selector ─────────────────────────────────────────────── */}
      {!loadingHistory && allMonths.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
            <CalendarDays size={13} /> Select Month
          </p>
          <div className="flex flex-wrap gap-2">
            {allMonths.map(h => {
              const isSelected = selectedMonth?.year === h.year && selectedMonth?.month === h.month;
              const rateVal = h.attendance_rate !== null ? Math.round(h.attendance_rate * 100) : null;
              return (
                <button
                  key={h.month_label}
                  onClick={() => setSelectedMonth({ year: h.year, month: h.month })}
                  className={cn(
                    'px-3 py-1.5 rounded-xl border text-sm font-semibold transition-all',
                    isSelected
                      ? 'bg-brand text-white border-brand shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-brand/40 hover:bg-brand/5'
                  )}
                >
                  {MONTH_NAMES[h.month].slice(0, 3)} {h.year}
                  {rateVal !== null && (
                    <span className={cn(
                      'ml-1.5 text-[10px] font-bold',
                      isSelected ? 'text-white/80' : rateVal >= 90 ? 'text-emerald-600' : rateVal >= 75 ? 'text-amber-600' : 'text-rose-500'
                    )}>{rateVal}%</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Stat Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          label="Attendance Rate"
          value={loadingSummary ? '…' : ratePercent}
          sub={`HEB: ${summary?.heb ?? '—'} days`}
          color={loadingSummary ? 'brand' : rateColor}
        />
        <StatCard
          icon={CheckCircle2}
          label="Total Present"
          value={loadingSummary ? '…' : summary?.total_present}
          sub={`+ ${summary?.total_late ?? 0} late`}
          color="green"
        />
        <StatCard
          icon={Clock}
          label="Late Days"
          value={loadingSummary ? '…' : summary?.total_late}
          sub={null}
          color="amber"
        />
        <StatCard
          icon={UserX}
          label="Absent Days"
          value={loadingSummary ? '…' : (summary ? (summary.sakit + summary.izin + summary.alfa) : '—')}
          sub={loadingSummary ? null : `S:${summary?.sakit ?? 0} I:${summary?.izin ?? 0} A:${summary?.alfa ?? 0}`}
          color="red"
        />
      </div>

      {/* ── Trend Chart ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-brand" />
          Attendance Trend
        </h2>
        {loadingHistory ? (
          <div className="h-52 flex items-center justify-center text-slate-400 text-sm">Loading chart…</div>
        ) : chartData ? (
          <div className="h-52">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="h-52 flex items-center justify-center text-slate-400 text-sm">No data available.</div>
        )}
      </div>

      {/* ── Calendar Heatmap + Breakdown Table ─────────────────────────── */}
      {selectedMonth && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

          {/* Calendar */}
          <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <CalendarDays size={18} className="text-brand" />
              {MONTH_NAMES[selectedMonth.month]} {selectedMonth.year}
            </h2>
            {loadingSummary ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
            ) : (
              <CalendarHeatmap
                breakdown={summary?.breakdown ?? []}
                year={selectedMonth.year}
                month={selectedMonth.month}
              />
            )}
          </div>

          {/* Breakdown table */}
          <div className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-800 mb-4">Daily Breakdown</h2>
            {loadingSummary ? (
              <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
            ) : !summary?.breakdown?.length ? (
              <div className="p-8 text-center text-slate-400 text-sm">No records for this month.</div>
            ) : (
              <div className="overflow-auto max-h-72 rounded-xl border border-slate-100 custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Date', 'Status', 'Check-In', 'Late'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {summary.breakdown.map((row) => (
                      <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.date}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-[9999px] text-[10px] font-bold capitalize',
                            row.status === 'on-time'    && 'bg-emerald-100 text-emerald-700',
                            row.status === 'late'       && 'bg-amber-100 text-amber-700',
                            row.status === 'absent'     && 'bg-rose-100 text-rose-600',
                            row.status === 'incomplete' && 'bg-orange-100 text-orange-600',
                          )}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.scan_masuk || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-amber-600">{row.terlambat || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
