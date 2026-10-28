import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccessDenied, AuthLoading } from './RouteGuards';

describe('route access states', () => {
  it('announces session loading', () => {
    expect(renderToStaticMarkup(<AuthLoading />)).toContain('role="status"');
  });

  it('announces access denial', () => {
    expect(renderToStaticMarkup(<AccessDenied />)).toContain('role="alert"');
  });
});
