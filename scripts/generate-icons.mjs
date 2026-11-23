#!/usr/bin/env node
/**
 * Extension icon generator: renders every icon of the declared set
 * (`lib/branding/icons.ts`) from the master mark `branding/icon.svg` into
 * `public/<path>` as an RGBA PNG of its exact size.
 *
 * Each size is a vector render of the master at that size (never a downscaled
 * bitmap), so small icons keep crisp edges. A `padded` icon is the same
 * drawing with the root `viewBox` widened around its center, which shrinks the
 * mark to the declared share of the canvas and leaves the margin transparent.
 *
 * `pnpm icons` writes the files; `pnpm icons --check` renders in memory and
 * exits non-zero naming every committed PNG that is missing or differs — run it
 * after editing the master or the table. Rendering depends on the renderer's
 * native build, so the check is a local tool, not a CI gate.
 *
 * The pure parts (viewBox math, layout, drift comparison, argument parsing)
 * take their I/O as parameters and are unit-tested; `main` is the thin wiring.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { EXTENSION_ICONS, PADDED_ART_RATIO } from '../lib/branding/icons.ts';

/** The master mark, relative to the package root. */
export const MASTER_PATH = 'branding/icon.svg';

/** Where icon paths are rooted in the repo (WXT copies it to the build root). */
export const PUBLIC_DIR = 'public';

/** XML comments: dropped before the root tag is located, so commented markup never matches. */
const XML_COMMENT = /<!--[\s\S]*?-->/g;

/** The root element's start tag (the first `<svg` start tag of the document). */
const ROOT_TAG = /<svg\b[^>]*>/;

/** The `viewBox` attribute inside a start tag, either quote style. */
const VIEW_BOX_ATTRIBUTE = /(\sviewBox\s*=\s*)(["'])([^"']*)\2/;

/**
 * The package root: this script lives at `<root>/scripts/`.
 *
 * @returns {string} Absolute package root.
 */
function packageRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Read the master root's `viewBox`. The icons are square, so a non-square or
 * missing box is refused rather than rendered stretched or at an arbitrary size.
 *
 * @param {string} svg The master SVG text.
 * @returns {{ minX: number, minY: number, width: number, height: number }} The box.
 * @throws {Error} When there is no root `<svg>`, no `viewBox`, or the box is malformed or not square.
 */
export function parseViewBox(svg) {
  const root = ROOT_TAG.exec(svg.replace(XML_COMMENT, ''));
  if (root === null) throw new Error(`${MASTER_PATH}: no root <svg> element`);
  const attribute = VIEW_BOX_ATTRIBUTE.exec(root[0]);
  if (attribute === null) throw new Error(`${MASTER_PATH}: the root <svg> has no viewBox`);
  const parts = attribute[3]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${MASTER_PATH}: malformed viewBox "${attribute[3]}"`);
  }
  const [minX, minY, width, height] = parts;
  if (width <= 0 || width !== height) {
    throw new Error(`${MASTER_PATH}: viewBox "${attribute[3]}" must be square and non-empty`);
  }
  return { minX, minY, width, height };
}

/**
 * Widen a box around its center so its original content spans `ratio` of the
 * new box's side — the content is scaled to `ratio` and centered.
 *
 * @param {{ minX: number, minY: number, width: number, height: number }} box The original box.
 * @param {number} ratio Share of the side the content keeps, in (0, 1].
 * @returns {{ minX: number, minY: number, width: number, height: number }} The widened box.
 * @throws {Error} When `ratio` is outside (0, 1].
 */
export function paddedViewBox(box, ratio) {
  if (!(ratio > 0 && ratio <= 1))
    throw new Error(`Padding ratio ${String(ratio)} is not in (0, 1]`);
  const width = box.width / ratio;
  const height = box.height / ratio;
  return {
    minX: box.minX - (width - box.width) / 2,
    minY: box.minY - (height - box.height) / 2,
    width,
    height
  };
}

/**
 * The master laid out for one icon: as is (`full-bleed`), or with its root
 * `viewBox` widened by {@link paddedViewBox} (`padded`).
 *
 * @param {string} svg The master SVG text.
 * @param {'full-bleed' | 'padded'} layout The icon's layout.
 * @param {number} ratio The padded art ratio.
 * @returns {string} SVG text to render.
 * @throws {Error} On an unknown layout or an unusable master (see {@link parseViewBox}).
 */
export function layoutSvg(svg, layout, ratio) {
  const box = parseViewBox(svg);
  if (layout === 'full-bleed') return svg;
  if (layout !== 'padded') throw new Error(`Unknown icon layout "${String(layout)}"`);
  const padded = paddedViewBox(box, ratio);
  const value = [padded.minX, padded.minY, padded.width, padded.height].join(' ');
  const source = svg.replace(XML_COMMENT, '');
  const root = ROOT_TAG.exec(source)?.[0] ?? '';
  const rewritten = root.replace(
    VIEW_BOX_ATTRIBUTE,
    (_, name, quote) => `${name}${quote}${value}${quote}`
  );
  return source.replace(root, rewritten);
}

/** The PNG file signature: the 8 bytes before the first chunk. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Byte length of a PNG `IHDR` chunk (4 length + 4 type + 13 data + 4 CRC). */
const IHDR_CHUNK_LENGTH = 25;

/** Chunks that declare a color space; one of them present means the PNG is already tagged. */
const COLOR_CHUNKS = new Set(['sRGB', 'iCCP', 'gAMA', 'cHRM', 'cICP']);

/**
 * A PNG's chunk types in file order (walked by length fields; reading stops at
 * the end of the bytes).
 *
 * @param {Buffer} png PNG bytes (signature first).
 * @returns {string[]} The chunk types, e.g. `['IHDR', 'IDAT', 'IEND']`.
 */
export function pngChunkTypes(png) {
  const types = [];
  for (let offset = PNG_SIGNATURE.length; offset + 8 <= png.length;) {
    types.push(png.toString('latin1', offset + 4, offset + 8));
    offset += 12 + png.readUInt32BE(offset);
  }
  return types;
}

/**
 * Tag a PNG as sRGB: insert an `sRGB` chunk (perceptual intent) right after
 * `IHDR`. The renderer writes no color-space chunk; the tag states what the
 * pixels already are (the master's colors are sRGB) so no reader guesses.
 *
 * @param {Buffer} png A PNG whose first chunk is `IHDR`.
 * @returns {Buffer} The tagged PNG.
 * @throws {Error} When the bytes are not a PNG starting with `IHDR`, or are already tagged.
 */
export function withSrgbChunk(png) {
  const ihdrEnd = PNG_SIGNATURE.length + IHDR_CHUNK_LENGTH;
  if (
    png.length < ihdrEnd ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Not a PNG starting with an IHDR chunk');
  }
  const colorChunk = pngChunkTypes(png).find((type) => COLOR_CHUNKS.has(type));
  if (colorChunk !== undefined) throw new Error(`The PNG already carries a ${colorChunk} chunk`);
  const body = Buffer.from([0x73, 0x52, 0x47, 0x42, 0x00]); // "sRGB" + rendering intent 0 (perceptual)
  const chunk = Buffer.alloc(4 + body.length + 4);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 4 + body.length);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

/**
 * Render SVG text to a square RGBA, sRGB-tagged PNG with resvg (no system fonts: the mark
 * has no text, and skipping the font scan keeps renders fast and machine-independent).
 *
 * @param {string} svg SVG text.
 * @param {number} size Target width = height in pixels.
 * @returns {{ png: Buffer, width: number, height: number, pixels: Buffer }} The render.
 */
export function resvgRender(svg, size) {
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false }
  }).render();
  return {
    png: withSrgbChunk(image.asPng()),
    width: image.width,
    height: image.height,
    pixels: image.pixels
  };
}

/**
 * Render one icon of the set and check it came out at its exact size.
 *
 * @param {string} master The master SVG text.
 * @param {{ size: number, layout: 'full-bleed' | 'padded', path: string }} icon The table row.
 * @param {typeof resvgRender} render The renderer.
 * @returns {Buffer} The PNG bytes.
 * @throws {Error} When the render is not `size` × `size`.
 */
export function renderIcon(master, icon, render = resvgRender) {
  const image = render(layoutSvg(master, icon.layout, PADDED_ART_RATIO), icon.size);
  if (image.width !== icon.size || image.height !== icon.size) {
    throw new Error(
      `${icon.path}: rendered ${String(image.width)}×${String(image.height)}, expected ${String(icon.size)}×${String(icon.size)}`
    );
  }
  return image.png;
}

/**
 * Render every icon of a set.
 *
 * @param {string} master The master SVG text.
 * @param {readonly { size: number, layout: 'full-bleed' | 'padded', path: string }[]} icons The table.
 * @param {typeof resvgRender} render The renderer.
 * @returns {Map<string, Buffer>} Icon path → PNG bytes, in table order.
 */
export function renderIconSet(master, icons = EXTENSION_ICONS, render = resvgRender) {
  return new Map(icons.map((icon) => [icon.path, renderIcon(master, icon, render)]));
}

/**
 * Compare fresh renders with the committed files.
 *
 * @param {Map<string, Buffer>} rendered Icon path → fresh PNG bytes.
 * @param {(path: string) => Buffer | undefined} readCommitted The committed bytes, `undefined` when absent.
 * @returns {string[]} One line per missing or differing file (empty = in sync).
 */
export function driftProblems(rendered, readCommitted) {
  const problems = [];
  for (const [path, png] of rendered) {
    const committed = readCommitted(path);
    if (committed === undefined) problems.push(`${PUBLIC_DIR}/${path}: missing`);
    else if (!committed.equals(png))
      problems.push(`${PUBLIC_DIR}/${path}: differs from a fresh render`);
  }
  return problems;
}

/**
 * Read the CLI arguments: none (write) or `--check`.
 *
 * @param {readonly string[]} args Arguments after the script path.
 * @returns {{ check: boolean }} The mode.
 * @throws {Error} On any other argument.
 */
export function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0)
    throw new Error(`Unknown argument(s): ${unknown.join(' ')} (usage: pnpm icons [--check])`);
  return { check: args.includes('--check') };
}

/**
 * Read the master mark.
 *
 * @param {string} root Package root.
 * @param {(path: string) => string} readText File reader.
 * @returns {string} The SVG text.
 * @throws {Error} When the file cannot be read — naming the path to restore.
 */
export function readMaster(root, readText = (path) => readFileSync(path, 'utf8')) {
  const path = join(root, MASTER_PATH);
  try {
    return readText(path);
  } catch (cause) {
    throw new Error(`Cannot read the master icon ${MASTER_PATH} (${path}): restore it from git`, {
      cause
    });
  }
}

/**
 * A committed icon's bytes, `undefined` when the file does not exist.
 *
 * @param {string} file Absolute path.
 * @returns {Buffer | undefined} The bytes.
 * @throws {Error} On any read failure other than a missing file.
 */
function readIfPresent(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * CLI entry: write the set, or check it against the committed files.
 *
 * @param {readonly string[]} args Arguments after the script path.
 * @returns {number} The process exit code.
 */
export function main(args) {
  const { check } = parseArgs(args);
  const root = packageRoot();
  const rendered = renderIconSet(readMaster(root));
  if (check) {
    const problems = driftProblems(rendered, (path) => readIfPresent(join(root, PUBLIC_DIR, path)));
    for (const problem of problems) console.error(`[icons] ${problem}`);
    if (problems.length > 0) {
      console.error('[icons] out of date — run `pnpm icons` and commit the result');
      return 1;
    }
    console.log(`[icons] ${String(rendered.size)} icons match ${MASTER_PATH}`);
    return 0;
  }
  for (const [path, png] of rendered) {
    const file = join(root, PUBLIC_DIR, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    console.log(`[icons] wrote ${PUBLIC_DIR}/${path} (${String(png.length)} B)`);
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
    console.error(`[icons] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
