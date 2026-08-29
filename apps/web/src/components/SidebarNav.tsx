import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AuthUser } from '../api/auth';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Database, Edit3, FileClock, FileText, GraduationCap, History, LayoutDashboard,
  ClipboardList, Layers3, LogOut, PieChart, Server, Settings as SettingsIcon, ShieldCheck, TrendingUp,
  UploadCloud, UserCheck, Users as UsersIcon, UserRound, Wrench,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { getServerStatus } from '../lib/api/endpoints';
import { useAuth } from '../context/AuthContext';
import { useDeploymentMode } from '../context/DeploymentModeContext';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { authenticatedRoutes, type RouteAuthorization } from '../routes/routeDefinitions';

export type NavigationItem = {
  name: string;
  path: string;
  icon: LucideIcon;
  matches?: string[];
  authorization: RouteAuthorization;
  nested?: boolean;
  exclude?: string[];
};

export type NavigationGroup = {
  id: string;
  title: string;
  items: NavigationItem[];
};

type NavigationItemInput = Omit<NavigationItem, 'authorization'>;
type NavigationGroupInput = Omit<NavigationGroup, 'items'> & { items: NavigationItemInput[] };

const RAW_NAV_GROUPS: NavigationGroupInput[] = [
  {
    id: 'overview', title: 'Overview',
    items: [{ name: 'Dashboard', path: '/', icon: LayoutDashboard, matches: ['/'] }],
  },
  {
    id: 'attendance', title: 'Attendance',
    items: [
      { name: 'Operator Work Queue', path: '/operator/work-queue', icon: ShieldCheck },
      { name: 'Class Attendance', path: '/attendance/class-entry', icon: CalendarDays },
      { name: 'Early Departures', path: '/attendance/class-departures', icon: Clock3 },
      { name: 'Attendance Review', path: '/attendance-review', icon: Edit3 },
      { name: 'Attendance Corrections', path: '/attendance-corrections', icon: Wrench },
      { name: 'Follow-Up Queue', path: '/attendance/followups', icon: UserCheck },
    ],
  },
  {
    id: 'academic-students', title: 'Academic & Students',
    items: [
      { name: 'Student Directory', path: '/students', icon: UsersIcon, nested: true, exclude: ['/students/operations'] },
      { name: 'Student Enrollment', path: '/enrollment', icon: UserRound },
      { name: 'Academic Management', path: '/academic-management', icon: Layers3 },
      { name: 'Teacher Assignments', path: '/teacher-class-assignments', icon: UserCheck },
      { name: 'Grade Ledger', path: '/grades', icon: GraduationCap },
    ],
  },
  {
    id: 'insights', title: 'Analytics & Reports',
    items: [
      { name: 'Management Analytics', path: '/analytics', icon: TrendingUp },
      { name: 'Data Recapitulation', path: '/analytics/recapitulation', icon: ClipboardList },
      { name: 'Executive Reports', path: '/reports/monthly', icon: BarChart3, matches: ['/reports', '/reports/monthly', '/reports/annual'] },
      { name: 'Monthly Management', path: '/reports/management/monthly', icon: PieChart },
      { name: 'Attendance Report', path: '/reports/attendance', icon: FileText },
      { name: 'Attendance Recap', path: '/reports/rekap-absensi', icon: Database },
      { name: 'Tardiness Report', path: '/reports/tardiness', icon: FileClock },
    ],
  },
  {
    id: 'data-management', title: 'Data Management',
    items: [
      { name: 'Data Import Center', path: '/upload', icon: UploadCloud },
      { name: 'Data Import & Export', path: '/data-portability', icon: Database },
      { name: 'Import History', path: '/upload-history', icon: History },
    ],
  },
  {
    id: 'administration', title: 'Administration',
    items: [
      { name: 'Departure Policies', path: '/attendance/departure-policies', icon: Clock3 },
      { name: 'Grade Level Cutoff', path: '/config/jenjang', icon: GraduationCap },
      { name: 'HEB Overrides', path: '/config/heb', icon: CalendarDays },
      { name: 'Absence Reasons', path: '/config/absence-reasons', icon: FileText },
      { name: 'Operations Audit', path: '/students/operations', icon: ShieldCheck },
      { name: 'Employee Directory', path: '/staff', icon: UsersIcon },
      { name: 'Settings', path: '/settings', icon: SettingsIcon, nested: true },
    ],
  },
];

function navigationItem(input: NavigationItemInput): NavigationItem {
  const route = authenticatedRoutes.find(({ path }) => path === input.path);
  if (!route) throw new Error(`Navigation item has no authenticated route: ${input.path}`);
  return { ...input, authorization: route.authorization };
}

export const NAV_GROUPS: NavigationGroup[] = RAW_NAV_GROUPS.map((group) => ({
  ...group,
  items: group.items.map(navigationItem),
}));

export function canAccessNavigationItem(
  item: NavigationItem,
  user: AuthUser | null,
  can: (capability: string) => boolean,
): boolean {
  if (!user) return false;
  if (item.authorization.type === 'role' && user.role !== item.authorization.role) return false;
  if (item.authorization.type === 'capability' && !can(item.authorization.capability)) return false;
  return true;
}

export function navigationItemIsActive(item: NavigationItem, pathname: string): boolean {
  if (item.exclude?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (item.matches) return item.matches.includes(pathname);
  return pathname === item.path || Boolean(item.nested && pathname.startsWith(`${item.path}/`));
}

export function visibleNavigationGroups(
  user: AuthUser | null,
  can: (capability: string) => boolean,
  isSingleUserMode = false,
): NavigationGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!canAccessNavigationItem(item, user, can)) return false;
      if (isSingleUserMode && item.path === '/teacher-class-assignments') return false;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
}

type SidebarNavProps = {
  open?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
};

type ServerStatus = 'checking' | 'online' | 'offline';

function SidebarNav({ open = false, collapsed = false, onNavigate, onToggleCollapsed }: SidebarNavProps) {
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const { user, can, logout } = useAuth();
  const { isSingleUserMode } = useDeploymentMode();
  const [loggingOut, setLoggingOut] = useState(false);
  const groups = useMemo(() => visibleNavigationGroups(user, can, isSingleUserMode), [user, can, isSingleUserMode]);
  const activeGroupId = groups.find((group) => group.items.some((item) => navigationItemIsActive(item, location.pathname)))?.id;
  const [expanded, setExpanded] = useState(() => new Set(NAV_GROUPS.map((group) => group.id)));

  useEffect(() => {
    if (!activeGroupId) return;
    setExpanded((current) => current.has(activeGroupId)
      ? current
      : new Set([...Array.from(current), activeGroupId]));
  }, [activeGroupId]);

  useEffect(() => {
    const checkStatus = async () => {
      try { await getServerStatus(); setServerStatus('online'); }
      catch { setServerStatus('offline'); }
    };
    void checkStatus();
    const interval = window.setInterval(checkStatus, 10000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleGroup = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logout(); } finally { setLoggingOut(false); }
  };

  return (
    <aside
      id="navigation-drawer"
      aria-label="Application navigation"
      aria-modal={open ? 'true' : undefined}
      role={open ? 'dialog' : undefined}
      className={cn(
        'app-sidebar fixed inset-y-0 left-0 z-50 flex max-h-dvh flex-col border-r border-slate-200 bg-white transition-[width,transform] duration-200 motion-reduce:transition-none no-print',
        collapsed ? 'w-20' : 'w-64',
        open ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
      )}
    >
      <div className={cn('flex h-20 shrink-0 items-center border-b border-slate-100 px-4', collapsed ? 'justify-center' : 'justify-between')}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white shadow-lg shadow-brand/20">O</div>
          <span className={cn('truncate text-xl font-bold tracking-tight text-slate-800', collapsed && 'sr-only')}>OperatorOS</span>
        </div>
        {!collapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar" className="hidden size-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronLeft aria-hidden="true" className="size-4" /></button>}
        {collapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar" className="hidden size-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronRight aria-hidden="true" className="size-4" /></button>}
      </div>

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {groups.map((group) => {
          const isExpanded = expanded.has(group.id) || collapsed;
          return <section key={group.id} className="mb-3 border-b border-slate-100 pb-3 last:border-0">
            <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={isExpanded} aria-controls={`nav-group-${group.id}`} disabled={collapsed} className={cn('flex min-h-10 w-full items-center rounded-lg px-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default disabled:hover:bg-transparent', collapsed ? 'justify-center' : 'justify-between')} title={collapsed ? group.title : undefined}>
              <span className={collapsed ? 'sr-only' : undefined}>{group.title}</span>
              <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform motion-reduce:transition-none', !isExpanded && '-rotate-90', collapsed && 'hidden')} />
              {collapsed && <span aria-hidden="true" className="size-1.5 rounded-full bg-slate-300" />}
            </button>
            {isExpanded && <ul id={`nav-group-${group.id}`} className="mt-1 space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = navigationItemIsActive(item, location.pathname);
                return <li key={item.path}><Link to={item.path} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={collapsed ? item.name : undefined} className={cn('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', collapsed && 'justify-center', active ? 'bg-brand/10 font-black text-brand ring-1 ring-brand/20' : 'font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800')}><Icon aria-hidden="true" className="size-5 shrink-0" /><span className={cn('min-w-0 leading-tight', collapsed ? 'sr-only' : 'break-words')}>{item.name}</span></Link></li>;
              })}
            </ul>}
          </section>;
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className={cn('rounded-xl border border-slate-200 bg-slate-50 p-3', collapsed && 'text-center')}>
          <p className={cn('truncate text-sm font-black text-slate-800', collapsed && 'sr-only')}>{user?.username}</p>
          {!collapsed && <Badge className="mt-1" variant="default">{user?.role}</Badge>}
          <Button aria-label={loggingOut ? 'Signing out' : 'Logout'} variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut} className={cn('mt-2 text-xs hover:border-rose-200 hover:text-rose-600', collapsed ? 'w-11 px-0' : 'w-full')}><LogOut aria-hidden="true" size={14} /><span className={collapsed ? 'sr-only' : undefined}>{loggingOut ? 'Signing out…' : 'Logout'}</span></Button>
        </div>
        <div className={cn('mt-2 flex min-h-10 items-center rounded-xl border border-slate-100 bg-slate-50 px-3', collapsed ? 'justify-center' : 'justify-between')} title={collapsed ? `Server ${serverStatus}` : undefined}>
          <div className="flex items-center gap-2"><Server aria-hidden="true" size={14} className="text-slate-400" /><span className={collapsed ? 'sr-only' : 'text-[10px] font-bold uppercase tracking-wider text-slate-400'}>Server</span></div>
          {!collapsed && <span className={cn('text-[10px] font-black uppercase', serverStatus === 'online' ? 'text-emerald-600' : serverStatus === 'offline' ? 'text-rose-600' : 'text-amber-600')}>{serverStatus}</span>}
        </div>
      </div>
    </aside>
  );
}

export default SidebarNav;
