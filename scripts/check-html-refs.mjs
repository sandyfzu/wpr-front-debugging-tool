#!/usr/bin/env node
/**
 * Built-HTML reference gate: every extension page in both builds
 * (`.output/chrome-mv3`, `.output/firefox-mv2`) must load what its source
 * page asks for. A page whose stylesheet the bundler dropped renders
 * unstyled, and a reference to a missing file fails silently in the browser
 * — neither breaks the build, so this script checks the built trees:
 *
 * - every local `href`/`src` on a `<link>`/`<script>` names a non-empty
 *   emitted file;
 * - no built reference still points at source (`.ts`/`.tsx`, `../`) — an
 *   unprocessed tag;
 * - every CSS input is represented: at least one emitted `.css` link per
 *   source stylesheet link plus one for the entry module's own `.css`
 *   imports (the bundler emits the shared token sheet and a page's own CSS
 *   as separate files, so losing either is caught; should it ever merge
 *   them, the gate fails loud, never passes falsely);
 * - a source module script yields an emitted module script, and every
 *   absolute source reference (`/icon/16.png`, copied from `public/`)
 *   survives verbatim;
 * - every built page has a source page and every source page is built.
 *
 * Built pages map to sources by WXT's convention: `<name>.html` ←
 * `entrypoints/<name>/index.html`. Run after `pnpm build && pnpm build:firefox`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The build trees checked — both must exist (the gate covers both browsers). */
export const HTML_BUILDS = ['chrome-mv3', 'firefox-mv2'];

/**
 * A reference that never names a file in the build: a scheme (`https:`,
 * `data:`, `chrome-extension:`), a protocol-relative URL or a fragment.
 */
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Every `<link>`/`<script>` tag of a page with its `rel`, `type` and URL
 * (`href` or `src`). Regex-scanned: the input is our own source and the
 * bundler's output, never untrusted markup.
 *
 * @param html The page's text.
 * @returns One entry per tag carrying a URL, in document order.
 */
export function pageReferences(html) {
  const references = [];
  for (const [, tag, attributes] of html.matchAll(/<(link|script)\b([^>]*)>/gi)) {
    const attribute = (name) =>
      new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
        .exec(attributes)
        ?.slice(1)
        .find((value) => value !== undefined);
    const url = attribute('href') ?? attribute('src');
    if (url === undefined) continue;
    references.push({
      tag: tag.toLowerCase(),
      rel: (attribute('rel') ?? '').toLowerCase(),
      type: (attribute('type') ?? '').toLowerCase(),
      url
    });
  }
  return references;
}

/**
 * Whether a reference names a file in the build (relative or root-absolute).
 *
 * @param url The reference's URL.
 */
export function isLocalReference(url) {
  return url.trim() !== '' && !EXTERNAL_REFERENCE.test(url);
}

/**
 * The build-relative path a built page's local reference names (query and
 * fragment dropped; pages sit at the build root).
 *
 * @param url A local reference.
 * @returns The path, without a leading slash.
 */
export function buildPath(url) {
  return url.replace(/[?#].*$/, '').replace(/^\.?\//, '');
}

/**
 * Whether a module statically imports a stylesheet for its side effect
 * (`import './style.css'`) — the CSS the bundler emits as the page's own file.
 *
 * @param moduleSource The entry module's text.
 */
export function importsCss(moduleSource) {
  return /^\s*import\s+(['"])[^'"]+\.css(?:\?[^'"]*)?\1/m.test(moduleSource);
}

/**
 * The source page's entry module (its first local `<script type="module">`),
 * relative to the page's folder, or `null` when it has none.
 *
 * @param sourceHtml The source page's text.
 */
export function entryModule(sourceHtml) {
  const entry = pageReferences(sourceHtml).find(
    (ref) => ref.tag === 'script' && ref.type === 'module' && isLocalReference(ref.url)
  );
  return entry === undefined ? null : entry.url.replace(/^\.\//, '');
}

/**
 * Everything wrong with one built page against its source page.
 *
 * @param page The built page's file name (`panel.html`), for messages.
 * @param sourceHtml The source page's text.
 * @param builtHtml The built page's text.
 * @param sizeOf The byte size of a build-relative path, `null` when absent.
 * @param entryCss Whether the page's entry module imports its own CSS.
 * @returns Actionable problem lines (empty when the page is sound).
 */
export function pageProblems(page, sourceHtml, builtHtml, sizeOf, entryCss = false) {
  const problems = [];
  const built = pageReferences(builtHtml).filter((ref) => isLocalReference(ref.url));
  for (const ref of built) {
    if (/\.tsx?(?:[?#]|$)|(?:^|\/)\.\.\//.test(ref.url)) {
      problems.push(`${page}: <${ref.tag}> still points at source "${ref.url}" (unprocessed)`);
      continue;
    }
    const size = sizeOf(buildPath(ref.url));
    if (size === null) problems.push(`${page}: "${ref.url}" names no emitted file`);
    else if (size === 0) problems.push(`${page}: "${ref.url}" is an empty file`);
  }
  const source = pageReferences(sourceHtml).filter((ref) => isLocalReference(ref.url));
  const wants = (rule) => source.some(rule);
  const has = (rule) => built.some(rule);
  const stylesheet = (ref) => ref.tag === 'link' && ref.rel === 'stylesheet';
  const expectedCss = source.filter(stylesheet).length + (entryCss ? 1 : 0);
  const emittedCss = built.filter(
    (ref) => stylesheet(ref) && /\.css$/.test(buildPath(ref.url))
  ).length;
  if (emittedCss < expectedCss) {
    problems.push(
      `${page}: ${emittedCss} emitted .css link(s) for ${expectedCss} CSS input(s) (a stylesheet was dropped; the page renders unstyled)`
    );
  }
  const moduleScript = (ref) => ref.tag === 'script' && ref.type === 'module';
  if (wants(moduleScript) && !has(moduleScript)) {
    problems.push(`${page}: its source module script emitted no <script type="module">`);
  }
  for (const ref of source.filter((entry) => entry.url.startsWith('/'))) {
    if (!built.some((entry) => entry.url === ref.url)) {
      problems.push(`${page}: source reference "${ref.url}" was dropped from the built page`);
    }
  }
  return problems;
}

/**
 * Pair built pages with source pages: both sides must be complete.
 *
 * @param builtPages The build root's `.html` file names.
 * @param sourcePages The entrypoint names that own an `index.html`.
 * @param build The build's directory name, for messages.
 * @returns The paired names and the unpaired-page problems.
 */
export function pairPages(builtPages, sourcePages, build) {
  const problems = [];
  const names = builtPages.map((page) => page.replace(/\.html$/, ''));
  for (const name of names) {
    if (!sourcePages.includes(name)) problems.push(`${build}/${name}.html: no source page`);
  }
  const pairs = names.filter((name) => sourcePages.includes(name));
  return { pairs, problems };
}

/** The package root (`<root>/scripts/` holds this file; non-file URLs fall back to cwd). */
function packageRoot() {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    // Test runners may serve the module from a non-file URL; tests run at the root.
    return process.cwd();
  }
}

/**
 * Entrypoints owning an `index.html`. Every one is expected in at least one
 * build; a browser-only page (Firefox's consent page) is absent from the other.
 *
 * @param root The package root.
 */
function sourcePageNames(root) {
  const entrypoints = join(root, 'entrypoints');
  return readdirSync(entrypoints).filter((name) =>
    existsSync(join(entrypoints, name, 'index.html'))
  );
}

/** Run the gate over both builds; exits non-zero on any problem. */
function main() {
  const root = packageRoot();
  const sources = sourcePageNames(root);
  const problems = [];
  const builtAnywhere = new Set();
  for (const build of HTML_BUILDS) {
    const dir = join(root, '.output', build);
    if (!existsSync(dir)) {
      problems.push(`${build}: no build at ${dir} — run pnpm build && pnpm build:firefox first`);
      continue;
    }
    const builtPages = readdirSync(dir).filter((name) => name.endsWith('.html'));
    const { pairs, problems: unpaired } = pairPages(builtPages, sources, build);
    problems.push(...unpaired);
    const sizeOf = (path) => {
      const file = join(dir, path);
      return existsSync(file) && statSync(file).isFile() ? statSync(file).size : null;
    };
    for (const name of pairs) {
      builtAnywhere.add(name);
      const sourceHtml = readFileSync(join(root, 'entrypoints', name, 'index.html'), 'utf8');
      const builtHtml = readFileSync(join(dir, `${name}.html`), 'utf8');
      const entry = entryModule(sourceHtml);
      const entryFile = entry === null ? null : join(root, 'entrypoints', name, entry);
      const entryCss =
        entryFile !== null && existsSync(entryFile) && importsCss(readFileSync(entryFile, 'utf8'));
      problems.push(
        ...pageProblems(`${build}/${name}.html`, sourceHtml, builtHtml, sizeOf, entryCss)
      );
    }
    console.log(`${build}: ${pairs.length} page(s) checked (${pairs.join(', ')})`);
  }
  for (const name of sources.filter((source) => !builtAnywhere.has(source))) {
    problems.push(`entrypoints/${name}/index.html: built in no browser`);
  }
  if (problems.length === 0) {
    console.log('✓ Every built page loads its emitted CSS and assets.');
    return;
  }
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exitCode = 1;
}

// Execute only when run as a script; importing (tests) must stay side-effect-free.
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
