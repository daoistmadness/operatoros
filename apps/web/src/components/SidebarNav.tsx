import { useEffect, useState, type MouseEvent } from 'react';
import { AppLink as Link } from './AppLink';
import { useLocation } from '@tanstack/react-router';
import {
  ChevronDown, ChevronLeft, ChevronRight, LogOut, Search, Server,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { isApiError } from '../lib/api/errors';
import { useAuth } from '../context/AuthContext';
import { useServerStatusQuery } from '../hooks/useServerStatusQuery';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { navigationGroups, navigationItemIsActive, type NavigationGroup } from '../lib/navigation/registry';

type SidebarNavProps = {
  groups: readonly NavigationGroup[];
  open?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  onOpenCommandSearch: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggleCollapsed?: () => void;
};

type ServerStatus = 'checking' | 'online' | 'offline';

function logoutFailureMessage(error: unknown): string {
  if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
    return 'Sign out could not be confirmed. Check the connection and try again. Your session may still be active.';
  }
  return 'Sign out could not be confirmed. Your session may still be active. Try again.';
}

function SidebarNav({ groups, open = false, collapsed = false, onNavigate, onOpenCommandSearch, onToggleCollapsed }: SidebarNavProps) {
  const isCollapsed = collapsed && !open;
  const location = useLocation();
  const { user, logout } = useAuth();
  const serverStatusQuery = useServerStatusQuery();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const activeGroupId = groups.find((group) => group.items.some((item) => navigationItemIsActive(item, location.pathname)))?.id;
  const [expanded, setExpanded] = useState(() => new Set(navigationGroups.map((group) => group.id)));

  useEffect(() => {
    if (!activeGroupId) return;
    setExpanded((current) => current.has(activeGroupId)
      ? current
      : new Set([...Array.from(current), activeGroupId]));
  }, [activeGroupId]);

  const serverStatus: ServerStatus = serverStatusQuery.isLoading
    ? 'checking'
    : serverStatusQuery.isError
      ? 'offline'
      : 'online';

  const toggleGroup = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleLogout = async () => {
    if (loggingOut) return;
    setLogoutError('');
    setLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      setLogoutError(logoutFailureMessage(error));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <aside
      id="navigation-drawer"
      aria-label="Application navigation"
      aria-modal={open ? 'true' : undefined}
      role={open ? 'dialog' : undefined}
      className={cn(
        'app-sidebar fixed inset-y-0 left-0 z-50 flex max-h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 motion-reduce:transition-none no-print',
        isCollapsed ? 'w-20' : 'w-64',
        open ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
      )}
    >
      <div className={cn('flex h-20 shrink-0 items-center border-b border-sidebar-border px-4', isCollapsed ? 'justify-center' : 'justify-between')}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white shadow-lg shadow-brand/20">O</div>
          <span className={cn('truncate text-xl font-bold tracking-tight text-sidebar-foreground', isCollapsed && 'sr-only')}>OperatorOS</span>
        </div>
        {!isCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar" className="hidden size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronLeft aria-hidden="true" className="size-4" /></button>}
        {isCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar" className="hidden size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronRight aria-hidden="true" className="size-4" /></button>}
      </div>

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <Button
          type="button"
          variant="outline"
          aria-label="Search navigation"
          aria-keyshortcuts="Control+K Meta+K"
          title={isCollapsed ? 'Search navigation (Ctrl+K / ⌘K)' : undefined}
          onClick={onOpenCommandSearch}
          className={cn('mb-4 w-full justify-start', isCollapsed && 'justify-center px-0')}
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className={isCollapsed ? 'sr-only' : 'min-w-0 flex-1 text-left'}>Search navigation</span>
          {!isCollapsed && <kbd aria-hidden="true" className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Ctrl K / ⌘ K</kbd>}
        </Button>
        {groups.map((group) => {
          const isExpanded = expanded.has(group.id) || isCollapsed;
          return <section key={group.id} className="mb-3 border-b border-sidebar-border pb-3 last:border-0">
            <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={isExpanded} aria-controls={`nav-group-${group.id}`} disabled={isCollapsed} className={cn('flex min-h-10 w-full items-center rounded-lg px-3 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default disabled:hover:bg-transparent', isCollapsed ? 'justify-center' : 'justify-between')} title={isCollapsed ? group.title : undefined}>
              <span className={isCollapsed ? 'sr-only' : undefined}>{group.title}</span>
              <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform motion-reduce:transition-none', !isExpanded && '-rotate-90', isCollapsed && 'hidden')} />
              {isCollapsed && <span aria-hidden="true" className="size-1.5 rounded-full bg-slate-300" />}
            </button>
            {isExpanded && <ul id={`nav-group-${group.id}`} className="mt-1 space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = navigationItemIsActive(item, location.pathname);
                return <li key={item.path}><Link to={item.path} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={isCollapsed ? item.name : undefined} className={cn('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', isCollapsed && 'justify-center', active ? 'bg-brand/10 font-black text-brand ring-1 ring-brand/20' : 'font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon aria-hidden="true" className="size-5 shrink-0" /><span className={cn('min-w-0 leading-tight', isCollapsed ? 'sr-only' : 'break-words')}>{item.name}</span></Link></li>;
              })}
            </ul>}
          </section>;
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className={cn('rounded-xl border border-sidebar-border bg-sidebar-accent p-3', isCollapsed && 'text-center')}>
          <p className={cn('truncate text-sm font-black text-sidebar-foreground', isCollapsed && 'sr-only')}>{user?.username}</p>
          {!isCollapsed && <Badge className="mt-1" variant="default">{user?.role}</Badge>}
          {logoutError && <p role="alert" className={cn('mt-2 rounded-lg border border-danger/20 bg-danger-surface px-2 py-2 text-left text-xs font-semibold text-danger', isCollapsed && 'sr-only')}>{logoutError}</p>}
          <Button aria-label={loggingOut ? 'Signing out' : 'Logout'} variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut} className={cn('mt-2 text-xs hover:border-danger/40 hover:text-danger', isCollapsed ? 'w-11 px-0' : 'w-full')}><LogOut aria-hidden="true" size={14} /><span className={isCollapsed ? 'sr-only' : undefined}>{loggingOut ? 'Signing out…' : 'Logout'}</span></Button>
        </div>
        <div className={cn('mt-2 flex min-h-10 items-center rounded-xl border border-sidebar-border bg-sidebar-accent px-3', isCollapsed ? 'justify-center' : 'justify-between')} title={isCollapsed ? `Server ${serverStatus}` : undefined}>
          <div className="flex items-center gap-2"><Server aria-hidden="true" size={14} className="text-muted-foreground" /><span className={isCollapsed ? 'sr-only' : 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'}>Server</span></div>
          {!isCollapsed && <span className={cn('text-[10px] font-black uppercase', serverStatus === 'online' ? 'text-success' : serverStatus === 'offline' ? 'text-danger' : 'text-warning')}>{serverStatus}</span>}
        </div>
      </div>
    </aside>
  );
}

export default SidebarNav;
