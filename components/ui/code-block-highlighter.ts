/**
 * The shiki highlighter for `code-block.tsx` — loaded **only inside the
 * highlight worker** (`code-block-highlight.worker.ts`), so shiki's engine,
 * grammars and themes never run on (or ship with) the main thread: a page
 * imports `CodeBlock`, which talks to the worker through the shiki-free
 * client in `code-block-worker-client.ts`. The language vocabulary is
 * declared shiki-free in `code-block-langs.ts`.
 *
 * Fine-grained shiki: the core plus exactly the languages this tool renders
 * (`CODE_BLOCK_LANGS`), one light/dark theme pair, and the JavaScript regex
 * engine (no WASM). Script and JSON grammars ship inside the worker; the
 * stylesheet and markup ones are fetched on their language's first block
 * (`GRAMMAR_SOURCES`). Tokenizing runs over the whole block — the grammar
 * state is always right — and its cost is the worker's problem: the client
 * bounds it (grammar fetch included) with a hard per-block time budget.
 */
import { addClassToHast, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type {
  CodeToHastOptions,
  HighlighterCore,
  LanguageRegistration,
  ShikiTransformer
} from 'shiki/core';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import { createLogger } from '../../lib/logger';
import type { CodeLanguage } from './code-block-langs';
import { tokenClassName, type TokenStyle } from './code-block-token-styles';

/** Grammar fetch failures (the block stays plain; a later block retries). */
const logger = createLogger('code-highlighter');

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
 * Lines at or above this length come back untokenized — plain text inline,
 * while the rest of the block colors (shiki's `tokenizeMaxLineLength`). The
 * grammar's time grows with the square of one token's length, so a giant
 * single line (a data URI, a minified bundle, a long CJK config line) would
 * otherwise spend the whole worker budget and leave the entire block plain.
 * Measured on the registered grammar (node, 2026-10-14): 17 lines of a
 * 1,856-char CJK config take 2.4 s and 15 quoted 1,980-char lines 3 s at a
 * 2,000 cap, both ≈ 0 ms at 1,500, while the heaviest block of ordinary
 * lines (60 quoted 480-char lines) stays ≈ 0.7 s either way.
 */
export const MAX_TOKENIZED_LINE = 1_500;

/** A highlighted result: the full `<pre>` HTML, ready for a scoped `innerHTML`. */
export type HighlightedCode = string;

/**
 * One highlighted block: its markup, whose tokens carry **class names**, and
 * the declarations of those classes. Classes instead of per-span inline
 * styles: the browser matches a handful of shared rules instead of parsing a
 * style attribute on every token, which made style recalculation the
 * dominant cost of mounting a large block.
 */
export interface HighlightResult {
  readonly html: HighlightedCode;
  /** `[className, declarations]` for every token class the markup uses. */
  readonly styles: readonly TokenStyle[];
}

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
   * the highlighted input. Only `transformers` could mutate generated markup;
   * the one passed (`styleToClass`) only moves each token's `style` into a
   * generated class name (`fdt-tk-<hash>`), never touching text. Mounting the
   * string is therefore a deliberate `innerHTML` use, with that guarantee
   * stated here.
   *
   * @param code The raw code text (may be untrusted page-sourced).
   * @param options The language of the text.
   * @returns The `<pre>` HTML with class-tagged tokens, and the classes' light/dark rules.
   * @throws {@link Error} (rejection) for a language outside the grammar
   *   sources (a call-site bug must fail loudly, not as an unstyled block),
   *   or when the language's on-demand grammar failed to load (retried on
   *   the next block of that language).
   */
  highlight: (code: string, options: { lang: CodeLanguage }) => Promise<HighlightResult>;
  /** Dispose the highlighter's state (tests; longer-lived surfaces keep it). */
  dispose: () => void;
}

/**
 * The one option set every highlight uses.
 *
 * @param lang The code's language.
 * @param transformer The style-to-class transformer collecting this block's classes.
 */
function hastOptions(lang: CodeLanguage, transformer: ShikiTransformer): CodeToHastOptions {
  return {
    lang,
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
    transformers: [transformer],
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
  };
}

/**
 * A transformer moving each token's inline `style` into a class named after
 * the declarations (`tokenClassName`), collecting `[class, declarations]`
 * into `styles`. Shiki's dual-theme style also carries per-theme custom
 * properties (`--shiki-light`/`--shiki-dark`) nothing here reads; only the
 * rendering declarations (`color`, font style/weight, decoration) are kept.
 *
 * @param styles The block's collected classes (filled in place).
 */
export function styleToClass(styles: Map<string, string>): ShikiTransformer {
  return {
    name: 'fdt-style-to-class',
    span(node) {
      const style = node.properties['style'];
      if (typeof style !== 'string') return;
      const declarations = style
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part !== '' && !part.startsWith('--'))
        .join(';');
      delete node.properties['style'];
      if (declarations === '') return;
      const className = tokenClassName(declarations);
      styles.set(className, declarations);
      addClassToHast(node, className);
    }
  };
}

/**
 * Where a language's grammar comes from: compiled into the worker
 * (`bundled`), or fetched on the language's first block (`on-demand`).
 */
export type GrammarSource =
  | { readonly kind: 'bundled'; readonly grammar: LanguageRegistration[] }
  | { readonly kind: 'on-demand'; readonly load: () => Promise<LanguageRegistration[]> };

/**
 * One grammar source per code-block language — an exhaustive record, so a
 * language added to `CODE_BLOCK_LANGS` fails to compile until it gets one.
 * Script and JSON blocks are the common case and pay no fetch; CSS and
 * HTML share one chunk (the HTML grammar embeds CSS and JavaScript, which
 * the bundle keeps single: JavaScript stays in the worker, imported back).
 */
export const GRAMMAR_SOURCES: Readonly<Record<CodeLanguage, GrammarSource>> = {
  javascript: { kind: 'bundled', grammar: javascript },
  json: { kind: 'bundled', grammar: json },
  css: { kind: 'on-demand', load: async () => (await import('./code-block-web-grammars')).css },
  html: { kind: 'on-demand', load: async () => (await import('./code-block-web-grammars')).html }
};

/**
 * Create a highlighter over the given grammar sources: the bundled grammars
 * are registered up front, each on-demand one on its language's first block
 * (one load in flight per language; a failed load is forgotten, so the next
 * block retries instead of every later block failing).
 *
 * @param sources The grammar per language (default {@link GRAMMAR_SOURCES}; tests inject failures).
 * @returns The ready highlighter.
 */
export async function createCodeHighlighter(
  sources: Readonly<Record<CodeLanguage, GrammarSource>> = GRAMMAR_SOURCES
): Promise<CodeHighlighter> {
  const highlighter: HighlighterCore = await createHighlighterCore({
    langs: Object.values(sources).flatMap((source) =>
      source.kind === 'bundled' ? source.grammar : []
    ),
    // Fine-grained mode has no bundled registry: themes and langs are passed
    // as registrations, then addressed by their registration names (`THEME_PAIR`).
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  });
  const loading = new Map<CodeLanguage, Promise<void>>();

  /** Resolve once `lang`'s grammar is registered; rejects for an unknown language or a failed load. */
  const ensureGrammar = (lang: CodeLanguage): Promise<void> => {
    // Own-key check: the language crossed a thread boundary as data.
    if (!Object.hasOwn(sources, lang)) {
      return Promise.reject(new Error(`Code highlighter: unsupported language "${lang}".`));
    }
    const source = sources[lang];
    if (source.kind === 'bundled') return Promise.resolve();
    let pending = loading.get(lang);
    if (pending === undefined) {
      pending = source
        .load()
        .then((grammar) => highlighter.loadLanguage(...grammar))
        .catch((error: unknown) => {
          loading.delete(lang);
          logger.warn(`The ${lang} grammar failed to load; the block stays plain.`, error);
          throw error;
        });
      loading.set(lang, pending);
    }
    return pending;
  };

  return {
    highlight: async (code, options) => {
      await ensureGrammar(options.lang);
      const styles = new Map<string, string>();
      const html = highlighter.codeToHtml(code, hastOptions(options.lang, styleToClass(styles)));
      return { html, styles: [...styles] };
    },
    dispose: () => {
      highlighter.dispose();
    }
  };
}

/** The process-wide singleton promise — grammars are expensive to wire. */
let instance: Promise<CodeHighlighter> | undefined;

/**
 * Load (or reuse) the highlighter.
 *
 * The first call creates it; every later call shares the singleton, so a
 * page with many code blocks pays loading once.
 *
 * @returns The ready highlighter.
 */
export function getHighlighter(): Promise<CodeHighlighter> {
  instance ??= createCodeHighlighter();
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
