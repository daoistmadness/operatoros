import type { LucideIcon } from 'lucide-react';
import {
  Activity, BarChart3, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ClipboardList,
  Clock3, DatabaseBackup, Edit3, FileClock, FileText, GraduationCap, Home, Inbox, Layers3,
  Package, Server, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, TrendingUp,
  UploadCloud, UserCheck, UserPlus, UserRound, Users as UsersIcon, Wrench,
} from 'lucide-react';
import type { AuthContextValue } from '../../context/AuthContext';
import { isRouteAuthorized, routePolicyPathForLocation } from '../router/access';

export type NavigationDomainId =
  | 'home'
  | 'work-queue'
  | 'attendance'
  | 'students'
  | 'academics'
  | 'staff'
  | 'inventory'
  | 'insights-reports'
  | 'settings';

export type NavigationItem = Readonly<{
  name: string;
  path: string;
  icon: LucideIcon;
  workflowGroup?: string;
  keywords?: readonly string[];
  matches?: readonly string[];
  nested?: boolean;
  exclude?: readonly string[];
  hideInSingleUserMode?: boolean;
}>;

export type NavigationGroup = Readonly<{
  id: NavigationDomainId;
  title: string;
  icon: LucideIcon;
  items: readonly NavigationItem[];
}>;

export type NavigationContext = Readonly<{
  auth: AuthContextValue;
  isSingleUserMode: boolean;
}>;

export type NavigationBreadcrumb = Readonly<{
  label: string;
  href?: string;
}>;

export type NavigationPresentation = Readonly<{
  title: string;
  domainTitle: string;
  breadcrumbs: readonly NavigationBreadcrumb[];
}>;

type RoutePresentationMetadata = Readonly<{
  title: string;
  parentPath: string;
  intermediateDetailLabel?: string;
  intermediateDetailHref?: (pathname: string) => string | undefined;
}>;

const routePresentationMetadata: Partial<Record<string, RoutePresentationMetadata>> = {
  '/classes/:id': { title: 'Class overview', parentPath: '/students' },
  '/students/:id': { title: 'Student profile', parentPath: '/students' },
  '/attendance/students/:id': { title: 'Student attendance', parentPath: '/students' },
  '/staff/:id': { title: 'Staff profile', parentPath: '/staff' },
  '/staff/:id/edit': {
    title: 'Edit staff profile',
    parentPath: '/staff',
    intermediateDetailLabel: 'Staff profile',
    intermediateDetailHref: (pathname) => {
      const match = /^\/staff\/([^/]+)\/edit\/?$/.exec(pathname);
      return match ? `/staff/${match[1]}` : undefined;
    },
  },
};

export const navigationGroups: readonly NavigationGroup[] = [
  {
    id: 'home',
    title: 'Home',
    icon: Home,
    items: [
      {
        name: 'Home',
        path: '/',
        icon: Home,
        matches: ['/'],
        keywords: ['home', 'dashboard', 'overview', 'beranda', 'dasbor', 'utama', 'ringkasan', 'system analytics'],
      },
    ],
  },
  {
    id: 'work-queue',
    title: 'Work Queue',
    icon: Inbox,
    items: [
      {
        name: 'Operator Work Queue',
        path: '/operator/work-queue',
        icon: ShieldCheck,
        keywords: ['work queue', 'follow-up tasks', 'operator queue', 'antrean kerja', 'antrean operator', 'daftar tugas', 'tindak lanjut'],
      },
      {
        name: 'Follow-Up Queue',
        path: '/attendance/followups',
        icon: UserCheck,
        keywords: ['follow up', 'followup', 'tindak lanjut', 'antrean tindak lanjut', 'kasus absensi'],
      },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    icon: CalendarCheck,
    items: [
      {
        name: 'Daily Attendance',
        path: '/attendance/daily',
        icon: ClipboardList,
        workflowGroup: 'Daily Operations',
        keywords: ['daily attendance', 'absensi harian', 'kehadiran harian', 'presensi harian'],
      },
      {
        name: 'Class Attendance',
        path: '/attendance/class-entry',
        icon: CalendarDays,
        workflowGroup: 'Daily Operations',
        keywords: ['class entry', 'attendance entry', 'class attendance', 'absensi kelas', 'input absensi', 'entri kehadiran'],
      },
      {
        name: 'Early Departures',
        path: '/attendance/class-departures',
        icon: Clock3,
        workflowGroup: 'Daily Operations',
        keywords: ['early departure', 'pulang awal', 'izin pulang awal', 'dispensasi pulang'],
      },
      {
        name: 'Attendance Calendar',
        path: '/attendance/calendar',
        icon: CalendarCheck,
        workflowGroup: 'Calendar',
        keywords: ['calendar', 'kalender', 'kalender kehadiran', 'hari efektif'],
      },
      {
        name: 'Attendance Review',
        path: '/attendance-review',
        icon: Edit3,
        workflowGroup: 'Review & Corrections',
        keywords: ['review attendance', 'tinjau kehadiran', 'review absensi', 'daftar kehadiran'],
      },
      {
        name: 'Attendance Corrections',
        path: '/attendance-corrections',
        icon: Wrench,
        workflowGroup: 'Review & Corrections',
        keywords: ['correct attendance', 'koreksi kehadiran', 'koreksi absensi', 'perbaikan absensi'],
      },
      {
        name: 'Correction Review',
        path: '/attendance/override-review',
        icon: FileClock,
        workflowGroup: 'Review & Corrections',
        keywords: ['override review', 'tinjau koreksi', 'persetujuan koreksi', 'review koreksi'],
      },
      {
        name: 'Monthly Recap Input',
        path: '/attendance/monthly-recap',
        icon: FileText,
        workflowGroup: 'Monthly Processing',
        matches: ['/attendance/monthly-recap', '/config/absence-reasons'],
        keywords: ['monthly recap', 'recap input', 'absence reasons', 'rekap bulanan', 'input rekap', 'alasan ketidakhadiran'],
      },
      {
        name: 'Monthly Reconciliation',
        path: '/attendance/reconciliation',
        icon: BookOpen,
        workflowGroup: 'Monthly Processing',
        keywords: ['reconcile', 'attendance reconciliation', 'rekonsiliasi', 'rekonsiliasi bulanan', 'finalisasi absensi'],
      },
    ],
  },
  {
    id: 'students',
    title: 'Students',
    icon: UsersIcon,
    items: [
      {
        name: 'Student Directory',
        path: '/students',
        icon: UsersIcon,
        nested: true,
        exclude: ['/students/operations'],
        keywords: ['students', 'roster', 'direktori siswa', 'daftar siswa', 'data siswa', 'peserta didik', 'dapodik'],
      },
      {
        name: 'Student Enrollment',
        path: '/enrollment',
        icon: UserRound,
        matches: ['/enrollment', '/mapping'],
        keywords: ['enrollment', 'admissions', 'mapping', 'pendaftaran', 'penempatan kelas', 'rombel', 'mutasi'],
      },
      {
        name: 'Operations Audit',
        path: '/students/operations',
        icon: ShieldCheck,
        keywords: ['student audit', 'audit log', 'audit operasi', 'log aktivitas', 'riwayat perubahan'],
      },
    ],
  },
  {
    id: 'academics',
    title: 'Academics',
    icon: GraduationCap,
    items: [
      {
        name: 'Academic Management',
        path: '/academic-management',
        icon: Layers3,
        keywords: ['academic operations', 'manajemen akademik', 'tahun ajaran', 'mata pelajaran', 'kurikulum', 'kkm', 'kenaikan kelas'],
      },
      {
        name: 'Grade Ledger',
        path: '/grades',
        icon: GraduationCap,
        keywords: ['grades', 'gradebook', 'nilai', 'daftar nilai', 'leger nilai', 'penilaian', 'rapor'],
      },
      {
        name: 'Assessment Operations',
        path: '/grades/operations',
        icon: ClipboardList,
        keywords: ['assessment', 'grade operations', 'asesmen', 'operasi penilaian', 'cakupan nilai'],
      },
      {
        name: 'Teacher Assignments',
        path: '/teacher-class-assignments',
        icon: UserCheck,
        hideInSingleUserMode: true,
        keywords: ['class assignments', 'penugasan guru', 'wali kelas', 'guru pengajar'],
      },
      {
        name: 'HEB Overrides',
        path: '/config/heb',
        icon: CalendarDays,
        keywords: ['heb', 'hari efektif belajar', 'pengecualian heb', 'override heb'],
      },
    ],
  },
  {
    id: 'staff',
    title: 'Staff',
    icon: UserCheck,
    items: [
      {
        name: 'Employee Directory',
        path: '/staff',
        icon: UsersIcon,
        keywords: ['staff', 'employees', 'pegawai', 'karyawan', 'guru', 'ptk', 'administrasi ptk', 'direktori pegawai'],
      },
      {
        name: 'Staff Monthly Activity',
        path: '/staff/monthly-activities',
        icon: CalendarCheck,
        keywords: ['staff activity', 'monthly staff', 'aktivitas bulanan', 'aktivitas ptk', 'kinerja pegawai'],
      },
      {
        name: 'Staff Analytics',
        path: '/staff/analytics',
        icon: BarChart3,
        keywords: ['staff analytics', 'analitik pegawai', 'statistik ptk', 'komposisi pegawai'],
      },
      {
        name: 'Import Employees',
        path: '/staff/import',
        icon: UploadCloud,
        keywords: ['import staff', 'impor pegawai', 'edelweiss', 'unggah pegawai'],
      },
      {
        name: 'Add Employee',
        path: '/staff/new',
        icon: UserPlus,
        keywords: ['add employee', 'new staff', 'tambah pegawai', 'pegawai baru'],
      },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: Package,
    items: [
      {
        name: 'Asset Inventory',
        path: '/inventory',
        icon: Package,
        keywords: ['inventory', 'assets', 'labels', 'arkas', 'bos', 'inventaris', 'aset sekolah', 'label aset', 'sarpras'],
      },
    ],
  },
  {
    id: 'insights-reports',
    title: 'Insights & Reports',
    icon: BarChart3,
    items: [
      {
        name: 'Management Analytics',
        path: '/analytics',
        icon: TrendingUp,
        keywords: ['analytics', 'dashboard', 'management analytics', 'analitik manajemen', 'ringkasan eksekutif'],
      },
      {
        name: 'Attendance Analytics',
        path: '/analytics/attendance',
        icon: Server,
        matches: ['/analytics/attendance', '/reports/attendance', '/reports/rekap-absensi', '/reports/tardiness'],
        keywords: ['attendance analytics', 'rekap absensi', 'tardiness', 'keterlambatan', 'laporan kehadiran', 'analitik kehadiran'],
      },
      {
        name: 'Academic Analytics',
        path: '/analytics/academic',
        icon: BookOpen,
        keywords: ['academic analytics', 'analitik akademik', 'statistik nilai', 'capaian akademik'],
      },
      {
        name: 'Population Overview',
        path: '/analytics/recapitulation',
        icon: ClipboardList,
        keywords: ['population', 'recapitulation', 'rekapitulasi', 'populasi siswa', 'demografi'],
      },
      {
        name: 'Data Quality',
        path: '/analytics/data-quality',
        icon: ShieldCheck,
        keywords: ['data quality', 'kualitas data', 'kelengkapan data'],
      },
      {
        name: 'Student Insights',
        path: '/analytics/student-insights',
        icon: Activity,
        matches: ['/analytics/student-insights', '/analytics/trends', '/analytics/indicators'],
        keywords: ['student insights', 'trends', 'indicators', 'wawasan siswa', 'tren siswa', 'indikator siswa'],
      },
      {
        name: 'Reports & Reviews',
        path: '/reports',
        icon: BarChart3,
        matches: ['/reports', '/reports/monthly', '/reports/annual', '/reports/management/monthly', '/analytics/management-review/student-profile'],
        keywords: ['reports', 'monthly report', 'annual report', 'term review', 'laporan', 'laporan bulanan', 'laporan tahunan', 'tinjauan semester'],
      },
      {
        name: 'Monthly UPP Reports',
        path: '/reports/upp',
        icon: FileText,
        keywords: ['upp report', 'laporan upp', 'upp bulanan', 'keuangan'],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: SettingsIcon,
    items: [
      {
        name: 'System Settings',
        path: '/settings',
        icon: SettingsIcon,
        nested: true,
        exclude: ['/settings/backups'],
        keywords: ['preferences', 'configuration', 'settings', 'pengaturan', 'preferensi', 'konfigurasi'],
      },
      {
        name: 'Setup & Readiness',
        path: '/setup',
        icon: CheckCircle2,
        keywords: ['setup', 'readiness', 'configuration', 'persiapan sistem', 'kesiapan', 'status sistem'],
      },
      {
        name: 'Grade Level Cutoff',
        path: '/config/jenjang',
        icon: Clock3,
        keywords: ['grade level', 'jenjang', 'cutoff', 'batas terlambat', 'jam masuk', 'institution'],
      },
      {
        name: 'Departure Policies',
        path: '/attendance/departure-policies',
        icon: SlidersHorizontal,
        keywords: ['departure policy', 'kebijakan pulang awal', 'aturan pulang', 'early departure policy'],
      },
      {
        name: 'Data Import & Export',
        path: '/upload',
        icon: UploadCloud,
        matches: ['/upload', '/upload-center', '/upload-history', '/data-portability', '/attendance/machine-import'],
        keywords: ['upload', 'import', 'export', 'impor data', 'ekspor data', 'unggah excel', 'portabilitas data', 'mesin absensi'],
      },
      {
        name: 'Backup Management',
        path: '/settings/backups',
        icon: DatabaseBackup,
        keywords: ['backup', 'backups', 'recovery', 'cadangan', 'pemulihan database', 'pencadangan'],
      },
    ],
  },
];

export function canSelectNavigationItem(item: NavigationItem, context: NavigationContext): boolean {
  if (item.hideInSingleUserMode && context.isSingleUserMode) return false;
  return isRouteAuthorized(item.path, context.auth);
}

export function visibleNavigationGroups(context: NavigationContext): NavigationGroup[] {
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSelectNavigationItem(item, context)),
    }))
    .filter((group) => group.items.length > 0);
}

export function domainPrimaryPath(group: NavigationGroup): string {
  return group.items[0]?.path ?? '/';
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

export function navigationItemIsActive(item: NavigationItem, pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (item.exclude?.some((path) => normalized === path || normalized.startsWith(`${path}/`))) return false;
  if (item.matches) return item.matches.includes(normalized);
  return normalized === item.path || Boolean(item.nested && normalized.startsWith(`${item.path}/`));
}

export function activeNavigationEntry(
  groups: readonly NavigationGroup[],
  pathname: string,
): { group: NavigationGroup; item: NavigationItem } | null {
  const normalized = normalizePathname(pathname);
  for (const group of groups) {
    const item = group.items.find((candidate) => navigationItemIsActive(candidate, normalized));
    if (item) return { group, item };
  }

  const policyPath = routePolicyPathForLocation(normalized);
  const routeMetadata = policyPath ? routePresentationMetadata[policyPath] : undefined;
  if (routeMetadata) {
    for (const group of groups) {
      const parentItem = group.items.find((candidate) => candidate.path === routeMetadata.parentPath);
      if (parentItem) return { group, item: parentItem };
    }
  }

  return null;
}

export function navigationPresentationForPath(
  groups: readonly NavigationGroup[],
  pathname: string,
): NavigationPresentation | null {
  const normalized = normalizePathname(pathname);
  const homeItem = groups.flatMap((group) => group.items).find((item) => item.path === '/');
  const policyPath = routePolicyPathForLocation(normalized);
  const routeMetadata = policyPath ? routePresentationMetadata[policyPath] : undefined;

  if (routeMetadata) {
    const active = activeNavigationEntry(groups, normalized);
    const parentGroup = active?.group;
    const parent = active?.item;
    const domainLanding = parentGroup ? domainPrimaryPath(parentGroup) : undefined;
    const breadcrumbs: NavigationBreadcrumb[] = [];

    if (homeItem) breadcrumbs.push({ label: homeItem.name, href: homeItem.path });
    if (parentGroup) {
      breadcrumbs.push({ label: parentGroup.title, href: domainLanding });
    }
    if (parent && domainLanding !== parent.path) {
      breadcrumbs.push({ label: parent.name, href: parent.path });
    }
    if (routeMetadata.intermediateDetailLabel) {
      const detailHref = routeMetadata.intermediateDetailHref?.(normalized);
      breadcrumbs.push({ label: routeMetadata.intermediateDetailLabel, href: detailHref });
    }
    breadcrumbs.push({ label: routeMetadata.title });

    return {
      title: routeMetadata.title,
      domainTitle: parentGroup?.title ?? routeMetadata.title,
      breadcrumbs,
    };
  }

  const active = activeNavigationEntry(groups, normalized);
  if (!active) return null;

  if (active.item.path === '/') {
    return {
      title: active.item.name,
      domainTitle: active.group.title,
      breadcrumbs: [{ label: active.item.name }],
    };
  }

  const breadcrumbs: NavigationBreadcrumb[] = [];
  if (homeItem) breadcrumbs.push({ label: homeItem.name, href: homeItem.path });

  if (active.group.items.length === 1) {
    breadcrumbs.push({ label: active.group.title });
    return {
      title: active.item.name,
      domainTitle: active.group.title,
      breadcrumbs,
    };
  }

  const landingPath = domainPrimaryPath(active.group);
  const isLanding = active.item.path === landingPath;
  breadcrumbs.push({
    label: active.group.title,
    href: isLanding ? undefined : landingPath,
  });
  if (active.item.workflowGroup && active.item.workflowGroup !== 'Calendar') {
    breadcrumbs.push({ label: active.item.workflowGroup });
  }
  breadcrumbs.push({ label: active.item.name });

  return {
    title: active.item.name,
    domainTitle: active.group.title,
    breadcrumbs,
  };
}

export function searchNavigationGroups(
  groups: readonly NavigationGroup[],
  query: string,
): NavigationGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return groups.map((group) => ({ ...group, items: [...group.items] }));

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const searchableText = [
          item.name,
          item.path,
          group.title,
          item.workflowGroup ?? '',
          ...(item.matches ?? []),
          ...(item.keywords ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return terms.every((term) => searchableText.includes(term));
      }),
    }))
    .filter((group) => group.items.length > 0);
}
