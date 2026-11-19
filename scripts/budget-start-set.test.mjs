import { describe, expect, it } from 'vitest';
import {
  htmlStartScripts,
  resolveBuildPath,
  startSet,
  staticImports
} from './budget-start-set.mjs';

/* The start-set derivation on in-memory builds shaped like the bundler's output. */

/** A page shaped like the built panel: comments, a module entry, preloads, a stylesheet. */
const PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <!-- <script type="module" src="/chunks/commented-out.js"></script> -->
    <script type="module" crossorigin src="/chunks/panel-A1.js"></script>
    <link rel="modulepreload" crossorigin href="/chunks/types-B2.js">
    <link rel="stylesheet" crossorigin href="/assets/panel-C3.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

/**
 * An in-memory build: its file set and a text reader that fails on a file it lacks.
 *
 * @param {Record<string, string>} files Build paths → contents.
 */
function build(files) {
  const present = new Set(Object.keys(files));
  return {
    present,
    readText: (path) => {
      if (!(path in files)) throw new Error(`read of a missing file: ${path}`);
      return files[path];
    }
  };
}

describe('htmlStartScripts', () => {
  it('reads module scripts and modulepreload links in order, never comments or stylesheets', () => {
    expect(htmlStartScripts(PANEL_HTML)).toEqual({
      modules: ['/chunks/panel-A1.js', '/chunks/types-B2.js'],
      classic: []
    });
  });

  it('reads any attribute order, quoting and case; a multi-token rel; skips src-less scripts', () => {
    const html = `<SCRIPT src='/a.js' TYPE=module></SCRIPT>
      <link href=/b.js rel="preload modulepreload">
      <script type="module">inline()</script>
      <link rel="preload" href="/c.js">`;
    expect(htmlStartScripts(html)).toEqual({ modules: ['/a.js', '/b.js'], classic: [] });
  });

  it('reports a classic script separately', () => {
    expect(htmlStartScripts('<script src="/classic.js"></script>').classic).toEqual([
      '/classic.js'
    ]);
  });
});

describe('staticImports', () => {
  it('lists import and re-export declarations, never import() calls', () => {
    const source = [
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["chunks/lazy-X.js"])))=>i.map(i=>d[i]);',
      'import{a as b}from"./types-B2.js";import"./side-C.js";import*as ns from"./ns-D.js";',
      'export{c}from"./re-E.js";export*from"./all-F.js";',
      'const lazy=()=>import("./lazy-X.js");const text=\'import"./in-a-string.js"\';',
      'export const own=1;'
    ].join('\n');
    expect(staticImports(source, 'chunks/panel-A1.js')).toEqual({
      specifiers: ['./types-B2.js', './side-C.js', './ns-D.js', './re-E.js', './all-F.js']
    });
  });

  it('returns nothing for a chunk without imports', () => {
    expect(staticImports('export const a=1;', 'chunks/a.js')).toEqual({ specifiers: [] });
  });

  it('names a chunk that does not parse and its first error, even when the parser lost its imports', () => {
    // Error recovery swallows the import: the empty list alone would read as "no imports".
    expect(staticImports('{{{ import"./a.js";', 'chunks/broken.js')).toEqual({
      specifiers: [],
      problem: "chunks/broken.js does not parse (1:20 '}' expected.): its imports cannot be read"
    });
    // A later error still fails the chunk, though the imports before it were read.
    expect(staticImports('import"./a.js";\nconst = 1;', 'chunks/b.js')).toEqual({
      specifiers: ['./a.js'],
      problem:
        'chunks/b.js does not parse (2:7 Variable declaration expected.): its imports cannot be read'
    });
  });
});

describe('resolveBuildPath', () => {
  it('resolves root-absolute and relative references to build paths', () => {
    expect(resolveBuildPath('/chunks/a.js', 'panel.html')).toEqual({ path: 'chunks/a.js' });
    expect(resolveBuildPath('./b.js', 'chunks/a.js')).toEqual({ path: 'chunks/b.js' });
    expect(resolveBuildPath('../c.js?v=1#x', 'chunks/a.js')).toEqual({ path: 'c.js' });
  });

  it('names a reference that is no build file (remote, bare, outside the build)', () => {
    expect(resolveBuildPath('https://cdn.test/x.js', 'panel.html')).toEqual({
      problem: 'panel.html loads https://cdn.test/x.js: not a file of the build'
    });
    expect(resolveBuildPath('//cdn.test/x.js', 'panel.html')).toHaveProperty('problem');
    expect(resolveBuildPath('solid-js', 'chunks/a.js')).toEqual({
      problem: 'chunks/a.js imports bare specifier "solid-js": it resolves to no build file'
    });
    expect(resolveBuildPath('../../x.js', 'chunks/a.js')).toEqual({
      problem: 'chunks/a.js loads ../../x.js: outside the build'
    });
  });
});

describe('startSet', () => {
  it('follows static imports transitively from the page, once each, and leaves dynamic ones out', () => {
    const { present, readText } = build({
      'panel.html': PANEL_HTML,
      // The entry imports a shared chunk that imports the preloaded one again (a diamond).
      'chunks/panel-A1.js':
        'import{x}from"./shared-R.js";import{t}from"./types-B2.js";const l=()=>import("./lazy-X.js");',
      'chunks/shared-R.js': 'import{t}from"./types-B2.js";export const x=1;',
      'chunks/types-B2.js': 'export const t=1;',
      'chunks/lazy-X.js': 'import{t}from"./types-B2.js";export const page=1;',
      'chunks/options-O.js': 'export const o=1;'
    });
    expect(startSet('panel.html', present, readText)).toEqual({
      files: ['chunks/panel-A1.js', 'chunks/types-B2.js', 'chunks/shared-R.js'],
      problems: []
    });
  });

  it('counts a renamed or new shared chunk without any name in the row', () => {
    const { present, readText } = build({
      'panel.html': '<script type="module" src="/chunks/panel-A1.js"></script>',
      'chunks/panel-A1.js': 'import"./renamed-Z9.js";',
      'chunks/renamed-Z9.js': 'import"./brand-new-Q.js";',
      'chunks/brand-new-Q.js': ''
    });
    expect(startSet('panel.html', present, readText).files).toEqual([
      'chunks/panel-A1.js',
      'chunks/renamed-Z9.js',
      'chunks/brand-new-Q.js'
    ]);
  });

  it('reports a missing page, a page without a module script, and a classic script', () => {
    expect(startSet('panel.html', new Set(), () => '')).toEqual({
      files: [],
      problems: ['panel.html is not in the build']
    });
    const { present, readText } = build({ 'panel.html': '<script src="/old.js"></script>' });
    expect(startSet('panel.html', present, readText).problems).toEqual([
      'panel.html loads classic script /old.js: not measured',
      'panel.html loads no module script'
    ]);
  });

  it('reports a start chunk that does not parse, and still walks what it could read', () => {
    const { present, readText } = build({
      'panel.html': '<script type="module" src="/chunks/panel-A1.js"></script>',
      'chunks/panel-A1.js': 'import"./ok-K.js";\nexport const = 1;',
      'chunks/ok-K.js': 'export const k=1;'
    });
    expect(startSet('panel.html', present, readText)).toEqual({
      files: ['chunks/panel-A1.js', 'chunks/ok-K.js'],
      problems: [
        'chunks/panel-A1.js does not parse (2:14 Variable declaration expected.): its imports cannot be read'
      ]
    });
  });

  it('reports an import of a file the build lacks, and a bare import', () => {
    const { present, readText } = build({
      'panel.html': '<script type="module" src="/chunks/panel-A1.js"></script>',
      'chunks/panel-A1.js': 'import"./gone-G.js";import"solid-js";'
    });
    expect(startSet('panel.html', present, readText)).toEqual({
      files: ['chunks/panel-A1.js'],
      problems: [
        'chunks/panel-A1.js loads ./gone-G.js: chunks/gone-G.js is not in the build',
        'chunks/panel-A1.js imports bare specifier "solid-js": it resolves to no build file'
      ]
    });
  });
});
