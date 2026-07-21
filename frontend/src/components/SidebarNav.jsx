import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Edit3, FileClock, FileText, GraduationCap, History, LayoutDashboard,
  Layers3, LogOut, Server, Settings as SettingsIcon, ShieldCheck, TrendingUp,
  UploadCloud, UserCheck, Users as UsersIcon,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { getServerStatus } from '../lib/api/endpoints';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

export const NAV_GROUPS = [
  {
    id: 'overview', title: 'Overview',
    items: [{ name: 'Dashboard', path: '/', icon: LayoutDashboard, matches: ['/'] }],
  },
  {
    id: 'workflows', title: 'Daily Workflows',
    items: [
      { name: 'Attendance Review', path: '/attendance-review', icon: Edit3 },
      { name: 'Students', path: '/students', icon: UsersIcon, capability: 'view_student', nested: true, exclude: ['/students/operations'] },
      { name: 'Data Import Center', path: '/upload', icon: UploadCloud, role: 'admin' },
      { name: 'Import History', path: '/upload-history', icon: History, role: 'admin' },
      { name: 'Academic Management', path: '/academic-management', icon: Layers3, role: 'admin' },
      { name: 'Student Enrollment', path: '/enrollment', icon: UserCheck, capability: 'manage_enrollment' },
      { name: 'Grade Ledger', path: '/grades', icon: GraduationCap, role: 'admin' },
    ],
  },
  {
    id: 'insights', title: 'Analytics & Reports',
    items: [
      { name: 'Management Analytics', path: '/analytics', icon: TrendingUp, capability: 'view_student' },
      { name: 'Executive Reports', path: '/reports/monthly', icon: BarChart3, matches: ['/reports', '/reports/monthly', '/reports/annual'] },
      { name: 'Monthly Management', path: '/reports/management/monthly', icon: BarChart3 },
      { name: 'Attendance Report', path: '/reports/attendance', icon: FileText },
      { name: 'Attendance Recap', path: '/reports/rekap-absensi', icon: BarChart3 },
      { name: 'Tardiness Report', path: '/reports/tardiness', icon: FileClock },
    ],
  },
  {
    id: 'administration', title: 'Administration',
    items: [
      { name: 'Cutoff Jenjang', path: '/config/jenjang', icon: Clock3 },
      { name: 'HEB Overrides', path: '/config/heb', icon: Clock3, role: 'admin' },
      { name: 'Absence Reasons', path: '/config/absence-reasons', icon: CalendarDays, role: 'admin' },
      { name: 'Operations Audit', path: '/students/operations', icon: ShieldCheck, capability: 'view_student_audit' },
      { name: 'Settings', path: '/settings', icon: SettingsIcon, nested: true },
    ],
  },
];

export function canAccessNavigationItem(item, user, can) {
  if (!user) return false;
  if (item.role && user.role !== item.role) return false;
  if (item.capability && !can(item.capability)) return false;
  return true;
}

export function navigationItemIsActive(item, pathname) {
  if (item.exclude?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (item.matches) return item.matches.includes(pathname);
  return pathname === item.path || Boolean(item.nested && pathname.startsWith(`${item.path}/`));
}

export function visibleNavigationGroups(user, can) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessNavigationItem(item, user, can)),
  })).filter((group) => group.items.length > 0);
}

function SidebarNav({ open = false, collapsed = false, onNavigate, onToggleCollapsed }) {
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState('checking');
  const { user, can, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const groups = useMemo(() => visibleNavigationGroups(user, can), [user, can]);
  const activeGroupId = groups.find((group) => group.items.some((item) => navigationItemIsActive(item, location.pathname)))?.id;
  const [expanded, setExpanded] = useState(() => new Set(NAV_GROUPS.map((group) => group.id)));

  useEffect(() => {
    if (!activeGroupId) return;
    setExpanded((current) => current.has(activeGroupId) ? current : new Set([...current, activeGroupId]));
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

  const toggleGroup = (id) => setExpanded((current) => {
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
