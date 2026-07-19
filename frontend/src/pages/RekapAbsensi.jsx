import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  Search,
  TriangleAlert,
  ChevronDown,
  ChevronRight,
  Info
} from 'lucide-react';

import { HebBadgeRow } from '../components/HebBadgeRow';
import { cn } from '../lib/cn';
import { createDownloadUrl, revokeDownloadUrl } from '../lib/api/client';
import { PageHeader } from "../components/common/page-header";
import { downloadRekapAbsensiExcel, getRekapAbsensiReport } from '../lib/api/endpoints';
import { TERM_OPTIONS, getAcademicYearLabel, getTermAcademicYearLabel } from '../lib/reportPeriods';
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

const FILTER_MODES = [
  { value: 'month', label: 'Bulan' },
  { value: 'date_range', label: 'Rentang Tanggal' },
  { value: 'term', label: 'Term' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' },
];

function formatLocalDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildParams({ filterMode, month, year, term, dateFrom, dateTo }) {
  if (filterMode === 'date_range') {
    return { date_from: dateFrom, date_to: dateTo };
  }

  if (filterMode === 'term') {
    return { term, year };
  }

  return { month, year };
}

function sanitizePeriodLabel(label) {
  return (label || 'periode')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getAcademicYearPreview({ filterMode, month, year, term, dateFrom, dateTo }) {
  if (filterMode === 'month') {
    return getAcademicYearLabel(year, month);
  }

  if (filterMode === 'term') {
    return getTermAcademicYearLabel(term, year);
  }

  const anchor = new Date(dateTo || dateFrom || `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`);
  return getAcademicYearLabel(anchor.getFullYear(), anchor.getMonth() + 1);
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function WarningBanner({ children, linkTo, linkLabel }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 flex items-start gap-3 no-print">
      <TriangleAlert className="mt-0.5 text-amber-600" size={20} />
      <div className="space-y-2">
        <p className="font-medium">{children}</p>
        {linkTo ? (
          <Link to={linkTo} className="inline-flex items-center gap-1 text-sm font-bold text-amber-700 hover:text-amber-900">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <Card className="rounded-2xl p-6 animate-pulse">
      <div className="h-8 w-72 bg-slate-200 rounded mx-auto" />
      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200">
        <div className="grid grid-cols-7 bg-emerald-700">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-12 border-r border-emerald-600 last:border-r-0" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-7 border-t border-slate-200 bg-white even:bg-emerald-50/60">
            {Array.from({ length: 7 }).map((__, cellIndex) => (
              <div key={cellIndex} className="px-4 py-4">
                <div className="h-4 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="mx-auto w-14 h-14 rounded-[9999px] bg-slate-100 flex items-center justify-center text-slate-400">
        <CalendarDays size={24} />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">Tidak ada data untuk periode ini.</h3>
      <p className="mt-2 text-sm text-slate-500">Coba ganti periode lalu klik Buat Laporan lagi.</p>
    </div>
  );
}

function RekapAbsensiChart({ data, title }) {
  if (!data.length) {
    return null;
  }

  const width = 720;
  const height = 320;
  const padding = { top: 24, right: 24, bottom: 48, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const gap = 24;
  const barWidth = (innerWidth - gap * (data.length - 1)) / data.length;
  const maxValue = 100;

  const axisTicks = [0, 25, 50, 75, 100];
  const colors = {
    Hadir: '#2E7D32',
    Sakit: '#81C784',
    Izin: '#A5D6A7',
    Alfa: '#B0BEC5',
  };

  return (
    <div className="chart-section rounded-2xl border border-slate-200 bg-white p-5 print:border-slate-300">
      <div className="mb-4 text-center">
        <h3 className="text-lg font-black uppercase tracking-wide text-slate-900">{title}</h3>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        {axisTicks.map((tick) => {
          const y = padding.top + innerHeight - (tick / maxValue) * innerHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} y1={y} x2={padding.left + innerWidth} y2={y} stroke="#E2E8F0" strokeWidth="1" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#64748B" fontWeight="600">
                {tick}%
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          stroke="#94A3B8"
          strokeWidth="1.2"
        />
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          stroke="#94A3B8"
          strokeWidth="1.2"
        />

        {data.map((item, index) => {
          const value = Number(item.value || 0);
          const barHeight = (value / maxValue) * innerHeight;
          const x = padding.left + index * (barWidth + gap);
          const y = padding.top + innerHeight - barHeight;
          const labelX = x + barWidth / 2;

          return (
            <g key={item.label}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="10" fill={colors[item.label] || '#94A3B8'} />
              <text x={labelX} y={y - 8} textAnchor="middle" fontSize="13" fill="#0F172A" fontWeight="700">
                {value}%
              </text>
              <text
                x={labelX}
                y={padding.top + innerHeight + 24}
                textAnchor="middle"
                fontSize="13"
                fill="#334155"
                fontWeight="700"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RekapAbsensi() {
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
  const [loading, setLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [expandedJenjangs, setExpandedJenjangs] = useState({});

  const toggleJenjang = (jenjangName) => {
    setExpandedJenjangs((prev) => ({
      ...prev,
      [jenjangName]: !prev[jenjangName],
    }));
  };

  const currentParams = useMemo(
    () => buildParams({ filterMode, month, year, term, dateFrom, dateTo }),
    [filterMode, month, year, term, dateFrom, dateTo]
  );

  const academicYearPreview = useMemo(
    () => getAcademicYearPreview({ filterMode, month, year, term, dateFrom, dateTo }),
    [filterMode, month, year, term, dateFrom, dateTo]
  );

  const jenjangs = report?.jenjang || [];
  const hasData = Boolean(report) && jenjangs.length > 0;

  const handleGenerateReport = async () => {
    setLoading(true);
    setError('');
    setHasGenerated(true);

    try {
      const nextReport = await getRekapAbsensiReport(currentParams);
      setReport(nextReport);
      
      // Default all jenjang to collapsed
      const initialExpandedState = {};
      (nextReport?.jenjang || []).forEach(j => {
        initialExpandedState[j.name] = false;
      });
      setExpandedJenjangs(initialExpandedState);
    } catch (requestError) {
      setReport(null);
      setError(requestError.response?.data?.detail || requestError.message || 'Gagal memuat rekap absensi.');
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
      const blob = await downloadRekapAbsensiExcel(currentParams);
      const url = createDownloadUrl(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rekap_absensi_${sanitizePeriodLabel(report.period?.label)}.xlsx`;
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
    document.body.classList.add('printing-rekap-absensi');

    const cleanup = () => {
      document.body.classList.remove('printing-rekap-absensi');
      window.removeEventListener('afterprint', cleanup);
      setPrinting(false);
    };

    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  return (
    <div className="space-y-8 rekap-absensi-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { font-size: 11pt; background: white !important; }
          table { page-break-inside: avoid; }
          .chart-section { page-break-before: avoid; }
          body.printing-rekap-absensi .app-sidebar { display: none !important; }
          body.printing-rekap-absensi .app-main { margin-left: 0 !important; padding: 0 !important; }
          body.printing-rekap-absensi .report-print-area { padding: 0 !important; }
          body.printing-rekap-absensi .report-section { box-shadow: none !important; border-radius: 0 !important; border-color: #cbd5e1 !important; }
        }
      `}</style>

      <PageHeader
        className="no-print"
        title="Rekap Absensi"
        description="Laporan rekapitulasi kehadiran siswa bulanan, date range, atau term."
      />

      <Card className="rounded-2xl p-6 filter-bar no-print">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-end">
          <div className="space-y-3 xl:col-span-1">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Mode Periode</label>
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

          <div className="space-y-3 xl:col-span-1">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Periode</label>
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
            <p className="text-xs font-semibold text-emerald-700">Tahun ajaran otomatis: {academicYearPreview}</p>
          </div>

          <div className="xl:col-span-1">
            <Button
              type="button"
              onClick={handleGenerateReport}
              disabled={loading}
              className="w-full h-[46px] font-bold"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
              <span>{loading ? 'Memuat...' : 'Buat Laporan'}</span>
            </Button>
          </div>

          <div className="xl:col-span-1">
            {report ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  onClick={handlePrint}
                  disabled={printing}
                  className="h-[46px] rounded-xl border border-slate-200 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  <span>Cetak PDF</span>
                </button>
              </div>
            ) : (
              <div className="h-[46px] rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 flex items-center justify-center text-sm text-slate-400">
                Export tersedia setelah laporan dibuat
              </div>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800 flex items-start gap-3 no-print">
          <TriangleAlert className="mt-0.5" size={20} />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {report?.global_flags?.heb_missing && (
        <WarningBanner>
          ⚠️ HEB belum tersedia untuk beberapa jenjang. Pastikan data absensi telah diupload.
        </WarningBanner>
      )}

      {report?.global_flags?.sia_missing && (
        <WarningBanner linkTo="/config/absence-reasons" linkLabel="Isi Sekarang →">
          ⚠️ Data Sakit/Izin/Alfa belum diisi untuk periode ini.
        </WarningBanner>
      )}

      {report?.global_flags?.has_data_quality_issue && (
        <WarningBanner>
          ⚠️ Ditemukan anomali data pada {report?.global_flags?.affected_classes} kelas. Data absensi (HADIR/SAKIT/IZIN/ALFA) tidak selaras dengan total siswa × HEB. Total persentase mungkin terpengaruh.
        </WarningBanner>
      )}

      {loading && <LoadingSkeleton />}

      {!loading && hasGenerated && !hasData && !error && <EmptyState />}

      {!loading && report && hasData && (
        <section className="report-print-area space-y-8">
          <Card className="rounded-2xl report-section px-6 py-10 text-center print:border print:shadow-none print:rounded-none">
            <h2 className="text-2xl md:text-3xl font-black tracking-wide text-slate-900 uppercase">{report.report_title}</h2>
            <p className="mt-2 text-lg font-semibold text-slate-700 uppercase">{report.school_name}</p>
            <p className="mt-2 text-base text-slate-500">{report.period.label}</p>
            <div className="flex justify-center mt-4 no-print">
              <HebBadgeRow hebByJenjang={report?.heb_by_jenjang} />
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)] gap-8">
            <Card className="rounded-2xl report-section p-6 print:border print:shadow-none print:rounded-none">
              <div className="mb-4">
                <h3 className="text-xl font-bold text-slate-900">Tabel Rekap Absensi</h3>
                <p className="text-sm text-slate-500">Persentase dibulatkan ke bilangan bulat. RATA2 menampilkan rata-rata per jenjang, bukan rata seluruh siswa.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-emerald-700 text-white uppercase tracking-wide text-xs">
                      <th className="px-4 py-3 text-left font-bold rounded-tl-xl">Jenjang / Kelas</th>
                      <th className="px-4 py-3 text-right font-bold">HEB</th>
                      <th className="px-4 py-3 text-right font-bold">Hadir</th>
                      <th className="px-4 py-3 text-right font-bold">Sakit</th>
                      <th className="px-4 py-3 text-right font-bold">Izin</th>
                      <th className="px-4 py-3 text-right font-bold">Alfa</th>
                      <th className="px-4 py-3 text-right font-bold rounded-tr-xl">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jenjangs.map((j) => {
                      const isExpanded = expandedJenjangs[j.name];
                      const jPcts = j.summary.percentages;
                      return (
                        <React.Fragment key={j.name}>
                          {/* Jenjang Header Row */}
                          <tr 
                            className="bg-emerald-50 hover:bg-emerald-100 cursor-pointer transition-colors border-b border-emerald-200"
                            onClick={() => toggleJenjang(j.name)}
                          >
                            <td className="px-4 py-3 text-left font-bold text-emerald-900 border-b border-emerald-200 flex items-center gap-2">
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              <span>{j.name}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-emerald-800 border-b border-emerald-200">{report?.heb_by_jenjang?.[j.name] ?? "—"}</td>
                            <td className="px-4 py-3 text-right font-bold text-emerald-800 border-b border-emerald-200">{formatPercent(jPcts.hadir_pct)}</td>
                            <td className="px-4 py-3 text-right font-bold text-emerald-800 border-b border-emerald-200">{formatPercent(jPcts.sakit_pct)}</td>
                            <td className="px-4 py-3 text-right font-bold text-emerald-800 border-b border-emerald-200">{formatPercent(jPcts.izin_pct)}</td>
                            <td className="px-4 py-3 text-right font-bold text-emerald-800 border-b border-emerald-200">{formatPercent(jPcts.alfa_pct)}</td>
                            <td className="px-4 py-3 text-right font-black text-emerald-900 border-b border-emerald-200">{formatPercent(jPcts.total_pct)}</td>
                          </tr>

                          {/* Expanded Classes */}
                          {isExpanded && j.classes.map((cls, idx) => {
                            const pcts = cls.percentages;
                            const flags = cls.warning_flags;
                            return (
                              <tr key={cls.class_name} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                <td className="px-4 py-3 pl-10 text-left font-semibold text-slate-800 border-b border-slate-200 flex items-center gap-2">
                                  <span>{cls.class_name}</span>
                                  {flags.excluded_unclassified && (
                                    <div className="group relative outline-none flex items-center">
                                      <Info size={16} className={flags.data_quality_issue ? "text-rose-500" : "text-amber-500"} />
                                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all z-10 bg-slate-900 text-white text-xs rounded-xl py-2 px-3 shadow-xl">
                                        Terdapat <b>{flags.lain2_count}</b> entri data tidak terklasifikasi (LAIN2) yang dikecualikan dari perhitungan persentase.
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-400 border-b border-slate-200">—</td>
                                <td className="px-4 py-3 text-right text-slate-600 border-b border-slate-200">{formatPercent(pcts.hadir_pct)}</td>
                                <td className="px-4 py-3 text-right text-slate-600 border-b border-slate-200">{formatPercent(pcts.sakit_pct)}</td>
                                <td className="px-4 py-3 text-right text-slate-600 border-b border-slate-200">{formatPercent(pcts.izin_pct)}</td>
                                <td className="px-4 py-3 text-right text-slate-600 border-b border-slate-200">{formatPercent(pcts.alfa_pct)}</td>
                                <td className="px-4 py-3 text-right font-semibold text-slate-800 border-b border-slate-200">{formatPercent(pcts.total_pct)}</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                    
                    <tr className="bg-emerald-900 text-white font-bold">
                      <td className="px-4 py-3 text-left">GLOBAL SUMMARY</td>
                      <td className="px-4 py-3 text-right">—</td>
                      <td className="px-4 py-3 text-right">{formatPercent(report.global_summary?.percentages?.hadir_pct)}</td>
                      <td className="px-4 py-3 text-right">{formatPercent(report.global_summary?.percentages?.sakit_pct)}</td>
                      <td className="px-4 py-3 text-right">{formatPercent(report.global_summary?.percentages?.izin_pct)}</td>
                      <td className="px-4 py-3 text-right">{formatPercent(report.global_summary?.percentages?.alfa_pct)}</td>
                      <td className="px-4 py-3 text-right">{formatPercent(report.global_summary?.percentages?.total_pct)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs font-medium text-slate-400 italic">
                *Data tidak terklasifikasi (LAIN2) dikecualikan secara penuh dari perhitungan pembagi (100%).
              </div>
            </Card>

            <div className="report-section print:break-inside-avoid">
              <RekapAbsensiChart data={report.chart_data || []} title={report.report_title} />
            </div>
          </div>
        </section>
      )}

      {!loading && !hasGenerated && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center no-print">
          <div className="mx-auto w-14 h-14 rounded-[9999px] bg-slate-100 flex items-center justify-center text-slate-400">
            <Download size={24} />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">Belum ada laporan ditampilkan</h3>
          <p className="mt-2 text-sm text-slate-500">Pilih periode lalu klik Buat Laporan untuk melihat rekap absensi.</p>
        </div>
      )}
    </div>
  );
}

export default RekapAbsensi;
