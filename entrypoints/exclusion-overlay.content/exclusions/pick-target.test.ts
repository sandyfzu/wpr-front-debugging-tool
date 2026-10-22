import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../../../lib/wp-rocket/constants';
import {
  parseParityTable,
  type ParityRow
} from '../../../lib/exclusion-builder/wp-rocket-parity-table';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../../lib/exclusion-builder/set';
import { delayJsTransform } from '../../../lib/exclusion-builder/delay-js';
import { deferJsTransform } from '../../../lib/exclusion-builder/defer-js';
import { lazyloadTransform } from '../../../lib/exclusion-builder/lazyload';
import { lazyRenderTransform } from '../../../lib/exclusion-builder/lazy-render';
import type { TransformResult } from '../../../lib/exclusion-builder/report';
import {
  candidatesFor,
  nameUrl,
  resolvePointerPick,
  type ElementSnapshot,
  type PickCandidate,
  type PickContext
} from './pick-target';
import { scanTags } from '../../../lib/exclusion-builder/html-scan';
import { findAttribute } from '../../../lib/exclusion-builder/tag-edit';
import {
  createElementKeys,
  elementSnapshot,
  pickContextOf,
  scanPage,
  scanPageInSlices,
  scriptHead,
  type SlicedScan
} from './page-scan';
import { createRowValidator, type LaneKey } from './draft';
import { parseExclusionSetPayload } from '../../../lib/messaging/exclusion-session';

const PAGE = 'https://example.com/shop/';

/** The first element of `html` (parsed as a page body). */
function first(html: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const element = doc.body.firstElementChild ?? doc.head.firstElementChild;
  if (element === null) throw new Error('fixture has no element');
  return element;
}

/** The pick context of the document an element lives in (its lazily rendered peers). */
function contextOf(element: Element): PickContext {
  return pickContextOf(element.ownerDocument, PAGE);
}

/** The candidates of the first element of `html`. */
function candidates(html: string): readonly PickCandidate[] {
  const element = first(html);
  return candidatesFor(elementSnapshot(element), contextOf(element));
}

/** The candidates of every element of `html` matching `selector`. */
function candidatesOf(html: string, selector: string): readonly PickCandidate[] {
  const element = first(html).ownerDocument.querySelector(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return candidatesFor(elementSnapshot(element), contextOf(element));
}

/** Each lane's engine transform. */
const TRANSFORMS: Record<LaneKey, (html: string, set: ExclusionSet) => TransformResult> = {
  delayJs: delayJsTransform,
  deferJs: (html, set) => deferJsTransform(html, set, PAGE),
  lazyload: lazyloadTransform,
  lazyRender: lazyRenderTransform
};

/**
 * Run the candidate's row through its lane's real transform over the
 * served markup: the row must match exactly that element.
 */
function matchesServed(html: string, candidate: PickCandidate): number {
  const set: ExclusionSet = {
    ...EMPTY_EXCLUSION_SET,
    rows: { ...EMPTY_EXCLUSION_SET.rows, [candidate.lane]: [candidate.row] }
  };
  return TRANSFORMS[candidate.lane](`<!doctype html><html><body>${html}</body></html>`, set).report
    .rewritten;
}

describe('candidatesFor — rows the engine actually matches', () => {
  it('names a delayed external script by its path (query dropped)', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="https://example.com/wp-content/plugins/foo/app.js?ver=1.2" id="foo-js"></script>';
    const [candidate] = candidates(html);
    expect(candidate).toEqual({
      lane: 'delayJs',
      row: 'wp-content/plugins/foo/app\\.js',
      subject: 'app.js'
    });
    expect(candidate && matchesServed(html, candidate)).toBe(1);
  });

  it('names a delayed inline script by its id, quoted so a longer id cannot match', () => {
    const html =
      '<script type="text/rocketlazyloadscript" id="foo-js">a()</script><script type="text/rocketlazyloadscript" id="foo-js-after">b()</script>';
    const [candidate] = candidates(html);
    // Changed in audit round 1 and the verification round: `\s` bounds the
    // name (data-id must not match), either quote or none, value bounded.
    expect(candidate?.row).toBe('\\sid=["\']?foo-js(?=["\'\\s/>])');
    expect(candidate && matchesServed(html, candidate)).toBe(1);
  });

  it('names an anonymous inline script by its first line, escaped', () => {
    const html =
      '<script type="rocketlazyloadscript">\n  window.dataLayer = window.dataLayer || [];\n</script>';
    const [candidate] = candidates(html);
    expect(candidate?.row).toBe('window\\.dataLayer = window\\.dataLayer \\|\\| \\[\\];');
    expect(candidate && matchesServed(html, candidate)).toBe(1);
  });

  it('cuts a long first line to the excerpt length', () => {
    const [candidate] = candidates(
      `<script type="rocketlazyloadscript">${'x'.repeat(100)}</script>`
    );
    expect(candidate?.row).toBe('x'.repeat(48));
  });

  it('recognizes an executed delayed script by the runtime marker', () => {
    const html = '<script data-rocket-status="executed" src="/wp-content/a.js"></script>';
    expect(candidates(html)[0]?.lane).toBe('delayJs');
  });

  it('offers Delay JS first, then Defer JS, for a delayed deferred script', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="/wp-includes/js/x.js" data-rocket-defer defer></script>';
    expect(candidates(html).map((candidate) => candidate.lane)).toEqual(['delayJs', 'deferJs']);
  });

  it('names a deferred script by its effective URL path', () => {
    const html =
      '<script src="https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1" data-rocket-defer defer></script>';
    const [candidate] = candidates(html);
    expect(candidate?.row).toBe('wp-includes/js/jquery/jquery\\.min\\.js');
    expect(candidate && matchesServed(html, candidate)).toBe(1);
  });

  it('keeps the host of another origin', () => {
    const html =
      '<script src="https://www.googletagmanager.com/gtag/js?id=G-1" data-rocket-defer defer></script>';
    expect(candidates(html)[0]).toEqual({
      lane: 'deferJs',
      row: 'www\\.googletagmanager\\.com/gtag/js',
      subject: 'www.googletagmanager.com › gtag/js'
    });
  });

  it('names a minified asset by its original path', () => {
    const html =
      '<script src="https://example.com/wp-content/cache/min/1/wp-content/plugins/x/app.js?ver=9" data-rocket-defer defer></script>';
    expect(candidates(html)[0]?.row).toBe('wp-content/plugins/x/app\\.js');
  });

  it('names a lazy image by its real source path (literal)', () => {
    const html =
      '<img src="data:image/svg+xml,%3Csvg%3E" data-lazy-src="https://example.com/wp-content/uploads/hero.jpg" alt="">';
    const [candidate] = candidates(html);
    expect(candidate).toEqual({
      lane: 'lazyload',
      row: 'wp-content/uploads/hero.jpg',
      subject: 'hero.jpg'
    });
    expect(candidate && matchesServed(html, candidate)).toBe(1);
  });

  it('names a lazily rendered element by id, else its most specific class', () => {
    const byId = '<div id="footer" class="x" data-wpr-lazyrender="1"><p>a</p></div>';
    const [idCandidate] = candidates(byId);
    // Changed in the verification round: the bare id (quote-agnostic),
    // checked unique against every stamped element's whole tag.
    expect(idCandidate).toEqual({ lane: 'lazyRender', row: 'footer', subject: '#footer' });
    expect(idCandidate && matchesServed(byId, idCandidate)).toBe(1);
    const byClass =
      '<section class="elementor-section elementor-element-3f2a1b" data-wpr-lazyrender="1"></section>';
    const [classCandidate] = candidates(byClass);
    expect(classCandidate?.row).toBe('elementor-element-3f2a1b');
    expect(classCandidate && matchesServed(byClass, classCandidate)).toBe(1);
  });

  it('offers nothing for a bare lazily rendered element (no row could name only it)', () => {
    expect(candidates('<aside data-wpr-lazyrender="1"></aside>')).toEqual([]);
  });

  it('offers nothing for ordinary elements and scripts', () => {
    expect(candidates('<script src="/a.js"></script>')).toEqual([]);
    expect(candidates('<img src="/a.jpg">')).toEqual([]);
    expect(candidates('<img data-lazy-src="  ">')).toEqual([]);
    expect(candidates('<script type="rocketlazyloadscript">   </script>')).toEqual([]);
    expect(candidates('<script data-rocket-defer></script>')).toEqual([]);
  });
});

describe('nameUrl', () => {
  it('refuses non-http(s) and unparseable values', () => {
    expect(nameUrl('data:image/png;base64,AA', PAGE)).toBeNull();
    expect(nameUrl('http://[', PAGE)).toBeNull();
  });

  it('names a bare origin by its host', () => {
    expect(nameUrl('https://cdn.example.net/', PAGE)).toEqual({
      text: 'cdn.example.net',
      file: 'cdn.example.net'
    });
    // Changed in P10K.4b: a host-less value without a path holds no text a
    // row could name (the host is not in the markup), so it gets no name.
    expect(nameUrl('/', PAGE)).toBeNull();
    expect(nameUrl('/?wc-ajax=1', PAGE)).toBeNull();
    expect(nameUrl('//example.com/?q=1', PAGE)).toEqual({ text: 'example.com', file: '/' });
  });
});

describe('resolvePointerPick', () => {
  it('resolves to the nearest pickable ancestor', () => {
    const section = first(
      '<section class="s-1" data-wpr-lazyrender="1"><div><span>text</span></div></section>'
    );
    const span = section.querySelector('span');
    if (span === null) throw new Error('fixture');
    const chain = [span, span.parentElement, section].filter((el): el is Element => el !== null);
    const resolved = resolvePointerPick(chain.map(elementSnapshot), contextOf(section));
    expect(resolved?.depth).toBe(2);
    expect(resolved?.candidate.lane).toBe('lazyRender');
  });

  it('prefers the pointed image over its lazily rendered container', () => {
    const section = first(
      '<section class="s-1" data-wpr-lazyrender="1"><img data-lazy-src="/a.png"></section>'
    );
    const img = section.querySelector('img');
    if (img === null) throw new Error('fixture');
    expect(
      resolvePointerPick([img, section].map(elementSnapshot), contextOf(section))?.candidate.lane
    ).toBe('lazyload');
  });

  it('resolves nothing over plain content', () => {
    const p = first('<p>x</p>');
    expect(resolvePointerPick([elementSnapshot(p)], contextOf(p))).toBeNull();
  });
});

describe('scanPage', () => {
  it('lists every candidate in document order with stable keys across scans', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><body><script type="rocketlazyloadscript" data-rocket-src="/a.js" data-rocket-defer></script><p>x</p><img data-lazy-src="/b.png"></body>',
      'text/html'
    );
    const keys = createElementKeys();
    const firstScan = scanPage(doc, PAGE, keys);
    expect(firstScan.map((entry) => entry.lane)).toEqual(['delayJs', 'deferJs', 'lazyload']);
    const secondScan = scanPage(doc, PAGE, keys);
    expect(secondScan.map((entry) => entry.key)).toEqual(firstScan.map((entry) => entry.key));
    expect(new Set(firstScan.map((entry) => entry.key)).size).toBe(3);
  });

  it('reads at most the first 512 characters of an inline script', () => {
    const script = first(`<script>${'y'.repeat(600)}</script>`);
    expect(elementSnapshot(script).text).toHaveLength(512);
    expect(elementSnapshot(first('<script src="/x.js"></script>')).text).toBeNull();
  });
});

describe('candidate rows target exactly their element (audit round 1)', () => {
  it('names non-ASCII paths as served, raw or percent-encoded', () => {
    for (const src of [
      'https://example.com/wp-content/plugins/café/app.js',
      'https://example.com/wp-content/plugins/caf%C3%A9/app.js'
    ]) {
      const html = `<script type="rocketlazyloadscript" data-rocket-src="${src}"></script>`;
      const [candidate] = candidates(html);
      expect(candidate && matchesServed(html, candidate), src).toBe(1);
    }
    const img =
      '<img src="data:image/svg+xml,x" data-lazy-src="https://example.com/wp-content/uploads/niño.jpg">';
    const [imgCandidate] = candidates(img);
    expect(imgCandidate?.subject).toBe('niño.jpg');
    expect(imgCandidate && matchesServed(img, imgCandidate)).toBe(1);
  });

  it('cuts an inline excerpt on a code-point boundary, so the row stays storable', () => {
    const [candidate] = candidates(
      `<script type="rocketlazyloadscript">${'x'.repeat(47)}🎉🎉</script>`
    );
    expect(candidate?.row).toBe(`${'x'.repeat(47)}🎉`);
    expect(createRowValidator()('delayJs', candidate?.row ?? '')).toBeNull();
    const set = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: [candidate?.row ?? ''] }
    };
    expect(parseExclusionSetPayload({ set })).not.toBeNull();
  });

  it('skips a URL too long to store as a row', () => {
    expect(nameUrl(`https://example.com/${'a'.repeat(2100)}.js`, PAGE)).toBeNull();
  });

  it('bounds id rows: id="x" never matches data-id="x"', () => {
    const alr =
      '<div data-wpr-lazyrender="1" data-id="hero">a</div><div data-wpr-lazyrender="1" id="hero">b</div>';
    const [alrCandidate] = candidatesOf(alr, '#hero');
    expect(alrCandidate && matchesServed(alr, alrCandidate)).toBe(1);
    const delay =
      '<script type="rocketlazyloadscript" data-id="x-js">a()</script><script type="rocketlazyloadscript" id="x-js">b()</script>';
    const [delayCandidate] = candidatesOf(delay, '#x-js');
    expect(delayCandidate && matchesServed(delay, delayCandidate)).toBe(1);
  });

  it('picks a class token no other lazily rendered element contains, else no row', () => {
    const html =
      '<div data-wpr-lazyrender="1" class="e-con">a</div><div data-wpr-lazyrender="1" class="e-con-inner">b</div>';
    // Changed in the verification round: the whole-class fallback is gone (a
    // class list the page's scripts extended is not the served one), so an
    // element named only by a shared token offers no row.
    expect(candidates(html)).toEqual([]);
    const [innerCandidate] = candidatesOf(html, '.e-con-inner');
    expect(innerCandidate?.row).toBe('e-con-inner');
    expect(innerCandidate && matchesServed(html, innerCandidate)).toBe(1);
  });
});

describe('scanPageInSlices', () => {
  /** A document with `count` lazy images. */
  const docWith = (count: number): Document =>
    new DOMParser().parseFromString(
      `<!doctype html><body>${'<img data-lazy-src="/a.png">'.repeat(count)}</body>`,
      'text/html'
    );

  it('yields between slices and finishes with the same result as one scan', () => {
    const doc = docWith(10);
    let clock = 0;
    const later: (() => void)[] = [];
    const done = vi.fn<(scan: SlicedScan) => void>();
    scanPageInSlices(
      doc,
      PAGE,
      createElementKeys(),
      // Every element costs 5 ms: a 8 ms slice takes two.
      { now: () => (clock += 5) - 5, later: (run) => later.push(run), sliceMs: 8 },
      done
    );
    expect(done).not.toHaveBeenCalled();
    expect(later).toHaveLength(1);
    while (later.length > 0) later.shift()?.();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]?.[0].candidates).toHaveLength(10);
    expect(done.mock.calls[0]?.[0].capped).toBe(false);
  });

  it('stops when cancelled, and finishes at once on an empty page', () => {
    const later: (() => void)[] = [];
    const done = vi.fn();
    let clock = 0;
    const cancel = scanPageInSlices(
      docWith(10),
      PAGE,
      createElementKeys(),
      { now: () => (clock += 5) - 5, later: (run) => later.push(run), sliceMs: 8 },
      done
    );
    cancel();
    while (later.length > 0) later.shift()?.();
    expect(done).not.toHaveBeenCalled();
    const empty = vi.fn();
    scanPageInSlices(
      docWith(0),
      PAGE,
      createElementKeys(),
      { now: () => 0, later: vi.fn(), sliceMs: 8 },
      empty
    );
    expect(empty).toHaveBeenCalledWith(expect.objectContaining({ candidates: [], capped: false }));
  });

  it('reads a script head across text nodes without the rest', () => {
    const script = document.createElement('script');
    script.append(
      document.createTextNode('a'.repeat(300)),
      document.createTextNode('b'.repeat(300))
    );
    expect(scriptHead(script)).toBe(`${'a'.repeat(300)}${'b'.repeat(212)}`);
  });
});

describe('rows hold against served markup (verification round)', () => {
  /** Candidates of the element `selector` picks in served `html`, each with its engine match count. */
  function served(
    html: string,
    selector: string
  ): { row: string; lane: LaneKey; matches: number }[] {
    const element = first(html).ownerDocument.querySelector(selector);
    if (element === null) throw new Error(`no ${selector}`);
    return candidatesFor(elementSnapshot(element), contextOf(element)).map((candidate) => ({
      row: candidate.row,
      lane: candidate.lane,
      matches: matchesServed(html, candidate)
    }));
  }

  it('lazy-render rows are unique against the whole opening tags (and end tags) of stamped peers', () => {
    const otherAttribute =
      '<div data-wpr-lazyrender="1" class="container hero">a</div><div data-wpr-lazyrender="1" data-element_type="container" class="other">b</div>';
    expect(served(otherAttribute, '.hero')).toEqual([
      { row: 'hero', lane: 'lazyRender', matches: 1 }
    ]);
    const stampWord =
      '<div data-wpr-lazyrender="1" class="lazyrender x1">a</div><div data-wpr-lazyrender="1" class="b">b</div>';
    expect(served(stampWord, '.x1')).toEqual([{ row: 'x1', lane: 'lazyRender', matches: 1 }]);
    const tagName =
      '<section data-wpr-lazyrender="1" class="sect ion">a</section><div data-wpr-lazyrender="1" class="x"><section>q</section></div>';
    for (const candidate of served(tagName, 'section.sect')) expect(candidate.matches).toBe(1);
  });

  it('offers no lazy-render row when nothing names only the element', () => {
    expect(
      served(
        '<div data-wpr-lazyrender="1">a</div><div data-wpr-lazyrender="1" class="other">b</div>',
        'div'
      )
    ).toEqual([]);
  });

  it('names a lazy-render element by an attribute value when its id and classes are shared', () => {
    const html =
      '<div data-wpr-lazyrender="1" class="card" data-id="7f3a2c">a</div><div data-wpr-lazyrender="1" class="card" data-id="9b1e4d">b</div>';
    expect(served(html, '[data-id="7f3a2c"]')).toEqual([
      { row: '7f3a2c', lane: 'lazyRender', matches: 1 }
    ]);
  });

  it('id rows match single-quoted and newline-separated served attributes', () => {
    for (const html of [
      `<script type="rocketlazyloadscript" id='x-js'>a()</script><script type="rocketlazyloadscript" data-id='x-js'>b()</script>`,
      '<script type="rocketlazyloadscript"\nid="x-js">a()</script>'
    ]) {
      expect(served(html, '#x-js').map((candidate) => candidate.matches)).toEqual([1]);
    }
    const alr = `<div data-wpr-lazyrender='1' id='hero'>a</div><div data-wpr-lazyrender="1" class="y">b</div>`;
    expect(served(alr, '#hero')).toEqual([{ row: 'hero', lane: 'lazyRender', matches: 1 }]);
  });

  it('matches entity-encoded and relative served paths', () => {
    const script =
      '<script type="rocketlazyloadscript" data-rocket-src="https://example.com/wp-content/a&amp;b.js"></script>';
    expect(served(script, 'script').map((candidate) => candidate.matches)).toEqual([1]);
    const img = '<img src="data:x" data-lazy-src="https://example.com/up/a&amp;bcde.jpg">';
    expect(served(img, 'img').map((candidate) => candidate.matches)).toEqual([1]);
    const relative = '<img src="data:x" data-lazy-src="uploads/niño.jpg">';
    expect(served(relative, 'img')).toEqual([
      { row: 'uploads/niño.jpg', lane: 'lazyload', matches: 1 }
    ]);
  });

  it('names an `&` path by an `&`-free stretch only when no other lazy image has it', () => {
    const thumb = '<img src="data:x" data-lazy-src="https://example.com/uploads/thumb.jpg">';
    // `b.jpg` is in `thumb.jpg` too: no row rather than one matching both.
    expect(
      served(`<img src="data:x" data-lazy-src="https://example.com/a&amp;b.jpg">${thumb}`, 'img')
    ).toEqual([]);
    // The longest stretch is shared; the next one names the image alone.
    const shared = '<img src="data:x" data-lazy-src="https://example.com/uploads/a-long-name.jpg">';
    expect(
      served(
        `<img src="data:x" data-lazy-src="https://example.com/uploads/a-long-name&amp;uniq.jpg">${shared}`,
        'img'
      )
    ).toEqual([{ row: 'uniq.jpg', lane: 'lazyload', matches: 1 }]);
  });

  it('names an `&` image shown twice by a stretch matching both copies', () => {
    const img = '<img src="data:x" data-lazy-src="https://example.com/up/a&amp;bcde.jpg">';
    expect(served(`${img}${img}`, 'img')).toEqual([
      { row: 'bcde.jpg', lane: 'lazyload', matches: 2 }
    ]);
  });

  it("reads the lazy images' tags once, on first need", () => {
    const element = first('<img src="data:x" data-lazy-src="/a.jpg"><img src="/b.jpg">');
    const context = pickContextOf(element.ownerDocument, PAGE);
    const peers = context.lazyImagePeers();
    expect(peers).toEqual([
      { lazySrc: '/a.jpg', tag: '<img src="data:x" data-lazy-src="/a.jpg">' }
    ]);
    expect(context.lazyImagePeers()).toBe(peers);
  });

  it('never offers a row the session would refuse (C1 control, over-cap id)', () => {
    expect(served('<script type="rocketlazyloadscript">\u0085abc</script>', 'script')).toEqual([]);
    const longId = 'i'.repeat(2100);
    expect(
      served(`<script type="rocketlazyloadscript" id="${longId}">a()</script>`, 'script')
    ).toEqual([]);
  });
});

describe('every picked row matches its element after WP Rocket’s save and runtime', () => {
  /** The WP Rocket parity table (outputs derived from the real plugin). */
  const table = parseParityTable(
    JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../../../lib/exclusion-builder/wp-rocket-parity.fixtures.json'
        ),
        'utf8'
      )
    )
  );

  /** A table row by id (fails loudly when a fixture is renamed). */
  function tableRow(id: string): ParityRow {
    const row = table.rows.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`no parity row ${id}`);
    return row;
  }

  /**
   * A script's snapshot from its served markup: attributes as the DOM reads
   * them (entities decoded) and its raw text. The DOM stand-in mis-parses a
   * `<` inside a script's text, so only the empty opening tag is parsed.
   *
   * @param region The script element, `<script…>` through `</script>`.
   */
  function scriptSnapshot(region: string): ElementSnapshot {
    const [tag] = scanTags(region);
    if (tag === undefined) throw new Error(`no tag in ${region}`);
    const element = first(`${region.slice(0, tag.openingEnd)}</script>`);
    const snapshot = elementSnapshot(element);
    const text = element.hasAttribute('src') ? null : region.slice(tag.openingEnd, tag.contentEnd);
    return {
      tag: snapshot.tag,
      attribute: (name) => element.getAttribute(name),
      attributeNames: () => element.getAttributeNames(),
      openingTag: snapshot.openingTag,
      text
    };
  }

  /** The pick context of a page with no lazy peers. */
  const SCRIPT_CONTEXT: PickContext = {
    pageUrl: PAGE,
    lazyRenderPeers: [],
    lazyImagePeers: () => []
  };

  /**
   * Each picked spelling the table proves safe — stored exactly as typed by
   * WP Rocket's save, and excluding its element at runtime — with markup
   * the picker writes it for.
   */
  const SAFE_SPELLINGS: readonly {
    readonly fixture: string;
    /** The fixture page's scripts it excludes on WP Rocket (`a.b` is on none). */
    readonly excluded: readonly string[];
    readonly html: string;
  }[] = [
    {
      fixture: 'picked-delay-path-plus-hex',
      excluded: ['p1'],
      html: '<script type="text/rocketlazyloadscript" data-rocket-src="/a+b.js"></script>'
    },
    {
      fixture: 'picked-delay-id-plus-hex',
      excluded: ['a+b'],
      html: '<script type="text/rocketlazyloadscript" id="a+b">go()</script>'
    },
    {
      fixture: 'picked-delay-ver-hex',
      excluded: ['p2'],
      html: '<script type="text/rocketlazyloadscript">x.js?ver=1</script>'
    },
    {
      fixture: 'picked-delay-star-hex',
      excluded: ['p3'],
      html: '<script type="text/rocketlazyloadscript">/* c */ var q = 1;</script>'
    },
    {
      fixture: 'picked-delay-lt-hex',
      excluded: ['p4'],
      html: '<script type="text/rocketlazyloadscript">if(a<b)</script>'
    },
    {
      fixture: 'picked-delay-octet-hex',
      excluded: ['p5'],
      html: '<script type="text/rocketlazyloadscript" data-rocket-src="/x%41y.js"></script>'
    },
    {
      fixture: 'picked-defer-octet-hex',
      excluded: ['p5'],
      html: '<script src="/x%41y.js" data-rocket-defer defer></script>'
    },
    {
      fixture: 'picked-delay-amp',
      excluded: ['p7'],
      html: '<script type="text/rocketlazyloadscript" data-rocket-src="/p&amp;q.js"></script>'
    },
    {
      fixture: 'picked-delay-dot',
      excluded: [],
      html: '<script type="text/rocketlazyloadscript">a.b</script>'
    },
    {
      fixture: 'picked-delay-hash',
      excluded: ['p8'],
      html: '<script type="text/rocketlazyloadscript">a#b</script>'
    }
  ];

  /** The rows the picker writes for a script's markup. */
  function pickedRows(html: string): readonly PickCandidate[] {
    return candidatesFor(scriptSnapshot(html), SCRIPT_CONTEXT);
  }

  it('writes each character the way the table proves WP Rocket stores and matches it', () => {
    for (const { fixture, excluded, html } of SAFE_SPELLINGS) {
      const save = tableRow(`save-${fixture}`);
      const match = tableRow(`match-${fixture}`);
      if (save.kind !== 'save' || match.kind !== 'match') throw new Error(`bad rows ${fixture}`);
      const lane: LaneKey = save.feature === 'delay_js' ? 'delayJs' : 'deferJs';
      const row = pickedRows(html).find((candidate) => candidate.lane === lane)?.row;
      expect(save.typed, fixture).toEqual([row]);
      // Stored as typed, and on the plugin's runtime it excludes its element.
      expect(save.stored, fixture).toEqual(save.typed);
      expect(match.from, fixture).toBe(save.id);
      expect(match.excluded, fixture).toEqual(excluded);
    }
  });

  it('never writes the spellings the table proves broken (\\+, \\?, \\*, raw <, raw %xx)', () => {
    const picked = SAFE_SPELLINGS.flatMap(({ html }) => pickedRows(html).map(({ row }) => row));
    for (const id of ['path-plus', 'id-plus', 'ver', 'star', 'lt', 'octet']) {
      const save = tableRow(`save-picked-delay-${id}`);
      const match = tableRow(`match-picked-delay-${id}`);
      if (save.kind !== 'save' || match.kind !== 'match') throw new Error(`bad rows ${id}`);
      // Each old spelling is changed by the save or never excludes live.
      const changed = JSON.stringify(save.stored) !== JSON.stringify(save.typed);
      expect(changed || match.excluded.length === 0, id).toBe(true);
      for (const typed of save.typed) expect(picked).not.toContain(typed);
    }
  });

  it("excludes every picked script of the table's picked-row pages through the engine", () => {
    for (const id of ['match-picked-delay-path-plus-hex', 'match-picked-defer-path-plus']) {
      const row = tableRow(id);
      if (row.kind !== 'match') throw new Error(`bad row ${id}`);
      const lane: LaneKey = row.feature === 'delay_js' ? 'delayJs' : 'deferJs';
      const scripts = scanTags(row.served).filter((tag) => tag.name === 'script');
      for (const key of row.candidates) {
        const tag = scripts.find((script) => findAttribute(script, 'id')?.value === key);
        if (tag === undefined) throw new Error(`no #${key}`);
        const snapshot = scriptSnapshot(row.served.slice(tag.start, tag.end));
        const candidate = candidatesFor(snapshot, SCRIPT_CONTEXT).find(
          (found) => found.lane === lane
        );
        if (candidate === undefined) throw new Error(`no ${lane} row for #${key}`);
        const set: ExclusionSet = {
          ...EMPTY_EXCLUSION_SET,
          rows: { ...EMPTY_EXCLUSION_SET.rows, [lane]: [candidate.row] }
        };
        const html = TRANSFORMS[lane](row.served, set).html;
        const excluded = scanTags(html).filter(
          (scanned) => findAttribute(scanned, FDT_EXCLUDED_RESOURCE) !== null
        );
        expect(
          excluded.some((scanned) => findAttribute(scanned, 'id')?.value === key),
          `${id} #${key}`
        ).toBe(true);
      }
    }
  });

  it('hex-escapes whitespace the save would collapse or trim, and a `?ver` the runtime would escape', () => {
    const [tabbed] = candidates('<script type="text/rocketlazyloadscript">var  a =\t1;</script>');
    expect(tabbed?.row).toBe('var\\x20 a =\\x091;');
    const html = '<script type="text/rocketlazyloadscript" id="version-1">a()</script>';
    const [ver] = candidates(html);
    expect(ver?.row).toBe('\\sid=["\']?\\x76ersion-1(?=["\'\\s/>])');
    expect(ver && matchesServed(html, ver)).toBe(1);
  });

  it('never writes a row that is just `0` (the save drops it)', () => {
    const script = '<script type="text/rocketlazyloadscript" data-rocket-src="/0?v=1"></script>';
    expect(candidates(script).map((candidate) => candidate.row)).toEqual(['\\x30']);
    expect(candidates('<img src="data:x" data-lazy-src="/0">')).toEqual([]);
  });

  it('names a lazy image by a stretch WP Rocket stores as written (no `<`, `%`, or space run)', () => {
    for (const [src, row] of [
      ['https://example.com/up/a%41long.jpg', '41long.jpg'],
      ['https://example.com/up/ab  photo-1.jpg', 'photo-1.jpg']
    ] as const) {
      const html = `<img src="data:x" data-lazy-src="${src}">`;
      expect(candidates(html).map((candidate) => candidate.row)).toEqual([row]);
    }
  });
});
