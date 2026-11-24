/**
 * The Exclusion Builder on the on-page strip: each changed row's modifier
 * (badge + visible sentence, the panel card's words) and the tab-level
 * "Exclusion Builder rewrote this page" line — none, one, many, excluded
 * only, and a fact on a row WP Rocket did not serve — and the closed pill's
 * builder hint (glyph + spoken suffix), over the real engine, in the model
 * and in the rendered widget.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILDER_PILL_HINT_SPOKEN,
  builderModifierCopy,
  builderTabLine,
  hudFeatureOf,
  LIST_JOINER,
  type HudFeature
} from '../../../lib/detection/hud';
import { runDetection } from '../../../lib/detection/run-detection';
import { cacheStateForPage } from '../../../lib/detection/cache-context';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import type { FeatureMetaRow, WprDetections } from '../../../lib/wp-rocket/types';
import {
  buildStripCardModel,
  WIDGET_BUILDER_LINE_ID,
  type StripCardModel,
  type StripCardRow
} from './strip-state';
import { DetectionWidgetView } from './ui';

afterEach(cleanup);

/** The generator meta declaring Delay/Defer/LazyLoad as served. */
const DECLARING_GENERATOR =
  '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">';

/** The owner's example line, word for word. */
const MANY_LINE =
  'Exclusion Builder rewrote this page — Delay JS off · Defer JS off on this page · Lazyload Images: 3 excluded';

/**
 * The engine's rows for a WP Rocket page with an optional builder marker.
 *
 * @param marker The marker content, or null for none.
 * @param generator The generator meta (default: declares Delay/Defer/LazyLoad).
 */
function markedDetections(marker: string | null, generator = DECLARING_GENERATOR): WprDetections {
  const note =
    marker === null ? '' : `<meta name="${BUILDER_MARKER_META_NAME}" content="${marker}">`;
  const html = `<!doctype html><html><head>${generator}${note}</head><body><img src="p.gif" data-lazy-src="r.jpg"></body></html>`;
  return runDetection(html).detections;
}

/**
 * The strip's card model for a WP Rocket page with an optional builder marker.
 *
 * @param marker The marker content, or null for none.
 * @param generator The generator meta (default: declares Delay/Defer/LazyLoad).
 */
function model(marker: string | null, generator = DECLARING_GENERATOR): StripCardModel {
  const detections = markedDetections(marker, generator);
  return buildStripCardModel({
    snapshot: {
      phase: 'ready',
      detections,
      cacheState: cacheStateForPage({ wpr: detections.wpr, headers: null, bypassAttested: false })
    },
    wordpressVersion: null,
    fdtVersion: '0.0.0'
  });
}

/** One row of a model, failing loudly when missing. */
function row(card: StripCardModel, id: FeatureMetaRow): StripCardRow {
  const found = card.groups.flatMap((group) => group.rows).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

/** A registry row, failing loudly if the registry lost it. */
function feature(id: string): HudFeature {
  const found = hudFeatureOf(id);
  if (found === undefined) throw new Error(`no HUD row ${id}`);
  return found;
}

/** Render the open card for a model; returns the shadow-free root. */
function renderCard(card: StripCardModel): HTMLElement {
  const noop = (): void => undefined;
  const { container } = render(() => (
    <DetectionWidgetView
      model={() => card}
      mood={() => 'green'}
      cardOpen={() => true}
      actions={{
        registerCard: noop,
        registerPill: noop,
        registerChrome: noop,
        openCard: noop,
        closeCard: noop
      }}
    />
  ));
  return container;
}

/**
 * The text assistive tech reads: text content minus every `aria-hidden`
 * subtree (CSS-drawn glyphs are never in it).
 */
function spokenText(node: Node): string {
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  return Array.from(node.childNodes, spokenText).join('');
}

/** The visible text: every text node outside the visually hidden spans. */
function visibleText(node: Node): string {
  if (node instanceof Element && node.classList.contains('dw-sr')) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  return Array.from(node.childNodes, visibleText).join('');
}

describe('the strip model — tab-level line', () => {
  it('none: a page without a fact has no line and no row modifier', () => {
    const card = model(null);
    expect(card.builderLine).toBeNull();
    for (const entry of card.groups.flatMap((group) => group.rows)) {
      expect(entry.modifier, entry.id).toBeNull();
    }
  });

  it('one: names the one feature turned off', () => {
    const card = model('v1 delay_js=off');
    expect(card.builderLine?.hints).toEqual(['Delay JS off']);
    expect(card.builderLine?.spoken).toBe('Exclusion Builder rewrote this page — Delay JS off');
  });

  it('many: the owner’s line, in registry order, the panel’s shared copy', () => {
    const card = model('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3');
    // Read as shown: the title, then the hints with the gutter dot between them.
    const line = card.builderLine;
    expect(line && `${line.title} — ${line.hints.join(LIST_JOINER)}`).toBe(MANY_LINE);
    expect(card.builderLine?.hints).toEqual([
      'Delay JS off',
      'Defer JS off on this page',
      'Lazyload Images: 3 excluded'
    ]);
  });

  it('excluded only: the line names the count, nothing is called off', () => {
    const card = model('v1 lazyload=excluded:1');
    expect(card.builderLine?.spoken).toBe(
      'Exclusion Builder rewrote this page — Lazyload Images: 1 excluded'
    );
  });

  it('is absent while the pass runs or failed, even over marked rows', () => {
    // Real marked rows: only the phase gate can keep the line out.
    const detections = markedDetections('v1 delay_js=off lazyload=excluded:3');
    for (const phase of ['running', 'failed'] as const) {
      const card = buildStripCardModel({
        snapshot: { phase, detections, cacheState: null },
        wordpressVersion: null,
        fdtVersion: '0.0.0'
      });
      expect(card.builderLine, phase).toBeNull();
    }
  });

  it('is the shared builderTabLine, never a second composition', () => {
    const html = `<html><head>${DECLARING_GENERATOR}<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off lazyload=excluded:2"></head><body></body></html>`;
    const { detections } = runDetection(html);
    const card = buildStripCardModel({
      snapshot: { phase: 'ready', detections, cacheState: null },
      wordpressVersion: null,
      fdtVersion: '0.0.0'
    });
    expect(card.builderLine).toEqual(builderTabLine(detections));
  });
});

describe('the strip model — row modifiers', () => {
  it('off: the served chip stays, its count gives way to the modifier', () => {
    const delay = row(model('v1 delay_js=off'), 'delay_js');
    expect(delay.chipState).toBe('ok');
    expect(delay.modifier).toEqual({
      kind: 'off',
      chip: 'Disabled in this tab',
      sentence: 'Disabled in this tab by the Exclusion Builder.'
    });
    // The count measures the rewritten page; the modifier replaces it.
    expect(delay.count).toBeNull();
    expect(delay.unit).toBeNull();
    expect(delay.tooltip).toBe(
      'Delay JavaScript execution — served by WP Rocket; disabled in this tab by the Exclusion Builder. ' +
        "Decided by WP Rocket's generator meta tag on this page."
    );
  });

  it('page-off: Defer’s own words', () => {
    const defer = row(model('v1 defer_all_js=page-off'), 'defer_all_js');
    expect(defer.chipState).toBe('ok');
    expect(defer.modifier).toEqual({
      kind: 'off',
      chip: 'Off on this page',
      sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
    });
    expect(defer.count).toBeNull();
  });

  it('excluded: the feature still runs — its count stays beside the modifier', () => {
    const lazy = row(model('v1 lazyload=excluded:3'), 'lazyload');
    expect(lazy.chipState).toBe('ok');
    expect(lazy.modifier).toEqual({
      kind: 'excluded',
      chip: '3 excluded',
      sentence: '3 images excluded by the Exclusion Builder.'
    });
    expect(lazy.count).toBe(1);
    expect(lazy.unit).toBe('image');
    expect(row(model('v1 lazyload=excluded:1'), 'lazyload').modifier?.sentence).toBe(
      '1 image excluded by the Exclusion Builder.'
    );
  });

  it('words equal the panel card’s (one shared copy)', () => {
    const card = model('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3');
    const facts = [
      ['delay_js', { off: 'feature' }],
      ['defer_all_js', { off: 'page' }],
      ['lazyload', { excluded: 3 }]
    ] as const;
    for (const [id, fact] of facts) {
      const copy = builderModifierCopy(feature(id), fact);
      expect(row(card, id).modifier, id).toMatchObject({
        chip: copy.chip,
        sentence: copy.sentence
      });
    }
  });

  it('a fact on a row WP Rocket did not serve: the modifier alone, never "served"', () => {
    const generator =
      '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_lazyload_images">';
    const delay = row(model('v1 delay_js=off', generator), 'delay_js');
    expect(delay.chipState).toBe('neutral');
    expect(delay.modifier?.sentence).toBe('Disabled in this tab by the Exclusion Builder.');
    expect(delay.tooltip).toMatch(/^Delay JavaScript execution — disabled in this tab/);
    expect(delay.tooltip).not.toMatch(/served/i);
  });
});

describe('the rendered card', () => {
  it('shows the tab-level line as visible text, spoken with commas, never the dot', () => {
    const root = renderCard(model('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3'));
    const line = root.querySelector<HTMLElement>('[data-fdt-strip-builder]');
    expect(line).not.toBeNull();
    expect(line?.querySelector('.dw-builder-title')?.textContent).toBe(
      'Exclusion Builder rewrote this page'
    );
    const hints = Array.from(
      root.querySelectorAll<HTMLElement>('[data-fdt-strip-builder-hint]'),
      visibleText
    );
    expect(hints).toEqual([
      'Delay JS off',
      'Defer JS off on this page',
      'Lazyload Images: 3 excluded'
    ]);
    // The dot is CSS-drawn with empty alt text: never in the DOM text.
    expect(line?.textContent).not.toContain('·');
    // Spoken once, as one sentence (the laid-out pieces are hidden from
    // assistive tech): commas where the eye sees the dot.
    const sentence =
      'Exclusion Builder rewrote this page — Delay JS off, Defer JS off on this page, Lazyload Images: 3 excluded';
    expect(spokenText(line as HTMLElement)).toBe(sentence);
    expect(root.querySelector(`#${WIDGET_BUILDER_LINE_ID}`)?.textContent).toBe(sentence);
    // The joiner glyph rides the shared CSS content value.
    expect(line?.style.getPropertyValue('--dw-joiner')).toBe(`'·' / ''`);
    // Opening the card announces the line: it is the dialog's description.
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toBe(
      WIDGET_BUILDER_LINE_ID
    );
  });

  it('renders each modifier as a hidden badge plus a visible sentence, spoken once', () => {
    const root = renderCard(model('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3'));
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.dw-row')).filter(
      (entry) => entry.querySelector('[data-fdt-strip-modifier]') !== null
    );
    expect(rows).toHaveLength(3);
    const expected = [
      ['off', 'Disabled in this tab', 'Disabled in this tab by the Exclusion Builder.'],
      [
        'off',
        'Off on this page',
        'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
      ],
      ['excluded', '3 excluded', '3 images excluded by the Exclusion Builder.']
    ] as const;
    rows.forEach((entry, index) => {
      const [kind, chip, sentence] = expected[index] ?? ['', '', ''];
      const badge = entry.querySelector<HTMLElement>('[data-fdt-strip-modifier]');
      expect(badge?.dataset['fdtStripModifier']).toBe(kind);
      expect(badge?.getAttribute('aria-hidden')).toBe('true');
      expect(badge?.hasAttribute('title')).toBe(false);
      expect(badge?.textContent).toBe(chip);
      // Not colour alone: every badge carries its kind's icon.
      expect(badge?.querySelectorAll('svg')).toHaveLength(1);
      // The kind's own glyph (lucide circle-off / list-x): a swapped icon table fails here.
      const paths = Array.from(badge?.querySelectorAll('path') ?? [], (path) =>
        path.getAttribute('d')
      );
      expect(paths).toContain(kind === 'off' ? 'm2 2 20 20' : 'm15.5 9.5 5 5');
      expect(paths).not.toContain(kind === 'off' ? 'm15.5 9.5 5 5' : 'm2 2 20 20');
      const line = entry.querySelector<HTMLElement>('[data-fdt-strip-modifier-line]');
      expect(line && visibleText(line)).toBe(sentence);
      const spoken = spokenText(entry);
      expect(spoken.split(sentence)).toHaveLength(2);
      // No row tooltip: it would repeat the visible sentence as the row's description.
      expect(entry.hasAttribute('title')).toBe(false);
    });
    // Rows without a modifier keep their explaining tooltip.
    const plain = Array.from(root.querySelectorAll<HTMLElement>('.dw-row')).find(
      (entry) => entry.querySelector('.dw-chip')?.textContent === 'Minify JS'
    );
    expect(plain?.getAttribute('title')).toMatch(/^Minify JavaScript files — /);
    // Off rows show no count; the excluded row keeps its value chip.
    const values = rows.map((entry) => entry.querySelector('.dw-value')?.textContent ?? null);
    expect(values).toEqual([null, null, '1 image']);
  });

  it('a page without a fact renders no line, no modifier and no description', () => {
    const root = renderCard(model(null));
    expect(root.querySelector('[data-fdt-strip-builder]')).toBeNull();
    expect(root.querySelector('[data-fdt-strip-modifier]')).toBeNull();
    expect(root.querySelector('[data-fdt-strip-modifier-line]')).toBeNull();
    expect(root.textContent).not.toContain('Exclusion Builder');
    expect(root.querySelector('[role="dialog"]')?.hasAttribute('aria-describedby')).toBe(false);
  });
});

/** The pill's exact spoken suffix, pinned literally (the copy's one owner is `hud.ts`). */
const PILL_SUFFIX = ', rewritten by the Exclusion Builder';

describe('the strip model — closed pill hint', () => {
  it('is absent without a fact', () => {
    expect(model(null).builderPill).toBeNull();
  });

  it('turned off wins over excluded; excluded alone draws the excluded glyph', () => {
    const cases: [string, 'off' | 'excluded'][] = [
      ['v1 delay_js=off', 'off'],
      ['v1 defer_all_js=page-off', 'off'],
      ['v1 delay_js=off lazyload=excluded:3', 'off'],
      ['v1 delay_js=excluded:2 defer_all_js=page-off', 'off'],
      ['v1 lazyload=excluded:1', 'excluded'],
      ['v1 delay_js=excluded:2 lazyload=excluded:3', 'excluded']
    ];
    for (const [marker, kind] of cases) {
      const card = model(marker);
      expect(card.builderPill, marker).toBe(kind);
      // The same facts as the card line: present together.
      expect(card.builderLine, marker).not.toBeNull();
    }
  });

  it('is absent while the pass runs or failed, even over marked rows', () => {
    const detections = markedDetections('v1 delay_js=off lazyload=excluded:3');
    for (const phase of ['running', 'failed'] as const) {
      const card = buildStripCardModel({
        snapshot: { phase, detections, cacheState: null },
        wordpressVersion: null,
        fdtVersion: '0.0.0'
      });
      expect(card.builderPill, phase).toBeNull();
    }
  });
});

describe('the rendered pill', () => {
  /** The pill button of a rendered widget. */
  function pillOf(root: HTMLElement): HTMLElement {
    const pill = root.querySelector<HTMLElement>('.dw-pill');
    if (pill === null) throw new Error('no pill');
    return pill;
  }

  it('shows the builder glyph after the version, hidden from assistive tech', () => {
    for (const [marker, kind] of [
      ['v1 delay_js=off lazyload=excluded:3', 'off'],
      ['v1 lazyload=excluded:3', 'excluded']
    ] as const) {
      const pill = pillOf(renderCard(model(marker)));
      const glyph = pill.querySelector<HTMLElement>('[data-fdt-strip-pill-builder]');
      expect(glyph?.dataset['fdtStripPillBuilder'], marker).toBe(kind);
      expect(glyph?.getAttribute('aria-hidden'), marker).toBe('true');
      // Right after the identity (the version), before the status chip.
      expect(glyph?.previousElementSibling?.classList.contains('dw-identity'), marker).toBe(true);
      expect(glyph?.querySelectorAll('svg'), marker).toHaveLength(1);
      // The card badge's own glyph for that kind (lucide circle-off / list-x).
      const paths = Array.from(glyph?.querySelectorAll('path') ?? [], (path) =>
        path.getAttribute('d')
      );
      expect(paths, marker).toContain(kind === 'off' ? 'm2 2 20 20' : 'm15.5 9.5 5 5');
      expect(paths, marker).not.toContain(kind === 'off' ? 'm15.5 9.5 5 5' : 'm2 2 20 20');
      cleanup();
    }
  });

  it('names the rewrite once, right after the version (where the glyph sits)', () => {
    const plain = pillOf(renderCard(model(null)));
    const plainName = spokenText(plain);
    const plainTitle = plain.getAttribute('title');
    cleanup();
    const pill = pillOf(renderCard(model('v1 delay_js=off')));
    expect(BUILDER_PILL_HINT_SPOKEN).toBe(PILL_SUFFIX);
    expect(plainName).toContain('WPR 3.23.5.1');
    expect(spokenText(pill)).toBe(plainName.replace('WPR 3.23.5.1', `WPR 3.23.5.1${PILL_SUFFIX}`));
    expect(spokenText(pill).split('Exclusion Builder')).toHaveLength(2);
    // Words for assistive tech only; the eye reads the glyph.
    expect(visibleText(pill)).not.toContain('Exclusion Builder');
    // One spoken run with the identity (an sr piece of its own would gain a
    // space before the comma in Chromium); the shown identity is hidden, heard once.
    const spoken = pill.querySelector('[data-fdt-strip-pill-builder-spoken]');
    expect(spoken?.textContent).toBe(`WPR 3.23.5.1${PILL_SUFFIX}`);
    expect(spoken?.classList.contains('dw-sr')).toBe(true);
    const shown = pill.querySelector('.dw-identity > [aria-hidden="true"]');
    expect(shown?.textContent).toBe('WPR 3.23.5.1');
    // Never repeated as the pill's description: the tooltip is unchanged.
    expect(pill.getAttribute('title')).toBe(plainTitle);
  });

  it('an untouched page: no glyph, no words', () => {
    const pill = pillOf(renderCard(model(null)));
    expect(pill.querySelector('[data-fdt-strip-pill-builder]')).toBeNull();
    expect(pill.querySelector('[data-fdt-strip-pill-builder-spoken]')).toBeNull();
    expect(pill.textContent).not.toContain('Exclusion Builder');
  });
});
