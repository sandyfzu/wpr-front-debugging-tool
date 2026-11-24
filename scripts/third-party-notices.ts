/**
 * Third-party licence notices for the packaged extension.
 *
 * Minified bundles drop the licence comments of the npm packages they
 * inline, while MIT/ISC/Apache-2.0 all require the copyright and permission
 * notice to travel with every copy. So the build records which packages
 * actually reached an output chunk (main passes and worker sub-builds
 * alike), reads each one's `package.json` + licence file, and writes one
 * plain-text notices file into the build output, which both store zips pack.
 * Files copied into the package outside npm (vendored runtimes) are passed
 * in as fixed entries.
 *
 * JavaScript packages are exact by construction: only module ids present in
 * emitted chunks count, so type-only packages and tree-shaken dependencies
 * never appear, and a newly bundled one appears without a list to maintain.
 * CSS-pipeline packages (e.g. tailwindcss, whose preflight and utilities a
 * Vite plugin resolves internally) never show up as chunk module ids, so
 * they are a declared list, cross-checked against the licence banners
 * (`/*! name vX.Y.Z | … License … *\/`) that survive in the emitted CSS: a
 * banner without a declared package, or a declared package without its
 * banner, fails the build.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** The notices file, at the root of the build output (and of each store zip). */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

/** One package (or vendored file set) whose notice ships. */
export interface PackageNotice {
  name: string;
  version: string;
  /** SPDX identifier from `package.json`, `UNKNOWN` when absent. */
  license: string;
  /** The licence file's text, `null` when the package ships none. */
  text: string | null;
  /** Where a vendored entry lives in the package (absent for npm packages). */
  files?: string;
}

/** The file-system reads a notice needs — injected so the logic stays unit-testable. */
export interface NoticeReader {
  readFile(path: string): string;
  listDir(path: string): string[];
}

/** Licence file names npm packages use (`LICENSE`, `LICENSE.md`, `LICENCE`, `COPYING`, …). */
const LICENSE_FILE = /^(licen[cs]e|copying)(\.|$)/i;

/** The real file system. */
export const FS_READER: NoticeReader = {
  readFile: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => readdirSync(path)
};

/**
 * The root folder of the npm package a bundled module belongs to.
 *
 * Takes the segment after the last `node_modules/` (two for a scoped name),
 * so pnpm's nested `.pnpm/<id>/node_modules/<name>` layout resolves to the
 * real package. Virtual (`\0`-prefixed) ids and project files have none.
 *
 * @param moduleId - A module id from an emitted chunk (query suffix allowed).
 * @returns The package root path, or `null` when the module is not from npm.
 */
export function packageRootOf(moduleId: string): string | null {
  if (moduleId.startsWith('\0')) return null;
  const path = moduleId.split('?')[0]?.replaceAll('\\', '/') ?? '';
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = path.slice(at + marker.length).split('/');
  const take = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length <= take || rest.slice(0, take).some((part) => part === '')) return null;
  return path.slice(0, at + marker.length) + rest.slice(0, take).join('/');
}

/**
 * Read one package's notice from its root.
 *
 * @param root - The package root ({@link packageRootOf}).
 * @param reader - File-system reads.
 * @returns The notice.
 * @throws {@link Error} naming the root when its `package.json` lacks a name or
 *   version — a package that cannot be attributed must fail the build, not
 *   ship without its notice.
 */
export function readPackageNotice(root: string, reader: NoticeReader): PackageNotice {
  const manifest = JSON.parse(reader.readFile(join(root, 'package.json'))) as Record<
    string,
    unknown
  >;
  const { name, version, license } = manifest;
  if (typeof name !== 'string' || typeof version !== 'string' || name === '' || version === '') {
    throw new Error(`[WPR FDT] third-party notices: ${root}/package.json has no name or version`);
  }
  const file = reader
    .listDir(root)
    .filter((entry) => LICENSE_FILE.test(entry))
    .sort()[0];
  return {
    name,
    version,
    license: typeof license === 'string' && license.trim() !== '' ? license.trim() : 'UNKNOWN',
    text: file === undefined ? null : reader.readFile(join(root, file)).trim()
  };
}

/**
 * Render the notices file: a header, then one section per entry sorted by
 * name and version, so the output is byte-stable across builds.
 *
 * @param notices - Every entry (npm packages + vendored files).
 * @returns The file text, newline-terminated.
 */
export function renderNotices(notices: readonly PackageNotice[]): string {
  const sorted = [...notices].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en')
  );
  const sections = sorted.map((notice) => {
    const head = `${notice.name} ${notice.version} (${notice.license})`;
    const where = notice.files === undefined ? '' : `\nPackaged as: ${notice.files}`;
    const body =
      notice.text ?? `Licensed under ${notice.license}; the package ships no licence file.`;
    return `${head}${where}\n${'-'.repeat(head.length)}\n\n${body}\n`;
  });
  return [
    'Third-party software notices\n',
    'This extension includes the following third-party software, each under its own licence.\n',
    ...sections
  ].join('\n');
}

/**
 * Fill in the licence text of packages that publish none in their npm
 * tarball, from texts the project supplies (the package's repository
 * licence at the shipped version).
 *
 * @param notices - The packages read from the build.
 * @param missingTexts - Licence text per package name, for packages without a file.
 * @returns The notices, each with a text.
 * @throws {@link Error} naming every package left without a text — a new
 *   dependency must not ship without its notice.
 */
export function withLicenseTexts(
  notices: readonly PackageNotice[],
  missingTexts: Readonly<Record<string, string>>
): PackageNotice[] {
  const filled = notices.map((notice) =>
    notice.text === null && notice.name in missingTexts
      ? { ...notice, text: missingTexts[notice.name] ?? null }
      : notice
  );
  const missing = filled.filter((notice) => notice.text === null).map((n) => n.name);
  if (missing.length > 0) {
    throw new Error(
      `[WPR FDT] third-party notices: no licence text for ${missing.join(', ')} — ` +
        'add the licence from its repository to the missing-texts table'
    );
  }
  return filled;
}

/**
 * The MIT licence text with its copyright line — for vendored files whose
 * distribution carries no licence file of its own.
 *
 * @param copyright - The holder's line, e.g. `Copyright (c) 2015 Jane Doe`.
 * @returns The licence text.
 */
export function mitLicenseText(copyright: string): string {
  return `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

/** A licence banner found in an emitted CSS file. */
export interface LicenseBanner {
  name: string;
  version: string;
  /** The emitted file it was found in (for error messages). */
  file: string;
}

/** Every preserved (`/*!`) comment. */
const PRESERVED_COMMENT = /\/\*![\s\S]*?\*\//g;

/** A licence mention: which preserved comments are licence banners. */
const LICENSE_WORD = /licen[cs]e/i;

/** A banner's head: `/*! <name> v<semver> |`. */
const BANNER_HEAD = /^\/\*!\s*(\S+)\s+v(\d+\.\d+\.\d+[^\s|]*)\s*\|/;

/**
 * The licence banners of one emitted CSS file.
 *
 * @param file - The emitted file name.
 * @param css - Its text.
 * @returns One entry per banner, in file order.
 * @throws {@link Error} naming the file and banner when a licence banner has
 *   no `name vX.Y.Z |` head — an unattributable notice must fail the build.
 */
export function licenseBannersOf(file: string, css: string): LicenseBanner[] {
  const banners: LicenseBanner[] = [];
  for (const [comment] of css.matchAll(PRESERVED_COMMENT)) {
    if (!LICENSE_WORD.test(comment)) continue;
    const head = BANNER_HEAD.exec(comment);
    if (head?.[1] === undefined || head[2] === undefined) {
      throw new Error(
        `[WPR FDT] third-party notices: unreadable licence banner in ${file}: ${comment}`
      );
    }
    banners.push({ name: head[1], version: head[2], file });
  }
  return banners;
}

/**
 * Check the declared CSS-pipeline packages against the banners the build
 * emitted, both ways.
 *
 * @param banners - Every banner found in the build's CSS.
 * @param declared - The notices of the declared CSS-pipeline packages.
 * @throws {@link Error} naming each banner with no declared package of that
 *   name and version, and each declared package whose banner never appeared.
 */
export function checkCssPackages(
  banners: readonly LicenseBanner[],
  declared: readonly PackageNotice[]
): void {
  const id = (entry: { name: string; version: string }): string => `${entry.name}@${entry.version}`;
  const declaredIds = new Set(declared.map(id));
  const seenIds = new Set(banners.map(id));
  const undeclared = [
    ...new Set(banners.filter((b) => !declaredIds.has(id(b))).map((b) => `${id(b)} (${b.file})`))
  ];
  const unseen = declared.filter((notice) => !seenIds.has(id(notice))).map(id);
  const problems = [
    ...(undeclared.length > 0
      ? [`CSS licence banner without a declared package: ${undeclared.join(', ')}`]
      : []),
    ...(unseen.length > 0
      ? [`declared CSS package not in the built CSS: ${unseen.join(', ')}`]
      : [])
  ];
  if (problems.length > 0) {
    throw new Error(
      `[WPR FDT] third-party notices: ${problems.join('; ')} — keep the CSS-pipeline package list in sync with the build`
    );
  }
}

/** Collects the npm packages of every emitted chunk across a build's passes. */
export interface NoticeCollector {
  /** Forget every recorded package (a new build starts). */
  reset(): void;
  /** Record the packages of a chunk's module ids. */
  addModules(moduleIds: Iterable<string>): void;
  /** Record the licence banners of an emitted CSS file ({@link licenseBannersOf}). */
  addCss(file: string, css: string): void;
  /** Whether any package was recorded. */
  readonly empty: boolean;
  /**
   * The notices file for everything recorded plus the vendored entries.
   *
   * @param vendored - Fixed entries for files packaged outside npm.
   * @param missingTexts - Licence texts for packages that ship no licence file.
   * @param cssPackageRoots - Roots of the declared CSS-pipeline packages.
   * @throws {@link Error} when a package is left without a licence text
   *   ({@link withLicenseTexts}) or the CSS packages and banners disagree
   *   ({@link checkCssPackages}).
   */
  render(
    vendored: readonly PackageNotice[],
    missingTexts: Readonly<Record<string, string>>,
    cssPackageRoots?: readonly string[]
  ): string;
  /** A Vite plugin recording each emitted chunk's packages (add to main and worker builds). */
  plugin(): Plugin;
}

/**
 * Create a collector. One per build process: WXT runs several Vite passes
 * (one per entrypoint group, plus worker sub-builds) and the notices file is
 * written once after all of them.
 *
 * @param reader - File-system reads (the real one by default).
 * @returns The collector.
 */
export function createNoticeCollector(reader: NoticeReader = FS_READER): NoticeCollector {
  const roots = new Set<string>();
  const banners: LicenseBanner[] = [];
  const collector: NoticeCollector = {
    reset: () => {
      roots.clear();
      banners.length = 0;
    },
    addModules: (moduleIds) => {
      for (const id of moduleIds) {
        const root = packageRootOf(id);
        if (root !== null) roots.add(root);
      }
    },
    addCss: (file, css) => {
      banners.push(...licenseBannersOf(file, css));
    },
    get empty() {
      return roots.size === 0;
    },
    render: (vendored, missingTexts, cssPackageRoots = []) => {
      const css = cssPackageRoots.map((root) => readPackageNotice(root, reader));
      checkCssPackages(banners, css);
      // Two roots can hold the same package version (pnpm peer variants): one entry each.
      const byId = new Map<string, PackageNotice>();
      for (const notice of [...[...roots].map((root) => readPackageNotice(root, reader)), ...css]) {
        byId.set(`${notice.name}@${notice.version}`, notice);
      }
      return renderNotices(withLicenseTexts([...byId.values(), ...vendored], missingTexts));
    },
    plugin: () => ({
      name: 'wpr-fdt:third-party-notices',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === 'chunk') collector.addModules(output.moduleIds);
          else if (output.fileName.endsWith('.css')) {
            const css =
              typeof output.source === 'string'
                ? output.source
                : new TextDecoder().decode(output.source);
            collector.addCss(output.fileName, css);
          }
        }
      }
    })
  };
  return collector;
}
