describe('API routing helpers', () => {
  afterEach(() => {
    delete process.env.REACT_APP_API_URL;
    jest.resetModules();
  });

  it('strips a single leading /api prefix for proxy paths', () => {
    const { stripLeadingApiPrefix } = require('./routing');

    expect(stripLeadingApiPrefix('/api/uploads/sample-template')).toBe('/uploads/sample-template');
    expect(stripLeadingApiPrefix('/api')).toBe('/');
    expect(stripLeadingApiPrefix('/uploads/sample-template')).toBe('/uploads/sample-template');
  });

  it('does not generate a duplicated /api/api prefix for relative API bases', () => {
    process.env.REACT_APP_API_URL = '/api';

    const { buildApiUrl } = require('./client');
    const url = buildApiUrl('/api/uploads/sample-template', { page: 1 });

    expect(url).toContain('/api/uploads/sample-template');
    expect(url).not.toContain('/api/api/');
    expect(url).toContain('page=1');
  });
});
