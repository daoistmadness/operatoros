import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary', () => {
  it('shows operator-safe recovery UI without raw error details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = () => {
      throw new Error('private chunk URL /assets/secret.js');
    };

    await act(async () => {
      root.render(<MemoryRouter><RouteErrorBoundary><Broken /></RouteErrorBoundary></MemoryRouter>);
    });

    expect(container.textContent).toContain('This page could not be loaded');
    expect(container.textContent).toContain('Retry');
    expect(container.textContent).toContain('Return to dashboard');
    expect(container.textContent).not.toContain('private chunk URL');
    expect(container.textContent).not.toContain('/assets/secret.js');
  });

  it('allows retry to reset the boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    const Recoverable = () => {
      if (shouldThrow) throw new Error('temporary');
      return <p>Recovered page</p>;
    };

    await act(async () => {
      root.render(<MemoryRouter><RouteErrorBoundary><Recoverable /></RouteErrorBoundary></MemoryRouter>);
    });
    shouldThrow = false;
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    await act(async () => retry?.click());

    expect(container.textContent).toContain('Recovered page');
    expect(container.textContent).not.toContain('This page could not be loaded');
  });
});
