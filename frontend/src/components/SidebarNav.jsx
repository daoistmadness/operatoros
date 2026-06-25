import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Edit3,
  FileClock,
  FileText,
  History,
  LayoutDashboard,
  Server,
  Settings as SettingsIcon,
  UploadCloud,
  Users as UsersIcon,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { getServerStatus } from '../lib/api/endpoints';

const NAV_GROUPS = [
  {
    title: 'Main',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard, match: (pathname) => pathname === '/' },
      { name: 'Upload Data', path: '/upload', icon: UploadCloud },
      { name: 'Upload History', path: '/upload-history', icon: History },
      { name: 'Class Mapping', path: '/mapping', icon: UsersIcon },
      { name: 'Attendance Review', path: '/attendance-review', icon: Edit3 },
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
      { name: 'Attendance Report', path: '/reports', icon: FileText },
      { name: 'Rekap Absensi', path: '/reports/rekap-absensi', icon: BarChart3 },
      { name: 'Laporan Keterlambatan', path: '/reports/tardiness', icon: FileClock },
    ],
  },
];

function SidebarNav() {
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState('checking');

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
    <nav className="app-sidebar fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 z-50 p-6 flex flex-col no-print">
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-brand/20">
          A
        </div>
        <span className="font-bold text-xl tracking-tight text-slate-800">OPREDEL</span>
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
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 ease-out',
                      isActive
                        ? 'bg-brand/10 text-brand font-semibold'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    )}
                    style={{ willChange: 'background-color, color' }}
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
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 ease-out',
            location.pathname === '/settings'
              ? 'bg-slate-100 text-slate-800 font-semibold'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
          )}
          style={{ willChange: 'background-color, color' }}
        >
          <SettingsIcon size={20} />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}

export default SidebarNav;
