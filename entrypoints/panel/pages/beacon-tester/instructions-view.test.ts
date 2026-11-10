/**
 * The instructions card's pure view: selector split, device, feature rows
 * (absent = off, unknown boolean keys by raw name), groups with only the
 * sent lists and their counts, the display cut, the allowlisted raw JSON,
 * the payload source, and the memory/state machine (current, unreadable,
 * stale on another load, dismissed, none).
 */
import { describe, expect, it } from 'vitest';
import { BEACON_CONFIG_LIMITS } from '../../../../lib/wp-rocket/constants';
import type { PriorityElementsBeaconDetection } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import {
  deviceLabel,
  describeInstructions,
  displayList,
  featureRows,
  hiddenEntriesNote,
  instructionGroup,
  instructionsCardState,
  instructionsSourceOf,
  LIST_DISPLAY_MAX,
  RAW_DISPLAY_MAX_CHARS,
  rawCutNote,
  rawDisplay,
  rawInstructions,
  rememberInstructions,
  splitSelectors,
  type InstructionsMemory
} from './instructions-view';

/** The docker site's real config, as the detection row carries it. */
const REAL: PriorityElementsBeaconDetection = {
  present: true,
  status: { atf: true, lrc: true, preconnect_external_domain: true },
  isMobile: false,
  elements: 'img, video, picture, p, main, div, li, svg, section, header, span',
  preconnect_external_domain_elements: ['link', 'script', 'iframe'],
  preconnect_external_domain_exclusions: ['static.cloudflareinsights.com', 'rel="profile"']
};

const NONE: PriorityElementsBeaconDetection = { present: false, status: null, isMobile: null };
const UNREADABLE: PriorityElementsBeaconDetection = {
  present: true,
  status: null,
  isMobile: null
};

describe('splitSelectors', () => {
  it('splits on commas, trims, drops empties', () => {
    expect(splitSelectors(' img,  video ,,p , ')).toEqual(['img', 'video', 'p']);
    expect(splitSelectors('')).toEqual([]);
    expect(splitSelectors(',,,')).toEqual([]);
  });
});

describe('deviceLabel', () => {
  it('names each device and an unstated one', () => {
    expect(deviceLabel(true)).toBe('Mobile');
    expect(deviceLabel(false)).toBe('Desktop');
    expect(deviceLabel(null)).toBe('Device not stated');
  });
});

describe('featureRows', () => {
  it('lists the four features by WP Rocket name, an absent key off', () => {
    expect(featureRows({ atf: true, lrc: false })).toEqual([
      { label: 'Optimize Critical Images', rawKey: false, on: true },
      { label: 'Automatic Lazy Rendering', rawKey: false, on: false },
      { label: 'Preload fonts', rawKey: false, on: false },
      { label: 'Preconnect to External Domains', rawKey: false, on: false }
    ]);
  });

  it('adds unknown boolean keys by raw name; other unknown values stay raw-only', () => {
    const rows = featureRows({ atf: true, future_toggle: true, note: 'x', level: 3, gone: null });
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual({ label: 'future_toggle', rawKey: true, on: true });
  });
});

describe('displayList / hiddenEntriesNote', () => {
  it('keeps a short list whole', () => {
    expect(displayList('x', 'X', ['a', 'b'])).toEqual({
      id: 'x',
      label: 'X',
      count: 2,
      shown: ['a', 'b'],
      hidden: 0
    });
  });

  it('cuts a parser-capped hostile list to the display max, counting every entry', () => {
    const entries = Array.from(
      { length: BEACON_CONFIG_LIMITS.lists.count },
      (_, i) => `e${String(i)}`
    );
    const list = displayList('x', 'X', entries);
    expect(list.count).toBe(500);
    expect(list.shown).toHaveLength(LIST_DISPLAY_MAX);
    expect(list.hidden).toBe(500 - LIST_DISPLAY_MAX);
    expect(hiddenEntriesNote(1450)).toBe('+1,450 more in the raw view');
  });
});

describe('instructionGroup', () => {
  it('shows only the sent lists, splitting the selector string, with the summed count', () => {
    const elements = instructionGroup('elements', REAL);
    expect(elements.title).toBe('Elements checked');
    expect(elements.lists.map((list) => [list.id, list.label, list.count])).toEqual([
      ['elements', 'Optimize Critical Images: selectors', 11],
      ['preconnect_external_domain_elements', 'Preconnect to External Domains: tags', 3]
    ]);
    expect(elements.count).toBe(14);
    const exclusions = instructionGroup('exclusions', REAL);
    expect(exclusions.title).toBe('Exclusions');
    expect(exclusions.lists.map((list) => list.id)).toEqual([
      'preconnect_external_domain_exclusions'
    ]);
    expect(exclusions.count).toBe(2);
  });

  it('labels every font list and keeps an empty sent list (the plugin default)', () => {
    const fonts: PriorityElementsBeaconDetection = {
      present: true,
      status: { preload_fonts: true },
      isMobile: true,
      processed_extensions: ['woff2', 'woff', 'ttf'],
      preload_fonts_exclusions: [],
      external_font_exclusions: ['fonts.example']
    };
    expect(instructionGroup('elements', fonts).lists.map((list) => list.label)).toEqual([
      'Preload fonts: font file types'
    ]);
    const exclusions = instructionGroup('exclusions', fonts);
    expect(exclusions.lists.map((list) => [list.label, list.count])).toEqual([
      ['Preload fonts: fonts', 0],
      ['Preload fonts: external font domains', 1]
    ]);
  });

  it('has no lists when the config sent none', () => {
    const group = instructionGroup('exclusions', { present: true, status: {}, isMobile: null });
    expect(group).toEqual({ id: 'exclusions', title: 'Exclusions', count: 0, lists: [] });
  });
});

describe('rawInstructions', () => {
  it('is the parsed config only, in a fixed key order', () => {
    expect(JSON.parse(rawInstructions(REAL))).toEqual({
      status: REAL.status,
      isMobile: false,
      elements: REAL.elements,
      preconnect_external_domain_elements: REAL.preconnect_external_domain_elements,
      preconnect_external_domain_exclusions: REAL.preconnect_external_domain_exclusions
    });
    expect(rawInstructions(REAL)).toContain('\n  "status"');
  });

  it('never carries a key outside the allowlist, even one forced onto the row', () => {
    const forged = {
      ...REAL,
      nonce: 'secret',
      ajax_url: '/wp-admin/admin-ajax.php',
      present: true
    } as PriorityElementsBeaconDetection;
    const raw = rawInstructions(forged);
    expect(raw).not.toContain('nonce');
    expect(raw).not.toContain('ajax_url');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('"present"');
  });
});

describe('rawDisplay / rawCutNote', () => {
  it('shows a short raw text whole and cuts a long one', () => {
    expect(rawDisplay('{}')).toEqual({ text: '{}', cut: false });
    const exact = 'x'.repeat(RAW_DISPLAY_MAX_CHARS);
    expect(rawDisplay(exact).cut).toBe(false);
    const long = rawDisplay(`${exact}y`);
    expect(long.cut).toBe(true);
    expect(long.text).toHaveLength(RAW_DISPLAY_MAX_CHARS);
    expect(rawCutNote()).toBe('Showing the first 50,000 characters. Copy takes them all.');
  });
});

describe('describeInstructions', () => {
  it('summarizes features on and the device, the title naming each feature', () => {
    const view = describeInstructions(REAL, REAL.status ?? {});
    expect(view.summary).toBe('3 of 4 features on · Desktop');
    expect(view.summaryTitle).toBe(
      'On: Optimize Critical Images, Automatic Lazy Rendering, Preconnect to External Domains. Off: Preload fonts.'
    );
    expect(view.featuresCount).toBe('3 of 4 on');
    expect(view.device).toBe('Desktop');
    expect(view.groups.map((group) => group.id)).toEqual(['elements', 'exclusions']);
    expect(view.raw).toBe(rawInstructions(REAL));
  });

  it('says none on or none off', () => {
    const off = describeInstructions(NONE, {});
    expect(off.summary).toBe('0 of 4 features on · Device not stated');
    expect(off.summaryTitle).toBe(
      'On: none. Off: Optimize Critical Images, Automatic Lazy Rendering, Preload fonts, Preconnect to External Domains.'
    );
    const all = describeInstructions(REAL, {
      atf: true,
      lrc: true,
      preload_fonts: true,
      preconnect_external_domain: true
    });
    expect(all.summaryTitle).toMatch(/Off: none\.$/);
  });
});

describe('instructionsSourceOf', () => {
  it('reads the row and identity from loaded data, nothing otherwise', () => {
    const data = makeFdtData({ scriptSnapshotId: 'page-1' });
    expect(instructionsSourceOf({ status: 'ready', data, fetchedAt: 0 })).toEqual({
      beacon: data.wprDetections.priority_elements_beacon,
      page: 'page-1'
    });
    expect(instructionsSourceOf({ status: 'refreshing', data, requestedAt: 0 }).page).toBe(
      'page-1'
    );
    expect(instructionsSourceOf({ status: 'fetching' })).toEqual({ beacon: null, page: null });
    expect(
      instructionsSourceOf({ status: 'error', cause: 'x', hardReload: false }).beacon
    ).toBeNull();
  });
});

describe('rememberInstructions', () => {
  it('remembers readable instructions with their load', () => {
    const memory = rememberInstructions(null, { beacon: REAL, page: 'p1' });
    expect(memory).toEqual({ page: 'p1', beacon: REAL, status: REAL.status });
    // Same row, same load: the same object.
    expect(rememberInstructions(memory, { beacon: REAL, page: 'p1' })).toBe(memory);
    // A new load with instructions replaces it.
    expect(rememberInstructions(memory, { beacon: REAL, page: 'p2' })?.page).toBe('p2');
  });

  it('keeps the memory over a payload without a beacon (or without page data)', () => {
    const memory = rememberInstructions(null, { beacon: REAL, page: 'p1' });
    for (const beacon of [NONE, null]) {
      expect(rememberInstructions(memory, { beacon, page: 'p2' })).toBe(memory);
    }
    expect(rememberInstructions(null, { beacon: NONE, page: 'p1' })).toBeNull();
  });

  it('forgets the memory on a beacon whose config could not be read', () => {
    // That beacon superseded the remembered instructions: a later page without a
    // beacon must not show the older ones as the page's last.
    const memory = rememberInstructions(null, { beacon: REAL, page: 'p1' });
    expect(rememberInstructions(memory, { beacon: UNREADABLE, page: 'p2' })).toBeNull();
    expect(rememberInstructions(null, { beacon: UNREADABLE, page: 'p1' })).toBeNull();
  });
});

describe('instructionsCardState', () => {
  const memory: InstructionsMemory = { page: 'p1', beacon: REAL, status: REAL.status ?? {} };

  it('shows the payload’s own instructions, or its unreadable line', () => {
    const current = instructionsCardState({ beacon: REAL, page: 'p1' }, memory, null);
    expect(current.kind).toBe('instructions');
    expect(instructionsCardState({ beacon: UNREADABLE, page: 'p2' }, memory, null)).toEqual({
      kind: 'unreadable'
    });
  });

  it('reads earlier instructions as no longer on the page on another load without a beacon', () => {
    const state = instructionsCardState({ beacon: NONE, page: 'p2' }, memory, null);
    expect(state.kind).toBe('stale');
    if (state.kind === 'stale') expect(state.view.summary).toBe('3 of 4 features on · Desktop');
  });

  it('shows the calm line once dismissed, with no memory, on the same load or an unknown one', () => {
    expect(instructionsCardState({ beacon: NONE, page: 'p2' }, memory, memory).kind).toBe('none');
    expect(instructionsCardState({ beacon: NONE, page: 'p2' }, null, null).kind).toBe('none');
    expect(instructionsCardState({ beacon: NONE, page: 'p1' }, memory, null).kind).toBe('none');
    expect(instructionsCardState({ beacon: NONE, page: null }, memory, null).kind).toBe('none');
    expect(instructionsCardState({ beacon: null, page: null }, null, null).kind).toBe('none');
  });

  it('a later memory is not covered by an earlier dismissal', () => {
    const later: InstructionsMemory = { ...memory, page: 'p3' };
    expect(instructionsCardState({ beacon: NONE, page: 'p4' }, later, memory).kind).toBe('stale');
  });
});
