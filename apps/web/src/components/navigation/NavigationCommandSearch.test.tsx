import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLocation } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../../context/AuthContext';
import { MemoryRouter } from '../../test/TestRouter';
import { visibleNavigationGroups, type NavigationItem } from '../../lib/navigation/registry';
import { NavigationCommandSearch } from './NavigationCommandSearch';

const auth: AuthContextValue = {
  user: { id: 1, username: 'admin', role: 'admin', capabilities: ['view_student'] },
  loading: false,
  authenticated: true,
  can: (capability) => capability === 'view_student',
  login: async () => ({ id: 1, username: 'admin', role: 'admin', capabilities: ['view_student'] }),
  logout: async () => undefined,
};

const groups = visibleNavigationGroups({ auth, isSingleUserMode: false });

function CurrentPath() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

function SearchHarness({ canSelect = () => true }: { canSelect?: (item: NavigationItem) => boolean }) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  return (
    <MemoryRouter>
      <button ref={returnFocusRef} type="button" id="return-focus">Open search</button>
      <button type="button" onClick={() => setOpen(false)}>Close search state</button>
      <CurrentPath />
      <NavigationCommandSearch
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        pathname="/"
        returnFocusTarget={returnFocusRef.current}
        sessionVerificationActive={false}
        canSelect={canSelect}
        onCommittedNavigation={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('navigation command search', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function render(canSelect?: (item: NavigationItem) => boolean) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SearchHarness canSelect={canSelect} />));
  }

  it('focuses the search field, finds navigation aliases, and announces empty results', async () => {
    await render();
    const input = document.querySelector<HTMLInputElement>('#navigation-search-input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    if (!input) throw new Error('Expected the command search field.');

    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setInputValue?.call(input, 'roster');
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')?.querySelector('a[href="/students"]')?.textContent).toContain('Student Directory');

    setInputValue?.call(input, 'nothing matches');
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('No pages found');
  });

  it('rechecks eligibility when a result is selected and returns focus on dismissal', async () => {
    const unavailable = vi.fn(() => false);
    await render(unavailable);
    const result = document.querySelector<HTMLAnchorElement>('[role="dialog"] a[href="/students"]');
    expect(result).not.toBeNull();
    if (!result) throw new Error('Expected a student directory result.');

    await act(async () => result.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('no longer available');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="current-path"]')?.textContent).toBe('/');

    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]');
    expect(close).not.toBeNull();
    if (!close) throw new Error('Expected the dialog close button.');
    await act(async () => close.click());
    await act(async () => await Promise.resolve());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('return-focus'));
  });
});
