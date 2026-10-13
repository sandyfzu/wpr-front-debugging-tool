/**
 * The shiki highlighter for `code-block.tsx` — loaded **only** through a
 * dynamic `import()` (see `code-block.tsx`), never through the static graph:
 * shiki's engines, grammars and themes stay out of every entrypoint's main
 * chunk until a surface actually renders code.
 *
 * Fine-grained shiki: the core plus exactly the two languages this tool
 * renders (WA-script sources and JSON payloads), one light/dark theme pair,
 * and the JavaScript regex engine (no WASM; the manifest's Chromium floor
 * covers the ES features the compiled grammars need).
 */
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterCore } from 'shiki/core';

/** The languages registered in the highlighter, one per data kind this tool renders. */
export const CODE_BLOCK_LANGS = ['javascript', 'json'] as const;

/** One code-block language. A call-site constant, never page-sourced. */
export type CodeLanguage = (typeof CODE_BLOCK_LANGS)[number];

/** The light/dark theme pair — one resolved pair so code is always palette-paired. */
const THEME_PAIR = { light: 'github-light', dark: 'github-dark' } as const;

/** A highlighted result: the full `<pre>` HTML, ready for a scoped `innerHTML`. */
export type HighlightedCode = string;

/** The lazy-loaded highlighter handle `code-block.tsx` consumes. */
export interface CodeHighlighter {
  /**
   * Highlight code text.
   *
   * **Safe for untrusted text:** shiki runs the code through a fixed
   * hast→HTML pipeline that HTML-escapes every text node — empirically pinned
   * (a `</span><img …>` input survives only as escaped text and never becomes
   * markup), so the output cannot introduce an element from the highlighted
   * input. Only `transformers` could mutate generated markup, and none are
   * passed. Mounting the string is therefore a deliberate `innerHTML` use,
   * with that guarantee stated here.
   *
   * @param code The raw code text (may be untrusted page-sourced).
   * @param options The language of the text.
   * @returns The `<pre>` HTML with per-token light/dark colors.
   * @throws {@link Error} for a language outside {@link CODE_BLOCK_LANGS} —
   *   a call-site bug must fail at analysis time, not as an unstyled block.
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
    langs: [import('shiki/langs/javascript.mjs'), import('shiki/langs/json.mjs')],
    // Fine-grained mode has no bundled registry: themes and langs load as
    // modules and are then addressed by their registration names (`THEME_PAIR`).
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
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
        // The root `pre` gets no inline palette from shiki: the component's
        // token-styled container owns background/border/padding chrome.
        rootStyle: false,
        // The code surface stays out of the tab order (hovering lives on the
        // owning surface's scroll logic; the wrap toggle owns horizontal flow).
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
