import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { AppLink as Link } from './AppLink';
import { useLocation } from '@tanstack/react-router';
import {
  ChevronLeft, ChevronRight, LogOut, Search, Server, X,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { isApiError } from '../lib/api/errors';
import { useAuth } from '../context/AuthContext';
import { useServerStatusQuery } from '../hooks/useServerStatusQuery';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { activeNavigationEntry, domainPrimaryPath, type NavigationGroup } from '../lib/navigation/registry';

type SidebarNavProps = {
  groups: readonly NavigationGroup[];
  open?: boolean;
  collapsed?: boolean;
  onClose: () => void;
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

function SidebarNav({ groups, open = false, collapsed = false, onClose, onNavigate, onOpenCommandSearch, onToggleCollapsed }: SidebarNavProps) {
  const isCollapsed = collapsed && !open;
  const location = useLocation();
  const { user, logout } = useAuth();
  const serverStatusQuery = useServerStatusQuery();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const navListRef = useRef<HTMLUListElement>(null);
  const activeDomainId = activeNavigationEntry(groups, location.pathname)?.group.id;

  const serverStatus: ServerStatus = serverStatusQuery.isLoading
    ? 'checking'
    : serverStatusQuery.isError
      ? 'offline'
      : 'online';

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

  const handleNavListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const links = Array.from(navListRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);
    if (!links.length) return;
    const currentIndex = links.findIndex((link) => link === document.activeElement);
    if (currentIndex === -1) return;

    event.preventDefault();
    if (event.key === 'Home') {
      links[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      links[links.length - 1]?.focus();
      return;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + links.length) % links.length;
    links[nextIndex]?.focus();
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
      <div className={cn('flex h-16 shrink-0 items-center border-b border-sidebar-border px-4', isCollapsed ? 'justify-center' : 'justify-between')}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white shadow-sm shadow-brand/20">O</div>
          <span className={cn('truncate text-lg font-bold tracking-tight text-sidebar-foreground', isCollapsed && 'sr-only')}>OperatorOS</span>
        </div>
        {open && <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:hidden"><X aria-hidden="true" className="size-5" /></button>}
        {!isCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar" className="hidden size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronLeft aria-hidden="true" className="size-4" /></button>}
        {isCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar" className="hidden size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:inline-flex"><ChevronRight aria-hidden="true" className="size-4" /></button>}
      </div>

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <Button
          type="button"
          variant="outline"
          aria-label="Search navigation"
          aria-keyshortcuts="Control+K Meta+K"
          title={isCollapsed ? 'Search navigation (Ctrl+K / ⌘K)' : undefined}
          onClick={onOpenCommandSearch}
          className={cn('mb-3 h-10 w-full justify-start gap-2 px-3', isCollapsed && 'justify-center px-0')}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('min-w-0 flex-1 truncate text-left text-xs font-semibold text-muted-foreground', isCollapsed && 'sr-only')}>Search…</span>
          {!isCollapsed && <kbd aria-hidden="true" className="shrink-0 rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Ctrl K</kbd>}
        </Button>

        <ul ref={navListRef} onKeyDown={handleNavListKeyDown} className="space-y-1">
          {groups.map((group) => {
            const Icon = group.icon;
            const targetPath = domainPrimaryPath(group);
            const active = activeDomainId === group.id;
            return (
              <li key={group.id}>
                <Link
                  to={targetPath}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={isCollapsed ? group.title : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    isCollapsed && 'justify-center px-0',
                    active
                      ? 'bg-brand/10 font-bold text-brand ring-1 ring-brand/20'
                      : 'font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                  <span className={cn('min-w-0 truncate leading-tight', isCollapsed && 'sr-only')}>{group.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className={cn('rounded-xl border border-sidebar-border bg-sidebar-accent p-3', isCollapsed && 'p-2 text-center')}>
          <p className={cn('truncate text-sm font-bold text-sidebar-foreground', isCollapsed && 'sr-only')}>{user?.username}</p>
          {!isCollapsed && <Badge className="mt-1" variant="default">{user?.role}</Badge>}
          {logoutError && <p role="alert" className={cn('mt-2 rounded-lg border border-danger/20 bg-danger-surface px-2 py-2 text-left text-xs font-semibold text-danger', isCollapsed && 'sr-only')}>{logoutError}</p>}
          <Button aria-label={loggingOut ? 'Signing out' : 'Logout'} variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut} className={cn('mt-2 text-xs hover:border-danger/40 hover:text-danger', isCollapsed ? 'w-11 px-0' : 'w-full')}><LogOut aria-hidden="true" size={14} /><span className={isCollapsed ? 'sr-only' : undefined}>{loggingOut ? 'Signing out…' : 'Logout'}</span></Button>
        </div>
        <div className={cn('mt-2 flex min-h-9 items-center rounded-xl border border-sidebar-border bg-sidebar-accent px-3', isCollapsed ? 'justify-center px-0' : 'justify-between')} title={isCollapsed ? `Server ${serverStatus}` : undefined}>
          <div className="flex items-center gap-2"><Server aria-hidden="true" size={14} className="text-muted-foreground" /><span className={isCollapsed ? 'sr-only' : 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'}>Server</span></div>
          {!isCollapsed && <span className={cn('text-[10px] font-black uppercase', serverStatus === 'online' ? 'text-success' : serverStatus === 'offline' ? 'text-danger' : 'text-warning')}>{serverStatus}</span>}
        </div>
      </div>
    </aside>
  );
}

export default SidebarNav;
