/**
 * The Known Conflicts freshness row, over injectable seams: the meta-stamp
 * reading (never-updated included), the typed refresh request's outcomes
 * (success, refused `null`, transport failure), the single-flight guard, the
 * live stamp re-read from storage watches, the re-age on a visible flip, the
 * watch cleanup, the card's keyboard/axe floor (never-synced and busy states
 * included), and the default storage IO's real round trip over the fake
 * runtime (store → render → request → store).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  KnownConflictsFreshness,
  KC_CARD_DESCRIPTION,
  KC_CARD_TITLE,
  KC_NEVER_SYNCED_TEXT,
  KC_REFRESH_FAILURE_TITLE,
  KC_REFRESH_SUCCESS_TITLE,
  type KcFreshnessIO
} from './kc-freshness';
import { toast, toastItems } from '../../components/ui/toast-store';
import { describeAxeViolations, runAxeAudit } from '../../components/ui/a11y-audit';
import { knownConflictsStore } from '../../lib/storage/known-conflicts';
import { onMessage } from '../../lib/messaging';

beforeEach(() => {
  fakeBrowser.reset();
  toast.clear();
});

afterEach(() => {
  cleanup();
});

/** The test clock: the fixed "now" the ages read against. */
const NOW_MS = 1_700_000_000_000 + 3 * 60_000;

/**
 * A manual stamp world: the meta value, its watchers, the refresh outcome and
 * the clock are the test's to move; the refresh default succeeds.
 */
interface StampWorld {
  io: KcFreshnessIO;
  /** Writes the stamp the next readMeta returns (absent = never synced). */
  setMeta(next: { updatedAt?: number }): void;
  /** Fires the armed watch (what a background/refresh write would do). */
  fireWatch(): void;
  /** How many watchers the row currently holds armed. */
  armed(): number;
  refreshNow: ReturnType<typeof vi.fn<() => Promise<{ updatedAt: number } | null>>>;
  now: { value: number };
}

/** A fresh world: no stamp, clock at NOW, refresh answers the clock value. */
function stampWorld(): StampWorld {
  let meta: { updatedAt?: number } = {};
  const watchers = new Set<() => void>();
  const now = { value: NOW_MS };
  const refreshNow = vi.fn<() => Promise<{ updatedAt: number } | null>>(() =>
    Promise.resolve({ updatedAt: now.value })
  );
  const io: KcFreshnessIO = {
    readMeta: () => Promise.resolve(meta),
    watchStamp(onChange) {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
      };
    },
    refreshNow,
    now: () => now.value
  };
  return {
    io,
    setMeta(next) {
      meta = next;
    },
    fireWatch() {
      for (const watcher of [...watchers]) watcher();
    },
    armed: () => watchers.size,
    refreshNow,
    now
  };
}

/** The stamp line's whole text (or the never-synced sentence). */
function stampText(): string {
  return screen.getByText(/Updated|Not synced/).textContent;
}

describe('KnownConflictsFreshness', () => {
  it('renders the card copy and the relative last-updated age', async () => {
    const world = stampWorld();
    world.setMeta({ updatedAt: NOW_MS - 3 * 60_000 });
    render(() => <KnownConflictsFreshness io={world.io} />);
    expect(screen.getByText(KC_CARD_TITLE)).toBeTruthy();
    expect(screen.getByText(KC_CARD_DESCRIPTION)).toBeTruthy();
    await waitFor(() => {
      expect(stampText()).toContain('Updated');
    });
    expect(stampText()).toContain('3 min ago');
    expect(world.refreshNow).not.toHaveBeenCalled();
  });

  it('shows the never-synced reading when the meta carries no stamp', async () => {
    const world = stampWorld();
    render(() => <KnownConflictsFreshness io={world.io} />);
    await waitFor(() => {
      expect(stampText()).toBe(KC_NEVER_SYNCED_TEXT);
    });
    expect(screen.getAllByRole('button', { name: 'Refresh now' })).toHaveLength(1);
    // The never-synced render state meets the same a11y floor as the stamped one.
    const audit = await runAxeAudit();
    expect(describeAxeViolations(audit.violations)).toBe('');
  });

  it('degrades a stamped meta that no longer is a number to the never-synced reading', async () => {
    const world = stampWorld();
    world.setMeta({ updatedAt: 'yesterday' as unknown as number });
    render(() => <KnownConflictsFreshness io={world.io} />);
    await waitFor(() => {
      expect(stampText()).toBe(KC_NEVER_SYNCED_TEXT);
    });
  });

  it('re-reads the stamp when the storage watch fires (a logged DB write lands)', async () => {
    const world = stampWorld();
    render(() => <KnownConflictsFreshness io={world.io} />);
    await waitFor(() => {
      expect(stampText()).toBe(KC_NEVER_SYNCED_TEXT);
    });
    world.setMeta({ updatedAt: NOW_MS - 30_000 });
    world.fireWatch();
    await waitFor(() => {
      expect(stampText()).toContain('30 s ago');
    });
    expect(world.refreshNow).not.toHaveBeenCalled(); // reads, never re-asks
  });

  it('re-ages the stamp when the document becomes visible again', async () => {
    vi.useFakeTimers();
    try {
      const world = stampWorld();
      world.setMeta({ updatedAt: NOW_MS - 59_000 });
      render(() => <KnownConflictsFreshness io={world.io} />);
      await vi.waitFor(() => {
        expect(stampText()).toContain('59 s ago');
      });
      // Time passes while the page sits open in its tab; only on re-showing
      // does the page-local row recompute (no timer, no idle work).
      world.now.value += 60_000;
      await vi.waitFor(() => {
        expect(stampText()).toContain('59 s ago');
      });
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => {
        expect(stampText()).toContain('1 min ago');
      });
    } finally {
      vi.useRealTimers();
      // happy-dom owns its own property descriptor; restore it.
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  describe('refresh now', () => {
    it('runs the typed request, advances the stamp and confirms with a toast', async () => {
      const world = stampWorld();
      world.setMeta({ updatedAt: NOW_MS - 5 * 3_600_000 });
      render(() => <KnownConflictsFreshness io={world.io} />);
      await waitFor(() => {
        expect(stampText()).toContain('5 h ago');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      await waitFor(() => {
        expect(toastItems().at(-1)).toMatchObject({
          tone: 'success',
          title: KC_REFRESH_SUCCESS_TITLE
        });
      });
      // The typed outcome's stamp advanced the reading to "just now".
      await waitFor(() => {
        expect(stampText()).toContain('just now');
      });
    });

    it('does not dead-end on a refused outcome (null): an actionable error toast', async () => {
      const world = stampWorld();
      world.refreshNow.mockResolvedValue(null);
      world.setMeta({ updatedAt: NOW_MS - 60_000 });
      render(() => <KnownConflictsFreshness io={world.io} />);
      await waitFor(() => {
        expect(stampText()).toContain('1 min ago');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      await waitFor(() => {
        expect(toastItems().at(-1)).toMatchObject({
          tone: 'error',
          title: KC_REFRESH_FAILURE_TITLE
        });
      });
      expect(toastItems().at(-1)?.description).toMatch(/try again/iu);
      // The stamp was not faked — the failed attempt leaves the reading untouched.
      expect(stampText()).toContain('1 min ago');
    });

    it('does not dead-end on a transport failure either (the control stays usable)', async () => {
      const world = stampWorld();
      world.refreshNow.mockRejectedValue(new Error('Extension context invalidated.'));
      world.setMeta({ updatedAt: NOW_MS - 60_000 });
      render(() => <KnownConflictsFreshness io={world.io} />);
      await waitFor(() => {
        expect(stampText()).toContain('1 min ago');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      await waitFor(() => {
        expect(toastItems().at(-1)).toMatchObject({
          tone: 'error',
          title: KC_REFRESH_FAILURE_TITLE
        });
      });
      expect(toastItems().at(-1)?.description).toMatch(/reload the page/iu);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      expect(world.refreshNow).toHaveBeenCalledTimes(2);
    });

    it('refuses a second click while one refresh is still in flight', async () => {
      let release!: (outcome: { updatedAt: number } | null) => void;
      const world = stampWorld();
      world.refreshNow.mockImplementation(
        () =>
          new Promise<{ updatedAt: number } | null>((done) => {
            release = done;
          })
      );
      render(() => <KnownConflictsFreshness io={world.io} />);
      await waitFor(() => Promise.resolve());
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      const button = screen.getByRole('button', { name: /Refresh now/ });
      expect(button.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(button);
      expect(world.refreshNow).toHaveBeenCalledTimes(1);
      // The busy control still meets the a11y floor (its state is legible).
      const busyAudit = await runAxeAudit();
      expect(describeAxeViolations(busyAudit.violations)).toBe('');
      release({ updatedAt: world.now.value });
      await waitFor(() => {
        expect(button.getAttribute('aria-busy')).not.toBe('true');
      });
    });
  });

  it('round-trips the default storage IO: renders the real store, refresh advances the real stamp', async () => {
    // The default IO (no injected seams): the stamp reads the REAL storage
    // item and the Refresh now request runs over the REAL messaging runtime —
    // the fake browser's store and runtime carry the whole round trip.
    const removeListener = onMessage('updateKnownConflictsDb', () => ({ updatedAt: Date.now() }));
    try {
      await knownConflictsStore.setMeta({ updatedAt: Date.now() - 3 * 60_000 });
      render(() => <KnownConflictsFreshness />);
      await waitFor(() => {
        expect(stampText()).toContain('3 min ago');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      await waitFor(() => {
        expect(toastItems().at(-1)).toMatchObject({
          tone: 'success',
          title: KC_REFRESH_SUCCESS_TITLE
        });
      });
      // The typed outcome's stamp re-reads from storage: the age advances.
      await waitFor(() => {
        expect(stampText()).toContain('just now');
      });
    } finally {
      removeListener();
    }
  });

  it('stops the storage watch on unmount (no subscription left behind)', async () => {
    const world = stampWorld();
    const view = render(() => <KnownConflictsFreshness io={world.io} />);
    await waitFor(() => {
      expect(world.armed()).toBe(1);
    });
    view.unmount();
    expect(world.armed()).toBe(0);
  });

  it('carries zero a11y violations (axe, component tier)', async () => {
    const world = stampWorld();
    world.setMeta({ updatedAt: NOW_MS - 60_000 });
    render(() => <KnownConflictsFreshness io={world.io} />);
    await waitFor(() => {
      expect(stampText()).toContain('1 min ago');
    });
    const result = await runAxeAudit();
    expect(describeAxeViolations(result.violations)).toBe('');
  });
});
