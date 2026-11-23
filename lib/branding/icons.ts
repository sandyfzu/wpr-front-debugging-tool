/**
 * The extension's icon set — the single declaring site of every icon file the
 * builds ship: its pixel size, how the master mark is laid out in it, and its
 * path. `pnpm icons` renders each row from `branding/icon.svg` into
 * `public/<path>` (WXT copies `public/` as-is and lists `icon/<size>.png` in
 * the manifest's `icons`); the manifest's toolbar button, the devtools panel
 * and the extension pages' favicons read their paths from here.
 *
 * Leaf module with no imports, so the Node generator script can load it under
 * Node's native TypeScript.
 */

/**
 * How the master mark fills an icon:
 * - `full-bleed`: the master as drawn, edge to edge — toolbar sizes, where every
 *   pixel counts next to the badge;
 * - `padded`: the master at {@link PADDED_ART_RATIO} of the canvas, centered,
 *   the rest transparent — the store's icon layout (96 px art in a 128 px
 *   canvas), kept by the larger sizes so the extensions page matches the store.
 */
export type IconLayout = 'full-bleed' | 'padded';

/** One shipped icon file. */
export interface ExtensionIcon {
  /** Width = height, in pixels. */
  readonly size: number;
  /** How the mark fills the canvas. */
  readonly layout: IconLayout;
  /** Path relative to the extension root (and to `public/` in the repo). */
  readonly path: string;
}

/** Share of a padded icon's side the mark spans (96 of 128 px: 16 px transparent per side). */
export const PADDED_ART_RATIO = 0.75;

/** Every shipped icon, smallest first; a size appears once. */
export const EXTENSION_ICONS: readonly ExtensionIcon[] = [
  { size: 16, layout: 'full-bleed', path: 'icon/16.png' },
  { size: 32, layout: 'full-bleed', path: 'icon/32.png' },
  { size: 48, layout: 'padded', path: 'icon/48.png' },
  { size: 96, layout: 'padded', path: 'icon/96.png' },
  { size: 128, layout: 'padded', path: 'icon/128.png' }
];

/** Sizes the toolbar button (and extension-page favicons) use: the full-bleed ones. */
export const TOOLBAR_ICON_SIZES = [16, 32] as const;

/**
 * The shipped icon of one size.
 *
 * @param size Pixel size.
 * @returns Its table row.
 * @throws {@link Error} When no icon of that size ships (a caller naming a size the set lacks).
 */
export function iconOfSize(size: number): ExtensionIcon {
  const icon = EXTENSION_ICONS.find((entry) => entry.size === size);
  if (icon === undefined) throw new Error(`No ${String(size)} px extension icon is declared`);
  return icon;
}

/**
 * The toolbar button's `default_icon` map: pinned to the full-bleed sizes so
 * the browser never picks a padded (store-layout) icon for the toolbar on a
 * high-density display, as it may when it falls back to the manifest `icons`.
 *
 * @returns Size (as the manifest's string key) → extension-root-relative path.
 */
export function toolbarIconMap(): Record<string, string> {
  return Object.fromEntries(
    TOOLBAR_ICON_SIZES.map((size) => [String(size), iconOfSize(size).path])
  );
}
