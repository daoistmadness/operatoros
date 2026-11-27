import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AppLink } from '../AppLink';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { cn } from '../../lib/cn';
import {
  searchNavigationGroups,
  type NavigationGroup,
  type NavigationItem,
} from '../../lib/navigation/registry';

type NavigationCommandSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly NavigationGroup[];
  pathname: string;
  returnFocusTarget: HTMLElement | null;
  sessionVerificationActive: boolean;
  canSelect: (item: NavigationItem) => boolean;
  onCommittedNavigation: () => void;
};

export function NavigationCommandSearch({
  open,
  onOpenChange,
  groups,
  pathname,
  returnFocusTarget,
  sessionVerificationActive,
  canSelect,
  onCommittedNavigation,
}: NavigationCommandSearchProps) {
  const [query, setQuery] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedPathnameRef = useRef(pathname);
  const results = useMemo(() => searchNavigationGroups(groups, query), [groups, query]);
  const flatItems = useMemo(() => results.flatMap((group) => group.items), [results]);
  const resultCount = flatItems.length;
  const boundedActiveIndex = resultCount > 0 ? Math.min(activeIndex, resultCount - 1) : -1;

  useEffect(() => {
    if (open) return;
    setQuery('');
    setUnavailable(false);
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (resultCount === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % resultCount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + resultCount) % resultCount);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(resultCount - 1);
      return;
    }
    if (event.key === 'Enter' && boundedActiveIndex >= 0) {
      event.preventDefault();
      const target = document.getElementById(`navigation-command-item-${boundedActiveIndex}`);
      if (target instanceof HTMLAnchorElement) {
        target.click();
      }
    }
  };

  let runningIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} restoreFocus={false}>
      <DialogContent
        aria-describedby="navigation-search-description"
        className="max-h-[min(75dvh,38rem)] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openedPathnameRef.current = pathname;
          inputRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (sessionVerificationActive) return;
          if (openedPathnameRef.current !== pathname) {
            onCommittedNavigation();
            return;
          }
          if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Search navigation</DialogTitle>
          <DialogDescription id="navigation-search-description">
            Search available pages in English or Indonesian. Use Arrow keys or Tab, and Enter to open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <label className="sr-only" htmlFor="navigation-search-input">Search pages</label>
          <Input
            ref={inputRef}
            id="navigation-search-input"
            type="search"
            autoComplete="off"
            aria-activedescendant={boundedActiveIndex >= 0 ? `navigation-command-item-${boundedActiveIndex}` : undefined}
            placeholder="Search pages (e.g. attendance, absensi, siswa, inventaris)…"
            value={query}
            onKeyDown={handleInputKeyDown}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setUnavailable(false);
            }}
          />
          {unavailable && <p role="alert" className="text-sm font-semibold text-danger">This destination is no longer available for your account.</p>}
          {resultCount === 0 ? (
            <p role="status" className="py-5 text-center text-sm text-muted-foreground">
              {query.trim() ? `No pages found for “${query.trim()}”.` : 'No pages are available.'}
            </p>
          ) : (
            <div className="max-h-[min(45dvh,24rem)] space-y-4 overflow-y-auto">
              <p className="sr-only" role="status">{resultCount} {resultCount === 1 ? 'page' : 'pages'} available.</p>
              {results.map((group) => (
                <section key={group.id} aria-labelledby={`navigation-search-group-${group.id}`}>
                  <h3 id={`navigation-search-group-${group.id}`} className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
                  <ul className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const itemIndex = runningIndex++;
                      const isActive = itemIndex === boundedActiveIndex;
                      return (
                        <li key={item.path}>
                          <AppLink
                            id={`navigation-command-item-${itemIndex}`}
                            to={item.path}
                            onMouseEnter={() => setActiveIndex(itemIndex)}
                            onClick={(event) => {
                              if (!canSelect(item)) {
                                event.preventDefault();
                                setUnavailable(true);
                                return;
                              }
                              setUnavailable(false);
                            }}
                            className={cn(
                              'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isActive && 'bg-surface-muted ring-1 ring-brand/30',
                            )}
                          >
                            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                            <span className="truncate text-xs font-normal text-muted-foreground">{item.path}</span>
                          </AppLink>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
