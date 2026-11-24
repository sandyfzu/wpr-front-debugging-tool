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
 * The bundled screenshots, by id. Empty until the shared capture run shoots
 * the shipped UI; highlights without one render as text-only cards.
 */
export const RELEASE_SCREENSHOTS = {} as const satisfies Readonly<Record<string, ScreenshotMeta>>;

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
