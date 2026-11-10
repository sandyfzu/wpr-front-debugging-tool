/**
 * Row identity: keys follow the script, not its position; reconciliation
 * reuses unchanged views wherever they moved and rebuilds changed ones.
 */
import { describe, expect, it } from 'vitest';
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import {
  buildRowView,
  domIdOf,
  fnv1a,
  reconcileRowViews,
  scriptKeys,
  scriptSignature
} from './script-identity';

/** A classified script with overrides. */
function script(overrides: Partial<JsScriptResource> = {}): JsScriptResource {
  return {
    id: 0,
    type: 'external',
    content: 'https://example.test/a.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minified: false,
    combined: false,
    originalType: null,
    ...overrides
  };
}

/** An inline script with the given text. */
function inline(content: string, overrides: Partial<JsScriptResource> = {}): JsScriptResource {
  return script({ type: 'inline', content, ...overrides });
}

describe('fnv1a', () => {
  it('hashes deterministically, per seed', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('a', 1)).not.toBe(fnv1a('a'));
  });
});

describe('scriptSignature', () => {
  it('names external scripts by URL', () => {
    expect(scriptSignature(script())).toBe('e|https://example.test/a.js');
  });

  it('names inline scripts by length plus head and tail hashes', () => {
    expect(scriptSignature(inline('abc'))).toMatch(/^i\|3\|[0-9a-z]+\|[0-9a-z]+$/);
    expect(scriptSignature(inline('abc'))).not.toBe(scriptSignature(inline('abd')));
    // Constant work: a middle-only difference keeps the signature (the full
    // text comparison at reconciliation tells them apart).
    const middle = (char: string): string => `${'h'.repeat(600)}${char}${'t'.repeat(600)}`;
    expect(scriptSignature(inline(middle('x')))).toBe(scriptSignature(inline(middle('y'))));
  });
});

describe('scriptKeys', () => {
  it('numbers repeated scripts by occurrence', () => {
    expect(scriptKeys([script(), inline('a'), script()])).toEqual([
      'e|https://example.test/a.js#0',
      `${scriptSignature(inline('a'))}#0`,
      'e|https://example.test/a.js#1'
    ]);
  });

  it('keeps every key when a script is added above', () => {
    const rows = [script({ content: 'https://x.test/1.js' }), inline('b')];
    const before = scriptKeys(rows);
    const after = scriptKeys([inline('new'), ...rows]);
    expect(after.slice(1)).toEqual(before);
  });
});

describe('domIdOf', () => {
  it('is id-safe, stable and distinct per key', () => {
    expect(domIdOf('e|https://a b#0')).toMatch(/^fdt-js-code-[0-9a-z]+$/);
    expect(domIdOf('k')).toBe(domIdOf('k'));
    expect(domIdOf('k#0')).not.toBe(domIdOf('k#1'));
  });
});

describe('buildRowView', () => {
  it('carries key, id, capture, chips, type detail and code (inline only)', () => {
    const view = buildRowView(inline('x'), 'k', 'clipped');
    expect(view).toMatchObject({ key: 'k', domId: domIdOf('k'), capture: 'clipped' });
    expect(view.code?.lines).toBe(1);
    expect(buildRowView(script(), 'e').code).toBeNull();
    expect(buildRowView(script(), 'e').capture).toBe('complete');
    expect(buildRowView(script(), 'e').chips).toEqual({ visible: [], overflow: null });
    expect(buildRowView(script(), 'e').typeDetail).toBeNull();
    const delayed = buildRowView(script({ delayed: true, originalType: 'module' }), 'd');
    expect(delayed.typeDetail).toBe('type: module');
    expect(delayed.chips.visible.map((chip) => chip.label)).toEqual(['Delayed']);
  });

  it('words a stamped defer as the simulation’s when a verified simulation ran Defer JS', () => {
    const stamped = script({ deferredByWPR: true, deferred: true });
    expect(buildRowView(stamped, 'e', 'complete', true).chips.visible[0]?.mark).toBe('Simulated');
    expect(reconcileRowViews([], [stamped], [], true)[0]?.chips.visible[0]?.mark).toBe('Simulated');
    expect(buildRowView(stamped, 'e').chips.visible[0]?.mark).toBe('WP Rocket');
  });
});

describe('reconcileRowViews', () => {
  const rows = [script({ content: 'https://x.test/1.js' }), inline('a')];

  it('builds every view on the first pass', () => {
    const views = reconcileRowViews([], rows);
    expect(views.map((view) => view.row)).toEqual(rows);
  });

  it('returns the previous array when nothing changed (a no-op refresh)', () => {
    const first = reconcileRowViews([], rows);
    expect(
      reconcileRowViews(
        first,
        rows.map((row) => ({ ...row }))
      )
    ).toBe(first);
  });

  it('reuses views by key when a script is added above', () => {
    const first = reconcileRowViews([], rows);
    const shifted = rows.map((row, id) => ({ ...row, id: id + 1 }));
    const next = reconcileRowViews(first, [inline('top'), ...shifted]);
    expect(next[1]).toBe(first[0]);
    expect(next[2]).toBe(first[1]);
  });

  it('rebuilds a view whose data or capture changed', () => {
    const first = reconcileRowViews([], rows, ['complete', 'complete']);
    const flipped = reconcileRowViews(
      first,
      [rows[0] as JsScriptResource, inline('a')],
      ['complete', 'clipped']
    );
    expect(flipped[0]).toBe(first[0]);
    expect(flipped[1]).not.toBe(first[1]);
    expect(flipped[1]?.capture).toBe('clipped');
    const edited = reconcileRowViews(first, [
      { ...(rows[0] as JsScriptResource), delayed: true },
      rows[1] as JsScriptResource
    ]);
    expect(edited[0]).not.toBe(first[0]);
    expect(edited[1]).toBe(first[1]);
  });

  it('rebuilds when a same-signature script differs in its middle', () => {
    const middle = (char: string): string => `${'h'.repeat(600)}${char}${'t'.repeat(600)}`;
    const first = reconcileRowViews([], [inline(middle('x'))]);
    const next = reconcileRowViews(first, [inline(middle('y'))]);
    expect(next[0]).not.toBe(first[0]);
    expect(next[0]?.key).toBe(first[0]?.key);
  });

  it('reports a change when rows were removed or reordered', () => {
    const first = reconcileRowViews([], rows);
    const shorter = reconcileRowViews(first, [rows[0] as JsScriptResource]);
    expect(shorter).toHaveLength(1);
    expect(shorter[0]).toBe(first[0]);
    const reordered = reconcileRowViews(first, [...rows].reverse());
    expect(reordered).not.toBe(first);
    expect(reordered[0]).toBe(first[1]);
  });

  it('keeps repeated scripts distinct when another script is inserted and removed', () => {
    const duplicate = script({ content: 'https://x.test/repeated.js' });
    const first = reconcileRowViews([], [duplicate, { ...duplicate }]);
    expect(first[0]?.key).not.toBe(first[1]?.key);
    const inserted = reconcileRowViews(first, [
      inline('new'),
      { ...duplicate, id: 1 },
      { ...duplicate, id: 2 }
    ]);
    expect(inserted[1]).toBe(first[0]);
    expect(inserted[2]).toBe(first[1]);
    const removed = reconcileRowViews(inserted, [{ ...duplicate }]);
    expect(removed[0]).toBe(first[0]);
  });
});
