import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../components/ui/toast-store';
import type { AskOutcome } from '../../../lib/messaging/bounded-ask';
import type {
  ExclusionOverlayOpenOutcome,
  ExclusionSessionStatus,
  ExclusionSessionTabStatus
} from '../../../lib/messaging/exclusion-session';
import { activeRecord } from '../../../lib/messaging/exclusion-session.fixtures';
import { BuilderEntry, type BuilderEntryDeps } from './builder-entry';

const TAB = 7;

/** Deps over controllable answers; `push` delivers to the registered listener. */
function deps(
  options: {
    tabId?: number | null;
    status?: Promise<AskOutcome<ExclusionSessionStatus>>;
    open?: () => Promise<AskOutcome<ExclusionOverlayOpenOutcome>>;
  } = {}
) {
  let handler: ((push: ExclusionSessionTabStatus, fromTab: boolean) => void) | null = null;
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
    push: (push: ExclusionSessionTabStatus, fromTab = false) => {
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
    const d = deps({ status: Promise.resolve({ kind: 'reply', reply: activeRecord() }) });
    render(() => <BuilderEntry deps={d.api} />);
    expect(d.askStatus).toHaveBeenCalledWith(TAB);
    await screen.findByText('On');
    expect(entry().getAttribute('title')).toMatch(/until Stop or the tab closes/);
    d.push({ tabId: TAB, status: { state: 'unavailable', cause: 'attach-denied', at: 1 } });
    await screen.findByText('Unavailable');
    // Another tab's push, or one from a page context, changes nothing.
    d.push({ tabId: 8, status: { state: 'inactive' } });
    d.push({ tabId: TAB, status: { state: 'inactive' } }, true);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    d.push({ tabId: TAB, status: { state: 'inactive' } });
    await screen.findByText('Off');
  });

  it('shows no badge while checking, and none when the ask got no answer', async () => {
    let answer!: (outcome: AskOutcome<ExclusionSessionStatus>) => void;
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
    expect(entry().getAttribute('aria-busy')).toBe('true');
    expect(entry().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(entry());
    expect(d.open).toHaveBeenCalledTimes(1);
    answer({ kind: 'reply', reply: 'injected' });
    await waitFor(() => {
      expect(toastItems().map((item) => item.title)).toEqual([
        'Exclusion builder opened on the page'
      ]);
    });
    expect(entry().getAttribute('aria-busy')).toBe('false');
    expect(entry().getAttribute('aria-disabled')).toBeNull();
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
