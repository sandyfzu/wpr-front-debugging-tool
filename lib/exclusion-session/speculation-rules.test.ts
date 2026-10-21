/** Speculation-rule script removal: live and delayed forms, HTML type matching, no false hits. */
import { describe, expect, it } from 'vitest';
import { removeSpeculationRules, SPECULATION_RULES_GUARD_SOURCE } from './speculation-rules';

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
function runGuard(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the shipped page-script text is the test
  const run = new Function(SPECULATION_RULES_GUARD_SOURCE) as () => void;
  run();
}

describe('SPECULATION_RULES_GUARD_SOURCE', () => {
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
      expect(runGuard).not.toThrow();
    } finally {
      globalThis.MutationObserver = original;
    }
  });
});
