// routing.test.js
// Verifies that the API client builds canonical /api/... URLs correctly
// without generating /api/api/ double-prefixes or applying Portless domain logic.

describe('API client URL construction', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('builds a canonical /api/... URL when API_BASE_URL is empty (Vite proxy mode)', () => {
    // In Vite proxy mode, VITE_API_BASE_URL is empty and API_BASE_URL resolves to "".
    // buildApiUrl forwards the path verbatim so the Vite proxy can handle it.
    const { buildApiUrl } = require('./client');
    const url = buildApiUrl('/api/uploads/sample-template', { page: 1 });

    expect(url).toContain('/api/uploads/sample-template');
    expect(url).not.toContain('/api/api/');
    expect(url).toContain('page=1');
  });

  it('does not apply Portless domain transformation', () => {
    // Verify the client never rewrites paths to school-attendance.localhost
    const { buildApiUrl } = require('./client');
    const url = buildApiUrl('/api/analytics/summary');

    expect(url).not.toContain('school-attendance.localhost');
    expect(url).not.toContain('api.school-attendance.localhost');
    expect(url).not.toContain('/api/api/');
  });
});
