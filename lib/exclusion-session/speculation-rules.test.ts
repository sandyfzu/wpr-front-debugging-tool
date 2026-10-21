/** Speculation-rule script removal: live and delayed forms, HTML type matching, no false hits. */
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { HAPPY_DOM_SETTINGS } from '../../vitest.shared';
import { removeSpeculationRules, speculationRulesGuardSource } from './speculation-rules';

const RULES = '{"prefetch":[{"source":"document","eagerness":"conservative"}]}';

describe('removeSpeculationRules', () => {
  it('removes an inline rule script, element and content', () => {
    const html = `<head><script type="speculationrules">${RULES}</script><title>x</title></head>`;
    expect(removeSpeculationRules(html)).toEqual({
      html: '<head><title>x</title></head>',
      removed: 1
    });
  });

  it('matches the type trimmed and ASCII-case-insensitively, quoted or not', () => {
    for (const type of ['" SpeculationRules\n"', 'SPECULATIONRULES', "'speculationrules'"]) {
      const html = `<p>a</p><script type=${type}>${RULES}</script><p>b</p>`;
      expect(removeSpeculationRules(html)).toEqual({ html: '<p>a</p><p>b</p>', removed: 1 });
    }
  });

  it('removes a rule script held back by delayed execution', () => {
    const html = `<script type="rocketlazyloadscript" data-rocket-type="speculationrules">${RULES}</script>`;
    expect(removeSpeculationRules(html)).toEqual({ html: '', removed: 1 });
  });

  it('removes every rule script, including one with no end tag (runs to the end)', () => {
    const html = `<script type="speculationrules">${RULES}</script><b></b><script type="speculationrules">{`;
    expect(removeSpeculationRules(html)).toEqual({ html: '<b></b>', removed: 2 });
  });

  it('leaves other scripts, mentions in text and comments, and look-alike types alone', () => {
    const html =
      '<script>const t = "speculationrules";</script><!-- <script type="speculationrules"></script> -->' +
      '<p>speculationrules</p><script type="speculationrules2">{}</script><div type="speculationrules"></div>';
    expect(removeSpeculationRules(html)).toEqual({ html, removed: 0 });
  });

  it('returns the very input when no rule exists', () => {
    const html = '<p>plain</p>';
    expect(removeSpeculationRules(html).html).toBe(html);
  });
});

/**
 * Evaluate the guard's source as a page script would run it (a plain
 * script, no module scope) — the source text is what ships, so the text
 * itself is what must be evaluated.
 */
function runGuard(origin = location.origin, page: PageGlobals = globalThis): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the shipped page-script text is the test
  const run = new Function(
    'location',
    'Element',
    'MutationObserver',
    'document',
    speculationRulesGuardSource(origin)
  ) as (...globals: unknown[]) => void;
  run(page.location, page.Element, page.MutationObserver, page.document);
}

/** The page globals the guard reads. */
interface PageGlobals {
  location: Location;
  Element: typeof Element;
  MutationObserver: typeof MutationObserver | undefined;
  document: Document;
}

/** A fresh page (its own document and DOM classes) at `url`, so guards never share a document. */
function freshPage(url = 'https://site.test/'): PageGlobals & { close: () => void } {
  const page = new Window({ url, settings: HAPPY_DOM_SETTINGS });
  return {
    location: page.location as unknown as Location,
    Element: page.Element as unknown as typeof Element,
    MutationObserver: page.MutationObserver as unknown as typeof MutationObserver,
    document: page.document as unknown as Document,
    close: () => {
      void page.happyDOM.close();
    }
  };
}

/** Let the observer's callbacks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('speculationRulesGuardSource', () => {
  it('removes rule scripts inserted later, alone or inside a subtree, and nothing else', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    runGuard();
    const rule = document.createElement('script');
    rule.setAttribute('type', ' SpeculationRules ');
    document.head.append(rule);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<script type="speculationrules"></script><script type="module"></script>';
    document.body.append(wrapper);
    const other = document.createElement('script');
    other.textContent = '/* speculationrules */';
    document.body.append(other);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rule.isConnected).toBe(false);
    expect(wrapper.querySelectorAll('script')).toHaveLength(1);
    expect(other.isConnected).toBe(true);
  });

  it('never throws into the page (a missing observer is swallowed)', () => {
    const original = globalThis.MutationObserver;
    try {
      // @ts-expect-error — simulating a page without the observer.
      globalThis.MutationObserver = undefined;
      expect(() => {
        runGuard();
      }).not.toThrow();
    } finally {
      globalThis.MutationObserver = original;
    }
  });

  it('does nothing in a document of another origin', async () => {
    const page = freshPage('https://site.test/');
    runGuard('https://another.test', page);
    const rule = page.document.createElement('script');
    rule.setAttribute('type', 'speculationrules');
    page.document.body.append(rule);
    await tick();
    expect(rule.isConnected).toBe(true);
    page.close();
  });

  it('keeps working, silently, when the page monkey-patches the DOM methods afterwards', async () => {
    const page = freshPage();
    runGuard(page.location.origin, page);
    const proto = page.Element.prototype as unknown as Record<string, unknown>;
    // The page breaks the methods for rule scripts (its own calls elsewhere keep working).
    const names = ['querySelectorAll', 'remove'];
    const originals = names.map((name) => proto[name]);
    names.forEach((name, index) => {
      const original = originals[index] as (this: Element, ...args: unknown[]) => unknown;
      proto[name] = function (this: Element, ...args: unknown[]) {
        if (this.localName === 'script' || this.localName === 'div') {
          throw new Error(`page broke ${name}`);
        }
        return original.apply(this, args);
      };
    });
    const restore = () => {
      names.forEach((name, index) => {
        proto[name] = originals[index];
      });
    };
    const errors: unknown[] = [];
    page.document.defaultView?.addEventListener('error', (event) => errors.push(event));
    const holder = page.document.createElement('div');
    holder.innerHTML = '<script type="speculationrules"></script>';
    page.document.body.append(holder);
    await tick();
    restore();
    expect(holder.childNodes).toHaveLength(0);
    expect(errors).toEqual([]);
    page.close();
  });

  it('swallows a fault inside the observer callback (nothing reaches the page)', async () => {
    document.body.innerHTML = '';
    runGuard();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);
    const weird = document.createElement('div');
    // A node whose type read throws when the guard inspects it.
    Object.defineProperty(weird, 'nodeType', {
      get() {
        throw new Error('hostile node');
      }
    });
    document.body.append(weird);
    await tick();
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
