/**
 * The live script read's words: every state's reason (each failure value,
 * structured data), the notes (scripts outside every state filter, a cut
 * list), the code notes (budget cut, per-script cap — exact at the cap's
 * boundary, astral characters counted as one), and every miss with its
 * recoveries.
 */
import { describe, expect, it } from 'vitest';
import { capText } from '../../utils/cap-text';
import { SCRIPT_RUNTIME_LIMITS } from '../messaging/script-runtime';
import { FULL_TEXT_MAX, type ScriptRuntimeState } from './classify';
import {
  codeNote,
  describeRuntimeMiss,
  fullTextCapped,
  LIVE_STATE_LABEL,
  outsideFiltersNote,
  RUNTIME_GROUP_EMPTY_TITLES,
  RUNTIME_GROUP_LABELS,
  RUNTIME_STATE_LABELS,
  RUNTIME_STATE_TONES,
  stateReason,
  TEXT_CAPPED_NOTE,
  TEXT_CUT_NOTE,
  truncatedNote
} from './outcome-view';
import { SCRIPT_RUNTIME_ASK_DEADLINE_MS } from './read-live';

const STATES: readonly ScriptRuntimeState[] = [
  'executed',
  'failed',
  'skipped',
  'pending',
  'not-delayed',
  'unknown'
];

describe('labels', () => {
  it('names the section as the live DOM, not the detection snapshot', () => {
    expect(LIVE_STATE_LABEL).toBe('Live DOM state (not the snapshot passed to detection)');
  });

  it('names and tones every state (failure is the only error; status never color alone)', () => {
    for (const state of STATES) expect(RUNTIME_STATE_LABELS[state]).not.toBe('');
    expect(RUNTIME_STATE_TONES).toEqual({
      executed: 'ok',
      failed: 'error',
      skipped: 'neutral',
      pending: 'info',
      'not-delayed': 'neutral',
      unknown: 'warn'
    });
  });

  it('names every group and its empty view', () => {
    expect(RUNTIME_GROUP_LABELS).toEqual({
      theme: 'Theme',
      plugin: 'Plugins',
      inline: 'Inline',
      other: 'Other'
    });
    expect(RUNTIME_GROUP_EMPTY_TITLES.plugin).toBe('No plugin scripts in this read');
  });
});

describe('stateReason', () => {
  /** A reason for a state. */
  const reason = (
    state: ScriptRuntimeState,
    rawStatus: string | null = null,
    structuredData = false
  ): string => stateReason({ state, rawStatus, structuredData });

  it('explains each failure value WP Rocket stamps, and quotes any other', () => {
    expect(reason('failed', 'failed-network')).toMatch(/file failed to load/);
    expect(reason('failed', 'failed-transform')).toMatch(/couldn't prepare it to run/);
    expect(reason('failed', 'failed-later')).toBe('Delay JS marked it as failed (“failed-later”).');
  });

  it('never reads an inherited property as a failure reason', () => {
    expect(reason('failed', 'constructor')).toBe('Delay JS marked it as failed (“constructor”).');
  });

  it('explains every other state', () => {
    expect(reason('executed', 'executed')).toBe('Delay JS ran it.');
    expect(reason('skipped', 'skipped')).toMatch(/nomodule fallback/);
    expect(reason('pending')).toMatch(/first user interaction/);
    expect(reason('not-delayed')).toMatch(/loads it as served/);
    expect(reason('not-delayed', null, true)).toMatch(/Structured data \(JSON-LD\)/);
    expect(reason('unknown', 'later')).toMatch(/“later”, a status this version/);
  });
});

describe('outsideFiltersNote', () => {
  it('is null when every script has a chip', () => {
    expect(outsideFiltersNote({ skipped: 0, unknown: 0 })).toBeNull();
  });

  it('counts skipped and unknown scripts, singular and plural', () => {
    expect(outsideFiltersNote({ skipped: 1, unknown: 0 })).toBe(
      '1 skipped script (a nomodule fallback this browser doesn’t need): listed under “All states” only.'
    );
    expect(outsideFiltersNote({ skipped: 0, unknown: 2 })).toBe(
      '2 scripts with a status this version doesn’t know: listed under “All states” only.'
    );
    expect(outsideFiltersNote({ skipped: 1200, unknown: 1 })).toBe(
      '1,200 skipped scripts (nomodule fallbacks this browser doesn’t need) and 1 script with a status this version doesn’t know: listed under “All states” only.'
    );
  });
});

describe('truncatedNote', () => {
  it('names the page total and the listed count only when cut', () => {
    expect(truncatedNote({ truncated: false, total: 3, listed: 3 })).toBeNull();
    expect(truncatedNote({ truncated: true, total: 1500, listed: 1000 })).toBe(
      'The page has 1,500 scripts; the first 1,000 are listed.'
    );
  });
});

describe('code notes', () => {
  it('names the read budget for a budget-cut script', () => {
    expect(codeNote({ fullTextCut: true, fullText: 'a' })).toBe(TEXT_CUT_NOTE);
    expect(TEXT_CUT_NOTE).toContain(SCRIPT_RUNTIME_LIMITS.textBudgetUnits.toLocaleString('en-US'));
  });

  it('flags exactly the texts the per-script cap cut', () => {
    const atCap = 'a'.repeat(FULL_TEXT_MAX);
    expect(fullTextCapped(capText(atCap, FULL_TEXT_MAX))).toBe(false);
    expect(fullTextCapped(capText(`${atCap}b`, FULL_TEXT_MAX))).toBe(true);
    expect(fullTextCapped('short…')).toBe(false);
    // Longer than the cap's length (cannot come from the cap) is not "cut".
    expect(fullTextCapped(`${atCap}bb…`)).toBe(false);
    expect(codeNote({ fullTextCut: false, fullText: capText(`${atCap}b`, FULL_TEXT_MAX) })).toBe(
      TEXT_CAPPED_NOTE
    );
    expect(codeNote({ fullTextCut: false, fullText: 'whole' })).toBeNull();
  });

  it('counts an astral character as one code point', () => {
    const astral = '😀'.repeat(FULL_TEXT_MAX + 5);
    expect(fullTextCapped(capText(astral, FULL_TEXT_MAX))).toBe(true);
    expect(fullTextCapped(capText('😀'.repeat(FULL_TEXT_MAX), FULL_TEXT_MAX))).toBe(false);
  });
});

describe('describeRuntimeMiss', () => {
  it('words each miss with its recoveries, reload first unless a retry may do', () => {
    expect(describeRuntimeMiss('no-receiver')).toMatchObject({
      title: "The page isn't listening",
      recoveries: ['reload-page', 'retry']
    });
    expect(describeRuntimeMiss('timeout')).toMatchObject({
      title: "The page didn't answer in time",
      recoveries: ['retry', 'reload-page']
    });
    expect(describeRuntimeMiss('timeout').message).toContain(
      `${String(SCRIPT_RUNTIME_ASK_DEADLINE_MS / 1000)} s`
    );
    expect(describeRuntimeMiss('invalid-reply')).toMatchObject({
      title: "The page's answer was unreadable",
      recoveries: ['reload-page', 'retry']
    });
    expect(describeRuntimeMiss('failed')).toMatchObject({
      title: "Couldn't reach the page",
      recoveries: ['reload-page', 'retry']
    });
  });
});
