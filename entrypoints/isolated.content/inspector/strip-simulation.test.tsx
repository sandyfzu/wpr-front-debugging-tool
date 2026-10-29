/**
 * The simulation on the detection widget: the Delay JS row's simulation
 * modifier (badge + visible sentence, the panel card's words) for both
 * facts, the tab-level line and the closed pill's flask glyph for a verified
 * simulation only, nothing on a page without a marker — in the model and
 * in the rendered widget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import FlaskConical from 'lucide-solid/icons/flask-conical';
import ShieldQuestionMark from 'lucide-solid/icons/shield-question-mark';
import { cacheStateForPage } from '../../../lib/detection/cache-context';
import { FIXTURE_DIR } from '../../../lib/detection/fixtures/corpus';
import { parsePage } from '../../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../../lib/detection/run-detection';
import { withSimulationMarker } from '../../../lib/detection/simulated-pages.fixtures';
import { buildStripCardModel, type StripCardModel, type StripCardRow } from './strip-state';
import { SIMULATED_ICON, UNVERIFIED_ICON } from './icons';
import { InspectorView } from './ui';

afterEach(cleanup);

const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

/**
 * The widget model of the Delay-on fixture.
 *
 * @param marked Whether the page carries the simulation marker.
 * @param verified Whether the background vouched for it.
 */
function model(marked: boolean, verified: boolean): StripCardModel {
  const html = marked ? withSimulationMarker(DELAY_ON_NO_META) : DELAY_ON_NO_META;
  const detections = runChecks(parsePage(html), verified ? ['delay_js'] : []);
  applyPresencePropagation(detections);
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

/** The Delay JS row of a model. */
function delayRow(card: StripCardModel): StripCardRow {
  const found = card.groups.flatMap((group) => group.rows).find((row) => row.id === 'delay_js');
  if (found === undefined) throw new Error('no Delay JS row');
  return found;
}

/** Render the open card; returns its root. */
function renderCard(card: StripCardModel): HTMLElement {
  const noop = (): void => undefined;
  const { container } = render(() => (
    <InspectorView
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

/** The `d` of every path under an element. */
function pathsOf(element: Element | null | undefined): (string | null)[] {
  return Array.from(element?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d'));
}

describe('the widget model', () => {
  it('verified: the row modifier, the tab line hint and the flask pill', () => {
    const card = model(true, true);
    expect(delayRow(card)).toMatchObject({
      chipState: 'neutral',
      modifier: null,
      simulation: {
        kind: 'simulated',
        chip: 'Simulated in this tab',
        sentence: "Simulated in this tab by the extension — not the site's configuration."
      }
    });
    expect(card.builderLine?.hints).toEqual(['Delay JS simulated']);
    expect(card.builderPill).toBe('simulated');
  });

  it('unverified: the served chip with the not-verified modifier, no tab line, no pill glyph', () => {
    const card = model(true, false);
    expect(delayRow(card)).toMatchObject({
      chipState: 'ok',
      simulation: {
        kind: 'unverified',
        chip: 'Simulation not verified',
        sentence:
          "This page claims a simulation the extension can't confirm, so it's read as served."
      }
    });
    expect(card.builderLine).toBeNull();
    expect(card.builderPill).toBeNull();
  });

  it('no marker: no simulation anywhere', () => {
    const card = model(false, false);
    expect(delayRow(card).simulation).toBeNull();
    expect(card.builderLine).toBeNull();
    expect(card.builderPill).toBeNull();
  });
});

describe('the rendered widget', () => {
  it.each([
    [true, 'simulated', SIMULATED_ICON],
    [false, 'unverified', UNVERIFIED_ICON]
  ] as const)(
    'verified=%s: the %s badge with its own glyph and the visible sentence',
    (verified, kind, icon) => {
      const root = renderCard(model(true, verified));
      const badge = root.querySelector(`[data-fdt-strip-modifier="${kind}"]`);
      expect(badge?.getAttribute('aria-hidden')).toBe('true');
      expect(pathsOf(badge)).toEqual(icon.paths);
      const row = badge?.closest('.ins-row');
      expect(row?.querySelector('[data-fdt-strip-modifier-line]')?.textContent).toContain(
        verified ? "not the site's configuration" : 'read as served'
      );
      // The sentence is visible: the row's tooltip would repeat it.
      expect(row?.hasAttribute('title')).toBe(false);
    }
  );

  it('verified: the pill draws the flask after the version; the tab line names the simulation', () => {
    const root = renderCard(model(true, true));
    const glyph = root.querySelector('.ins-pill [data-fdt-strip-pill-builder]');
    expect(glyph?.getAttribute('data-fdt-strip-pill-builder')).toBe('simulated');
    expect(pathsOf(glyph)).toEqual(SIMULATED_ICON.paths);
    expect(root.querySelector('[data-fdt-strip-builder]')?.textContent).toContain(
      'Delay JS simulated'
    );
  });

  it('no marker: no simulation badge, line or glyph', () => {
    const root = renderCard(model(false, false));
    expect(root.querySelector('[data-fdt-strip-modifier]')).toBeNull();
    expect(root.querySelector('[data-fdt-strip-pill-builder]')).toBeNull();
    expect(root.textContent).not.toMatch(/simulat/i);
  });
});

describe('the simulation glyphs', () => {
  it('are the panel badges’ lucide geometry, verbatim', () => {
    const flask = render(() => <FlaskConical />).container;
    expect(pathsOf(flask)).toEqual(SIMULATED_ICON.paths);
    cleanup();
    const shield = render(() => <ShieldQuestionMark />).container;
    expect(pathsOf(shield)).toEqual(UNVERIFIED_ICON.paths);
  });
});
