/**
 * The capture's size caps read back per script: list cut at its count cap,
 * clipped inline text, and text the list-wide budget left out.
 */
import { describe, expect, it } from 'vitest';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { DelayedScriptRecord, WprDetections } from '../../../../lib/wp-rocket/types';
import { contentCaptures, inlineScriptsCut, scriptListCut } from './capture-bounds';

/** An inline record of the given length. */
function inline(length: number): DelayedScriptRecord {
  return {
    inline: true,
    content: 'x'.repeat(length),
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minifyAttribute: false
  };
}

/** An external record. */
const EXTERNAL: DelayedScriptRecord = {
  inline: false,
  src: '/a.js',
  delayed: false,
  deferred: false,
  deferredByWPR: false,
  fdtExcluded: null,
  minifyAttribute: false
};

/** A Delay JS row around a script list. */
function row(scripts: DelayedScriptRecord[], truncated?: true): WprDetections['delay_js'] {
  return {
    present: true,
    scripts,
    version: null,
    delayedScripts: 0,
    ...(truncated === undefined ? {} : { truncated })
  };
}

const CAPS = PAYLOAD_LIMITS.delayScripts;

describe('scriptListCut', () => {
  it('is true only for a marked list at its count cap', () => {
    const full = Array.from({ length: CAPS.count }, () => EXTERNAL);
    expect(scriptListCut(row(full, true))).toBe(true);
    expect(scriptListCut(row(full))).toBe(false);
    expect(scriptListCut(row(full.slice(1), true))).toBe(false);
  });
});

describe('contentCaptures', () => {
  it('reports every script complete on an unmarked row', () => {
    expect(contentCaptures(row([inline(CAPS.content), inline(0), EXTERNAL]))).toEqual([
      'complete',
      'complete',
      'complete'
    ]);
  });

  it('marks text at the per-script cap clipped', () => {
    expect(contentCaptures(row([inline(CAPS.content), inline(10), EXTERNAL], true))).toEqual([
      'clipped',
      'complete',
      'complete'
    ]);
  });

  it('conservatively marks text and URLs ending one unit below their cap after surrogate-safe clipping', () => {
    expect(
      contentCaptures(
        row([inline(CAPS.content - 1), { ...EXTERNAL, src: 'x'.repeat(CAPS.src - 1) }], true)
      )
    ).toEqual(['clipped', 'clipped']);
  });

  it('marks the script that exhausted the budget clipped and later ones not captured', () => {
    // Sixteen full scripts spend the 8 Mi budget exactly; the next ones get nothing.
    const spent = Array.from({ length: CAPS.contentTotal / CAPS.content }, () =>
      inline(CAPS.content)
    );
    expect(
      contentCaptures(row([...spent, inline(0), EXTERNAL, inline(0)], true)).slice(-3)
    ).toEqual(['not-captured', 'complete', 'not-captured']);
    // A partial last allowance: the script clipped to what was left.
    const partial = [...spent.slice(1), inline(CAPS.content - 100), inline(100), inline(0)];
    expect(contentCaptures(row(partial, true)).slice(-3)).toEqual([
      'complete',
      'clipped',
      'not-captured'
    ]);
  });
});

describe('inlineScriptsCut', () => {
  it('is false on an unmarked row, even at the caps', () => {
    expect(inlineScriptsCut(row([inline(CAPS.content), EXTERNAL]))).toBe(false);
  });

  it('is false when the mark covers only non-inline cuts', () => {
    // A clipped URL, a dropped original type: inline text whole.
    const clippedUrl = { ...EXTERNAL, src: 'x'.repeat(CAPS.src) };
    expect(inlineScriptsCut(row([inline(10), clippedUrl], true))).toBe(false);
    expect(inlineScriptsCut(row([inline(10), { ...EXTERNAL, delayed: true }], true))).toBe(false);
  });

  it('is true when an inline text was clipped or left out', () => {
    expect(inlineScriptsCut(row([EXTERNAL, inline(CAPS.content)], true))).toBe(true);
    const spent = Array.from({ length: CAPS.contentTotal / CAPS.content }, () =>
      inline(CAPS.content - 2)
    );
    // Sixteen near-full scripts leave 32 chars; the next empty one fills nothing: not captured.
    const tail = [...spent, inline(32), inline(0)];
    expect(contentCaptures(row(tail, true)).slice(-2)).toEqual(['clipped', 'not-captured']);
    expect(inlineScriptsCut(row(tail, true))).toBe(true);
  });

  it('is true when the list itself was cut at its count cap', () => {
    const full = Array.from({ length: CAPS.count }, () => EXTERNAL);
    expect(inlineScriptsCut(row(full, true))).toBe(true);
  });
});
