import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Edit3,
  FileClock,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  Layers3,
  Server,
  Settings as SettingsIcon,
  TrendingUp,
  UploadCloud,
  UserCheck,
  LogOut,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { getServerStatus } from '../lib/api/endpoints';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

const NAV_GROUPS = [
  {
    title: 'Main',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard, match: (pathname) => pathname === '/' },
      { name: 'Upload Data', path: '/upload', icon: UploadCloud },
      { name: 'Upload History', path: '/upload-history', icon: History },
      { name: 'Attendance Review', path: '/attendance-review', icon: Edit3 },
      { name: 'Academic & Student Management', path: '/academic-management', icon: Layers3 },
      { name: 'Students', path: '/students', icon: UsersIcon, match: (pathname) => pathname === '/students' || (pathname.startsWith('/students/') && pathname !== '/students/operations') },
      { name: 'Operations Audit', path: '/students/operations', icon: ShieldCheck, capability: 'view_student_audit' },
      { name: 'Student Enrollment', path: '/enrollment', icon: UserCheck },
      { name: 'Grade Ledger', path: '/grades', icon: GraduationCap },
      { name: 'Management Analytics', path: '/analytics', icon: TrendingUp },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { name: 'Jenjang Config', path: '/config/jenjang', icon: Clock3 },
      { name: 'Override HEB', path: '/config/heb', icon: Clock3 },
      { name: 'Sakit / Izin / Alfa', path: '/config/absence-reasons', icon: CalendarDays },
    ],
  },
  {
    title: 'Reports',
    items: [
      { name: 'Executive Reports', path: '/reports/monthly', icon: BarChart3, match: (pathname) => pathname === '/reports/monthly' || pathname === '/reports/annual' },
      { name: 'Monthly Management Report', path: '/reports/management/monthly', icon: BarChart3 },
      { name: 'Attendance Report', path: '/reports/attendance', icon: FileText },
      { name: 'Rekap Absensi', path: '/reports/rekap-absensi', icon: BarChart3 },
      { name: 'Laporan Keterlambatan', path: '/reports/tardiness', icon: FileClock },
    ],
  },
];

function SidebarNav({ open = false, onNavigate }) {
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState('checking');
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    const checkStatus = async () => {
      try {
        await getServerStatus();
        setServerStatus('online');
      } catch (error) {
        setServerStatus('offline');
      }
    };

    checkStatus();
    const interval = window.setInterval(checkStatus, 10000);
    return () => window.clearInterval(interval);
  }, []);

  const isActivePath = (item) => {
    if (typeof item.match === 'function') {
      return item.match(location.pathname);
    }
    return location.pathname === item.path;
  };

  return (
    <nav
      id="primary-navigation"
      aria-label="Primary navigation"
      className={cn(
        'app-sidebar fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-slate-200 bg-white p-6 transition-transform duration-200 no-print',
        open ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
      )}
    >
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-brand/20">
          O
        </div>
        <span className="font-bold text-xl tracking-tight text-slate-800">OperatorOS</span>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto pr-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-4 mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
              {group.title}
            </p>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = isActivePath(item);

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 ease-out',
                      isActive
                        ? 'bg-brand/10 text-brand font-semibold'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    )}
                  >
                    <Icon size={20} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-6 border-t border-slate-100 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Logged in as</p>
          <p className="mt-1 truncate text-sm font-black text-slate-800">{user?.username}</p>
          <Badge className="mt-1" variant="default">{user?.role}</Badge>
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut} className="mt-3 w-full text-xs hover:border-rose-200 hover:text-rose-600">
            <LogOut size={14} />{loggingOut ? 'Signing out…' : 'Logout'}
          </Button>
        </div>
        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Server Status</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-2 h-2 rounded-[9999px]',
                serverStatus === 'online'
                  ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : serverStatus === 'offline'
                    ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'
                    : 'bg-amber-500'
              )}
            />
            <span
              className={cn(
                'text-[10px] font-black uppercase tracking-tighter',
                serverStatus === 'online'
                  ? 'text-emerald-600'
                  : serverStatus === 'offline'
                    ? 'text-rose-600'
                    : 'text-amber-600'
              )}
            >
              {serverStatus}
            </span>
          </div>
        </div>

        <Link
          to="/settings"
          onClick={onNavigate}
          aria-current={location.pathname === '/settings' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 ease-out',
            location.pathname === '/settings'
              ? 'bg-slate-100 text-slate-800 font-semibold'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
          )}
        >
          <SettingsIcon size={20} />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}

export default SidebarNav;
