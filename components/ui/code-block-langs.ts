/**
 * The code-block language table — the shiki-free declaring site of the
 * code-highlight vocabulary (`javascript`, `json`, `css`, `html`).
 *
 * It exists so pages and the code block itself can import the vocabulary as
 * **values** without pulling the highlighter module in: the vocabulary lives
 * here, the shiki assembly lives in `code-block-highlighter.ts` and is
 * reached only through its dynamic `import()` from `code-block.tsx`. Keeping
 * the two apart is what keeps shiki's engines and grammars out of every
 * consumer's static chunk — a property proven by an esbuild consumer spike
 * (entry/eager chunk free of shiki, the lazy chunk carrying it) during audit
 * round 2026-10-12.
 */

/**
 * The languages the highlighter renders, one per data kind this tool shows:
 * script sources, JSON payloads, stylesheets and served markup (tags).
 */
export const CODE_BLOCK_LANGS = ['javascript', 'json', 'css', 'html'] as const;

/** One code-block language. A call-site constant, never page-sourced. */
export type CodeLanguage = (typeof CODE_BLOCK_LANGS)[number];
