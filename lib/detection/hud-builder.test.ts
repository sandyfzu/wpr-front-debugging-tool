/**
 * The Exclusion Builder modifier in the shared reading: the fact read
 * through, the copy pinned (chip, sentence, tab-level hint), every verdict ×
 * modifier state line, the tab-level line per token, and the two edges —
 * a fact on a row WP Rocket did not serve, and a page with no fact.
 */
import { describe, expect, it } from 'vitest';
import type { BuilderFact, WprDetections } from '../wp-rocket/types';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import { describeDetections } from './describe';
import {
  BUILDER_SERVED_LEAD,
  BUILDER_TAB_LINE_TITLE,
  builderBadgeKind,
  builderModifierCopy,
  builderOffSummary,
  builderTabLine,
  builderTurnsOff,
  hudFeatureOf,
  hudStateLine,
  readHudFeature,
  type HudFeature,
  type HudReading,
  type HudVerdict
} from './hud';
import { runDetection } from './run-detection';

/** A registry row, failing loudly if the registry lost it. */
function feature(row: string): HudFeature {
  const found = hudFeatureOf(row);
  if (found === undefined) throw new Error(`no HUD row ${row}`);
  return found;
}

const DELAY = feature('delay_js');
const DEFER = feature('defer_all_js');
const LAZYLOAD = feature('lazyload');
const ALR = feature('automatic_lazy_rendering');

/** A page whose generator meta declares Delay/Defer/Lazyload/ALR, with a builder marker. */
function markedPage(content: string | null, declared = true): string {
  const generator = declared
    ? '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images wpr_automatic_lazy_rendering">'
    : '';
  const marker =
    content === null ? '' : `<meta name="${BUILDER_MARKER_META_NAME}" content="${content}">`;
  return `<!doctype html><html><head>${generator}${marker}</head><body></body></html>`;
}

/** The detections of a page. */
function detectionsOf(html: string): WprDetections {
  return runDetection(html).detections;
}

/** A reading with the given verdict, count and fact. */
function reading(verdict: HudVerdict, count: number | null, builder?: BuilderFact): HudReading {
  return { verdict, count, source: null, why: null, ...(builder === undefined ? {} : { builder }) };
}

describe('builderTurnsOff — the one "off in this tab" rule', () => {
  it('is true for the feature-wide disable and the Defer page-off', () => {
    expect(builderTurnsOff({ off: 'feature' })).toBe(true);
    expect(builderTurnsOff({ off: 'page' })).toBe(true);
  });

  it('is false for excluded rows, whatever the count', () => {
    expect(builderTurnsOff({ excluded: 1 })).toBe(false);
    expect(builderTurnsOff({ excluded: 9999 })).toBe(false);
  });

  it('is false without a fact', () => {
    expect(builderTurnsOff(undefined)).toBe(false);
    expect(builderTurnsOff()).toBe(false);
  });
});

describe('builderBadgeKind — the badge icon every surface follows', () => {
  it('maps every fact to its badge kind', () => {
    expect(builderBadgeKind({ off: 'feature' })).toBe('off');
    expect(builderBadgeKind({ off: 'page' })).toBe('off');
    expect(builderBadgeKind({ excluded: 1 })).toBe('excluded');
  });
});

describe('builderOffSummary — the summary reason suffix', () => {
  it('says nothing when no feature is off in this tab', () => {
    expect(builderOffSummary(0)).toBeNull();
    expect(builderOffSummary(-1)).toBeNull();
  });

  it('counts one and many with the same wording', () => {
    expect(builderOffSummary(1)).toBe('1 off in this tab');
    expect(builderOffSummary(2)).toBe('2 off in this tab');
    expect(builderOffSummary(4)).toBe('4 off in this tab');
  });
});

describe('builderModifierCopy — the declared words', () => {
  it('pins the feature-wide disable', () => {
    expect(builderModifierCopy(DELAY, { off: 'feature' })).toEqual({
      chip: 'Disabled in this tab',
      sentence: 'Disabled in this tab by the Exclusion Builder.',
      hint: 'Delay JS off'
    });
    expect(builderModifierCopy(ALR, { off: 'feature' }).hint).toBe('Automatic Lazy Rendering off');
  });

  it('pins Defer JS turned off for the page by a row', () => {
    expect(builderModifierCopy(DEFER, { off: 'page' })).toEqual({
      chip: 'Off on this page',
      sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.',
      hint: 'Defer JS off on this page'
    });
  });

  it('pins the excluded count with its unit, singular for one', () => {
    expect(builderModifierCopy(LAZYLOAD, { excluded: 3 })).toEqual({
      chip: '3 excluded',
      sentence: '3 images excluded by the Exclusion Builder.',
      hint: 'Lazyload Images: 3 excluded'
    });
    expect(builderModifierCopy(DELAY, { excluded: 1 })).toEqual({
      chip: '1 excluded',
      sentence: '1 script excluded by the Exclusion Builder.',
      hint: 'Delay JS: 1 excluded'
    });
    expect(builderModifierCopy(ALR, { excluded: 9999 }).sentence).toBe(
      '9999 elements excluded by the Exclusion Builder.'
    );
    expect(builderModifierCopy(DEFER, { excluded: 2 }).hint).toBe('Defer JS: 2 excluded');
  });

  it('never claims WP Rocket served the feature (the verdict owns that)', () => {
    const facts: [HudFeature, BuilderFact][] = [
      [DELAY, { off: 'feature' }],
      [DEFER, { off: 'page' }],
      [LAZYLOAD, { excluded: 2 }]
    ];
    for (const [entry, fact] of facts) {
      const copy = builderModifierCopy(entry, fact);
      expect(`${copy.chip} ${copy.sentence} ${copy.hint}`).not.toMatch(/served/i);
    }
  });
});

describe('hudStateLine — singular for one', () => {
  it('reads one of every counted feature in the singular, many in the plural', () => {
    const cases: [string, string, string][] = [
      ['delay_js', '1 script', '2 scripts'],
      ['defer_all_js', '1 script', '2 scripts'],
      ['lazyload', '1 image', '2 images'],
      ['rocket_above_the_fold_optimization', '1 image', '2 images'],
      ['automatic_lazy_rendering', '1 element', '2 elements'],
      ['auto_preload_fonts', '1 font', '2 fonts'],
      ['preconnect_external_domains', '1 domain', '2 domains']
    ];
    for (const [row, one, many] of cases) {
      expect(hudStateLine(feature(row), reading('applied', 1)), row).toBe(
        `applied on this page: ${one}.`
      );
      expect(hudStateLine(feature(row), reading('applied', 2)), row).toBe(
        `applied on this page: ${many}.`
      );
    }
  });
});

describe('hudStateLine — every verdict × modifier', () => {
  it('replaces the served counts line when the feature is off in this tab', () => {
    // The rewritten page's own count ("applied on this page: 0 scripts") is
    // the contradiction the modifier replaces.
    expect(hudStateLine(DELAY, reading('applied', 0, { off: 'feature' }))).toBe(
      `${BUILDER_SERVED_LEAD}; disabled in this tab by the Exclusion Builder.`
    );
    expect(hudStateLine(DEFER, reading('applied', 0, { off: 'page' }))).toBe(
      'served by WP Rocket; off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
    );
    expect(hudStateLine(DELAY, reading('applied', 0, { off: 'feature' }))).not.toContain(
      'applied on this page'
    );
  });

  it('says only the modifier, never "served", when the verdict does not prove WP Rocket served it', () => {
    for (const verdict of ['not applied', 'not enabled', 'collecting', 'unknown'] as const) {
      expect(hudStateLine(DELAY, reading(verdict, 0, { off: 'feature' })), verdict).toBe(
        'disabled in this tab by the Exclusion Builder.'
      );
      expect(hudStateLine(DEFER, reading(verdict, 0, { off: 'page' })), verdict).toBe(
        'off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
      );
    }
  });

  it('keeps the served line and adds the excluded count', () => {
    expect(hudStateLine(DELAY, reading('applied', 1, { excluded: 1 }))).toBe(
      'applied on this page: 1 script. 1 script excluded by the Exclusion Builder.'
    );
    expect(hudStateLine(LAZYLOAD, reading('not applied', 0, { excluded: 2 }))).toBe(
      "nothing matched on this page (the page may predate the plugin's work). 2 images excluded by the Exclusion Builder."
    );
    expect(hudStateLine(ALR, reading('collecting', 0, { excluded: 1 }))).toBe(
      'enabled, not yet applied on this page. 1 element excluded by the Exclusion Builder.'
    );
  });

  it('is the served line alone without a fact', () => {
    expect(hudStateLine(DELAY, reading('applied', 2))).toBe('applied on this page: 2 scripts.');
  });
});

describe('readHudFeature — the fact read through', () => {
  it('carries the row’s fact beside the unchanged verdict', () => {
    const detections = detectionsOf(markedPage('v1 delay_js=off lazyload=excluded:2'));
    const report = describeDetections(detections);
    expect(readHudFeature(DELAY, report, detections)).toMatchObject({
      verdict: 'applied',
      source: 'meta',
      builder: { off: 'feature' }
    });
    expect(readHudFeature(LAZYLOAD, report, detections).builder).toEqual({ excluded: 2 });
    expect(readHudFeature(DEFER, report, detections)).not.toHaveProperty('builder');
    // Rows the builder never touches never carry one.
    expect(readHudFeature(feature('rocket_cdn'), report, detections)).not.toHaveProperty('builder');
  });

  it('keeps a fact on a row WP Rocket did not serve, worded without claiming it did', () => {
    // No generator declaration (an older WP Rocket) and the footprint removed
    // by the disable: the served verdict reads not applied; the fact explains why.
    const detections = detectionsOf(markedPage('v1 delay_js=off', false));
    const report = describeDetections(detections);
    const delay = readHudFeature(DELAY, report, detections);
    expect(delay).toMatchObject({ verdict: 'not applied', builder: { off: 'feature' } });
    const line = hudStateLine(DELAY, delay);
    expect(line).toBe('disabled in this tab by the Exclusion Builder.');
    expect(line).not.toMatch(/served/i);
  });

  it('adds nothing on a page with no builder fact', () => {
    // E.g. a rewrite that only removed a served marker: no feature changed.
    const detections = detectionsOf(markedPage(null));
    const report = describeDetections(detections);
    for (const entry of [DELAY, DEFER, LAZYLOAD, ALR]) {
      const read = readHudFeature(entry, report, detections);
      expect(read, entry.row).not.toHaveProperty('builder');
      expect(hudStateLine(entry, read)).not.toMatch(/Exclusion Builder/);
    }
  });
});

describe('builderTabLine — the strip’s tab-level line', () => {
  it('is absent without a fact', () => {
    expect(builderTabLine(detectionsOf(markedPage(null)))).toBeNull();
  });

  it('names every changed feature in registry order', () => {
    const line = builderTabLine(
      detectionsOf(
        markedPage(
          'v1 delay_js=off defer_all_js=page-off automatic_lazy_rendering=excluded:1 lazyload=excluded:3'
        )
      )
    );
    expect(line).toEqual({
      title: BUILDER_TAB_LINE_TITLE,
      hints: [
        'Delay JS off',
        'Defer JS off on this page',
        'Lazyload Images: 3 excluded',
        'Automatic Lazy Rendering: 1 excluded'
      ],
      text: 'Exclusion Builder rewrote this page — Delay JS off · Defer JS off on this page · Lazyload Images: 3 excluded · Automatic Lazy Rendering: 1 excluded'
    });
  });

  it('carries one hint per token, worded exactly as the per-feature copy', () => {
    const cases: [string, HudFeature, BuilderFact][] = [
      ['v1 delay_js=excluded:2', DELAY, { excluded: 2 }],
      ['v1 defer_all_js=off', DEFER, { off: 'feature' }],
      ['v1 automatic_lazy_rendering=off', ALR, { off: 'feature' }],
      ['v1 lazyload=excluded:1', LAZYLOAD, { excluded: 1 }]
    ];
    for (const [content, entry, fact] of cases) {
      const line = builderTabLine(detectionsOf(markedPage(content)));
      expect(line?.hints, content).toEqual([builderModifierCopy(entry, fact).hint]);
      expect(line?.text, content).toBe(
        `${BUILDER_TAB_LINE_TITLE} — ${builderModifierCopy(entry, fact).hint}`
      );
    }
  });
});
