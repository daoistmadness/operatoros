import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import SidebarNav from './SidebarNav';
import { NavigationCommandSearch } from './navigation/NavigationCommandSearch';
import { AppLink } from './AppLink';
import { AccessDenied } from './auth/RouteGuards';
import { RouteLoadingFallback } from '../routes/RouteLoadingFallback';
import { useAuth } from '../context/AuthContext';
import { useDeploymentMode } from '../context/DeploymentModeContext';
import { UiPreferencesProvider, useUiPreferences } from '../context/UiPreferencesContext';
import { isRouteAuthorized } from '../lib/router/access';
import {
  canSelectNavigationItem,
  navigationPresentationForPath,
  visibleNavigationGroups,
} from '../lib/navigation/registry';

export function AppShell() {
  return (
    <UiPreferencesProvider>
      <AppShellContent />
    </UiPreferencesProvider>
  );
}

function AppShellContent() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [commandReturnFocusTarget, setCommandReturnFocusTarget] = useState<HTMLElement | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sessionStatusRef = useRef<HTMLDivElement>(null);
  const sessionDialogRef = useRef<HTMLElement>(null);
  const sessionOverlayRef = useRef<HTMLDivElement>(null);
  const closeNavigation = useCallback(() => {
    setNavigationOpen(false);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, []);
  const { pathname } = useLocation();
  const auth = useAuth();
  const { preferences, setSidebarCollapsed } = useUiPreferences();
  const navigationCollapsed = preferences.sidebarCollapsed;
  const { isSingleUserMode } = useDeploymentMode();
  const sessionVerification = auth.sessionVerification ?? 'idle';
  const verifyingSession = sessionVerification !== 'idle';
  const previousSessionVerification = useRef(sessionVerification);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const accessDenied = !isRouteAuthorized(pathname, auth);
  const navigationContext = useMemo(() => ({ auth, isSingleUserMode }), [auth, isSingleUserMode]);
  const groups = useMemo(() => visibleNavigationGroups(navigationContext), [navigationContext]);
  const presentation = useMemo(() => navigationPresentationForPath(groups, pathname), [groups, pathname]);
  const pageTitle = accessDenied ? 'Access denied' : presentation?.title;

  useEffect(() => {
    setNavigationOpen(false);
    setCommandSearchOpen(false);
    setCommandReturnFocusTarget(null);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    if (verifyingSession) {
      setNavigationOpen(false);
      setCommandSearchOpen(false);
    }
  }, [verifyingSession]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      if (event.defaultPrevented || event.repeat || event.isComposing || verifyingSession) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault();
      const activeElement = document.activeElement;
      const returnTarget = navigationOpen
        ? openerRef.current
        : activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : mainRef.current;
      setCommandReturnFocusTarget(returnTarget);
      setNavigationOpen(false);
      setCommandSearchOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigationOpen, verifyingSession]);

  useEffect(() => {
    document.title = `${pageTitle ?? 'OperatorOS'}${pageTitle ? ' | OperatorOS' : ''}`;
  }, [pageTitle]);

  useEffect(() => () => {
    document.title = 'OperatorOS';
  }, []);

  useLayoutEffect(() => {
    const previous = previousSessionVerification.current;
    if (sessionVerification === 'idle') {
      if (previous !== 'idle') {
        if (focusReturnRef.current?.isConnected) focusReturnRef.current.focus({ preventScroll: true });
        focusReturnRef.current = null;
      }
    } else {
      if (previous === 'idle' && document.activeElement instanceof HTMLElement) {
        focusReturnRef.current = document.activeElement;
      }
      const verificationElement = sessionVerification === 'checking' ? sessionStatusRef.current : sessionDialogRef.current;
      const retryButton = verificationElement?.querySelector<HTMLButtonElement>('button');
      (retryButton ?? verificationElement)?.focus({ preventScroll: true });
    }
    previousSessionVerification.current = sessionVerification;
  }, [sessionVerification]);

  useLayoutEffect(() => {
    if (!verifyingSession) return undefined;
    const previousState = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
    const isolateOutsideOverlay = () => {
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child === sessionOverlayRef.current) continue;
        if (!previousState.has(child)) {
          previousState.set(child, { inert: child.inert, ariaHidden: child.getAttribute('aria-hidden') });
        }
        child.inert = true;
        child.setAttribute('aria-hidden', 'true');
      }
    };
    isolateOutsideOverlay();
    const observer = new MutationObserver(isolateOutsideOverlay);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      for (const [element, previous] of previousState) {
        if (!element.isConnected) continue;
        element.inert = previous.inert;
        if (previous.ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', previous.ariaHidden);
      }
    };
  }, [verifyingSession]);

  useEffect(() => {
    if (!navigationOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (mainRef.current) mainRef.current.inert = true;
    const drawer = document.getElementById('navigation-drawer');
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    window.requestAnimationFrame(() => {
      const items = focusable();
      items[0]?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeNavigation(); return; }
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
  }, [closeNavigation, navigationOpen]);

  return (
    <>
      <div className="app-shell min-h-screen bg-background xl:flex" inert={verifyingSession || undefined} aria-hidden={verifyingSession || undefined}>
        <a href="#main-content" inert={navigationOpen || undefined} tabIndex={navigationOpen ? -1 : undefined} className="fixed left-4 top-2 z-[80] -translate-y-16 rounded-lg bg-slate-950 px-4 py-2 font-bold text-white transition-transform focus:translate-y-0 motion-reduce:transition-none">Skip to main content</a>
        <button
          ref={openerRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={navigationOpen}
          aria-controls="navigation-drawer"
          inert={navigationOpen || undefined}
          onClick={() => setNavigationOpen((open) => !open)}
          className="fixed left-4 top-4 z-[30] inline-flex size-11 items-center justify-center rounded-xl border border-sidebar-border bg-surface text-foreground shadow-sm xl:hidden"
        >
          {navigationOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        {navigationOpen && (
          <button
            type="button"
            aria-label="Close navigation overlay"
            aria-hidden="true"
            tabIndex={-1}
            onClick={closeNavigation}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] xl:hidden"
          />
        )}
        <SidebarNav
          groups={groups}
          open={navigationOpen}
          collapsed={navigationCollapsed}
          onClose={closeNavigation}
          onToggleCollapsed={() => setSidebarCollapsed(!navigationCollapsed)}
          onNavigate={() => setNavigationOpen(false)}
          onOpenCommandSearch={(event) => {
            setCommandReturnFocusTarget(navigationOpen ? openerRef.current : event.currentTarget);
            setNavigationOpen(false);
            setCommandSearchOpen(true);
          }}
        />
        <main ref={mainRef} id="main-content" tabIndex={-1} aria-hidden={navigationOpen ? 'true' : undefined} className={`app-main min-w-0 flex-1 px-4 pb-8 pt-20 outline-none sm:px-6 xl:p-8 ${navigationCollapsed ? 'xl:ml-20' : 'xl:ml-64'}`}>
          <div className="mx-auto max-w-7xl">
            {presentation && !accessDenied && (
              <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
                <ol className="flex min-h-6 items-center gap-2">
                  {presentation.breadcrumbs.map((breadcrumb, index) => (
                    <li key={`${breadcrumb.label}-${index}`} aria-current={index === presentation.breadcrumbs.length - 1 ? 'page' : undefined}>
                      {breadcrumb.href
                        ? <AppLink to={breadcrumb.href} className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{breadcrumb.label}</AppLink>
                        : <span className="font-semibold text-foreground">{breadcrumb.label}</span>}
                      {index < presentation.breadcrumbs.length - 1 && <span aria-hidden="true" className="ml-2">/</span>}
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            {accessDenied ? <AccessDenied /> : <SuspendedOutlet />}
          </div>
        </main>
      </div>
      <NavigationCommandSearch
        open={commandSearchOpen && !verifyingSession}
        onOpenChange={setCommandSearchOpen}
        groups={groups}
        pathname={pathname}
        returnFocusTarget={commandReturnFocusTarget}
        sessionVerificationActive={verifyingSession}
        canSelect={(item) => canSelectNavigationItem(item, navigationContext)}
        onCommittedNavigation={() => mainRef.current?.focus({ preventScroll: true })}
      />
      {verifyingSession && createPortal(
        <div ref={sessionOverlayRef} data-testid="session-verification-overlay" className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-slate-950/90 p-6 text-center text-white">
          {sessionVerification === 'checking' ? (
            <div ref={sessionStatusRef} tabIndex={-1} role="status" aria-live="polite" className="max-w-md outline-none">
              <h1 className="text-xl font-bold">Checking your session</h1>
              <p className="mt-2 text-sm text-slate-200">Your workspace will return after access is verified.</p>
            </div>
          ) : (
            <section
              ref={sessionDialogRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="session-verification-title"
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault();
                  sessionDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                }
              }}
              className="max-w-md outline-none"
            >
              <h1 id="session-verification-title" className="text-xl font-bold">Session check unavailable</h1>
              <p className="mt-2 text-sm text-slate-200">Your workspace is hidden until your access can be verified.</p>
              <button type="button" onClick={() => void auth.retrySessionVerification?.()} className="mt-5 rounded-lg bg-white px-4 py-2 font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Retry session check</button>
            </section>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function SuspendedOutlet() {
  return <Suspense fallback={<RouteLoadingFallback />}><Outlet /></Suspense>;
}
