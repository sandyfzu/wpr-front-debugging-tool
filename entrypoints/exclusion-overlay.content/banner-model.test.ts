import { describe, expect, it } from 'vitest';
import type { ExclusionServedDocument } from '../../lib/messaging/exclusion-session';
import { noticeBanner, servedNotes, stateBanner, withoutRepeatedActions } from './banner-model';
import { SESSION_ON_NOTE, SESSION_PERSISTS_NOTE } from './copy';
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

  it('offers Retry on a failed load; a dead context names the way back instead', () => {
    expect(stateBanner({ phase: 'load-failed', problem: 'timeout' }, null)?.actions).toEqual([
      'retry-load'
    ]);
    expect(
      stateBanner({ phase: 'load-failed', problem: 'context-invalidated' }, null)?.actions
    ).toEqual([]);
  });

  it('waits on a reload with a spinner (an overdue one becomes a notice)', () => {
    expect(stateBanner({ phase: 'reloading' }, null)).toMatchObject({
      glyph: 'spinner',
      actions: []
    });
    expect(noticeBanner({ kind: 'reload-stalled' }).actions).toEqual(['reload', 'dismiss']);
  });

  it('maps every session view to a tone, a glyph and a way forward', () => {
    const cases: readonly [SessionView, string, readonly string[]][] = [
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
    // Changed in audit round 1: nothing applied shows no banner (the header
    // indicator says it; the empty editor carries the guidance).
    expect(stateBanner(READY, { kind: 'off' })).toBeNull();
    for (const [view, tone, actions] of cases) {
      const banner = stateBanner(READY, view);
      expect(banner?.tone, view.kind).toBe(tone);
      expect(banner?.actions, view.kind).toEqual(actions);
      expect(banner?.glyph.length, view.kind).toBeGreaterThan(0);
    }
  });
});

describe('the session’s persistence (it outlives the page)', () => {
  it('promises the next pages only where this page shows the session working', () => {
    for (const view of [
      { kind: 'armed' },
      { kind: 'applied', reports: [], unmatched: 0, served: undefined }
    ] as const) {
      expect(stateBanner(READY, view)?.notes[0], view.kind).toBe(SESSION_PERSISTS_NOTE);
    }
    expect(
      stateBanner(READY, {
        kind: 'applied',
        reports: [],
        unmatched: 0,
        served: { ...SERVED, copy: true }
      })?.notes
    ).toEqual([SESSION_PERSISTS_NOTE, ...servedNotes({ ...SERVED, copy: true })]);
  });

  it('says only that the session stays on where this page was not (or may not be) rewritten', () => {
    const unproven: readonly SessionView[] = [
      {
        kind: 'unmodified',
        reason: { kind: 'failed', reason: 'engine-failed' },
        served: undefined
      },
      { kind: 'not-intercepted' },
      { kind: 'cant-tell' }
    ];
    for (const view of unproven) {
      const notes = stateBanner(READY, view)?.notes ?? [];
      expect(notes[0], view.kind).toBe(SESSION_ON_NOTE);
      expect(notes.join(' '), view.kind).not.toMatch(/loads with these exclusions/);
    }
  });

  it('is never said when nothing runs (interception unavailable)', () => {
    expect(
      stateBanner(READY, { kind: 'unavailable', cause: 'attach-denied', retryable: true })?.notes
    ).toEqual([]);
  });

  it('names Stop and tab close as the only ends', () => {
    expect(SESSION_ON_NOTE).toMatch(/until you stop it or close the tab\.$/);
    expect(SESSION_PERSISTS_NOTE).toMatch(/until you stop it or close the tab: each page/);
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
      actions: ['retry-action', 'dismiss']
    });
    expect(
      noticeBanner({ kind: 'action-failed', action: 'apply', problem: 'context-invalidated' })
        .actions
    ).toEqual(['dismiss']);
  });
});

describe('withoutRepeatedActions', () => {
  it('drops a forward action the notice already offers (one Reload, not two)', () => {
    const armed = stateBanner(READY, { kind: 'armed' });
    if (armed === null) throw new Error('armed banner');
    const stalled = noticeBanner({ kind: 'reload-stalled' });
    expect(withoutRepeatedActions(armed, stalled).actions).toEqual([]);
    expect(withoutRepeatedActions(armed, null)).toBe(armed);
  });
});
