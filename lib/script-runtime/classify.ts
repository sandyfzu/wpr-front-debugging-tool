/**
 * Classifies one live `<script>` for the runtime view: its Delay JS state,
 * where it comes from (theme, plugin, inline, other) and what to show of it.
 * The executor copies each element's attributes and text into a plain
 * {@link ScriptDescriptor} first — nothing here touches the DOM, and no
 * script is skipped (structured data and unmatched sources included).
 *
 * Delay JS runtime states (WP Rocket's runtime stamps `data-rocket-status`;
 * values read from its 3.23.5.1/3.24 runtime): `executed`, `failed-network`,
 * `failed-transform`, `skipped` (a `nomodule` script in a module-capable
 * browser). A delayed script without the attribute has not run yet.
 *
 * Known limit — the script being loaded: the runtime restores its `type`
 * (or replaces the element) and moves `data-rocket-src` to `src` before the
 * load, and stamps the status only once it loaded or failed. Meanwhile that
 * one script reads `not-delayed` (the runtime loads one at a time, so at most
 * one, briefly); reading again after it settles shows its real state.
 */

import { capText } from '../../utils/cap-text';
import {
  isDelayedScriptType,
  servedSrcOf,
  type ScriptSrcAttributes
} from '../wp-rocket/delayed-script';

/**
 * What the executor copies out of one `<script>` element: `type`,
 * `data-rocket-src` and `src` as written (null when absent), plus these.
 */
export interface ScriptDescriptor extends ScriptSrcAttributes {
  /** `data-rocket-status`, or null when absent. */
  readonly status: string | null;
  /** The `id` property (`''` when absent). */
  readonly id: string;
  /** The class names, in order. */
  readonly classes: readonly string[];
  /** The script's text content. */
  readonly text: string;
}

/** A script's Delay JS state. */
export type ScriptRuntimeState =
  | 'executed'
  | 'failed'
  | 'skipped'
  /** Delayed, not run yet (no user interaction so far). */
  | 'pending'
  | 'not-delayed'
  /** A status value this version does not know (kept raw). */
  | 'unknown';

/** Where a script comes from. */
export type ScriptGroup = 'theme' | 'plugin' | 'inline' | 'other';

/** How the source is shown. */
export type ScriptSourceKind =
  | 'url'
  /** No URL: the code is in the tag. */
  | 'inline'
  /** Delay JS turned the inline code into a base64 `data:` URL to run it (the URL is not kept). */
  | 'converted-inline';

/** One classified script. */
export interface ScriptRuntimeRecord {
  readonly state: ScriptRuntimeState;
  /** The `data-rocket-status` value as found (capped), or null. */
  readonly rawStatus: string | null;
  readonly group: ScriptGroup;
  /** A JSON-LD block (`application/ld+json`): data, never run. */
  readonly structuredData: boolean;
  readonly sourceKind: ScriptSourceKind;
  /** The URL (capped) when {@link sourceKind} is `url`, else `''`. */
  readonly source: string;
  readonly id: string;
  readonly classes: readonly string[];
  /** The trimmed text's first {@link PREVIEW_MAX} code points (ellipsis when longer). */
  readonly preview: string;
  /** The trimmed text, up to {@link FULL_TEXT_MAX} code points (ellipsis when longer). */
  readonly fullText: string;
}

/** Code points in a text preview. */
export const PREVIEW_MAX = 80;

/** Code points kept of a script's full text. */
export const FULL_TEXT_MAX = 65_536;

/** Code points kept of a URL, status, id or class. */
export const FIELD_MAX = 2048;

/** Classes kept per script. */
export const CLASSES_MAX = 50;

/** The prefix of the `data:` URL Delay JS runs a converted inline script from. */
export const CONVERTED_INLINE_PREFIX = 'data:text/javascript;base64';

/** The structured-data script type. */
const JSON_LD_TYPE = 'application/ld+json';

/** Status values by state (anything starting with `failed` is a failure). */
const STATUS_STATES: Readonly<Record<string, ScriptRuntimeState>> = {
  executed: 'executed',
  skipped: 'skipped'
};

/** The status prefix every failure value carries (`failed-network`, `failed-transform`). */
const FAILED_PREFIX = 'failed';

/**
 * Whether Delay JS handles the script: a `type` its runtime loads (the
 * shared delayed-type rule) or a runtime status (a replaced element keeps only the status).
 *
 * @param script The descriptor.
 * @returns `true` when Delay JS handles (or handled) the script.
 */
export function isDelayed(script: Pick<ScriptDescriptor, 'type' | 'status'>): boolean {
  return script.status !== null || isDelayedScriptType(script.type);
}

/**
 * The Delay JS state.
 *
 * @param script The descriptor.
 * @returns The state; `unknown` for an unrecognized status value.
 */
export function runtimeState(
  script: Pick<ScriptDescriptor, 'type' | 'status'>
): ScriptRuntimeState {
  const status = script.status;
  if (status === null) return isDelayed(script) ? 'pending' : 'not-delayed';
  const known = Object.hasOwn(STATUS_STATES, status) ? STATUS_STATES[status] : undefined;
  if (known !== undefined) return known;
  return status.startsWith(FAILED_PREFIX) ? 'failed' : 'unknown';
}

/**
 * The script's source URL, by the one served-URL rule: a delayed tag's
 * non-empty `data-rocket-src`, else `src`.
 *
 * @param script The descriptor.
 * @returns The URL, or `''` when the script names none.
 */
export function sourceUrl(script: ScriptSrcAttributes): string {
  return servedSrcOf(script) ?? '';
}

/**
 * The group of a source URL: inline without one, else theme or plugin by
 * the first of `themes` / `plugins` it contains (any case — the WordPress
 * directory comes before any later path segment), else other.
 *
 * @param url The source URL (`''` for none).
 * @param kind The source kind.
 * @returns The group.
 */
export function sourceGroup(url: string, kind: ScriptSourceKind): ScriptGroup {
  if (kind !== 'url') return 'inline';
  const lower = url.toLowerCase();
  const theme = lower.indexOf('themes');
  const plugin = lower.indexOf('plugins');
  if (theme === -1 && plugin === -1) return 'other';
  if (plugin === -1) return 'theme';
  if (theme === -1) return 'plugin';
  return theme < plugin ? 'theme' : 'plugin';
}

/**
 * The source kind of a URL.
 *
 * @param url The source URL (`''` for none).
 * @returns `inline`, `converted-inline` or `url`.
 */
export function sourceKind(url: string): ScriptSourceKind {
  if (url === '') return 'inline';
  return url.startsWith(CONVERTED_INLINE_PREFIX) ? 'converted-inline' : 'url';
}

/**
 * Whether the script is a JSON-LD block.
 *
 * @param type The `type` attribute.
 * @returns `true` for `application/ld+json` (trimmed, any case).
 */
export function isStructuredData(type: string | null): boolean {
  return type?.trim().toLowerCase() === JSON_LD_TYPE;
}

/**
 * Classify one script.
 *
 * @param script The descriptor.
 * @returns The record (plain, frozen, bounded).
 */
export function classifyScript(script: ScriptDescriptor): ScriptRuntimeRecord {
  const url = sourceUrl(script);
  const kind = sourceKind(url);
  const text = script.text.trim();
  return Object.freeze({
    state: runtimeState(script),
    rawStatus: script.status === null ? null : capText(script.status, FIELD_MAX),
    group: sourceGroup(url, kind),
    structuredData: isStructuredData(script.type),
    sourceKind: kind,
    source: kind === 'url' ? capText(url, FIELD_MAX) : '',
    id: capText(script.id, FIELD_MAX),
    classes: Object.freeze(
      script.classes.slice(0, CLASSES_MAX).map((name) => capText(name, FIELD_MAX))
    ),
    preview: capText(text, PREVIEW_MAX),
    fullText: capText(text, FULL_TEXT_MAX)
  });
}
