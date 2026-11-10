/**
 * The "applied despite ?nowprocket" warning on the Detections page: on a
 * bypass URL, each footprint-decided applied card shows the warn badge
 * (alert glyph + short text, hidden from assistive tech) and the visible
 * sentence beside its unchanged "Active" verdict; off a bypass URL nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { BYPASS_APPLIED_COPY } from '../../../../lib/detection/bypass-applied';
import { FIXTURE_DIR } from '../../../../lib/detection/fixtures/corpus';
import { parsePage } from '../../../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../../../lib/detection/run-detection';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { DetectionsView } from './page';

afterEach(cleanup);

/** The panel data of the bypass-render fixture. */
function data(bypass: boolean): FdtData {
  const html = readFileSync(join(FIXTURE_DIR, 'bypass-render.html'), 'utf8');
  const detections = runChecks(parsePage(html));
  applyPresencePropagation(detections);
  return makeFdtData({ wprDetections: detections, ...(bypass ? { bypassAttested: true } : {}) });
}

/** The ids of the cards showing the warning badge. */
function warnedCards(): (string | null)[] {
  return Array.from(
    document.querySelectorAll('[data-fdt-card-bypass-warning]'),
    (badge) => badge.closest('[data-fdt-card-id]')?.getAttribute('data-fdt-card-id') ?? null
  );
}

describe('the bypass warning on the Detections cards', () => {
  it('a bypass URL: badge + visible sentence on each footprint-decided applied card', () => {
    render(() => <DetectionsView data={data(true)} now={0} />);
    expect(warnedCards()).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
    const card = document.querySelector<HTMLElement>('[data-fdt-card-id="minify_js"]');
    const badge = card?.querySelector('[data-fdt-card-bypass-warning]');
    expect(badge?.textContent).toBe(BYPASS_APPLIED_COPY.chip);
    // Word + glyph, never color alone; hidden from assistive tech (the line says it).
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(card?.querySelector('[data-fdt-card-bypass-line]')?.textContent).toContain(
      BYPASS_APPLIED_COPY.sentence
    );
    // The verdict stays WP Rocket's: the feature was applied.
    expect(card?.textContent).toContain('Active');
  });

  it('off a bypass URL: no badge, no sentence', () => {
    render(() => <DetectionsView data={data(false)} now={0} />);
    expect(warnedCards()).toEqual([]);
    expect(document.body.textContent).not.toContain(BYPASS_APPLIED_COPY.sentence);
  });
});
