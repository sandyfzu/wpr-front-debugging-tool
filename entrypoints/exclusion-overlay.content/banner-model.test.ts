import { describe, expect, it } from 'vitest';
import type { ExclusionServedDocument } from '../../lib/messaging/exclusion-session';
import { noticeBanner, servedNotes, stateBanner } from './banner-model';
import type { OverlayState } from './session/machine';
import type { SessionView } from './session/session-view';

const READY: OverlayState = {
  phase: 'ready',
  status: { state: 'inactive' },
  pending: null,
  notice: null
};

const SERVED: ExclusionServedDocument = {
  urlPath: 'https://example.com/',
  urlDigest: 'a'.repeat(64),
  token: 't',
  order: 1,
  receivedAt: 1,
  speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: false },
  copy: false,
  serviceWorkersBypassed: false
};

describe('stateBanner — the state matrix', () => {
  it('shows nothing while loading (the skeleton does)', () => {
    expect(stateBanner({ phase: 'loading' }, null)).toBeNull();
  });

  it('offers Retry on a failed load, Reload for a dead context', () => {
    expect(stateBanner({ phase: 'load-failed', problem: 'timeout' }, null)?.actions).toEqual([
      'retry-load'
    ]);
    expect(
      stateBanner({ phase: 'load-failed', problem: 'context-invalidated' }, null)?.actions
    ).toEqual(['reload']);
  });

  it('waits on a reload, then offers a manual one once overdue', () => {
    expect(stateBanner({ phase: 'reloading', stalled: false }, null)).toMatchObject({
      glyph: 'spinner',
      actions: []
    });
    expect(stateBanner({ phase: 'reloading', stalled: true }, null)?.actions).toEqual(['reload']);
  });

  it('maps every session view to a tone, a glyph and a way forward', () => {
    const cases: readonly [SessionView, string, readonly string[]][] = [
      [{ kind: 'off' }, 'neutral', []],
      [{ kind: 'unavailable', cause: 'attach-denied', retryable: true }, 'error', ['retry-apply']],
      [{ kind: 'unavailable', cause: 'debugging-policy', retryable: false }, 'error', []],
      [{ kind: 'armed' }, 'info', ['reload']],
      [{ kind: 'applied', reports: [], unmatched: 0, served: undefined }, 'ok', []],
      [{ kind: 'applied', reports: [], unmatched: 2, served: undefined }, 'warn', []],
      [
        {
          kind: 'unmodified',
          reason: { kind: 'failed', reason: 'engine-failed' },
          served: undefined
        },
        'warn',
        ['reload']
      ],
      [{ kind: 'not-intercepted' }, 'warn', ['reload']],
      [{ kind: 'cant-tell' }, 'warn', ['reload']]
    ];
    for (const [view, tone, actions] of cases) {
      const banner = stateBanner(READY, view);
      expect(banner?.tone, view.kind).toBe(tone);
      expect(banner?.actions, view.kind).toEqual(actions);
      expect(banner?.glyph.length, view.kind).toBeGreaterThan(0);
    }
  });
});

describe('servedNotes', () => {
  it('says what the session changed besides the exclusions', () => {
    expect(servedNotes(undefined)).toEqual([]);
    expect(servedNotes(SERVED)).toEqual([]);
    expect(
      servedNotes({
        ...SERVED,
        copy: true,
        serviceWorkersBypassed: true,
        speculationRules: { removedFromDocument: 1, headerRemoved: false, guarded: false }
      })
    ).toHaveLength(3);
    expect(
      servedNotes({ ...SERVED, speculationRules: { ...SERVED.speculationRules, guarded: true } })
    ).toEqual(['Link prefetching is off while the session runs.']);
  });
});

describe('noticeBanner', () => {
  it('words each notice, singular and plural', () => {
    expect(noticeBanner({ kind: 'invalid', rows: 1 }).title).toBe('Fix 1 row before applying');
    expect(noticeBanner({ kind: 'invalid', rows: 4 }).title).toBe('Fix 4 rows before applying');
    expect(noticeBanner({ kind: 'too-large' }).body).toMatch(/65,536 characters/);
    expect(noticeBanner({ kind: 'stopped' }).actions).toEqual(['reload', 'dismiss']);
    expect(
      noticeBanner({ kind: 'action-failed', action: 'stop', problem: 'timeout' })
    ).toMatchObject({
      title: 'Couldn’t stop',
      actions: ['dismiss']
    });
    expect(
      noticeBanner({ kind: 'action-failed', action: 'apply', problem: 'context-invalidated' })
        .actions
    ).toEqual(['reload']);
  });
});
