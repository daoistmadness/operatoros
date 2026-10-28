import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useRouterState } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import SidebarNav from './SidebarNav';
import { AccessDenied } from './auth/RouteGuards';
import { RouteLoadingFallback } from '../routes/RouteLoadingFallback';

export function AppShell() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const accessDenied = useRouterState({
    select: (state) => state.matches.some((match) => (match.context as { accessDenied?: boolean }).accessDenied),
  });

  useEffect(() => {
    setNavigationOpen(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    if (!navigationOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (mainRef.current) mainRef.current.inert = true;
    const drawer = document.getElementById('navigation-drawer');
    const focusable = () => [openerRef.current, ...Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])]
      .filter((element): element is HTMLElement => element !== null && element.getClientRects().length > 0);
    window.requestAnimationFrame(() => {
      const items = focusable();
      (items[1] ?? items[0])?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setNavigationOpen(false); window.requestAnimationFrame(() => openerRef.current?.focus()); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items.at(0);
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (mainRef.current) mainRef.current.inert = false;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [navigationOpen]);

  return (
    <div className="app-shell min-h-screen bg-slate-50 xl:flex">
      <a href="#main-content" className="fixed left-4 top-2 z-[80] -translate-y-16 rounded-lg bg-slate-950 px-4 py-2 font-bold text-white transition-transform focus:translate-y-0 motion-reduce:transition-none">Skip to main content</a>
      <button
        ref={openerRef}
        type="button"
        aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navigationOpen}
        aria-controls="navigation-drawer"
        onClick={() => setNavigationOpen((open) => !open)}
        className="fixed left-4 top-4 z-[60] inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm xl:hidden"
      >
        {navigationOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      {navigationOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setNavigationOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] xl:hidden"
        />
      )}
      <SidebarNav open={navigationOpen} collapsed={navigationCollapsed} onToggleCollapsed={() => setNavigationCollapsed((value) => !value)} onNavigate={() => setNavigationOpen(false)} />
      <main ref={mainRef} id="main-content" tabIndex={-1} aria-hidden={navigationOpen ? 'true' : undefined} className={`app-main min-w-0 flex-1 px-4 pb-8 pt-20 outline-none sm:px-6 xl:p-8 ${navigationCollapsed ? 'xl:ml-20' : 'xl:ml-64'}`}>
        <div className="mx-auto max-w-7xl">
          {accessDenied ? <AccessDenied /> : <SuspendedOutlet />}
        </div>
      </main>
    </div>
  );
}

function SuspendedOutlet() {
  return <Suspense fallback={<RouteLoadingFallback />}><Outlet /></Suspense>;
}
