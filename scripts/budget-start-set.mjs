/**
 * The start set of a built extension page: every JS file the page loads before
 * it runs — its module scripts and modulepreload links, plus each one's static
 * imports, transitively. Dynamic `import()` targets (lazily loaded pages,
 * on-demand chunks) and worker URLs are not on the start path and stay out.
 *
 * The set is derived from the build itself, never from chunk names: the
 * bundler names a shared chunk after one of its modules, so a moved import
 * renames it, and a name-based budget row silently stops counting it. A
 * derived set cannot miss a start chunk; anything it cannot resolve (a missing
 * file, a bare or remote import, a page with no module script, a chunk that
 * does not parse) is a problem the gate reports, never a silent skip.
 *
 * Pure apart from the injected readers, so it is unit-tested on in-memory builds.
 */

import { posix } from 'node:path';
import ts from 'typescript';

/** HTML comments: removed first, so a commented-out tag is never read as markup. */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** An opening `<script>` or `<link>` tag and its attribute text. */
const START_TAG = /<(script|link)\b([^>]*)>/gi;

/** One attribute: name, then an optional double-quoted, single-quoted or bare value. */
const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * Read a tag's attributes (names lower-cased; a bare attribute reads as `''`).
 *
 * @param {string} text The tag's attribute text.
 * @returns {Map<string, string>} Attribute values by name (the first occurrence wins, as in HTML).
 */
function tagAttributes(text) {
  const attributes = new Map();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * The JS a page fetches at start, as its HTML references it: `<script
 * type="module" src>` and `<link rel="modulepreload" href>`, in document order.
 * Classic scripts are reported too (an extension page may not ship one; the
 * gate then names it instead of measuring past it).
 *
 * @param {string} html The built page.
 * @returns {{ modules: string[], classic: string[] }} The referenced URLs, as written.
 */
export function htmlStartScripts(html) {
  const modules = [];
  const classic = [];
  for (const [, tag, text] of html.replace(HTML_COMMENT, '').matchAll(START_TAG)) {
    const attributes = tagAttributes(text);
    if (tag.toLowerCase() === 'script') {
      const src = attributes.get('src');
      if (src === undefined || src === '') continue;
      if (attributes.get('type')?.toLowerCase() === 'module') modules.push(src);
      else classic.push(src);
      continue;
    }
    const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attributes.get('href');
    if (rel.includes('modulepreload') && href !== undefined && href !== '') modules.push(href);
  }
  return { modules, classic };
}

/**
 * The module specifiers a chunk imports statically: its top-level `import`
 * and `export … from` declarations. `import()` expressions are calls, not
 * declarations, so lazily loaded chunks never count.
 *
 * The parser recovers from a syntax error by skipping text, which can swallow
 * import declarations; a chunk that does not parse cleanly is therefore a
 * problem (the set would under-count), never a short list. `parseDiagnostics`
 * is the parser's own error list on the source file (TypeScript 5.9; not in
 * its public typings): a parser without it is a problem too, so an upgrade
 * that drops it fails loudly instead of silently trusting every chunk.
 *
 * @param {string} source The chunk's code.
 * @param {string} name The chunk's path (named in the problem).
 * @returns {{ specifiers: string[], problem?: string }} The specifiers, in source order, and why
 *   they cannot be trusted when the chunk did not parse cleanly.
 */
export function staticImports(source, name) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const specifiers = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier !== undefined && ts.isStringLiteral(specifier)) specifiers.push(specifier.text);
  }
  const problem = parseProblem(file, name);
  return problem === undefined ? { specifiers } : { specifiers, problem };
}

/**
 * Why a parsed chunk's imports cannot be trusted: its first parse error, at
 * its 1-based line and column, or the parser not reporting errors at all.
 *
 * @param {import('typescript').SourceFile} file The parsed chunk.
 * @param {string} name The chunk's path.
 * @returns {string | undefined} The problem, or `undefined` when the chunk parsed cleanly.
 */
function parseProblem(file, name) {
  const diagnostics = /** @type {{ parseDiagnostics?: unknown }} */ (file).parseDiagnostics;
  if (!Array.isArray(diagnostics)) {
    return `${name}: this TypeScript version reports no parse errors (parseDiagnostics), so its imports cannot be trusted`;
  }
  if (diagnostics.length === 0) return undefined;
  const [first] = diagnostics;
  const { line, character } = ts.getLineAndCharacterOfPosition(file, first.start ?? 0);
  const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
  return `${name} does not parse (${line + 1}:${character + 1} ${message}): its imports cannot be read`;
}

/**
 * Resolve a reference to a build file path.
 *
 * @param {string} reference A page `src`/`href` or an import specifier.
 * @param {string} from The referencing file's build path.
 * @returns {{ path: string } | { problem: string }} The build-relative POSIX path, or why it has none.
 */
export function resolveBuildPath(reference, from) {
  const clean = reference.replace(/[?#].*$/, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith('//')) {
    return { problem: `${from} loads ${reference}: not a file of the build` };
  }
  if (clean.startsWith('/')) return { path: posix.normalize(clean.slice(1)) };
  if (!clean.startsWith('./') && !clean.startsWith('../')) {
    return {
      problem: `${from} imports bare specifier "${reference}": it resolves to no build file`
    };
  }
  const path = posix.normalize(posix.join(posix.dirname(from), clean));
  return path.startsWith('../')
    ? { problem: `${from} loads ${reference}: outside the build` }
    : { path };
}

/**
 * The page's start set: the JS its HTML loads plus every static import, transitively.
 *
 * @param {string} page The entry HTML's build path (`panel.html`).
 * @param {ReadonlySet<string>} present Every file of the build.
 * @param {(path: string) => string} readText Reads a build file as UTF-8.
 * @returns {{ files: string[], problems: string[] }} The start files (discovery order) and
 *   everything that kept the set from being complete; `files` is only trustworthy when
 *   `problems` is empty.
 */
export function startSet(page, present, readText) {
  if (!present.has(page)) return { files: [], problems: [`${page} is not in the build`] };
  const { modules, classic } = htmlStartScripts(readText(page));
  const problems = classic.map((src) => `${page} loads classic script ${src}: not measured`);
  if (modules.length === 0) problems.push(`${page} loads no module script`);
  const files = [];
  const seen = new Set();
  /** Queue one reference (dedupe, check presence). */
  const visit = (reference, from) => {
    const resolved = resolveBuildPath(reference, from);
    if ('problem' in resolved) {
      problems.push(resolved.problem);
      return;
    }
    if (seen.has(resolved.path)) return;
    seen.add(resolved.path);
    if (!present.has(resolved.path)) {
      problems.push(`${from} loads ${reference}: ${resolved.path} is not in the build`);
      return;
    }
    files.push(resolved.path);
  };
  for (const reference of modules) visit(reference, page);
  // `files` grows while it is walked: each file's imports join the queue once.
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const { specifiers, problem } = staticImports(readText(file), file);
    if (problem !== undefined) problems.push(problem);
    for (const specifier of specifiers) visit(specifier, file);
  }
  return { files, problems };
}
