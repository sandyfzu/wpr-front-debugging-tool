/**
 * The shiki highlighter for `code-block.tsx` — imported asynchronously only
 * inside `code-block.tsx` (via its dynamic `import()`), so shiki's engines,
 * grammars and themes stay out of every consumer's main chunk until a surface
 * actually renders code. The language vocabulary itself is declared shiki-free
 * in `code-block-langs.ts` — pages import it from there, never from this
 * module (importing this module as a value pulls the shiki chunk in).
 *
 * Fine-grained shiki: the core plus exactly the two languages this tool
 * renders (extension-script sources and JSON payloads), one light/dark theme
 * pair, and the JavaScript regex engine (no WASM; the manifest's Chromium
 * floor covers the ES features the compiled grammars need). Grammars and
 * themes are static imports: the highlighter always loads all four at once,
 * so they ride this module's own lazy chunk — one fetch instead of a second
 * round of per-grammar chunks, and one stable chunk name to budget.
 */
import { createHighlighterCore, hastToHtml } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { CodeToHastOptions, GrammarState, HighlighterCore } from 'shiki/core';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import type { CodeLanguage } from './code-block-langs';

/** The light/dark theme pair — one resolved pair so code is always palette-paired. */
export const THEME_PAIR = { light: 'github-light', dark: 'github-dark' } as const;

/**
 * Token colors swapped per theme so every token clears WCAG AA (4.5:1) on the
 * code block's surface (`--surface-1` in each palette). The four theme
 * colors below fall short (on `#fafbfc` / `#111418`: keyword 4.42, tag 4.47,
 * `variable` 3.37; dark comment 3.84); each is replaced by the same role's
 * color from GitHub's current "default" theme family, keeping the look while
 * clearing AA (5.17 / 7.14 / 7.13 / 6.00). Keys are lowercase, as shiki
 * matches them. The colocated test proves every color of both themes,
 * after these swaps, against the surface tokens.
 */
export const COLOR_REPLACEMENTS = {
  [THEME_PAIR.light]: {
    '#d73a49': '#cf222e', // keyword, storage
    '#22863a': '#116329', // tag names, regexp escapes
    '#e36209': '#953800' // `variable` (bare scope)
  },
  [THEME_PAIR.dark]: {
    '#6a737d': '#8b949e' // comments
  }
} as const satisfies Record<string, Record<string, string>>;

/**
 * Lines at or above this length are emitted as plain text, untokenized
 * (shiki's `tokenizeMaxLineLength`). The JS grammar's time grows with the
 * square of a token's length — a 30 KB data-URI string blocks for seconds —
 * and measured on the registered grammar a 2,000-char string line costs
 * ≈ 15 ms, comfortably inside one 50 ms task; minified one-liners above it
 * stay readable, just uncolored.
 */
export const MAX_TOKENIZED_LINE = 2_000;

/**
 * Work budget of one highlighting slice (ms): {@link CodeHighlighter.highlightSliced}
 * tokenizes as many lines as fit, then yields to the event loop, so no block
 * ever holds the main thread for a long task (> 50 ms) — one line is the
 * smallest unit, and {@link MAX_TOKENIZED_LINE} bounds it.
 */
export const HIGHLIGHT_SLICE_MS = 8;

/** Lines tokenized in a block's first slice (later slices adapt to the measured pace). */
const FIRST_SLICE_LINES = 16;

/** Upper bound of one slice's line count (the pace estimate never runs away). */
const MAX_SLICE_LINES = 4_000;

/** A highlighted result: the full `<pre>` HTML, ready for a scoped `innerHTML`. */
export type HighlightedCode = string;

/** The lazy-loaded highlighter handle `code-block.tsx` consumes. */
export interface CodeHighlighter {
  /**
   * Highlight code text.
   *
   * **Safe for untrusted text:** shiki runs the code through a fixed
   * hast→HTML pipeline that HTML-escapes every text node — regression-pinned
   * against the real loader in `code-block-highlighter.test.ts` (hostile
   * inputs like `</span><img …>` and `<script>` survive only as escaped text
   * and never become markup), so the output cannot introduce an element from
   * the highlighted input. Only `transformers` could mutate generated markup,
   * and none are passed. Mounting the string is therefore a deliberate
   * `innerHTML` use, with that guarantee stated here.
   *
   * @param code The raw code text (may be untrusted page-sourced).
   * @param options The language of the text.
   * @returns The `<pre>` HTML with per-token light/dark colors.
   * @throws {@link Error} for a language outside the registered code-block
   *   language table (`CODE_BLOCK_LANGS` in `code-block-langs.ts`) — a
   *   call-site bug must fail at analysis time, not as an unstyled block.
   */
  highlight: (code: string, options: { lang: CodeLanguage }) => HighlightedCode;
  /**
   * Highlight code text in time slices: the same output as
   * {@link CodeHighlighter.highlight} (same safety contract), produced a few
   * lines at a time with the grammar state carried across slices and a yield
   * to the event loop between them, so a large block never becomes one long
   * task.
   *
   * @param code The raw code text.
   * @param options The language, an abort signal (stops at the next slice
   *   and rejects with its reason) and the yield seam (tests).
   * @returns The `<pre>` HTML.
   */
  highlightSliced: (
    code: string,
    options: { lang: CodeLanguage; signal?: AbortSignal; yieldToMain?: () => Promise<void> }
  ) => Promise<HighlightedCode>;
  /** Dispose the highlighter's state (tests; longer-lived surfaces keep it). */
  dispose: () => void;
}

/**
 * The one option set every highlight uses.
 *
 * @param lang The code's language.
 */
function hastOptions(lang: CodeLanguage): CodeToHastOptions {
  return {
    lang,
    // Dual themes with `light-dark()` as the default inline color: the
    // browser resolves the palette per element — the same mechanism as the
    // design tokens — so palette switching needs no appearance store or
    // re-render here (verified output: `color:light-dark(<light>, <dark>)`).
    themes: THEME_PAIR,
    defaultColor: 'light-dark()',
    // Theme-scoped swaps (keyed by theme name) lifting every token to AA.
    colorReplacements: COLOR_REPLACEMENTS,
    // Over-long lines render untokenized (see the constant's note).
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
    // The root `pre` gets no inline palette from shiki: the component's
    // token-styled container owns background/border/padding chrome.
    rootStyle: false,
    // No tab stop on shiki's `pre`: the component's code area owns
    // focusability, granting it only while the code overflows.
    tabindex: false
  };
}

/**
 * Yield to the event loop between slices: `scheduler.yield()` where the
 * platform has it (continuation keeps its priority), else a macrotask.
 */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The end offsets of the text's lines, exclusive of their break (`\n`, or
 * `\r\n` as one break — shiki's own line split).
 *
 * @param code The code text.
 * @returns One `[start, end)` pair per line.
 */
export function lineSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (;;) {
    const newline = code.indexOf('\n', start);
    if (newline === -1) {
      spans.push([start, code.length]);
      return spans;
    }
    spans.push([start, newline > start && code[newline - 1] === '\r' ? newline - 1 : newline]);
    start = newline + 1;
  }
}

/** The `<pre …><code>` head of a highlighted output (the shared root chrome). */
const CODE_OPEN = '<code>';
/** The `</code></pre>` tail. */
const CODE_CLOSE = '</code></pre>';

/**
 * Highlight in time slices (see {@link CodeHighlighter.highlightSliced}).
 * Each slice is a run of whole lines tokenized from the previous slice's
 * grammar state; the slices' line markup is joined exactly as shiki joins
 * lines (a `\n` text node), under the first slice's root chrome — the
 * result equals the one-shot output.
 *
 * @throws The signal's reason when aborted between slices.
 */
async function highlightInSlices(
  highlighter: HighlighterCore,
  code: string,
  lang: CodeLanguage,
  options: { signal?: AbortSignal; yieldToMain: () => Promise<void> }
): Promise<HighlightedCode> {
  const spans = lineSpans(code);
  const parts: string[] = [];
  let head = '';
  let state: GrammarState | undefined;
  let size = FIRST_SLICE_LINES;
  for (let first = 0; first < spans.length;) {
    options.signal?.throwIfAborted();
    const last = Math.min(first + size, spans.length) - 1;
    const text = code.slice(spans[first]?.[0] ?? 0, spans[last]?.[1] ?? 0);
    const started = performance.now();
    const root = highlighter.codeToHast(text, { ...hastOptions(lang), grammarState: state });
    state = highlighter.getLastGrammarState(root);
    const html = hastToHtml(root);
    const open = html.indexOf(CODE_OPEN) + CODE_OPEN.length;
    if (head === '') head = html.slice(0, open);
    parts.push(html.slice(open, html.length - CODE_CLOSE.length));
    const elapsed = performance.now() - started;
    const done = last + 1 - first;
    // Aim the next slice at the budget from this slice's pace.
    size = Math.max(
      1,
      Math.min(MAX_SLICE_LINES, Math.floor((done * HIGHLIGHT_SLICE_MS) / Math.max(elapsed, 0.5)))
    );
    first = last + 1;
    if (first < spans.length) await options.yieldToMain();
  }
  return `${head}${parts.join('\n')}${CODE_CLOSE}`;
}

/** The process-wide singleton promise — grammars are expensive to wire. */
let instance: Promise<CodeHighlighter> | undefined;

/**
 * Load (or reuse) the highlighter.
 *
 * The first call resolves the dynamic chunk; every later call shares the
 * singleton, so a page with many code blocks pays loading once.
 *
 * @returns The ready highlighter.
 */
export function getHighlighter(): Promise<CodeHighlighter> {
  instance ??= createHighlighterCore({
    langs: [javascript, json],
    // Fine-grained mode has no bundled registry: themes and langs are passed
    // as registrations, then addressed by their registration names (`THEME_PAIR`).
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  }).then((highlighter: HighlighterCore): CodeHighlighter => ({
    highlight: (code, options) => highlighter.codeToHtml(code, hastOptions(options.lang)),
    highlightSliced: (code, options) =>
      highlightInSlices(highlighter, code, options.lang, {
        signal: options.signal,
        yieldToMain: options.yieldToMain ?? yieldToMain
      }),
    dispose: () => {
      highlighter.dispose();
    }
  }));
  return instance;
}

/**
 * Peek the singleton for tests (they await the loader in isolation).
 *
 * @returns The loading promise when scheduled; `undefined` otherwise.
 */
export function pendingHighlighter(): Promise<CodeHighlighter> | undefined {
  return instance;
}

/**
 * Forget the singleton so a fresh module graph starts clean (tests; reload
 * scenarios simply re-trigger the load path).
 */
export function resetHighlighter(): void {
  instance = undefined;
}
