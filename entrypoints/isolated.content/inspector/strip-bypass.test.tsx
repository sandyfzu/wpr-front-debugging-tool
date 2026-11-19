/**
 * The "applied despite ?nowprocket" warning on the detection widget: the
 * bypass render's footprint-decided rows carry the warn modifier (alert
 * badge + visible sentence, the panel card's words) over an unchanged chip,
 * read from the snapshot's own bypass-render flag — so a stamped copy (whose
 * cache state hides the request) still warns; nothing off a bypass render or
 * on a simulated row — in the model, the hub-read mapping and the rendered
 * widget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { BYPASS_APPLIED_COPY } from '../../../lib/detection/bypass-applied';
import { cacheStateForPage } from '../../../lib/detection/cache-context';
import { FIXTURE_DIR } from '../../../lib/detection/fixtures/corpus';
import { hudFeatureOf, readHudFeature } from '../../../lib/detection/hud';
import { describeDetections } from '../../../lib/detection/describe';
import { parsePage } from '../../../lib/detection/parse-page';
import { applyPresencePropagation, runChecks } from '../../../lib/detection/run-detection';
import { withSimulationMarker } from '../../../lib/detection/simulated-pages.fixtures';
import type { WprDetections } from '../../../lib/wp-rocket/types';
import type { PageDataSnapshot } from '../data-hub';
import {
  buildStripCardModel,
  readySnapshot,
  STRIP_BYPASS_MODIFIER,
  stripRow,
  type StripCardModel,
  type StripCardRow
} from './strip-state';
import { BYPASS_APPLIED_ICON, MODIFIER_ICONS } from './icons';
import { InspectorView } from './ui';

afterEach(cleanup);

/** A fixture page's rows, with the simulated features the background vouched for. */
function detect(name: string, marked = false, verified = false): WprDetections {
  const html = readFileSync(join(FIXTURE_DIR, name), 'utf8');
  const detections = runChecks(
    parsePage(marked ? withSimulationMarker(html) : html),
    verified ? ['delay_js'] : []
  );
  applyPresencePropagation(detections);
  return detections;
}

/** The widget model of a page, with or without the bypass-render flag. */
function model(detections: WprDetections, bypassRender?: boolean): StripCardModel {
  return buildStripCardModel({
    snapshot: {
      phase: 'ready',
      detections,
      cacheState: cacheStateForPage({
        wpr: detections.wpr,
        headers: null,
        bypassAttested: bypassRender === true
      }),
      ...(bypassRender === undefined ? {} : { bypassRender })
    },
    wordpressVersion: null,
    fdtVersion: '0.0.0'
  });
}

/** The ids of the rows carrying the warning. */
function warned(card: StripCardModel): string[] {
  return card.groups
    .flatMap((group) => group.rows)
    .filter((row) => row.bypass !== null)
    .map((row) => row.id);
}

const BYPASS_RENDER = detect('bypass-render.html');

/** Render the open card; returns its root. */
function renderCard(card: StripCardModel): HTMLElement {
  const noop = (): void => undefined;
  const { container } = render(() => (
    <InspectorView
      model={() => card}
      mood={() => 'amber'}
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
  it('a bypass render warns its footprint-decided applied rows, chips unchanged', () => {
    const card = model(BYPASS_RENDER, true);
    expect(warned(card)).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
    const plain = model(BYPASS_RENDER, false);
    // Nulling the warning leaves exactly the plain rows: a pure modifier.
    const unwarned = (c: StripCardModel): StripCardRow[] =>
      c.groups.flatMap((group) => group.rows.map((row) => ({ ...row, bypass: null })));
    expect(unwarned(card)).toEqual(unwarned(plain));
  });

  it('the modifier is the shared copy with the warning kind', () => {
    expect(STRIP_BYPASS_MODIFIER).toEqual({ kind: 'bypass-applied', ...BYPASS_APPLIED_COPY });
  });

  it('no flag (absent or false) warns nothing', () => {
    expect(warned(model(BYPASS_RENDER))).toEqual([]);
    expect(warned(model(BYPASS_RENDER, false))).toEqual([]);
  });

  it('reads the flag, not the cache state: a stamped copy of a bypass render still warns', () => {
    const stamped: WprDetections = {
      ...BYPASS_RENDER,
      wpr: { ...BYPASS_RENDER.wpr, cached: true, cacheMarkerFound: true, timeStamp: 1_700_000_000 }
    };
    const card = model(stamped, true);
    expect(card.cacheChip?.state).toBe('ok');
    expect(warned(card)).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
  });

  it('a meta-decided page on a bypass URL warns nothing', () => {
    expect(warned(model(detect('me-home-cached.html'), true))).toEqual([]);
  });

  it.each([true, false])('a simulated row never warns (verified=%s)', (verified) => {
    const card = model(detect('delay-on-no-meta.html', true, verified), true);
    expect(warned(card)).not.toContain('delay_js');
    expect(warned(card)).toEqual(['minify_css', 'minify_js', 'lazyload']);
  });

  it('stripRow defaults to no warning', () => {
    const feature = hudFeatureOf('minify_js');
    if (feature === undefined) throw new Error('no Minify JS row');
    const reading = readHudFeature(feature, describeDetections(BYPASS_RENDER), BYPASS_RENDER);
    expect(stripRow(feature, reading).bypass).toBeNull();
    expect(stripRow(feature, reading, true).bypass).toBe(STRIP_BYPASS_MODIFIER);
  });
});

describe('the hub-read snapshot', () => {
  /** A hub read of the bypass render with the given URL and meta facts. */
  function read(bypassAttested: boolean, wprGeneratorMeta: boolean): PageDataSnapshot {
    const cacheState = cacheStateForPage({ wpr: BYPASS_RENDER.wpr, headers: null, bypassAttested });
    return {
      data: {
        detections: BYPASS_RENDER,
        preloadedResources: { present: false },
        wordpressVersion: null,
        wprGeneratorMeta,
        servedScriptTags: []
      },
      cacheState,
      bypassAttested
    };
  }

  it('carries the rows and the cache answer as read', () => {
    const hub = read(true, false);
    expect(readySnapshot(hub)).toEqual({
      phase: 'ready',
      detections: BYPASS_RENDER,
      cacheState: hub.cacheState,
      bypassRender: true
    });
  });

  it.each<[boolean, boolean, boolean]>([
    [true, false, true],
    // A generator meta (degraded included) means WP Rocket rendered normally.
    [true, true, false],
    [false, false, false],
    [false, true, false]
  ])('bypass URL %s + generator meta %s → bypass render %s', (bypass, meta, expected) => {
    const snapshot = readySnapshot(read(bypass, meta));
    expect(snapshot.bypassRender).toBe(expected);
    const card = buildStripCardModel({ snapshot, wordpressVersion: null, fdtVersion: '0.0.0' });
    expect(warned(card)).toEqual(expected ? ['defer_all_js', 'minify_js', 'lazyload'] : []);
  });
});

describe('the rendered widget', () => {
  it('draws the alert badge (hidden from AT) and the visible sentence; no row tooltip', () => {
    const root = renderCard(model(BYPASS_RENDER, true));
    const badges = root.querySelectorAll('[data-fdt-strip-modifier="bypass-applied"]');
    expect(badges).toHaveLength(3);
    const badge = badges[0];
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.textContent).toBe(BYPASS_APPLIED_COPY.chip);
    expect(pathsOf(badge)).toEqual(BYPASS_APPLIED_ICON.paths);
    const row = badge?.closest('.ins-row');
    expect(row?.querySelector('[data-fdt-strip-modifier-line]')?.textContent).toContain(
      BYPASS_APPLIED_COPY.sentence
    );
    expect(row?.hasAttribute('title')).toBe(false);
  });

  it('off a bypass URL: no badge, and the rows keep their tooltip', () => {
    const root = renderCard(model(BYPASS_RENDER, false));
    expect(root.querySelector('[data-fdt-strip-modifier]')).toBeNull();
    expect(root.textContent).not.toContain(BYPASS_APPLIED_COPY.chip);
  });
});

describe('the warning glyph', () => {
  it('is the panel badge’s lucide geometry, verbatim', () => {
    expect(MODIFIER_ICONS['bypass-applied']).toBe(BYPASS_APPLIED_ICON);
    const alert = render(() => <TriangleAlert />).container;
    expect(pathsOf(alert)).toEqual(BYPASS_APPLIED_ICON.paths);
  });
});
