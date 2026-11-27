import { useRef, type KeyboardEvent } from 'react';
import { AppLink as Link } from '../AppLink';
import { cn } from '../../lib/cn';
import { navigationItemIsActive, type NavigationGroup, type NavigationItem } from '../../lib/navigation/registry';

type DomainSubNavProps = {
  domain: NavigationGroup;
  pathname: string;
  activeItemPath?: string;
};

type WorkflowSection = {
  label: string;
  items: NavigationItem[];
};

function groupByWorkflow(items: readonly NavigationItem[]): WorkflowSection[] {
  const sections: WorkflowSection[] = [];
  for (const item of items) {
    const label = item.workflowGroup ?? item.name;
    const existing = sections.find((section) => section.label === label);
    if (existing) existing.items.push(item);
    else sections.push({ label, items: [item] });
  }
  return sections;
}

function handleHorizontalArrowKeys(event: KeyboardEvent<HTMLUListElement>, list: HTMLUListElement | null) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
    return;
  }
  const links = Array.from(list?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);
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
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (currentIndex + delta + links.length) % links.length;
  links[nextIndex]?.focus();
}

export function DomainSubNav({ domain, pathname, activeItemPath }: DomainSubNavProps) {
  const groupListRef = useRef<HTMLUListElement>(null);
  const itemListRef = useRef<HTMLUListElement>(null);

  if (domain.items.length <= 1) return null;

  const isItemActive = (item: NavigationItem) =>
    navigationItemIsActive(item, pathname) || activeItemPath === item.path;

  const hasWorkflowGrouping = domain.items.some((item) => Boolean(item.workflowGroup));

  if (hasWorkflowGrouping) {
    const sections = groupByWorkflow(domain.items);
    const activeSection = sections.find((section) => section.items.some(isItemActive)) ?? sections[0];
    const showChildItems = Boolean(activeSection && activeSection.items.length > 1);

    return (
      <nav
        aria-label={`${domain.title} navigation`}
        className="mb-4 max-w-full rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-surface)] no-print"
      >
        <ul
          ref={groupListRef}
          onKeyDown={(event) => handleHorizontalArrowKeys(event, groupListRef.current)}
          className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:items-center"
        >
          {sections.map((section) => {
            const firstItem = section.items[0];
            if (!firstItem) return null;
            const isSingleItemSection = section.items.length === 1;
            const isSectionActive = activeSection?.label === section.label;
            const displayLabel = isSingleItemSection ? firstItem.name : section.label;
            const Icon = firstItem.icon;
            return (
              <li key={section.label} className="min-w-0">
                <Link
                  to={firstItem.path}
                  aria-current={isSingleItemSection && isSectionActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex sm:min-h-10 sm:w-auto sm:gap-2 sm:px-3 sm:text-sm',
                    isSectionActive
                      ? 'bg-brand/10 font-bold text-brand ring-1 ring-brand/20'
                      : 'font-semibold text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="leading-tight sm:whitespace-nowrap">{displayLabel}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {showChildItems && activeSection && (
          <ul
            ref={itemListRef}
            aria-label={`${activeSection.label} pages`}
            onKeyDown={(event) => handleHorizontalArrowKeys(event, itemListRef.current)}
            className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border pt-1.5"
          >
            {activeSection.items.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-surface-muted font-bold text-foreground ring-1 ring-border'
                        : 'font-semibold text-muted-foreground hover:bg-surface-muted/70 hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label={`${domain.title} navigation`}
      className="mb-4 max-w-full rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-surface)] no-print"
    >
      <ul
        ref={itemListRef}
        onKeyDown={(event) => handleHorizontalArrowKeys(event, itemListRef.current)}
        className="flex flex-wrap items-center gap-1"
      >
        {domain.items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item);
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 sm:px-3 sm:text-sm',
                  active
                    ? 'bg-brand/10 font-bold text-brand ring-1 ring-brand/20'
                    : 'font-semibold text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
