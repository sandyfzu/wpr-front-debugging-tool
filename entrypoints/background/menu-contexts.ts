/**
 * Translation of the menu registry's browser-agnostic contexts into the
 * context names the running extension platform accepts.
 *
 * The toolbar button's own menu is named by manifest version, not by
 * browser: Manifest V3 calls it `'action'`, Manifest V2 `'browser_action'`.
 * Firefox validates the name against the running manifest version and throws
 * synchronously on the other one, so the registry names the place abstractly
 * and the creation boundary translates it here. On Manifest V3 the
 * translation is the identity — those rows reach the browser exactly as the
 * registry spells them. Callers pass the version in (pure); the runtime
 * reaches this module only from Manifest V2 builds.
 */

import type { Browser } from 'wxt/browser';

/**
 * Every in-page context a right-click can report — the page itself, a frame,
 * a selection, a link, an editable field, an image, a video, an audio — and
 * nothing outside the page. Unlike `'all'`, none of these names includes the
 * toolbar button's own menu (capped at 6 top-level rows by Chromium and
 * Firefox alike), so page-only rows never compete for those slots. Both
 * browsers declare every name, with the same meaning, on both manifest
 * versions; Firefox also reports a password field as `'editable'` unless it
 * is read-only.
 */
export const PAGE_CONTENT_CONTEXTS = [
  'page',
  'frame',
  'selection',
  'link',
  'editable',
  'image',
  'video',
  'audio'
] as const;

/** One in-page context name (see {@link PAGE_CONTENT_CONTEXTS}). */
export type PageContentContext = (typeof PAGE_CONTENT_CONTEXTS)[number];

/**
 * Where a registry entry may show: every context (page and toolbar button
 * menu), the toolbar button's menu only, or named in-page contexts.
 */
export type MenuContext = 'all' | 'action' | PageContentContext;

/**
 * A context name `contextMenus.create` accepts on some supported manifest
 * version — picked from the browser API's own enum: a name the API does not
 * declare drops out of the union, so the registry stops type-checking.
 */
export type PlatformMenuContext = Extract<
  `${Browser.contextMenus.ContextType}`,
  MenuContext | 'browser_action'
>;

/** A nonempty context list, as `contextMenus.create` requires. */
export type NonEmpty<T> = [T, ...T[]];

/**
 * The registry contexts Manifest V2 spells differently; every other name
 * (`'all'` — which already includes the toolbar button's menu on both
 * versions — and the in-page names) keeps its spelling.
 */
const MV2_RENAMED_CONTEXTS: Readonly<Partial<Record<MenuContext, PlatformMenuContext>>> = {
  action: 'browser_action'
};

/** The first manifest version whose toolbar-button context is `'action'`. */
const ACTION_CONTEXT_MANIFEST_VERSION = 3;

/**
 * Translate one registry context for a manifest version.
 *
 * @param context The registry's context.
 * @param manifestVersion The running manifest's `manifest_version`.
 * @returns The platform's name for it: unchanged on Manifest V3+, the
 *   Manifest V2 name below that.
 * @throws {@link RangeError} When `manifestVersion` is not an integer ≥ 2
 *   (no supported platform reports one; guessing a name would be silent).
 */
export function platformMenuContext(
  context: MenuContext,
  manifestVersion: number
): PlatformMenuContext {
  if (!Number.isInteger(manifestVersion) || manifestVersion < 2) {
    throw new RangeError(`Unsupported manifest version: ${String(manifestVersion)}`);
  }
  return manifestVersion >= ACTION_CONTEXT_MANIFEST_VERSION
    ? context
    : (MV2_RENAMED_CONTEXTS[context] ?? context);
}

/**
 * Translate a registry context list for a manifest version, order kept.
 *
 * @param contexts The registry's nonempty context list.
 * @param manifestVersion The running manifest's `manifest_version`.
 * @returns A fresh nonempty list of platform context names.
 * @throws {@link RangeError} See {@link platformMenuContext}.
 */
export function platformMenuContexts(
  contexts: readonly [MenuContext, ...MenuContext[]],
  manifestVersion: number
): NonEmpty<PlatformMenuContext> {
  const [first, ...rest] = contexts;
  return [
    platformMenuContext(first, manifestVersion),
    ...rest.map((context) => platformMenuContext(context, manifestVersion))
  ];
}
