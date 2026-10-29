/**
 * The simulation modifier on the Detections page: a verified simulation
 * shows its badge (flask glyph + "Simulated in this tab") and its sentence
 * beside the not-served verdict; an unverified marker shows its own badge
 * (shield glyph) and sentence beside the served verdict; the summary
 * headline adds the matching suffix; a page without a marker shows nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../../lib/detection/fixtures/corpus';
import { parsePage } from '../../../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../../../lib/detection/run-detection';
import { withSimulationMarker } from '../../../../lib/detection/simulated-pages.fixtures';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { DetectionsView } from './page';

afterEach(cleanup);

const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

/**
 * The panel data of the Delay-on fixture.
 *
 * @param marked Whether the page carries the simulation marker.
 * @param verified Whether the background vouched for it.
 */
function data(marked: boolean, verified: boolean): FdtData {
  const html = marked ? withSimulationMarker(DELAY_ON_NO_META) : DELAY_ON_NO_META;
  const detections = runChecks(parsePage(html), verified ? ['delay_js'] : []);
  applyPresencePropagation(detections);
  return makeFdtData({ wprDetections: detections });
}

/** The Delay JS card root. */
function delayCard(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt-card-id="delay_js"]');
  if (found === null) throw new Error('no Delay JS card');
  return found;
}

/** The summary headline's text. */
function headline(): string {
  return document.querySelector('[data-fdt-summary-headline]')?.textContent ?? '';
}

describe('the simulation modifier on the Delay JS card', () => {
  it.each([
    [true, 'simulated', 'Simulated in this tab', 'Not active', 'lucide-flask-conical'],
    [false, 'unverified', 'Simulation not verified', 'Active', 'lucide-shield-question-mark']
  ] as const)(
    'verified=%s: badge %s with its own glyph, the visible sentence, the verdict %s',
    (verified, fact, chip, verdict, glyph) => {
      render(() => <DetectionsView data={data(true, verified)} now={0} />);
      const card = delayCard();
      const badge = card.querySelector<HTMLElement>('[data-fdt-card-simulation]');
      expect(badge?.dataset.fdtCardSimulation).toBe(fact);
      expect(badge?.textContent).toBe(chip);
      // Word + glyph, never color alone; hidden from assistive tech (the line says it).
      expect(badge?.getAttribute('aria-hidden')).toBe('true');
      expect(badge?.querySelector(`svg.${glyph}`)).not.toBeNull();
      const line = card.querySelector('[data-fdt-card-simulation-line]');
      expect(line?.textContent).toContain(
        verified
          ? "Simulated in this tab by the extension — not the site's configuration."
          : "This page claims a simulation the extension can't confirm, so it's read as served."
      );
      expect(card.textContent).toContain(verdict);
    }
  );

  it('no marker: no simulation badge or line, no summary suffix', () => {
    render(() => <DetectionsView data={data(false, false)} now={0} />);
    expect(delayCard().querySelector('[data-fdt-card-simulation]')).toBeNull();
    expect(delayCard().querySelector('[data-fdt-card-simulation-line]')).toBeNull();
    expect(document.querySelector('[data-fdt-summary-simulation]')).toBeNull();
  });
});

describe('the summary headline', () => {
  it('adds "1 simulated in this tab" for a verified simulation', () => {
    render(() => <DetectionsView data={data(true, true)} now={0} />);
    const parts = Array.from(
      document.querySelectorAll('[data-fdt-summary-simulation]'),
      (node) => node.textContent
    );
    expect(parts).toEqual([', 1 simulated in this tab']);
    expect(headline()).toContain('1 simulated in this tab');
  });

  it('adds "simulation not verified" for an unverified marker', () => {
    render(() => <DetectionsView data={data(true, false)} now={0} />);
    expect(headline()).toContain('simulation not verified');
    expect(headline()).not.toContain('simulated in this tab');
  });
});
