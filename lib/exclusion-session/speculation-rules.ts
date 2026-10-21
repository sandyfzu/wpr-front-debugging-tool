/**
 * The session's speculation-rules step: while a session is active, the
 * documents it serves carry no speculation rules — a navigation the
 * browser prefetched or prerendered is served from that copy and never
 * reaches interception, so it would render unmodified behind a record
 * that says otherwise. Removing the rules keeps every navigation on the
 * network, where the backend intercepts it.
 *
 * Removes inline rule scripts (`<script type="speculationrules">`) and the
 * same scripts held back by a delayed-execution rewrite
 * (`data-rocket-type="speculationrules"`: the delay runner would insert
 * them live on first interaction). Rules a page's own scripts insert at
 * runtime are outside the document text: {@link SPECULATION_RULES_GUARD_SOURCE}
 * is the page-world script a backend runs in each new document of a
 * session tab to remove them as they are inserted (removing a rule script
 * withdraws its rules, cancelling their pending prefetches). The
 * `Speculation-Rules` response header is the backend's to drop.
 */
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { applyPatches } from '../exclusion-builder/tag-edit';
import { DELAY_TYPE_ATTRIBUTE } from '../exclusion-builder/delay-js';

/** The script type naming speculation rules (HTML: compared ASCII-case-insensitively, trimmed). */
const SPECULATION_RULES_TYPE = 'speculationrules';

/** The attributes whose value can make a script a rule script: the live type and its delayed form. */
const TYPE_ATTRIBUTES: readonly string[] = ['type', DELAY_TYPE_ATTRIBUTE];

/** ASCII whitespace (HTML "strip leading and trailing ASCII whitespace"). */
const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** What removing the rules produced. */
export interface SpeculationRulesRemoval {
  /** The document text without its rule scripts (the input itself when there were none). */
  readonly html: string;
  /** How many rule scripts were removed. */
  readonly removed: number;
}

/** Whether a scanned tag is a rule script (live or delayed). */
function isRuleScript(tag: ScannedTag): boolean {
  if (tag.name !== 'script') return false;
  return tag.attrs.some(
    (attr) =>
      TYPE_ATTRIBUTES.includes(attr.name) &&
      attr.value !== null &&
      attr.value.replace(ASCII_WHITESPACE, '').toLowerCase() === SPECULATION_RULES_TYPE
  );
}

/**
 * Remove every speculation-rule script element (opening tag through its
 * end tag) from a document.
 *
 * @param html The document text.
 * @returns The text without rule scripts and how many were removed.
 */
export function removeSpeculationRules(html: string): SpeculationRulesRemoval {
  // Cheap gate: a document that never names the type has no rule script.
  if (!html.toLowerCase().includes(SPECULATION_RULES_TYPE)) return { html, removed: 0 };
  const patches = scanTags(html)
    .filter(isRuleScript)
    .map((tag) => ({ start: tag.start, end: tag.end, text: '' }));
  return { html: applyPatches(html, patches), removed: patches.length };
}

/**
 * The page-world guard a backend evaluates at the start of every new
 * document of a session tab: a `MutationObserver` that removes each
 * speculation-rule script (same type test as above) as soon as it is
 * inserted, anywhere in the document. Self-contained (no closure over this
 * module), silent (any fault is swallowed — it must never break or log
 * into the host page), and idempotent (a second copy only removes
 * nothing).
 */
export const SPECULATION_RULES_GUARD_SOURCE = `(() => {
  try {
    const isRule = (node) =>
      node.nodeType === 1 &&
      node.localName === 'script' &&
      /^[\\t\\n\\f\\r ]*speculationrules[\\t\\n\\f\\r ]*$/i.test(node.getAttribute('type') || '');
    const sweep = (node) => {
      if (isRule(node)) node.remove();
      else if (node.nodeType === 1) for (const script of node.querySelectorAll('script')) if (isRule(script)) script.remove();
    };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) sweep(node);
    }).observe(document, { childList: true, subtree: true });
  } catch {}
})();`;
