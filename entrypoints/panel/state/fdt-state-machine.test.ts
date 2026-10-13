/**
 * The data-state machine's transition table, exercised state by state: the
 * boot fetch's settle both ways, the soft refresh (carrying data, replacing
 * it on settle), the contract-failure flag, the auto-recovery from error,
 * and the dedup no-ops that keep the flights honest. The matrix covers every
 * (state, event) pair of the table, including the cross-story cells (a fetch
 * over an in-flight refresh, a notification from idle, settles outside any
 * flight).
 */
import { describe, expect, it } from 'vitest';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { transitionDataState, type DataState, type FetchOutcome } from './fdt-state-machine';
import { makeFdtData } from './fixtures';

const NOW = 1727000000000;

/** One ready-state value (narrow type: the test reads `data` on it). */
const ready = (fetchedAt = 1) => ({
  status: 'ready' as const,
  data: makeFdtData(),
  fetchedAt
});

/** One fresh successful payload (per call — no shared object identity). */
const freshData = (): FdtData => makeFdtData({ allScriptsLoaded: true });

describe('fetch triggers', () => {
  it('starts fetching from idle', () => {
    const next = transitionDataState({ status: 'idle' }, { type: 'fetch' }, NOW);
    expect(next).toEqual({ status: 'fetching' });
  });

  it('is a no-op while fetching (a flight is running)', () => {
    const before: DataState = { status: 'fetching' };
    expect(transitionDataState(before, { type: 'fetch' }, NOW)).toBe(before);
  });

  it('changes nothing while ready (a plain fetch trigger is not exposed there)', () => {
    const before = ready(3);
    expect(transitionDataState(before, { type: 'fetch' }, NOW)).toBe(before);
  });

  it('re-runs the fetch from the error state (the retry control)', () => {
    const error: DataState = { status: 'error', cause: 'x', hardReload: false };
    expect(transitionDataState(error, { type: 'fetch' }, NOW)).toEqual({ status: 'fetching' });
  });
});

describe('refresh triggers (the soft refresh)', () => {
  it('carries the ready data into refreshing without touching anything else', () => {
    const before = ready(3);
    const next = transitionDataState(before, { type: 'refresh' }, NOW);
    expect(next).toEqual({ status: 'refreshing', data: before.data, requestedAt: NOW });
  });

  it('is a no-op while fetching (the running flight settles into fresh data)', () => {
    const before: DataState = { status: 'fetching' };
    expect(transitionDataState(before, { type: 'refresh' }, NOW)).toBe(before);
  });

  it('is a no-op while refreshing (a second notification does not restart the flight)', () => {
    const before: DataState = { status: 'refreshing', data: makeFdtData(), requestedAt: 5 };
    expect(transitionDataState(before, { type: 'refresh' }, NOW)).toBe(before);
  });

  it('turns into a fetch from the error state — auto-recovery on the notification', () => {
    const error: DataState = { status: 'error', cause: 'x', hardReload: false };
    expect(transitionDataState(error, { type: 'refresh' }, NOW)).toEqual({ status: 'fetching' });
  });
});

describe('cross-story cells (the full state × event matrix)', () => {
  it('fetch during refreshing retargets the flight (the carried data is dropped)', () => {
    // The refresh flight's own pending request still settles honestly; a
    // plain fetch trigger over it starts a fresh, own-flight lifecycle.
    const before: DataState = { status: 'refreshing', data: makeFdtData(), requestedAt: 5 };
    expect(transitionDataState(before, { type: 'fetch' }, NOW)).toEqual({ status: 'fetching' });
  });

  it('refresh during idle asks fresh (the notification means the source is alive)', () => {
    expect(transitionDataState({ status: 'idle' }, { type: 'refresh' }, NOW)).toEqual({
      status: 'fetching'
    });
  });

  it('settled outside a flight never lands — from idle as much as from ready', () => {
    const idle: DataState = { status: 'idle' };
    expect(
      transitionDataState(idle, { type: 'settled', outcome: { ok: true, data: freshData() } }, NOW)
    ).toBe(idle);
  });

  it('settled outside a flight is a no-op from error (the fallback cannot double-fire)', () => {
    const error: DataState = { status: 'error', cause: 'integrity', hardReload: true };
    expect(
      transitionDataState(error, { type: 'settled', outcome: { ok: true, data: freshData() } }, NOW)
    ).toBe(error);
  });
});

describe('settled outcomes', () => {
  it('lands a successful fetch as ready with the settled timestamp', () => {
    const payload = freshData();
    const next = transitionDataState(
      { status: 'fetching' },
      { type: 'settled', outcome: { ok: true, data: payload } },
      NOW
    );
    expect(next).toEqual({ status: 'ready', data: payload, fetchedAt: NOW });
  });

  it('lands a successful refresh as ready — the carried data swaps wholesale', () => {
    const payload = freshData();
    const next = transitionDataState(
      { status: 'refreshing', data: makeFdtData(), requestedAt: 5 },
      { type: 'settled', outcome: { ok: true, data: payload } },
      NOW
    );
    expect(next).toEqual({ status: 'ready', data: payload, fetchedAt: NOW });
  });

  it('adapts a failed flight into the error state (with its cause)', () => {
    const outcome: FetchOutcome = { ok: false, cause: 'no answer', hardReload: false };
    const next = transitionDataState({ status: 'fetching' }, { type: 'settled', outcome }, NOW);
    expect(next).toEqual({ status: 'error', cause: 'no answer', hardReload: false });
  });

  it('marks the contract-failure fallback without ever entering corrupt ready', () => {
    const outcome: FetchOutcome = { ok: false, cause: 'integrity', hardReload: true };
    const next = transitionDataState(
      { status: 'refreshing', data: makeFdtData(), requestedAt: 5 },
      { type: 'settled', outcome },
      NOW
    );
    expect(next).toEqual({ status: 'error', cause: 'integrity', hardReload: true });
  });

  it('ignores settles that arrive outside a flight (bookkeeping misorder)', () => {
    const success = ready();
    expect(
      transitionDataState(
        success,
        { type: 'settled', outcome: { ok: true, data: freshData() } },
        NOW
      )
    ).toBe(success);
  });
});
