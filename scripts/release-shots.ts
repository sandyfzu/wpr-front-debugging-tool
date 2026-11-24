/**
 * The release screenshot plan: every image `pnpm screenshots:release` shoots,
 * declared once — the What's new highlights (both palettes, the page's
 * registry gives each one's size and format), the store set (one palette,
 * 640×400 CSS shot at 2×: the stores' shared 1280×800) and the README (which embeds store files, so
 * it adds no image of its own). The capture run (`tests/e2e/capture/`) maps
 * each target's stage to the real shipped surface it stages.
 *
 * Pure data and helpers: no browser, no file system.
 */
import {
  RELEASE_SCREENSHOTS,
  SCREENSHOT_PALETTES,
  screenshotPath,
  type ScreenshotFormat,
  type ScreenshotId,
  type ScreenshotPalette
} from '../lib/release-notes/screenshots';
import { CACHE_TIMESTAMP_PATTERN } from '../lib/wp-rocket/constants';

/** Every staged surface a target can show. */
export const STAGE_IDS = [
  'detections',
  'exclusion-builder',
  'detection-widget',
  'command-palette',
  'rucss-tester',
  'beacon-tester',
  'toolbar-dot',
  'options'
] as const;

/** One staged surface. */
export type StageId = (typeof STAGE_IDS)[number];

/** A viewport in CSS pixels (the image is this × the target's device scale). */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** One image the run writes. */
export interface CaptureTarget {
  readonly stage: StageId;
  readonly palette: ScreenshotPalette;
  readonly viewport: Viewport;
  /** Device pixels per CSS pixel (the browser the target is shot in). */
  readonly scale: number;
  /** Repository-relative output path. */
  readonly file: string;
  readonly format: ScreenshotFormat;
}

/**
 * The stage behind each What's new screenshot id. Typed over the registry's
 * ids, so a registry row without a stage (or a stray stage) fails to compile.
 */
export const WHATS_NEW_STAGES: Readonly<Record<ScreenshotId, StageId>> = {
  'exclusion-builder': 'exclusion-builder',
  'rucss-tester': 'rucss-tester',
  'beacon-tester': 'beacon-tester',
  'detection-widget': 'detection-widget',
  'toolbar-dot': 'toolbar-dot',
  'command-palette': 'command-palette'
};

/**
 * The store screenshots' CSS viewport. Chrome Web Store takes 1280×800 or
 * 640×400 but shows every screenshot downscaled to 640×400, AMO recommends
 * 1280×800 and Edge takes 640×480 or 1280×800: the UI is laid out at
 * 640×400 and shot at {@link STORE_SCALE}, so the files are 1280×800 (one
 * set fits all) and their text survives the downscale at its laid-out size.
 */
export const STORE_VIEWPORT: Viewport = { width: 640, height: 400 };

/** The store set's device scale (image = {@link STORE_VIEWPORT} × 2 = 1280×800). */
export const STORE_SCALE = 2;

/** The What's new set's device scale: the registry's box is the image, pixel for pixel. */
export const WHATS_NEW_SCALE = 1;

/** One palette for the whole store set (a listing reads as one product). */
export const STORE_PALETTE: ScreenshotPalette = 'light';

/** Where the store set is written (never shipped: outside `public/`). */
export const STORE_DIR = 'store/screenshots';

/**
 * The store set, best first: Chrome Web Store shows the first five, Edge up
 * to six, AMO all. File names carry the order.
 */
export const STORE_SHOTS: readonly { readonly name: string; readonly stage: StageId }[] = [
  { name: '01-detections', stage: 'detections' },
  { name: '02-exclusion-builder', stage: 'exclusion-builder' },
  { name: '03-detection-widget', stage: 'detection-widget' },
  { name: '04-rucss-tester', stage: 'rucss-tester' },
  { name: '05-beacon-tester', stage: 'beacon-tester' },
  { name: '06-command-palette', stage: 'command-palette' },
  { name: '07-options', stage: 'options' }
];

/** The folder (repository-relative) the extension copies to its root as-is. */
export const PUBLIC_DIR = 'public';

/**
 * Lossy WebP quality for the What's new images: UI text stays crisp at 0.9,
 * at a fraction of the PNG's bytes (the run prints both sizes per image).
 */
export const WEBP_QUALITY = 0.9;

/**
 * Every image of a run: the What's new targets (each registry id × both
 * palettes, sized and formatted by its row) then the store set.
 *
 * @param table The What's new registry (default the bundled one; tests pass their own).
 * @param stages The stage per registry id.
 * @returns The targets, What's new first, in registry then palette order.
 * @throws {Error} Naming an id the stage map lacks.
 */
export function captureTargets(
  table: Readonly<
    Record<string, { width: number; height: number; format: ScreenshotFormat }>
  > = RELEASE_SCREENSHOTS,
  stages: Readonly<Record<string, StageId>> = WHATS_NEW_STAGES
): CaptureTarget[] {
  const whatsNew = Object.entries(table).flatMap(([id, meta]) => {
    const stage = stages[id];
    if (stage === undefined) throw new Error(`What's new screenshot "${id}" has no stage`);
    return SCREENSHOT_PALETTES.map((palette) => ({
      stage,
      palette,
      viewport: { width: meta.width, height: meta.height },
      scale: WHATS_NEW_SCALE,
      file: `${PUBLIC_DIR}/${screenshotPath(id, palette, meta.format)}`,
      format: meta.format
    }));
  });
  const store = STORE_SHOTS.map(({ name, stage }) => ({
    stage,
    palette: STORE_PALETTE,
    viewport: STORE_VIEWPORT,
    scale: STORE_SCALE,
    file: `${STORE_DIR}/${name}.png`,
    format: 'png' as const
  }));
  return [...whatsNew, ...store];
}

/**
 * Narrow a run to some stages (`SHOTS_STAGES=a,b`), for a quick re-shoot of
 * one surface after a UI change.
 *
 * @param targets Every target.
 * @param filter The comma-separated stage ids, or undefined/empty for all.
 * @returns The selected targets.
 * @throws {Error} Naming an unknown stage id.
 */
export function selectTargets(
  targets: readonly CaptureTarget[],
  filter: string | undefined
): CaptureTarget[] {
  if (filter === undefined || filter.trim() === '') return [...targets];
  const wanted = filter
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const unknown = wanted.filter((id) => !(STAGE_IDS as readonly string[]).includes(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown stage(s): ${unknown.join(', ')} (known: ${STAGE_IDS.join(', ')})`);
  }
  return targets.filter((target) => wanted.includes(target.stage));
}

/**
 * The instant every extension page of a run reads as "now" (2026-11-20
 * 10:15 UTC): relative ages ("7 min ago", "just now") come out the same on
 * every run.
 */
export const FROZEN_NOW_MS = Date.UTC(2026, 10, 20, 10, 15, 0);

/** How old the frozen cache stamp reads against {@link FROZEN_NOW_MS}. */
export const FROZEN_CACHE_AGE_MS = 7 * 60_000;

/**
 * Pin WP Rocket's cache stamp (the footer's `cached@<epoch seconds>`) in a
 * served page: the cached copy's real stamp is the moment the run warmed it,
 * so every run would show another time. Only the stamp's digits change.
 *
 * @param html The served HTML.
 * @param seconds The stamp to show, in epoch seconds.
 * @returns The HTML with every stamp replaced (unchanged without one).
 * @throws {Error} When `seconds` is not a non-negative integer.
 */
export function freezeCacheStamp(html: string, seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error(`A cache stamp is whole epoch seconds, got ${String(seconds)}`);
  }
  const stamps = new RegExp(CACHE_TIMESTAMP_PATTERN.source, 'g');
  // The shared pattern captures any token after `cached@`; only a digit run is a stamp.
  return html.replace(stamps, (match: string, token: string) =>
    /^\d+$/.test(token) ? `${match.slice(0, -token.length)}${String(seconds)}` : match
  );
}

/**
 * The page the site-facing shots show: a tidy, ordinary page (the fixture
 * pages carry test-only copy), created for the run and deleted after it.
 * WP Rocket optimizes and caches it like any page; the theme's navigation
 * block (a delayed module script) is what the Exclusion Builder shot excludes.
 */
export const SHOWCASE_PAGE = {
  slug: 'spring-menu',
  title: 'Spring menu notes',
  html: [
    '<p>Our kitchen changes its menu with the seasons. This page collects what is new this spring, what stays, and what the team is still testing before it reaches the tables.</p>',
    '<h2>New this season</h2>',
    '<ul><li>Asparagus with brown butter and toasted hazelnuts</li><li>Wild garlic risotto</li><li>Rhubarb tart with vanilla cream</li></ul>',
    '<img src="/wp-content/mu-plugins/assets/fdt-lcp.png" alt="Spring vegetables on the pass" width="320" height="180">',
    '<h2>Still on the menu</h2>',
    '<p>The sourdough, the slow-cooked beans and the lemon cake stay, by popular demand.</p>',
    '<h2>Opening hours</h2>',
    '<p>Tuesday to Sunday, from noon to ten. Booking is recommended at weekends.</p>'
  ].join('\n')
} as const;

/** One toolbar state as the browser renders it for a tab. */
export interface ToolbarState {
  /** The badge text (the dot glyph). */
  readonly text: string;
  /** The badge text color, RGBA 0–255. */
  readonly color: readonly number[];
  /** The button's tooltip. */
  readonly title: string;
}

/** Browser-chrome colors of the toolbar mock (not extension tokens: the browser draws this). */
const TOOLBAR_CHROME: Readonly<
  Record<
    ScreenshotPalette,
    { page: string; bar: string; box: string; text: string; tip: string; tipText: string }
  >
> = {
  light: {
    page: '#dee1e6',
    bar: '#ffffff',
    box: '#f1f3f4',
    text: '#5f6368',
    tip: '#3c4043',
    tipText: '#ffffff'
  },
  dark: {
    page: '#1f2023',
    bar: '#35363a',
    box: '#202124',
    text: '#9aa0a6',
    tip: '#e8eaed',
    tipText: '#202124'
  }
};

/**
 * Escape text for HTML content and attribute values.
 *
 * @param text Any text.
 * @returns The escaped text.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * A CSS color from the badge API's RGBA answer.
 *
 * @param color Four 0–255 channels.
 * @returns `rgb(r g b / a)`.
 * @throws {Error} When the answer is not four 0–255 integers.
 */
export function badgeCssColor(color: readonly number[]): string {
  if (color.length !== 4 || !color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    throw new Error(`Badge color must be four 0–255 channels, got ${JSON.stringify(color)}`);
  }
  const [r, g, b, a] = color as [number, number, number, number];
  return `rgb(${String(r)} ${String(g)} ${String(b)} / ${String(Math.round((a / 255) * 100) / 100)})`;
}

/**
 * The toolbar mock: one browser toolbar per state (an address box, the
 * extension's toolbar button with its badge, the tooltip under it), drawn
 * 2× so the dot reads. Headless Chromium has no toolbar to capture, so the
 * page is assembled from what the extension really sets: its toolbar icon
 * file, and each state's badge text, color and tooltip as `chrome.action`
 * answers them for a real tab.
 *
 * @param states The states, top to bottom (at least one).
 * @param palette The browser theme drawn.
 * @param iconSrc The toolbar icon (a data URL of the shipped PNG).
 * @param address The address box text (the tabs' site).
 * @returns A full HTML document.
 * @throws {Error} When no state is given.
 */
export function toolbarMockHtml(
  states: readonly ToolbarState[],
  palette: ScreenshotPalette,
  iconSrc: string,
  address: string
): string {
  if (states.length === 0) throw new Error('The toolbar mock needs at least one state');
  const c = TOOLBAR_CHROME[palette];
  const rows = states
    .map(
      (state) => `<div class="row">
  <div class="bar">
    <div class="address">${escapeHtml(address)}</div>
    <div class="button"><img src="${escapeHtml(iconSrc)}" alt="" width="32" height="32"><span class="badge" style="color:${badgeCssColor(state.color)}">${escapeHtml(state.text)}</span></div>
  </div>
  <div class="tip">${escapeHtml(state.title)}</div>
</div>`
    )
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:${c.page};font:15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;gap:28px;padding:0 48px}
.row{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.bar{width:100%;height:72px;background:${c.bar};border-radius:14px;display:flex;align-items:center;gap:20px;padding:0 20px}
.address{flex:1;height:48px;border-radius:24px;background:${c.box};color:${c.text};display:flex;align-items:center;padding:0 24px;font-size:17px}
.button{position:relative;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:${c.box}}
.button img{display:block;width:32px;height:32px}
.badge{position:absolute;right:4px;bottom:2px;font:700 20px/1 system-ui,sans-serif}
.tip{background:${c.tip};color:${c.tipText};border-radius:8px;padding:8px 14px;font-size:15px;margin-right:4px}
</style></head><body>
${rows}
</body></html>`;
}
