/**
 * The Exclusion Builder modifier on the Detections page: each card the
 * builder changed carries its modifier badge (icon + short text) and the
 * full sentence as a visible line, spoken once, beside the unchanged served
 * verdict; a fact on a row WP Rocket did not serve shows the modifier alone;
 * the summary strip counts per O-N3; a page with no fact shows nothing.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { runDetection } from '../../../../lib/detection/run-detection';
import { BUILDER_MARKER_META_NAME } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { builderBadgeKind } from './card-presentation';
import { DetectionsView } from './page';

afterEach(cleanup);

/** The generator meta declaring Delay/Defer/LazyLoad as served. */
const DECLARING_GENERATOR =
  '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">';

/**
 * A WP Rocket page with an optional builder marker.
 *
 * @param marker The marker content, or null for none.
 * @param generator The generator meta (default: declares Delay/Defer/LazyLoad).
 */
function data(marker: string | null, generator = DECLARING_GENERATOR): FdtData {
  const note =
    marker === null ? '' : `<meta name="${BUILDER_MARKER_META_NAME}" content="${marker}">`;
  const html = `<!doctype html><html><head>${generator}${note}</head><body><img src="p.gif" data-lazy-src="r.jpg"></body></html>`;
  return makeFdtData({ wprDetections: runDetection(html).detections });
}

/** One card root by id. */
function card(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-fdt-card-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id}`);
  return found;
}

/** A card's modifier badge, or null. */
function modifier(id: string): HTMLElement | null {
  return card(id).querySelector<HTMLElement>('[data-fdt-card-modifier]');
}

/** A card's visible modifier sentence line, or null. */
function modifierLine(id: string): HTMLElement | null {
  return card(id).querySelector<HTMLElement>('[data-fdt-card-modifier-line]');
}

/**
 * The text assistive tech reads for an element: its text content minus
 * every `aria-hidden` subtree (what a link card's accessible name is built of).
 */
function spokenText(root: Node): string {
  if (root instanceof Element && root.getAttribute('aria-hidden') === 'true') return '';
  if (root.nodeType === Node.TEXT_NODE) return root.textContent ?? '';
  return Array.from(root.childNodes, spokenText).join('');
}

/** How often `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The strip's active count text ("N of M optimizations active"). */
function activeLine(): string {
  const strip = document.querySelector<HTMLElement>('[data-fdt-summary-headline]');
  return strip?.textContent ?? '';
}

const MARKED = 'v1 delay_js=off defer_all_js=page-off lazyload=excluded:2';

describe('the modifier on the cards', () => {
  it('states each modifier with an icon, short text and the visible sentence, verdict Active', () => {
    render(() => <DetectionsView data={data(MARKED)} now={0} />);
    const cases: [string, string, string, string][] = [
      ['delay_js', 'off', 'Disabled in this tab', 'Disabled in this tab by the Exclusion Builder.'],
      [
        'defer_all_js',
        'off',
        'Off on this page',
        'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
      ],
      ['lazyload', 'excluded', '2 excluded', '2 images excluded by the Exclusion Builder.']
    ];
    for (const [id, kind, chip, sentence] of cases) {
      const badge = modifier(id);
      expect(badge, id).not.toBeNull();
      expect(badge?.dataset.fdtCardModifier, id).toBe(kind);
      // Never color alone: an icon (decorative) and the visible words.
      expect(badge?.querySelector('svg[aria-hidden="true"]'), id).not.toBeNull();
      expect(badge?.textContent, id).toBe(chip);
      // The full sentence is visible text (never hover-only), not sr-only.
      const line = modifierLine(id);
      expect(line?.textContent, id).toContain(sentence);
      expect(line?.classList.contains('sr-only'), id).toBe(false);
      expect(line?.closest('.sr-only'), id).toBeNull();
      // Neutral secondary text, never the info/accent blue a link reads in.
      expect(line?.classList.contains('text-fg-secondary'), id).toBe(true);
      expect(line?.className, id).not.toMatch(/text-(status-info|accent)\b/);
      expect(badge?.hasAttribute('title'), id).toBe(false);
      // Spoken once: the badge is hidden from assistive tech, the sentence read once.
      const spoken = spokenText(card(id));
      expect(occurrences(spoken, sentence), id).toBe(1);
      expect(occurrences(spoken, chip), id).toBe(sentence.includes(chip) ? 1 : 0);
      // The served verdict is unchanged.
      expect(card(id).textContent, id).toContain('Active');
    }
  });

  it('adds no tab stop and nothing interactive inside a link card', () => {
    render(() => <DetectionsView data={data(MARKED)} now={0} />);
    const badge = modifier('delay_js');
    expect(card('delay_js').tagName).toBe('A');
    expect(badge?.querySelector('a, button, [tabindex]')).toBeNull();
    expect(badge?.closest('[tabindex]')).toBeNull();
  });

  it('shows no modifier on a page with no builder fact', () => {
    render(() => <DetectionsView data={data(null)} now={0} />);
    expect(document.querySelectorAll('[data-fdt-card-modifier]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-fdt-card-modifier-line]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Exclusion Builder');
  });

  it('shows the modifier alone on a row WP Rocket did not serve (no source, no why)', () => {
    // A generator meta without `data-wpr-features`: no meta evidence, and no
    // footprint either — the card has no source chip and no why, so only the
    // fact can open its evidence line.
    render(() => (
      <DetectionsView
        data={data('v1 delay_js=off', '<meta name="generator" content="WP Rocket 3.23.5.1">')}
        now={0}
      />
    ));
    const delay = card('delay_js');
    expect(delay.querySelector('[data-fdt-card-source]')).toBeNull();
    expect(delay.querySelector('[data-fdt-card-why]')).toBeNull();
    expect(delay.querySelector('[data-fdt-card-evidence]')).not.toBeNull();
    expect(modifier('delay_js')?.textContent).toBe('Disabled in this tab');
    expect(modifierLine('delay_js')?.textContent).toContain(
      'Disabled in this tab by the Exclusion Builder.'
    );
    expect(delay.textContent).toContain('Not active');
    expect(delay.textContent).not.toMatch(/served/i);
  });

  it('maps every fact to its badge kind', () => {
    expect(builderBadgeKind({ off: 'feature' })).toBe('off');
    expect(builderBadgeKind({ off: 'page' })).toBe('off');
    expect(builderBadgeKind({ excluded: 1 })).toBe('excluded');
  });
});

describe('the summary strip counts (O-N3)', () => {
  it('counts Delay off and Defer page-off as inactive, Lazyload excluded as active', () => {
    render(() => <DetectionsView data={data(null)} now={0} />);
    const plain = activeLine();
    cleanup();
    render(() => <DetectionsView data={data(MARKED)} now={0} />);
    const marked = activeLine();
    const count = (line: string): number => Number(/(\d+)\s*of/.exec(line)?.[1] ?? Number.NaN);
    expect(Number.isInteger(count(plain)) && count(plain) >= 3).toBe(true);
    expect(count(marked)).toBe(count(plain) - 2);
    // The gap's reason: Delay off + Defer page-off; the excluded rows do not count.
    expect(marked).toMatch(/optimizations active, 2 off in this tab$/);
    expect(plain).not.toContain('off in this tab');
  });
});
