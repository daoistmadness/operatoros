import { Link as TanStackLink, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { AnchorHTMLAttributes } from 'react';
import { parseSearch } from '../lib/router/search';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

type Destination = {
  path: string;
  params: Record<string, string>;
  search: ReturnType<typeof parseSearch>;
  hash: string;
};

function routePattern(path: string): RegExp {
  if (path === '/') return /^\/$/;
  const parts = path.split('/').filter(Boolean).map((part) => part.startsWith('$') ? '([^/]+)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^/${parts.join('/')}/?$`);
}

function destinationFromHref(href: string, routePaths: string[]): Destination | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;

  const orderedPaths = routePaths.toSorted((left, right) => {
    const leftDynamic = (left.match(/\$[^/]+/g) ?? []).length;
    const rightDynamic = (right.match(/\$[^/]+/g) ?? []).length;
    return leftDynamic - rightDynamic || right.length - left.length;
  });
  for (const path of orderedPaths) {
    if (path === '/$') continue;
    const names = [...path.matchAll(/\$([^/]+)/g)].map((match) => match[1]);
    const match = url.pathname.match(routePattern(path));
    if (!match) continue;
    try {
      const params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? '')]));
      return { path, params, search: parseSearch(url.search), hash: url.hash.slice(1) };
    } catch {
      return null;
    }
  }
  return null;
}

export function AppLink({ to, ...props }: LinkProps) {
  const router = useRouter();
  const destination = destinationFromHref(to, Object.keys(router.routesByPath));
  if (!destination) return <a href={to} {...props} />;
  return <TanStackLink to={destination.path as never} params={destination.params as never} search={destination.search as never} hash={destination.hash} {...props} />;
}

export function useNavigateToHref() {
  const router = useRouter();
  return useCallback((href: string, options?: { replace?: boolean }) => {
    const destination = destinationFromHref(href, Object.keys(router.routesByPath));
    const safeHref = destination ? href : '/';
    if (options?.replace) router.history.replace(safeHref);
    else router.history.push(safeHref);
  }, [router]);
}
