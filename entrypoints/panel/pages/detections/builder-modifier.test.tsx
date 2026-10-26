/**
 * The Exclusion Builder modifier on the Detections page: each card the
 * builder changed carries its modifier badge (icon + text, the sentence
 * spoken and as the native title) beside the unchanged served verdict;
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

/** A WP Rocket page declaring Delay/Defer/LazyLoad, with an optional builder marker. */
function data(marker: string | null): FdtData {
  const note =
    marker === null ? '' : `<meta name="${BUILDER_MARKER_META_NAME}" content="${marker}">`;
  const html = `<!doctype html><html><head><meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">${note}</head><body><img src="p.gif" data-lazy-src="r.jpg"></body></html>`;
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

/** The strip's active count text ("N of M optimizations active"). */
function activeLine(): string {
  const strip = document.querySelector<HTMLElement>('[data-fdt-summary-headline]');
  return strip?.textContent ?? '';
}

const MARKED = 'v1 delay_js=off defer_all_js=page-off lazyload=excluded:2';

describe('the modifier badge on the cards', () => {
  it('states each modifier with an icon and text, the verdict staying Active', () => {
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
      expect(badge?.textContent, id).toContain(chip);
      // The full sentence for assistive tech and as the native title.
      expect(badge?.querySelector('.sr-only:last-child')?.textContent, id).toBe(`: ${sentence}`);
      expect(badge?.title, id).toBe(sentence);
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
    expect(document.body.textContent).not.toContain('Exclusion Builder');
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
  });
});
