/**
 * The What's new page's screenshots: one row per image id, declared once
 * here — its alt text, its intrinsic size (the page reserves the box, so a
 * loading image never shifts the layout) and its file format. Every image
 * ships with the extension in both palettes, as
 * `public/whats-new/<id>-<palette>.<format>` (served from the extension
 * root); nothing is ever fetched remotely.
 *
 * Adding a screenshot = its two files + one row here + the id on the
 * highlight that shows it (the registry test checks both files exist).
 */

/** The two palettes every screenshot exists in. */
export const SCREENSHOT_PALETTES = ['light', 'dark'] as const;

/** One palette. */
export type ScreenshotPalette = (typeof SCREENSHOT_PALETTES)[number];

/** The image formats the page bundles. */
export type ScreenshotFormat = 'webp' | 'png';

/** One screenshot's metadata (identical for both palettes). */
export interface ScreenshotMeta {
  /** What the image shows, for readers who cannot see it. */
  readonly alt: string;
  /** Intrinsic width in CSS pixels. */
  readonly width: number;
  /** Intrinsic height in CSS pixels. */
  readonly height: number;
  readonly format: ScreenshotFormat;
}

/**
 * The size every screenshot is shot at (device scale 1): a 1.6:1 frame that
 * fits a card. At this width the panel shows its icon rail, not the labeled
 * sidebar, which leaves the tool's content the room.
 */
const SHOT = { width: 800, height: 500, format: 'webp' } as const;

/**
 * The bundled screenshots, by id (shot by `pnpm screenshots:release` on the
 * real UI); highlights without one render as text-only cards.
 */
export const RELEASE_SCREENSHOTS = {
  'exclusion-builder': {
    ...SHOT,
    alt: 'The Exclusion Builder open over a page, with a Delay JavaScript execution exclusion applied to the live page.'
  },
  'rucss-tester': {
    ...SHOT,
    alt: 'The RUCSS Tester in the panel after a test: the used CSS applied to the page, with what it removed and kept.'
  },
  'beacon-tester': {
    ...SHOT,
    alt: 'The Beacon Tester in the panel after a run, listing what WP Rocket’s beacon found on the page.'
  },
  'detection-widget': {
    ...SHOT,
    alt: 'The detection widget open in the corner of a page: WP Rocket’s version, the cache state and the features the page uses.'
  },
  'toolbar-dot': {
    ...SHOT,
    alt: 'The toolbar icon with a green, a blue and a grey dot, each with the tooltip that names the page’s WP Rocket state.'
  },
  'command-palette': {
    ...SHOT,
    alt: 'The command palette open over a page, listing the on-page actions.'
  }
} as const satisfies Readonly<Record<string, ScreenshotMeta>>;

/** One screenshot id (derived from the table: one declaring site). */
export type ScreenshotId = keyof typeof RELEASE_SCREENSHOTS;

/** The folder (under the extension root) the images are served from. */
export const SCREENSHOT_DIR = 'whats-new';

/** One image as the page renders it. */
export interface ScreenshotSource extends ScreenshotMeta {
  /** The root-relative URL of the palette's file. */
  readonly src: string;
}

/**
 * The served path of one screenshot in one palette.
 *
 * @param id The screenshot id.
 * @param palette The palette shown.
 * @param format The file's format.
 * @returns The path relative to the extension root (no leading slash).
 */
export function screenshotPath(
  id: string,
  palette: ScreenshotPalette,
  format: ScreenshotFormat
): string {
  return `${SCREENSHOT_DIR}/${id}-${palette}.${format}`;
}

/**
 * Resolve one screenshot for the palette on screen.
 *
 * @param id The id a highlight names (absent: the highlight has none).
 * @param palette The resolved palette.
 * @param table The registry (default the bundled one; tests pass their own).
 * @returns The image to render, or null without an id or for one the table does not know.
 */
export function resolveScreenshot(
  id: string | undefined,
  palette: ScreenshotPalette,
  table: Readonly<Record<string, ScreenshotMeta>> = RELEASE_SCREENSHOTS
): ScreenshotSource | null {
  if (id === undefined || !Object.hasOwn(table, id)) return null;
  const meta = table[id];
  if (meta === undefined) return null;
  return { ...meta, src: `/${screenshotPath(id, palette, meta.format)}` };
}
