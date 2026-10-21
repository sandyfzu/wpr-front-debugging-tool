import { describe, expect, it, vi } from 'vitest';
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
  type PickCandidate,
  type PickContext
} from './pick-target';
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
    expect(nameUrl('/', PAGE)).toEqual({ text: 'example.com', file: '/' });
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

  it("reads the lazy images' tags once, on first need", () => {
    const element = first('<img src="data:x" data-lazy-src="/a.jpg"><img src="/b.jpg">');
    const context = pickContextOf(element.ownerDocument, PAGE);
    const peers = context.lazyImagePeers();
    expect(peers).toEqual(['<img src="data:x" data-lazy-src="/a.jpg">']);
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
