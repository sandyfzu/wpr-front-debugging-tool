/**
 * The Undefined References page's pure engine: given the page's script
 * sources and the error words collected from the page, find where each word
 * gets its value — the definition sites. Three pieces, all unit-testable:
 *
 * - {@link findDefinitions} — the batch query over a set of assets
 *   (the word list → per-word definition origins), whose regex is
 *   behavior-verbatim: declaration + assignment alternation, `gm` flags,
 *   and the reference's identifier-boundary set (a `#` next to an identifier
 *   does not break it).
 * - {@link loadScriptAssets} — the inspected-window asset loading, all
 *   script resources + the Delay-JS inline stack in one settle; zero script
 *   resources resolves to the inline stack alone (an empty page resolves
 *   `[]`, never forever), and a resource whose content cannot be read
 *   contributes nothing rather than poisoning the search.
 * - {@link refreshDefinitions} — the incremental re-analysis: a refresh of
 *   the word list runs the query only for words it has never seen, reusing
 *   prior results through a per-word memo (a new push lane instead of a
 *   full-page re-scan every update). The memo is valid for the asset list it
 *   was built over — a new page's assets mean a fresh memo (the owning
 *   surface resets it when the page reloads).
 *
 * Asset identity is a typed discriminator ({@link ScriptOrigin.kind}) so the
 * definitions list can render inline entries as chips and URL entries as
 * links without string-matching.
 */

import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../wp-rocket/constants';

/**
 * Where one definition lives. `inline` entries come from the page's own
 * inline scripts (rendered as inline chips, never as the pseudo-URL link
 * that mis-rendered before); `url` entries are real script files.
 */
export type ScriptOrigin =
  { readonly kind: 'inline' } | { readonly kind: 'url'; readonly url: string };

/** One script source the query runs over, with its typed origin. */
export interface ScriptAsset {
  readonly origin: ScriptOrigin;
  readonly content: string;
}

/** One word's answer: the origins where the word is (probably) defined. */
export interface WordDefinition {
  readonly word: string;
  /** Matching assets' origins, in asset order, one entry per asset. */
  readonly definitions: readonly ScriptOrigin[];
}

/**
 * What the loader reads from the Delay JS inventory: the inline scripts'
 * source text comes from the script records' `content` (a record without
 * one is not an inline script source).
 */
export interface InlineScriptSource {
  readonly content?: string;
}

/** The inspected-window loader's seam (the real `browser.devtools.inspectedWindow` satisfies it). */
export interface InspectedWindowResources {
  getResources(onComplete: (resources: readonly InspectedScriptResource[]) => void): void;
}

/**
 * One inspected-window resource. The runtime field `type` is outside the
 * published typings, so it is read as the optional string it actually is:
 * only `'script'` values with an http(s) URL become text sources.
 */
export interface InspectedScriptResource {
  readonly url: string;
  readonly type?: string;
  getContent(onContent: (content: string | null | undefined) => void): void;
}

/**
 * Hardened identifier word for the definition regex. Words come from page
 * error messages — arbitrary text under page control — and raw
 * interpolation into `new RegExp` would have their regex metacharacters
 * reinterpreted as syntax: a `(` reshaped the alternation into a different
 * query (fabricating "definitions" for words nobody searched), a `$`
 * collapsed into an end-anchor. Escaping every metacharacter pins the
 * query's meaning to the literal identifier, and non-special words (the
 * realistic case — error texts name real identifiers) compile to exactly
 * the same pattern they did before the hardening.
 */
function escapeDefinitionWord(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The definition query, escaped-word interpolated: declaration + a boundary
 * the identifier ends at (`[^a-zA-Z0-9_$#]` or line end), or the word
 * preceded by a boundary and followed by an assignment. `gm` flags; the
 * reference's own boundary set.
 */
function definitionPattern(escapedWord: string): RegExp {
  return new RegExp(
    `(((var|let|const|function) +)${escapedWord}(([^a-zA-Z0-9_$#])|$))|((^|([^a-zA-Z0-9_$#]))${escapedWord}( *(=|:)))`,
    'gm'
  );
}

/**
 * One word's definition search over the asset list: every asset whose source
 * matches the word's query contributes its origin, in asset order.
 *
 * The captured cross-origin sentinel word is answered with no definitions:
 * its browser-side redaction means the asset inspection can say nothing
 * (the page explains it instead of searching).
 *
 * @param word The undefined-reference word (page-controlled; safe — escaped).
 */
function findWordDefinitions(
  word: string,
  assets: readonly ScriptAsset[]
): readonly ScriptOrigin[] {
  if (word === UNDEFINED_REFERENCE_EXTERNAL_ERROR) return [];
  // Every asset is visited once; two matching assets for the same word each
  // contribute their origin, but an asset cannot list itself twice.
  const pattern = definitionPattern(escapeDefinitionWord(word));
  const definitions: ScriptOrigin[] = [];
  for (const asset of assets) {
    if (asset.content.match(pattern) !== null) {
      const last = definitions.at(-1);
      if (last !== undefined && sameOrigin(last, asset.origin)) continue;
      definitions.push(asset.origin);
    }
  }
  return definitions;
}

/** Structural equality for two origins (the dedupe comparison). */
function sameOrigin(left: ScriptOrigin, right: ScriptOrigin): boolean {
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url;
  return left.kind === right.kind;
}

/**
 * The batch definition search — the word list → per-word definitions, in the
 * word list's order. (The incremental flow uses {@link refreshDefinitions};
 * this is the plain one-shot call.)
 *
 * @param scriptAssets The page's script sources (see {@link loadScriptAssets}).
 * @param words The undefined-reference words collected from the page.
 */
export function findDefinitions(
  scriptAssets: readonly ScriptAsset[],
  words: readonly string[]
): WordDefinition[] {
  return words.map((word) => ({
    word,
    definitions: findWordDefinitions(word, scriptAssets)
  }));
}

/**
 * Load the page's script sources: every inspected-window resource of type
 * `script` with an http(s) URL (its readable content; one whose content
 * cannot be read — the resource never loaded, encoding refused it — is
 * recorded as nothing instead of a null-poisoned source), after the page's
 * own inline scripts joined in one order into a single inline asset.
 *
 * Every resource's content is awaited together, so zero script resources
 * (an `about:`-only page, no external scripts yet) resolves to the inline
 * stack alone — and an all-empty page resolves `[]` — instead of the
 * settle hanging forever on a last-index that never arrives.
 *
 * @param inspectedWindow The devtools inspected-window API (the loader's
 *   seam; the real `browser.devtools.inspectedWindow` satisfies it).
 * @param inlineScripts The Delay JS record's scripts, whose string contents
 *   are the page's inline sources, first-occurrence order.
 */
export async function loadScriptAssets(
  inspectedWindow: InspectedWindowResources,
  inlineScripts: readonly InlineScriptSource[]
): Promise<ScriptAsset[]> {
  const external = await new Promise<ScriptAsset[]>((resolve) => {
    inspectedWindow.getResources((resources) => {
      const readable = resources.filter(
        (resource) => resource.type === 'script' && resource.url.startsWith('http')
      );
      // Every resource is its own promise; the asset list settles when all
      // of them do — never keyed to one lucky callback. Each resource keeps
      // its own content (paired at the map, no index re-arithmetic), and an
      // unreadable content contributes nothing.
      resolve(
        Promise.all(
          readable.map((resource) =>
            readResourceContent(resource).then((content): ScriptAsset | null =>
              content === null ? null : { origin: { kind: 'url', url: resource.url }, content }
            )
          )
        ).then((assets) => assets.filter((asset): asset is ScriptAsset => asset !== null))
      );
    });
  });
  const inline = joinInlineScripts(inlineScripts);
  return inline === null ? external : [...external, inline];
}

/** Read one resource's content through its callback API (a promise seam). */
function readResourceContent(resource: InspectedScriptResource): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      resource.getContent((content) => {
        resolve(typeof content === 'string' ? content : null);
      });
    } catch {
      // Content read failed — the resource contributes nothing.
      resolve(null);
    }
  });
}

/** Join the page's inline sources into one inline asset (null with none). */
function joinInlineScripts(inlineScripts: readonly InlineScriptSource[]): ScriptAsset | null {
  const contents: string[] = [];
  for (const script of inlineScripts) {
    if (typeof script.content === 'string') contents.push(script.content);
  }
  if (contents.length === 0) return null;
  return { origin: { kind: 'inline' }, content: contents.join('\n\n') };
}

/**
 * One refresh's answer: the word list's definitions (the full list, in its
 * first-occurrence order), the memo behind them for the next refresh, and
 * the split of what this refresh did — `recomputed` names the words whose
 * query actually ran, `memoHits` names the words whose prior result was
 * reused (its length is the memo hit count).
 */
export interface DefinitionsRefresh {
  readonly definitions: readonly WordDefinition[];
  readonly memo: ReadonlyMap<string, readonly ScriptOrigin[]>;
  readonly recomputed: readonly string[];
  readonly memoHits: readonly string[];
}

/**
 * Refresh the word list's definitions against the asset list, recomputing
 * only the words the memo has never answered. New words are queried (push
 * lane: an update that adds one word runs one query); known words reuse
 * their cached answer asset-for-asset — see the memo's validity rule in the
 * module header (one asset list per memo).
 *
 * @param prior The previous refresh's memo (empty for a first analysis).
 * @param words The current word list — the merged total, not just the
 *   advance; both sides of the list (already-cached + new words) run.
 * @param assets The page's script sources.
 */
export function refreshDefinitions(
  prior: ReadonlyMap<string, readonly ScriptOrigin[]>,
  words: readonly string[],
  assets: readonly ScriptAsset[]
): DefinitionsRefresh {
  const memo = new Map(prior);
  const definitions: WordDefinition[] = [];
  const recomputed: string[] = [];
  const memoHits: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    // A repeated word in one push (path-duplicated sources merge away
    // upstream; being defensive here keeps the list honest) answers once.
    if (seen.has(word)) continue;
    seen.add(word);
    const cached = memo.get(word);
    if (cached !== undefined) {
      memoHits.push(word);
      definitions.push({ word, definitions: cached });
      continue;
    }
    const computed = findWordDefinitions(word, assets);
    memo.set(word, computed);
    recomputed.push(word);
    definitions.push({ word, definitions: computed });
  }
  return { definitions, memo, recomputed, memoHits };
}
