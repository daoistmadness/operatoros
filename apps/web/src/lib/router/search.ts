import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { trimPathRight, useMatch, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

const searchSchema = Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]));
type SearchValues = Static<typeof searchSchema>;

export function validateSearch(raw: Record<string, unknown>): SearchValues {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') normalized[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') normalized[key] = String(value);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) normalized[key] = value;
  }
  return Value.Check(searchSchema, normalized) ? normalized : {};
}

export function parseSearch(search: string): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = values[key];
    values[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return values;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) values.append(key, String(item));
  }
  const query = values.toString();
  return query ? `?${query}` : '';
}

function toSearchObject(params: URLSearchParams): SearchValues {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const previous = values[key];
    values[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return values;
}

export type SearchParamsInit = URLSearchParams | string | Record<string, string | string[] | undefined>;
export type SearchParamsSetter = (
  next: SearchParamsInit | ((current: URLSearchParams) => SearchParamsInit),
  options?: { replace?: boolean },
) => void;

function createSearchParams(init: SearchParamsInit): URLSearchParams {
  if (init instanceof URLSearchParams) return new URLSearchParams(init);
  if (typeof init === 'string') return new URLSearchParams(init);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

export function useUrlSearchParams(): [URLSearchParams, SearchParamsSetter] {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const currentPathname = useRouterState({ select: (state) => state.location.pathname });
  const pathname = useMatch({ strict: false, shouldThrow: false, select: (match) => match.pathname }) ?? currentPathname;
  const router = useRouter();
  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const setParams = useCallback<SearchParamsSetter>((next, options) => {
    if (trimPathRight(router.state.location.pathname) !== trimPathRight(pathname)) return;
    const current = new URLSearchParams(searchStr);
    const updated = typeof next === 'function' ? next(current) : next;
    const location = router.state.location;
    const hash = location.hash ? `#${location.hash}` : '';
    const href = `${location.pathname}${stringifySearch(toSearchObject(createSearchParams(updated)))}${hash}`;
    if (options?.replace) router.history.replace(href);
    else router.history.push(href);
  }, [pathname, router, searchStr]);
  return [params, setParams];
}
