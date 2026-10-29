import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';
import { clearSessionQueries } from './sessionCache';

describe('session query cache', () => {
  it('clears protected data while retaining public setup status for route guards', async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.setup.status, { setup_required: false });
    client.setQueryData(queryKeys.auth.me, { id: 1, username: 'synthetic', role: 'admin', capabilities: [] });
    client.setQueryData(['dashboard', 'snapshot'], { count: 1 });

    await clearSessionQueries(client);

    expect(client.getQueryData(queryKeys.setup.status)).toEqual({ setup_required: false });
    expect(client.getQueryData(queryKeys.auth.me)).toBeNull();
    expect(client.getQueryData(['dashboard', 'snapshot'])).toBeUndefined();
    client.clear();
  });

  it('cancels the current-user request before setting the anonymous cache value', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let signal: AbortSignal | undefined;
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.auth.me,
      queryFn: ({ signal: requestSignal }) => {
        signal = requestSignal;
        return new Promise((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await Promise.resolve();

    await clearSessionQueries(client);

    expect(signal?.aborted).toBe(true);
    expect(client.getQueryData(queryKeys.auth.me)).toBeNull();
    unsubscribe();
    client.clear();
  });
});
