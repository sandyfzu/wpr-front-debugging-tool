import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../components/ui/toast-store';
import type { AskOutcome } from '../../../lib/messaging/bounded-ask';
import type {
  ExclusionOverlayOpenOutcome,
  ExclusionSessionSummary,
  ExclusionSessionTabSummary
} from '../../../lib/messaging/exclusion-panel';
import { BuilderEntry, builderEntryOffered, type BuilderEntryDeps } from './builder-entry';

const TAB = 7;

/** Deps over controllable answers; `push` delivers to the registered listener. */
function deps(
  options: {
    tabId?: number | null;
    status?: Promise<AskOutcome<ExclusionSessionSummary>>;
    open?: () => Promise<AskOutcome<ExclusionOverlayOpenOutcome>>;
  } = {}
) {
  let handler: ((push: ExclusionSessionTabSummary, fromTab: boolean) => void) | null = null;
  const stop = vi.fn();
  const open = vi.fn(
    options.open ?? (() => Promise.resolve({ kind: 'reply', reply: 'injected' } as const))
  );
  const askStatus = vi.fn(
    () =>
      options.status ?? Promise.resolve({ kind: 'reply', reply: { state: 'inactive' } } as const)
  );
  const api: BuilderEntryDeps = {
    inspectedTabId: () => (options.tabId === undefined ? TAB : options.tabId),
    askStatus,
    open,
    listen: (registered) => {
      handler = registered;
      return stop;
    }
  };
  return {
    api,
    open,
    askStatus,
    stop,
    push: (push: ExclusionSessionTabSummary, fromTab = false) => {
      handler?.(push, fromTab);
    }
  };
}

/** The entry's button. */
const entry = (): HTMLElement => screen.getByRole('button', { name: /^Exclusions/ });

afterEach(() => {
  cleanup();
  toast.clear();
});

describe('BuilderEntry', () => {
  it('asks the inspected tab’s status, then follows the background’s pushes for that tab only', async () => {
    const d = deps({
      status: Promise.resolve({
        kind: 'reply',
        reply: { state: 'active', origin: 'https://example.com' }
      } as const)
    });
    render(() => <BuilderEntry deps={d.api} />);
    expect(d.askStatus).toHaveBeenCalledWith(TAB);
    await screen.findByText('On');
    expect(entry().getAttribute('title')).toMatch(/until Stop or the tab closes/);
    d.push({ tabId: TAB, summary: { state: 'unavailable' } });
    await screen.findByText('Unavailable');
    // Another tab's push, or one from a page context, changes nothing.
    d.push({ tabId: 8, summary: { state: 'inactive' } });
    d.push({ tabId: TAB, summary: { state: 'inactive' } }, true);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    d.push({ tabId: TAB, summary: { state: 'inactive' } });
    await screen.findByText('Off');
  });

  it('shows no badge while checking, and none when the ask got no answer', async () => {
    let answer!: (outcome: AskOutcome<ExclusionSessionSummary>) => void;
    const d = deps({ status: new Promise((resolve) => (answer = resolve)) });
    render(() => <BuilderEntry deps={d.api} />);
    expect(entry().getAttribute('title')).toBe('Checking the exclusion session of this tab.');
    answer({ kind: 'timeout' });
    await waitFor(() => {
      expect(entry().getAttribute('title')).toMatch(/could not be read/);
    });
    expect(screen.queryByText(/^(On|Off|Unavailable)$/)).toBeNull();
  });

  it('opens the builder on the inspected tab and confirms with a toast, once at a time', async () => {
    let answer!: (outcome: AskOutcome<ExclusionOverlayOpenOutcome>) => void;
    const d = deps({ open: () => new Promise((resolve) => (answer = resolve)) });
    render(() => <BuilderEntry deps={d.api} />);
    fireEvent.click(entry());
    expect(d.open).toHaveBeenCalledWith(TAB);
    const busy = screen.getByRole('button', { name: /^Opening…/ });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    // Held: no hover surface, muted words.
    expect(busy.className).not.toMatch(/hover:/);
    expect(busy.className).toMatch(/text-fg-muted/);
    fireEvent.click(busy);
    expect(d.open).toHaveBeenCalledTimes(1);
    answer({ kind: 'reply', reply: 'injected' });
    await waitFor(() => {
      expect(toastItems().map((item) => item.title)).toEqual([
        'Exclusion builder opened on the page'
      ]);
    });
    expect(entry().getAttribute('aria-busy')).toBe('false');
    expect(entry().getAttribute('aria-disabled')).toBeNull();
    expect(entry().className).toMatch(/hover:bg-surface-3/);
  });

  it('names the remedy when the page cannot host the builder', async () => {
    const d = deps({
      open: () => Promise.resolve({ kind: 'reply', reply: 'unsupported-page' } as const)
    });
    render(() => <BuilderEntry deps={d.api} />);
    fireEvent.click(entry());
    await waitFor(() => {
      expect(toastItems()[0]).toMatchObject({
        tone: 'error',
        title: 'This page can’t host the exclusion builder',
        description: 'Open a regular http or https page in this tab.'
      });
    });
  });

  it('reads its words once: name = words + action, description = the title only', async () => {
    const d = deps({
      status: Promise.resolve({ kind: 'reply', reply: { state: 'inactive' } } as const)
    });
    render(() => <BuilderEntry deps={d.api} />);
    await screen.findByText('Off');
    expect(entry().textContent).toBe('ExclusionsOff — open the exclusion builder on the page');
    expect(entry().getAttribute('title')).toBe('No exclusions applied in this tab.');
  });

  it('is offered on every build but Firefox (its panel sender is unverified there)', () => {
    expect(builderEntryOffered('chrome')).toBe(true);
    expect(builderEntryOffered('edge')).toBe(true);
    expect(builderEntryOffered('firefox')).toBe(false);
  });

  it('is held and explained outside a DevTools window (no tab to act on)', () => {
    const d = deps({ tabId: null });
    render(() => <BuilderEntry deps={d.api} />);
    expect(d.askStatus).not.toHaveBeenCalled();
    expect(entry().getAttribute('aria-disabled')).toBe('true');
    expect(entry().getAttribute('title')).toMatch(/Open the panel in DevTools/);
    fireEvent.click(entry());
    expect(d.open).not.toHaveBeenCalled();
  });

  it('stops listening when unmounted', () => {
    const d = deps();
    const { unmount } = render(() => <BuilderEntry deps={d.api} />);
    unmount();
    expect(d.stop).toHaveBeenCalledTimes(1);
  });
});
