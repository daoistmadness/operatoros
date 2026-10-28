import { QueryClient } from '@tanstack/react-query';
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
});
