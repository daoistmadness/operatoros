import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLink } from '../AppLink';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const openedPathnameRef = useRef(pathname);
  const results = useMemo(() => searchNavigationGroups(groups, query), [groups, query]);
  const resultCount = results.reduce((count, group) => count + group.items.length, 0);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setUnavailable(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} restoreFocus={false}>
      <DialogContent
        aria-describedby="navigation-search-description"
        className="max-h-[min(70dvh,36rem)] p-0"
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
            Search available pages. Use Tab and Enter to choose a destination.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <label className="sr-only" htmlFor="navigation-search-input">Search pages</label>
          <Input
            ref={inputRef}
            id="navigation-search-input"
            type="search"
            autoComplete="off"
            placeholder="Search pages…"
            value={query}
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
                      return (
                        <li key={item.path}>
                          <AppLink
                            to={item.path}
                            onClick={(event) => {
                              if (!canSelect(item)) {
                                event.preventDefault();
                                setUnavailable(true);
                                return;
                              }
                              setUnavailable(false);
                            }}
                            className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
