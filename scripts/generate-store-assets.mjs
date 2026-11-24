#!/usr/bin/env node
/**
 * Store listing image generator: renders every non-screenshot listing image
 * of {@link STORE_ASSETS} from the master mark `branding/icon.svg` into
 * `store/assets/` (never shipped: the store zips are built from the build
 * output, and the Firefox sources zip excludes `store/`).
 *
 * Two kinds of image:
 * - `icon`: the master in an icon layout (`lib/branding/icons.ts`), exactly
 *   as `pnpm icons` renders it — a store icon is the extension icon;
 * - `tile`: a promotional tile — the mark centered on a canvas filled with
 *   the mark's own tile color, no text (the stores' tile guidance asks for
 *   brand imagery that fills the region and avoids text).
 *
 * `pnpm store:assets` writes the files; `--check` renders in memory and exits
 * non-zero naming every committed image that is missing or differs. Local
 * tool like `pnpm icons` (native-renderer bytes), never a CI gate.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PADDED_ART_RATIO } from '../lib/branding/icons.ts';
import {
  MASTER_PATH,
  driftProblems,
  layoutSvg,
  packageRoot,
  parseArgs,
  parseViewBox,
  readIfPresent,
  readMaster,
  resvgRender
} from './generate-icons.mjs';

/** Where the listing images live, relative to the package root. */
export const STORE_ASSETS_DIR = 'store/assets';

/** The command the usage line names. */
const COMMAND = 'pnpm store:assets';

/**
 * @typedef {{ kind: 'icon', file: string, size: number, layout: 'full-bleed' | 'padded' }} StoreIcon
 *   A store icon: square, `size` px, the master in an icon layout.
 * @typedef {{ kind: 'tile', file: string, width: number, height: number, markShare: number }} StoreTile
 *   A promotional tile: the mark's side spans `markShare` of the tile's height.
 * @typedef {StoreIcon | StoreTile} StoreAsset One listing image.
 */

/**
 * Every listing image, one row per distinct file (a file several stores take
 * is listed once; `store/README.md` maps stores to files). Sizes are the
 * stores' own (that checklist cites each spec with its source and date).
 *
 * @type {readonly StoreAsset[]}
 */
export const STORE_ASSETS = [
  // Chrome Web Store icon: 96 px art + 16 px transparent per side, the extension's 128 layout.
  { kind: 'icon', file: 'icon-128-padded.png', size: 128, layout: 'padded' },
  // Firefox add-on icon (square upload, resized by the store to 32/64/128).
  { kind: 'icon', file: 'icon-128.png', size: 128, layout: 'full-bleed' },
  // Edge logo (1:1, 300 recommended, 128 minimum).
  { kind: 'icon', file: 'logo-300.png', size: 300, layout: 'full-bleed' },
  // Small promo tile (Chrome Web Store, Edge).
  { kind: 'tile', file: 'promo-small-440x280.png', width: 440, height: 280, markShare: 0.7 },
  // Marquee (Chrome Web Store) / large promo tile (Edge).
  { kind: 'tile', file: 'promo-marquee-1400x560.png', width: 1400, height: 560, markShare: 0.7 }
];

/** The master's first `<rect>` start tag (its tile). */
const FIRST_RECT = /<rect\b[^>]*>/;

/** A `fill` attribute holding a hex color, either quote style. */
const HEX_FILL = /\sfill\s*=\s*(["'])(#[0-9a-fA-F]{3,8})\1/;

/** XML comments, dropped before markup is located. */
const XML_COMMENT = /<!--[\s\S]*?-->/g;

/** The root `<svg` start tag. */
const ROOT_TAG = /<svg\b[^>]*>/;

/** Placement attributes a nested root must not already carry (they would be overridden ambiguously). */
const PLACEMENT_ATTRIBUTE = /\s(x|y|width|height)\s*=/;

/**
 * The mark's tile color: the `fill` of the master's first `<rect>`. Read from
 * the master so the tile background never drifts from the mark.
 *
 * @param {string} svg The master SVG text.
 * @returns {string} The hex color.
 * @throws {Error} When the master has no `<rect>` with a hex `fill`.
 */
export function masterTileFill(svg) {
  const rect = FIRST_RECT.exec(svg.replace(XML_COMMENT, ''));
  const fill = rect === null ? null : HEX_FILL.exec(rect[0]);
  if (fill === null)
    throw new Error(`${MASTER_PATH}: no <rect> with a hex fill to use as tile color`);
  return fill[2];
}

/**
 * Where the mark sits in a tile: a square of `markShare` × height, centered,
 * on whole pixels so its edges stay crisp.
 *
 * @param {number} width Tile width.
 * @param {number} height Tile height.
 * @param {number} markShare Share of the height the mark spans, in (0, 1].
 * @returns {{ x: number, y: number, side: number }} The mark's box.
 * @throws {Error} When the tile is not positive or `markShare` is outside (0, 1].
 */
export function tileMarkBox(width, height, markShare) {
  if (!(width > 0 && height > 0))
    throw new Error(`Tile ${String(width)}×${String(height)} is empty`);
  if (!(markShare > 0 && markShare <= 1))
    throw new Error(`Mark share ${String(markShare)} is not in (0, 1]`);
  const side = Math.round(height * markShare);
  if (side > width)
    throw new Error(`A ${String(side)} px mark does not fit a ${String(width)} px wide tile`);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}

/**
 * A tile's SVG: a full canvas in the mark's tile color with the master nested
 * at {@link tileMarkBox} (the master's own tile merges into the background,
 * leaving the brackets and rocket).
 *
 * @param {string} master The master SVG text.
 * @param {number} width Tile width.
 * @param {number} height Tile height.
 * @param {number} markShare Share of the height the mark spans.
 * @returns {string} SVG text to render.
 * @throws {Error} On an unusable master (see {@link parseViewBox}, {@link masterTileFill}) or a placed root.
 */
export function tileSvg(master, width, height, markShare) {
  parseViewBox(master);
  const fill = masterTileFill(master);
  const source = master.replace(XML_COMMENT, '');
  const root = ROOT_TAG.exec(source)?.[0] ?? '';
  if (PLACEMENT_ATTRIBUTE.test(root)) {
    throw new Error(`${MASTER_PATH}: the root <svg> must not set x/y/width/height`);
  }
  const box = tileMarkBox(width, height, markShare);
  const placed = root.replace(
    /^<svg/,
    `<svg x="${String(box.x)}" y="${String(box.y)}" width="${String(box.side)}" height="${String(box.side)}"`
  );
  const size = `width="${String(width)}" height="${String(height)}"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${String(width)} ${String(height)}">`,
    `<rect ${size} fill="${fill}"/>`,
    source.replace(root, placed).trim(),
    '</svg>'
  ].join('');
}

/**
 * Render one listing image and check it came out at its exact size.
 *
 * @param {string} master The master SVG text.
 * @param {StoreAsset} asset The table row.
 * @param {typeof resvgRender} render The renderer (it fits the SVG to the given width).
 * @returns {Buffer} The PNG bytes.
 * @throws {Error} On an unknown kind, or a render whose size differs from the row's.
 */
export function renderStoreAsset(master, asset, render = resvgRender) {
  let image;
  let width;
  let height;
  if (asset.kind === 'icon') {
    width = height = asset.size;
    image = render(layoutSvg(master, asset.layout, PADDED_ART_RATIO), asset.size);
  } else if (asset.kind === 'tile') {
    ({ width, height } = asset);
    image = render(tileSvg(master, width, height, asset.markShare), width);
  } else {
    throw new Error(
      `Unknown store asset kind "${String(/** @type {{kind: unknown}} */ (asset).kind)}"`
    );
  }
  if (image.width !== width || image.height !== height) {
    throw new Error(
      `${asset.file}: rendered ${String(image.width)}×${String(image.height)}, expected ${String(width)}×${String(height)}`
    );
  }
  return image.png;
}

/**
 * Render every listing image.
 *
 * @param {string} master The master SVG text.
 * @param {readonly StoreAsset[]} assets The table.
 * @param {typeof resvgRender} render The renderer.
 * @returns {Map<string, Buffer>} File name → PNG bytes, in table order.
 * @throws {Error} When two rows name the same file.
 */
export function renderStoreAssets(master, assets = STORE_ASSETS, render = resvgRender) {
  const rendered = new Map();
  for (const asset of assets) {
    if (rendered.has(asset.file)) throw new Error(`Store asset ${asset.file} is listed twice`);
    rendered.set(asset.file, renderStoreAsset(master, asset, render));
  }
  return rendered;
}

/**
 * CLI entry: write the images, or check them against the committed files.
 *
 * @param {readonly string[]} args Arguments after the script path.
 * @returns {number} The process exit code.
 */
export function main(args) {
  const { check } = parseArgs(args, COMMAND);
  const root = packageRoot();
  const rendered = renderStoreAssets(readMaster(root));
  if (check) {
    const problems = driftProblems(
      rendered,
      (file) => readIfPresent(join(root, STORE_ASSETS_DIR, file)),
      STORE_ASSETS_DIR
    );
    for (const problem of problems) console.error(`[store-assets] ${problem}`);
    if (problems.length > 0) {
      console.error(`[store-assets] out of date — run \`${COMMAND}\` and commit the result`);
      return 1;
    }
    console.log(`[store-assets] ${String(rendered.size)} images match ${MASTER_PATH}`);
    return 0;
  }
  for (const [file, png] of rendered) {
    const path = join(root, STORE_ASSETS_DIR, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    console.log(`[store-assets] wrote ${STORE_ASSETS_DIR}/${file} (${String(png.length)} B)`);
  }
  return 0;
}

if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`[store-assets] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
