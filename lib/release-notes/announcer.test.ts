/**
 * The announcer's effects order and failure arms: reads → decision → marker
 * written first → page opened; a failed write opens nothing; a failed open
 * keeps the marker (once); checks run one at a time, so the start check and
 * `onInstalled` arriving together open exactly one page.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import { createWhatsNewAnnouncer, type WhatsNewAnnouncerDeps } from './announcer';
import type { WhatsNewOpening } from './decision';
import type { ReleaseEntry } from './releases';

const NOTES: readonly ReleaseEntry[] = [{ version: '3.0.0', announce: true }];

/** A logger recording warnings. */
function recordingLog(): { log: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const noop = (): void => undefined;
  return {
    log: {
      debug: noop,
      info: noop,
      error: noop,
      warn: (message: string) => {
        warnings.push(message);
      }
    },
    warnings
  };
}

/** Deps over an in-memory marker; every effect is a spy. */
function harness(overrides: Partial<WhatsNewAnnouncerDeps> = {}): {
  deps: WhatsNewAnnouncerDeps;
  calls: string[];
  warnings: string[];
  marker: () => unknown;
} {
  let stored: unknown = undefined;
  const calls: string[] = [];
  const { log, warnings } = recordingLog();
  const deps: WhatsNewAnnouncerDeps = {
    currentVersion: '3.0.0',
    releases: NOTES,
    readMarker: vi.fn(() => Promise.resolve(stored)),
    writeMarker: vi.fn((version: string) => {
      calls.push(`write ${version}`);
      stored = version;
      return Promise.resolve();
    }),
    readEnabled: vi.fn(() => Promise.resolve(true)),
    openPage: vi.fn((opening: WhatsNewOpening) => {
      calls.push(`open ${opening.version} since ${opening.since}`);
      return Promise.resolve();
    }),
    log,
    ...overrides
  };
  return { deps, calls, warnings, marker: () => stored };
}

const UPDATE = { kind: 'installed', reason: 'update', previousVersion: '2.2.5' } as const;

describe('createWhatsNewAnnouncer', () => {
  it('stores the marker before opening the page', async () => {
    const { deps, calls } = harness();
    await expect(createWhatsNewAnnouncer(deps).check(UPDATE)).resolves.toBe('opened');
    expect(calls).toEqual(['write 3.0.0', 'open 3.0.0 since 2.2.5']);
  });

  it('opens once across the start check, the event and a second event', async () => {
    const { deps, calls } = harness();
    const announcer = createWhatsNewAnnouncer(deps);
    const outcomes = await Promise.all([
      announcer.check({ kind: 'startup' }),
      announcer.check(UPDATE),
      announcer.check(UPDATE)
    ]);
    expect(outcomes).toEqual(['nothing', 'opened', 'nothing']);
    expect(calls).toEqual(['write 3.0.0', 'open 3.0.0 since 2.2.5']);
  });

  it('seeds silently on install', async () => {
    const { deps, calls } = harness();
    await expect(
      createWhatsNewAnnouncer(deps).check({ kind: 'installed', reason: 'install' })
    ).resolves.toBe('nothing');
    expect(calls).toEqual(['write 3.0.0']);
  });

  it('opens nothing when the marker cannot be stored', async () => {
    const { deps, calls, warnings } = harness({
      writeMarker: vi.fn(() => Promise.reject(new Error('quota')))
    });
    await expect(createWhatsNewAnnouncer(deps).check(UPDATE)).resolves.toBe('marker-write-failed');
    expect(calls).toEqual([]);
    expect(warnings[0]).toContain('marker could not be stored');
  });

  it('keeps the marker when the open fails (no retry loop)', async () => {
    const { deps, marker, warnings } = harness({
      openPage: vi.fn(() => Promise.reject(new Error('no window')))
    });
    const announcer = createWhatsNewAnnouncer(deps);
    await expect(announcer.check(UPDATE)).resolves.toBe('open-failed');
    expect(marker()).toBe('3.0.0');
    expect(warnings[0]).toContain('could not be opened');
    await expect(announcer.check({ kind: 'startup' })).resolves.toBe('nothing');
  });

  it('skips the check when its state cannot be read', async () => {
    for (const failing of ['readMarker', 'readEnabled'] as const) {
      const { deps, calls, warnings } = harness({
        [failing]: vi.fn(() => Promise.reject(new Error('dead context')))
      });
      await expect(createWhatsNewAnnouncer(deps).check(UPDATE)).resolves.toBe('read-failed');
      expect(calls).toEqual([]);
      expect(warnings[0]).toContain('could not be read');
    }
  });

  it('honors the opt-out and logs a decision warning', async () => {
    const opted = harness({ readEnabled: vi.fn(() => Promise.resolve(false)) });
    await expect(createWhatsNewAnnouncer(opted.deps).check(UPDATE)).resolves.toBe('nothing');
    expect(opted.calls).toEqual(['write 3.0.0']);

    const corrupt = harness({ readMarker: vi.fn(() => Promise.resolve('garbage')) });
    await expect(createWhatsNewAnnouncer(corrupt.deps).check(UPDATE)).resolves.toBe('nothing');
    expect(corrupt.warnings[0]).toContain('marker');
  });

  it('a rejecting check never stalls the next one', async () => {
    let first = true;
    const { deps } = harness({
      readMarker: vi.fn(() => {
        if (first) {
          first = false;
          return Promise.reject(new Error('once'));
        }
        return Promise.resolve(undefined);
      })
    });
    const announcer = createWhatsNewAnnouncer(deps);
    await expect(announcer.check(UPDATE)).resolves.toBe('read-failed');
    await expect(announcer.check(UPDATE)).resolves.toBe('opened');
  });
});
