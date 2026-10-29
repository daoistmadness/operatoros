import type { LucideIcon } from 'lucide-react';
import {
  Activity, BarChart3, BookOpen, CalendarCheck, CalendarDays, Clock3, Edit3, FileClock,
  FileText, GraduationCap, LayoutDashboard, ClipboardList, Layers3, Server, Settings as SettingsIcon,
  ShieldCheck, TrendingUp, UploadCloud, UserCheck, Users as UsersIcon, UserRound, Wrench,
} from 'lucide-react';
import type { AuthContextValue } from '../../context/AuthContext';
import { isRouteAuthorized, routePolicyPathForLocation } from '../router/access';

export type NavigationItem = Readonly<{
  name: string;
  path: string;
  icon: LucideIcon;
  keywords?: readonly string[];
  matches?: readonly string[];
  nested?: boolean;
  exclude?: readonly string[];
  hideInSingleUserMode?: boolean;
}>;

export type NavigationGroup = Readonly<{
  id: string;
  title: string;
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
  breadcrumbs: readonly NavigationBreadcrumb[];
}>;

type RoutePresentationMetadata = Readonly<{
  title: string;
  parentPath?: string;
}>;

const routePresentationMetadata: Partial<Record<string, RoutePresentationMetadata>> = {
  '/classes/:id': { title: 'Class overview' },
  '/students/:id': { title: 'Student profile', parentPath: '/students' },
  '/attendance/students/:id': { title: 'Student attendance', parentPath: '/students' },
  '/settings/backups': { title: 'Backups', parentPath: '/settings' },
  '/staff/:id': { title: 'Staff profile', parentPath: '/staff' },
  '/staff/:id/edit': { title: 'Edit staff profile', parentPath: '/staff' },
};

export const navigationGroups: readonly NavigationGroup[] = [
  {
    id: 'overview', title: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard, matches: ['/'], keywords: ['home', 'overview'] },
      { name: 'Setup & Readiness', path: '/setup', icon: SettingsIcon, keywords: ['setup', 'readiness', 'configuration'] },
    ],
  },
  {
    id: 'attendance', title: 'Attendance',
    items: [
      { name: 'Operator Work Queue', path: '/operator/work-queue', icon: ShieldCheck, keywords: ['work queue', 'follow-up tasks'] },
      { name: 'Class Attendance', path: '/attendance/class-entry', icon: CalendarDays, keywords: ['class entry', 'attendance entry'] },
      { name: 'Daily Attendance', path: '/attendance/daily', icon: ClipboardList, keywords: ['daily attendance'] },
      { name: 'Attendance Calendar', path: '/attendance/calendar', icon: CalendarCheck, keywords: ['calendar'] },
      { name: 'Monthly Recap Input', path: '/attendance/monthly-recap', icon: FileText, keywords: ['monthly recap', 'recap input'] },
      { name: 'Monthly Reconciliation', path: '/attendance/reconciliation', icon: BookOpen, keywords: ['reconcile', 'attendance reconciliation'] },
      { name: 'Early Departures', path: '/attendance/class-departures', icon: Clock3, keywords: ['early departure'] },
      { name: 'Attendance Review', path: '/attendance-review', icon: Edit3, keywords: ['review attendance'] },
      { name: 'Attendance Corrections', path: '/attendance-corrections', icon: Wrench, keywords: ['correct attendance'] },
      { name: 'Correction Review', path: '/attendance/override-review', icon: FileClock, keywords: ['override review'] },
      { name: 'Follow-Up Queue', path: '/attendance/followups', icon: UserCheck, keywords: ['follow up', 'followup'] },
    ],
  },
  {
    id: 'academic-students', title: 'Academic & Students',
    items: [
      { name: 'Student Directory', path: '/students', icon: UsersIcon, nested: true, exclude: ['/students/operations'], keywords: ['students', 'roster'] },
      { name: 'Student Enrollment', path: '/enrollment', icon: UserRound, keywords: ['enrollment', 'admissions'] },
      { name: 'Academic Management', path: '/academic-management', icon: Layers3, keywords: ['academic operations'] },
      { name: 'Teacher Assignments', path: '/teacher-class-assignments', icon: UserCheck, hideInSingleUserMode: true, keywords: ['class assignments'] },
      { name: 'Grade Ledger', path: '/grades', icon: GraduationCap, keywords: ['grades', 'gradebook'] },
      { name: 'Assessment Operations', path: '/grades/operations', icon: ClipboardList, keywords: ['assessment', 'grade operations'] },
    ],
  },
  {
    id: 'insights', title: 'Analytics & Reports',
    items: [
      { name: 'Management Analytics', path: '/analytics', icon: TrendingUp, keywords: ['analytics', 'dashboard'] },
      { name: 'Population Overview', path: '/analytics/recapitulation', icon: ClipboardList, keywords: ['population', 'recapitulation'] },
      { name: 'Data Quality', path: '/analytics/data-quality', icon: ShieldCheck, keywords: ['data quality'] },
      { name: 'Attendance', path: '/analytics/attendance', icon: Server, keywords: ['attendance analytics'] },
      { name: 'Academic Analytics', path: '/analytics/academic', icon: BookOpen, keywords: ['academic analytics'] },
      { name: 'Student Insights', path: '/analytics/student-insights', icon: Activity, matches: ['/analytics/trends', '/analytics/indicators'], keywords: ['student insights', 'trends', 'indicators'] },
      { name: 'Reports & Reviews', path: '/reports', icon: BarChart3, matches: ['/reports', '/reports/monthly', '/reports/annual', '/reports/management/monthly', '/analytics/management-review/student-profile'], keywords: ['reports', 'monthly report', 'annual report'] },
    ],
  },
  {
    id: 'data-management', title: 'Data Management',
    items: [
      { name: 'Data Import & Export', path: '/upload', icon: UploadCloud, keywords: ['upload', 'import', 'export'] },
    ],
  },
  {
    id: 'administration', title: 'Administration',
    items: [
      { name: 'Departure Policies', path: '/attendance/departure-policies', icon: Clock3, keywords: ['departure policy'] },
      { name: 'Grade Level Cutoff', path: '/config/jenjang', icon: GraduationCap, keywords: ['grade level', 'jenjang'] },
      { name: 'HEB Overrides', path: '/config/heb', icon: CalendarDays, keywords: ['heb'] },
      { name: 'Operations Audit', path: '/students/operations', icon: ShieldCheck, keywords: ['student audit', 'audit log'] },
      { name: 'Employee Directory', path: '/staff', icon: UsersIcon, keywords: ['staff', 'employees'] },
      { name: 'Staff Monthly Activity', path: '/staff/monthly-activities', icon: CalendarCheck, keywords: ['staff activity', 'monthly staff'] },
      { name: 'Monthly UPP Reports', path: '/reports/upp', icon: FileText, keywords: ['upp report'] },
      { name: 'Settings', path: '/settings', icon: SettingsIcon, nested: true, keywords: ['preferences', 'configuration'] },
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

export function navigationItemIsActive(item: NavigationItem, pathname: string): boolean {
  if (item.exclude?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (item.matches) return item.matches.includes(pathname);
  return pathname === item.path || Boolean(item.nested && pathname.startsWith(`${item.path}/`));
}

export function activeNavigationEntry(
  groups: readonly NavigationGroup[],
  pathname: string,
): { group: NavigationGroup; item: NavigationItem } | null {
  for (const group of groups) {
    const item = group.items.find((candidate) => navigationItemIsActive(candidate, pathname));
    if (item) return { group, item };
  }
  return null;
}

export function navigationPresentationForPath(
  groups: readonly NavigationGroup[],
  pathname: string,
): NavigationPresentation | null {
  const policyPath = routePolicyPathForLocation(pathname);
  const routeMetadata = policyPath ? routePresentationMetadata[policyPath] : undefined;
  if (routeMetadata) {
    const parent = routeMetadata.parentPath
      ? groups.flatMap((group) => group.items).find((item) => item.path === routeMetadata.parentPath)
      : undefined;
    const dashboard = groups.flatMap((group) => group.items).find((item) => item.path === '/');
    const breadcrumbs: NavigationBreadcrumb[] = [];
    if (parent && dashboard && parent.path !== dashboard.path) {
      breadcrumbs.push({ label: dashboard.name, href: dashboard.path });
    }
    if (parent) breadcrumbs.push({ label: parent.name, href: parent.path });
    breadcrumbs.push({ label: routeMetadata.title });
    return { title: routeMetadata.title, breadcrumbs };
  }

  const active = activeNavigationEntry(groups, pathname);
  if (!active) return null;
  if (active.item.path === '/') {
    return { title: active.item.name, breadcrumbs: [{ label: active.item.name }] };
  }

  const dashboard = groups.flatMap((group) => group.items).find((item) => item.path === '/');
  const breadcrumbs: NavigationBreadcrumb[] = [];
  if (dashboard) breadcrumbs.push({ label: dashboard.name, href: dashboard.path });
  breadcrumbs.push({ label: active.item.name });
  return { title: active.item.name, breadcrumbs };
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
        const searchableText = [item.name, item.path, group.title, ...(item.matches ?? []), ...(item.keywords ?? [])]
          .join(' ')
          .toLowerCase();
        return terms.every((term) => searchableText.includes(term));
      }),
    }))
    .filter((group) => group.items.length > 0);
}
