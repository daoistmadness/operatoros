import React, { useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  Download,
  BriefcaseBusiness,
  FileSpreadsheet,
  Loader2,
  Printer,
  Search,
  TimerReset,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { createDownloadUrl, revokeDownloadUrl } from '../lib/api/client';
import { PageHeader } from "../components/common/page-header";
import {
  downloadTardinessExcel,
  downloadTardinessManagementExcel,
  getTardinessReport,
  getTardinessSummaryByJenjang,
  getJenjangs,
} from '../lib/api/endpoints';
import { TERM_OPTIONS } from '../lib/reportPeriods';
import { HebBadgeRow } from '../components/HebBadgeRow';

const FILTER_MODES = [
  { value: 'month', label: 'Month' },
  { value: 'date_range', label: 'Date Range' },
  { value: 'term', label: 'Term' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function formatLocalDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildParams({ filterMode, month, year, term, dateFrom, dateTo, jenjang }) {
  let params = {};
  if (filterMode === 'date_range') {
    params = { date_from: dateFrom, date_to: dateTo };
  } else if (filterMode === 'term') {
    params = { term, year };
  } else {
    params = { month, year };
  }

  if (jenjang && jenjang !== 'All') {
    params.jenjang = jenjang;
  }

  return params;
}

function sanitizePeriodLabel(label) {
  return (label || 'period')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function SummaryCard({ title, value, icon, tone }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 print:border print:shadow-none print:rounded-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg', tone)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 animate-pulse">
        <div className="h-6 w-56 bg-slate-200 rounded" />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 animate-pulse">
        <div className="h-5 w-48 bg-slate-200 rounded" />
        <div className="mt-4 h-72 rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="mx-auto w-14 h-14 rounded-[9999px] bg-slate-100 flex items-center justify-center text-slate-400">
        <CalendarDays size={24} />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">No tardiness data found for this period.</h3>
      <p className="mt-2 text-sm text-slate-500">Try changing the reporting period and generate the report again.</p>
    </div>
  );
}

function TardinessBarChart({ data }) {
  const chartData = data.slice(0, 12);
  const maxValue = Math.max(...chartData.map((item) => item.total_kejadian), 0);

  if (chartData.length === 0) {
    return null;
  }

  const width = 680;
  const height = 280;
  const padding = { top: 24, right: 24, bottom: 52, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const gap = 16;
  const barWidth = (innerWidth - gap * (chartData.length - 1)) / chartData.length;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 print:border-slate-300">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-800">Late Incident Distribution by Level</h4>
          <p className="text-sm text-slate-500">Green bars show total late incidents for the selected reporting period.</p>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          stroke="#CBD5E1"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          stroke="#CBD5E1"
          strokeWidth="1"
        />

        {chartData.map((item, index) => {
          const barHeight = maxValue === 0 ? 0 : (item.total_kejadian / maxValue) * innerHeight;
          const x = padding.left + index * (barWidth + gap);
          const y = padding.top + innerHeight - barHeight;
          const labelX = x + barWidth / 2;

          return (
            <g key={item.jenjang}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="10" fill="#22C55E" />
              <text x={labelX} y={y - 8} textAnchor="middle" fontSize="13" fill="#166534" fontWeight="700">
                {item.total_kejadian}
              </text>
              <text
                x={labelX}
                y={padding.top + innerHeight + 24}
                textAnchor="middle"
                fontSize="13"
                fill="#475569"
                fontWeight="600"
              >
                {item.jenjang}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TardinessReport() {
  const today = useMemo(() => new Date(), []);
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const currentMonthStart = useMemo(() => formatLocalDate(currentYear, today.getMonth(), 1), [currentYear, today]);
  const currentMonthEnd = useMemo(
    () => formatLocalDate(currentYear, today.getMonth(), new Date(currentYear, today.getMonth() + 1, 0).getDate()),
    [currentYear, today]
  );

  const [filterMode, setFilterMode] = useState('month');
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [term, setTerm] = useState(1);
  const [dateFrom, setDateFrom] = useState(currentMonthStart);
  const [dateTo, setDateTo] = useState(currentMonthEnd);
  const [jenjangs, setJenjangs] = useState([]);
  const [selectedJenjang, setSelectedJenjang] = useState('All');
  const [loading, setLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingManagementExcel, setExportingManagementExcel] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [jenjangSummaryRows, setJenjangSummaryRows] = useState([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  React.useEffect(() => {
    getJenjangs().then(setJenjangs).catch(console.error);
  }, []);

  const groupedClasses = useMemo(() => {
    const rows = report?.breakdown_by_class || [];
    return rows.reduce((accumulator, row) => {
      if (!accumulator[row.jenjang]) {
        accumulator[row.jenjang] = [];
      }
      accumulator[row.jenjang].push(row);
      return accumulator;
    }, {});
  }, [report]);

  const totals = report?.totals || {
    total_late_duration_str: '00:00',
    total_days_late: 0,
    total_late_incidents: 0,
    unique_late_days: 0,
    tracked_school_days: 0,
    school_impact_rate_pct: 0,
    average_lateness_density: 0,
    total_students_ever_late: 0,
  };

  const managementSummary = report?.management_summary || {
    total_late_incidents: 0,
    unique_late_days: 0,
    tracked_school_days: 0,
    school_impact_rate_pct: 0,
    average_lateness_density: 0,
  };

  const currentParams = useMemo(
    () => buildParams({ filterMode, month, year, term, dateFrom, dateTo, jenjang: selectedJenjang }),
    [filterMode, month, year, term, dateFrom, dateTo, selectedJenjang]
  );

  const totalIncidentCount = totals.total_late_incidents || totals.total_days_late;
  const hasData = Boolean(report) && totalIncidentCount > 0;

  const handleGenerateReport = async () => {
    setLoading(true);
    setError('');
    setHasGenerated(true);

    try {
      const [nextReport, nextJenjangSummary] = await Promise.all([
        getTardinessReport(currentParams),
        getTardinessSummaryByJenjang(currentParams),
      ]);
      setReport(nextReport);
      setJenjangSummaryRows(nextJenjangSummary.rows);
    } catch (requestError) {
      setReport(null);
      setJenjangSummaryRows([]);
      setError(requestError.response?.data?.detail || requestError.message || 'Gagal memuat laporan keterlambatan.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!report) {
      return;
    }

    setExportingExcel(true);
    try {
      const blob = await downloadTardinessExcel(currentParams);
      const url = createDownloadUrl(blob);
      const link = document.createElement('a');
      const periodSlug = sanitizePeriodLabel(report.period?.label);
      link.href = url;
      link.download = `tardiness_report_${periodSlug}.xlsx`;
      link.click();
      revokeDownloadUrl(url);
    } catch (downloadError) {
      setError(downloadError.response?.data?.detail || downloadError.message || 'Gagal mengunduh file Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handlePrint = () => {
    if (!report) {
      return;
    }

    setPrinting(true);
    document.body.classList.add('printing-tardiness-report');

    const cleanup = () => {
      document.body.classList.remove('printing-tardiness-report');
      window.removeEventListener('afterprint', cleanup);
      setPrinting(false);
    };

    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const handleExportManagementExcel = async () => {
    if (!report) {
      return;
    }

    setExportingManagementExcel(true);
    try {
      const blob = await downloadTardinessManagementExcel(currentParams);
      const url = createDownloadUrl(blob);
      const link = document.createElement('a');
      const periodSlug = sanitizePeriodLabel(report.period?.label);
      link.href = url;
      link.download = `executive_tardiness_summary_${periodSlug}.xlsx`;
      link.click();
      revokeDownloadUrl(url);
    } catch (downloadError) {
      setError(downloadError.response?.data?.detail || downloadError.message || 'Gagal mengunduh file Excel eksekutif.');
    } finally {
      setExportingManagementExcel(false);
    }
  };

  return (
    <div className="space-y-8 tardiness-report-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { font-size: 11pt; background: white !important; }
          table { page-break-inside: avoid; }
          body.printing-tardiness-report .app-sidebar { display: none !important; }
          body.printing-tardiness-report .app-main { margin-left: 0 !important; padding: 0 !important; }
          body.printing-tardiness-report .report-print-area { padding: 0 !important; }
          body.printing-tardiness-report .report-section { box-shadow: none !important; border-radius: 0 !important; border-color: #cbd5e1 !important; }
        }
      `}</style>

      <PageHeader
        className="no-print"
        title="Tardiness Report"
        description="Analyze student tardiness distribution by level and by class."
      />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 filter-bar no-print">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-end">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Period Mode</label>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
              {FILTER_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilterMode(option.value)}
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                    filterMode === option.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Period</label>
            {filterMode === 'month' && (
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={month}
                  onChange={(event) => setMonth(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {MONTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1900"
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            )}

            {filterMode === 'date_range' && (
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            )}

            {filterMode === 'term' && (
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={term}
                  onChange={(event) => setTerm(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {TERM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1900"
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            )}
          </div>
          
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Level (Jenjang)</label>
            <select
              value={selectedJenjang}
              onChange={(event) => setSelectedJenjang(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="All">All Levels</option>
              {jenjangs.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={handleGenerateReport}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-2.5 font-medium text-white transition-all duration-150 ease-out hover:bg-brand-hover focus:ring-4 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 w-full h-[46px] font-bold"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
              <span>{loading ? 'Loading...' : 'Generate Report'}</span>
            </button>
          </div>

          <div className="export-actions">
            {report ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={exportingExcel}
                  className="h-[46px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {exportingExcel ? <Loader2 className="animate-spin" size={18} /> : <FileSpreadsheet size={18} />}
                  <span>Export Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportManagementExcel}
                  disabled={exportingManagementExcel}
                  className="h-[46px] rounded-xl border border-indigo-200 bg-indigo-50 px-4 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {exportingManagementExcel ? <Loader2 className="animate-spin" size={18} /> : <BriefcaseBusiness size={18} />}
                  <span>Export Executive</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printing}
                  className="h-[46px] rounded-xl border border-slate-200 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  <span>Print PDF</span>
                </button>
              </div>
            ) : (
              <div className="h-[46px] rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 flex items-center justify-center text-sm text-slate-400">
                Export is available after the report is generated
              </div>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800 flex items-start gap-3 no-print">
          <TriangleAlert className="mt-0.5" size={20} />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {loading && <LoadingSkeleton />}

      {!loading && hasGenerated && !hasData && !error && <EmptyState />}

      {!loading && report && hasData && (
        <section className="report-print-area space-y-8">
          <div className="report-section rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-10 text-center print:border print:shadow-none print:rounded-none">
            <h2 className="text-2xl md:text-3xl font-black tracking-wide text-slate-900 uppercase">{report.report_title}</h2>
            <p className="mt-2 text-lg font-semibold text-slate-700 uppercase">{report.school_name}</p>
            <p className="mt-2 text-base text-slate-500">{report.period.label}</p>
            <div className="flex justify-center mt-4 no-print">
              <HebBadgeRow hebByJenjang={report?.heb_by_jenjang} />
            </div>
          </div>

          <div className="report-section rounded-2xl border border-slate-200 bg-white shadow-sm p-6 print:border print:shadow-none print:rounded-none">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-slate-900">Management Summary</h3>
              <p className="text-sm text-slate-500">Separates total late incidents from the actual number of school days affected.</p>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-5 text-white shadow-lg shadow-emerald-900/10">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100">Executive Summary</p>
                  <h4 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">{managementSummary.total_late_incidents}</h4>
                  <p className="mt-2 text-lg font-semibold text-white">Total Incidents</p>
                  <p className="mt-1 text-sm text-emerald-50">Accumulated late entries for the active report filter.</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-emerald-50 backdrop-blur-sm md:max-w-sm">
                  <p className="font-semibold text-white">Filter-aware summary</p>
                  <p className="mt-1">This number always follows the active reporting period and filters, including cases where SD totals 446 incidents.</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <SummaryCard
                title="Total Incidents"
                value={managementSummary.total_late_incidents}
                icon={<TimerReset size={22} />}
                tone="bg-emerald-500 shadow-emerald-500/25"
              />
              <SummaryCard
                title="Unique Late Days"
                value={managementSummary.unique_late_days}
                icon={<CalendarDays size={22} />}
                tone="bg-brand shadow-brand/25"
              />
              <SummaryCard
                title="School Impact Rate"
                value={`${Number(managementSummary.school_impact_rate_pct || 0).toFixed(1)}%`}
                icon={<Activity size={22} />}
                tone="bg-amber-500 shadow-amber-500/25"
              />
              <SummaryCard
                title="Avg Lateness Density"
                value={Number(managementSummary.average_lateness_density || 0).toFixed(2)}
                icon={<Users size={22} />}
                tone="bg-slate-900 shadow-slate-900/25"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">Interpretation:</span>{' '}
              {managementSummary.total_late_incidents} late incidents occurred across {managementSummary.unique_late_days} unique days,
              affecting {Number(managementSummary.school_impact_rate_pct || 0).toFixed(1)}% of the {managementSummary.tracked_school_days} recorded school days
              in this period, with an average of {Number(managementSummary.average_lateness_density || 0).toFixed(2)} late students per affected day.
            </div>
          </div>

          <div className="report-section rounded-2xl border border-slate-200 bg-white shadow-sm p-6 print:border print:shadow-none print:rounded-none">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Jenjang Late Summary</h3>
                <p className="text-sm text-slate-500">Shows total late incidents, share of total incidents, effective late days, and average late students per day for each level.</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4 font-semibold">Level</th>
                    <th className="py-3 pr-4 font-semibold">Total Late Incidents</th>
                    <th className="py-3 pr-4 font-semibold">Percentage of Total</th>
                    <th className="py-3 pr-4 font-semibold">Effective Late Days</th>
                    <th className="py-3 font-semibold">Average Late Students/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {jenjangSummaryRows.map((row) => (
                    <tr key={row.jenjang} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-3 pr-4 font-semibold text-slate-900">{row.jenjang}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.total_kejadian}</td>
                      <td className="py-3 pr-4 text-slate-700">{Number(row.percentage_of_total || 0).toFixed(1)}%</td>
                      <td className="py-3 pr-4 text-slate-700">{row.hari_efektif_terlambat}</td>
                      <td className="py-3 font-semibold text-slate-900">{Number(row.rata_rata_siswa_terlambat_per_hari || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">How to read this table</p>
              <ul className="mt-2 space-y-2 list-disc pl-5">
                <li><span className="font-medium text-slate-800">Total Late Incidents</span>: count of all late records for the level. If 10 students are late on the same day, that counts as 10 incidents.</li>
                <li><span className="font-medium text-slate-800">Percentage of Total</span>: <code className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">(Level Total Late Incidents / Grand Total Late Incidents) × 100</code></li>
                <li><span className="font-medium text-slate-800">Effective Late Days</span>: count of unique school dates where at least one student in the level arrived late.</li>
                <li><span className="font-medium text-slate-800">Average Late Students/Day</span>: <code className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">Total Late Incidents / Effective Late Days</code></li>
              </ul>
            </div>

            <TardinessBarChart data={jenjangSummaryRows} />
          </div>

          <div className="report-section rounded-2xl border border-slate-200 bg-white shadow-sm p-6 print:border print:shadow-none print:rounded-none">
            <div className="mb-4">
                 <h3 className="text-xl font-bold text-slate-900">Class Breakdown</h3>
                 <p className="text-sm text-slate-500">Classes are sorted alphabetically within each level.</p>
               </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4 font-semibold">Class</th>
                    <th className="py-3 pr-4 font-semibold">Level</th>
                    <th className="py-3 pr-4 font-semibold">Total Late Duration</th>
                    <th className="py-3 pr-4 font-semibold">% Duration</th>
                    <th className="py-3 pr-4 font-semibold">Unique Late Days</th>
                    <th className="py-3 pr-4 font-semibold">% Late Days</th>
                    <th className="py-3 pr-4 font-semibold">Late Students</th>
                    <th className="py-3 pr-4 font-semibold">Sick</th>
                    <th className="py-3 pr-4 font-semibold">Excused</th>
                    <th className="py-3 pr-4 font-semibold">Unexcused</th>
                    <th className="py-3 font-semibold">Total Absences</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedClasses).map(([jenjang, rows]) => (
                    <React.Fragment key={jenjang}>
                      <tr className="bg-emerald-50 border-b border-emerald-100">
                        <td colSpan={11} className="px-4 py-2.5 font-bold text-emerald-700 uppercase tracking-wide">
                          {jenjang}
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr key={`${row.jenjang}-${row.class_name}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-3 pr-4 font-semibold text-slate-900">{row.class_name}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.jenjang}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.total_late_duration_str}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.late_duration_pct.toFixed(1)}%</td>
                          <td className="py-3 pr-4 text-slate-700">{row.total_days_late}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.days_late_pct.toFixed(1)}%</td>
                          <td className="py-3 pr-4 font-semibold text-slate-900">{row.late_student_count}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.sakit ?? 0}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.izin ?? 0}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.alfa ?? 0}</td>
                          <td className="py-3 font-semibold text-slate-900">{row.total_absence_reasons ?? 0}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <tr className="bg-slate-100 font-bold text-slate-900">
                    <td className="py-3 pr-4">TOTAL</td>
                    <td className="py-3 pr-4">-</td>
                    <td className="py-3 pr-4">{totals.total_late_duration_str}</td>
                    <td className="py-3 pr-4">100.0%</td>
                     <td className="py-3 pr-4">{totals.unique_late_days}</td>
                     <td className="py-3 pr-4">-</td>
                     <td className="py-3 pr-4">{totals.total_students_ever_late}</td>
                    <td className="py-3 pr-4">-</td>
                    <td className="py-3 pr-4">-</td>
                    <td className="py-3 pr-4">-</td>
                    <td className="py-3">-</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-section print:break-inside-avoid">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-slate-900">Summary</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard
                title="Total Late Duration"
                value={totals.total_late_duration_str}
                icon={<TimerReset size={22} />}
                tone="bg-emerald-500 shadow-emerald-500/25"
              />
              <SummaryCard
                title="Total Incidents"
                value={totalIncidentCount}
                icon={<CalendarDays size={22} />}
                tone="bg-brand shadow-brand/25"
              />
              <SummaryCard
                title="Total Students Ever Late"
                value={totals.total_students_ever_late}
                icon={<Users size={22} />}
                tone="bg-slate-900 shadow-slate-900/25"
              />
            </div>
          </div>
        </section>
      )}

      {!loading && !hasGenerated && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center no-print">
          <div className="mx-auto w-14 h-14 rounded-[9999px] bg-slate-100 flex items-center justify-center text-slate-400">
            <Download size={24} />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">No report displayed yet</h3>
          <p className="mt-2 text-sm text-slate-500">Select a period and click Generate Report to view the tardiness summary.</p>
        </div>
      )}
    </div>
  );
}

export default TardinessReport;
