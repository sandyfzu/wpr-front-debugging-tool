/**
 * The nav row note: live state first, count second, both selectors
 * contained to their row, the two note lengths, and the labeled row title.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Rocket from 'lucide-solid/icons/rocket';
import { SCRIPT_NOUN } from '../../../lib/detection/count-nouns';
import type { NavRoute } from '../routes';
import { makeFdtData } from '../state/fixtures';
import { resolveCount, resolveLiveState, resolveRowNote, rowTitle } from './row-note';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A registry-shaped row with the given selectors. */
function row(extra: Partial<NavRoute>): NavRoute {
  return { id: 'javascript', label: 'JavaScript', icon: Rocket, group: 'Inspect', ...extra };
}

const DATA = makeFdtData();

describe('resolveLiveState', () => {
  it('is null without a selector and passes null data to the selector', () => {
    expect(resolveLiveState(row({}), DATA)).toBeNull();
    const liveState = vi.fn(() => ({ text: 'Monitoring', tone: 'neutral' as const }));
    expect(resolveLiveState(row({ liveState }), null)).toEqual({
      text: 'Monitoring',
      tone: 'neutral'
    });
    expect(liveState).toHaveBeenCalledWith(null);
  });

  it('contains a throwing selector and names the row in the log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const liveState = (): never => {
      throw new Error('boom');
    };
    expect(resolveLiveState(row({ liveState }), DATA)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('live-state selector failed'),
      expect.objectContaining({ row: 'javascript', cause: { message: 'boom' } })
    );
  });
});

describe('resolveCount', () => {
  it('needs both a selector and loaded data', () => {
    const count = vi.fn(() => ({ count: 3, partial: false, noun: SCRIPT_NOUN }));
    expect(resolveCount(row({}), DATA)).toBeNull();
    expect(resolveCount(row({ count }), null)).toBeNull();
    expect(count).not.toHaveBeenCalled();
    expect(resolveCount(row({ count }), DATA)).toEqual({
      count: 3,
      partial: false,
      noun: SCRIPT_NOUN
    });
  });

  it('contains a throwing selector', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const count = (): never => {
      throw new Error('bad count');
    };
    expect(resolveCount(row({ count }), DATA)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('count selector failed'),
      expect.objectContaining({ row: 'javascript' })
    );
  });
});

describe('resolveRowNote', () => {
  const count = (): { count: number; partial: boolean; noun: typeof SCRIPT_NOUN } => ({
    count: 5000,
    partial: true,
    noun: SCRIPT_NOUN
  });

  it('prefers the live state, keeping its short figure', () => {
    const liveState = (): { text: string; tone: 'info'; short: string } => ({
      text: 'delayed 3/9',
      tone: 'info',
      short: '3/9'
    });
    expect(resolveRowNote(row({ liveState, count }), DATA)).toEqual({
      text: 'delayed 3/9',
      short: '3/9',
      tone: 'info'
    });
  });

  it('gives a live state without a figure a null short form (the dot)', () => {
    const liveState = (): { text: string; tone: 'neutral' } => ({
      text: 'Monitoring',
      tone: 'neutral'
    });
    expect(resolveRowNote(row({ liveState }), DATA)?.short).toBeNull();
  });

  it('falls back to the count: phrase with the noun, figure alone, neutral', () => {
    expect(resolveRowNote(row({ liveState: () => null, count }), DATA)).toEqual({
      text: '5,000+ scripts',
      short: '5,000+',
      tone: 'neutral'
    });
    expect(
      resolveRowNote(row({ count: () => ({ count: 1, partial: false, noun: SCRIPT_NOUN }) }), DATA)
    ).toEqual({ text: '1 script', short: '1', tone: 'neutral' });
  });

  it('is null when the row has nothing to say', () => {
    expect(resolveRowNote(row({}), DATA)).toBeNull();
    expect(resolveRowNote(row({ count }), null)).toBeNull();
  });
});

describe('rowTitle', () => {
  it('is the label, followed by the full note when there is one', () => {
    expect(rowTitle(row({}), null)).toBe('JavaScript');
    expect(rowTitle(row({}), { text: 'delayed 3/9', short: '3/9', tone: 'info' })).toBe(
      'JavaScript · delayed 3/9'
    );
  });
});
