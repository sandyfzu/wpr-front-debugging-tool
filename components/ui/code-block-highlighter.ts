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
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterCore } from 'shiki/core';
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
  /** Dispose the highlighter's state (tests; longer-lived surfaces keep it). */
  dispose: () => void;
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
  }).then((highlighter: HighlighterCore) => ({
    highlight: (code, options) =>
      highlighter.codeToHtml(code, {
        lang: options.lang,
        // Dual themes with `light-dark()` as the default inline color: the
        // browser resolves the palette per element — the same mechanism as the
        // design tokens — so palette switching needs no appearance store or
        // re-render here (verified output: `color:light-dark(<light>, <dark>)`).
        themes: THEME_PAIR,
        defaultColor: 'light-dark()',
        // Theme-scoped swaps (keyed by theme name) lifting every token to AA.
        colorReplacements: COLOR_REPLACEMENTS,
        // The root `pre` gets no inline palette from shiki: the component's
        // token-styled container owns background/border/padding chrome.
        rootStyle: false,
        // No tab stop on shiki's `pre`: the component's code area owns
        // focusability, granting it only while the code overflows.
        tabindex: false
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
