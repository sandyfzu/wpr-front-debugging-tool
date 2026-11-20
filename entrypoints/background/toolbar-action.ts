/**
 * The toolbar button's API namespace for this build. Manifest V3 names it
 * `action`; Manifest V2 names it `browserAction` (Firefox's MV2 build has no
 * `action` at all). The choice is a build-time constant equal to the shipped
 * manifest's version, so each bundle references only its own namespace.
 *
 * Also the toolbar button's manifest declaration as read at runtime: the
 * extension name and the button's default tooltip (see {@link toolbarTitles}).
 */

import type { Browser } from 'wxt/browser';

/**
 * This build's toolbar button namespace name — the one declaring site of the
 * manifest-version rule. A build-time constant, so each bundle folds it to its
 * own literal and never carries the other name.
 */
export const TOOLBAR_NAMESPACE: 'browserAction' | 'action' =
  import.meta.env.MANIFEST_VERSION === 2 ? 'browserAction' : 'action';

/**
 * The per-tab display writes the toolbar button gets (badge + tooltip), in
 * their promise forms. Both namespaces expose these per tab (`tabId`) on
 * every supported platform: Firefox declares `browserAction` as an import of
 * `action`'s schema.
 */
export type ToolbarDisplayApi = Pick<
  typeof Browser.action,
  'setBadgeText' | 'setBadgeBackgroundColor' | 'setBadgeTextColor' | 'setTitle'
>;

/** The methods {@link asToolbarDisplayApi} requires, in one place. */
const DISPLAY_METHODS = [
  'setBadgeText',
  'setBadgeBackgroundColor',
  'setBadgeTextColor',
  'setTitle'
] as const;

/**
 * The toolbar button's click event. Fires only while no popup is declared;
 * Chromium passes the clicked tab, Firefox the tab plus click data (ignored).
 */
export type ToolbarClickEvent = (typeof Browser.action)['onClicked'];

/**
 * The value as a string-keyed record, or null for a non-object.
 *
 * @param candidate Any value.
 */
function asRecord(candidate: unknown): Record<string, unknown> | null {
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as Record<string, unknown>)
    : null;
}

/**
 * Accept a candidate namespace only when it carries every display write.
 *
 * @param candidate The namespace the build selected (possibly undefined).
 * @returns The namespace as the display API, or null when it is missing or
 *   lacks a write — callers report that instead of throwing per update.
 */
export function asToolbarDisplayApi(candidate: unknown): ToolbarDisplayApi | null {
  const record = asRecord(candidate);
  if (record === null) return null;
  return DISPLAY_METHODS.every((name) => typeof record[name] === 'function')
    ? (candidate as ToolbarDisplayApi)
    : null;
}

/**
 * Accept a candidate namespace's click event only when it can take a listener.
 *
 * @param candidate The namespace the build selected (possibly undefined).
 * @returns The namespace's `onClicked`, or null when absent or listener-less.
 */
export function asToolbarClickEvent(candidate: unknown): ToolbarClickEvent | null {
  const event: unknown = asRecord(candidate)?.onClicked;
  return typeof asRecord(event)?.addListener === 'function' ? (event as ToolbarClickEvent) : null;
}

/**
 * This build's toolbar namespace, read through `unknown`: the typings mark
 * both namespaces as always present, while a browser may lack one. The key
 * is a build-time constant, so the dead namespace leaves each bundle.
 */
function toolbarNamespace(): unknown {
  return browser[TOOLBAR_NAMESPACE];
}

/**
 * This build's toolbar display API.
 *
 * @returns `browser.action` on Manifest V3 builds, `browser.browserAction`
 *   on Manifest V2 builds; null when the running browser lacks it.
 */
export function toolbarDisplayApi(): ToolbarDisplayApi | null {
  return asToolbarDisplayApi(toolbarNamespace());
}

/**
 * This build's toolbar click event (same namespace rule as the display API).
 *
 * @returns The namespace's `onClicked`, or null when the browser lacks it.
 */
export function toolbarClickEvent(): ToolbarClickEvent | null {
  return asToolbarClickEvent(toolbarNamespace());
}

/** The two texts the toolbar tooltip is built from. */
export interface ToolbarTitles {
  /** The extension's name: the prefix of every per-tab state tooltip. */
  readonly name: string;
  /** The button's manifest tooltip: what a tab without a state shows. */
  readonly defaultTitle: string;
}

/**
 * A non-empty string field of a record, or null.
 *
 * @param record The record (or null).
 * @param key The field name.
 */
function nonEmptyString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Read the tooltip texts from a manifest. The default tooltip is the button's
 * `default_title` (MV3 `action`, MV2 `browser_action`), else the name — what
 * the browser itself shows for a button without one. Writing it back is the
 * portable per-tab reset: Chromium's `setTitle` takes a string only, so the
 * `null` revert Firefox documents does not exist there.
 *
 * @param manifest The runtime manifest (`runtime.getManifest()`), untrusted shape.
 * @returns The texts, or null when the manifest carries no usable name.
 */
export function toolbarTitlesFrom(manifest: unknown): ToolbarTitles | null {
  const record = asRecord(manifest);
  const name = nonEmptyString(record, 'name');
  if (name === null) return null;
  const declared =
    nonEmptyString(asRecord(record?.action), 'default_title') ??
    nonEmptyString(asRecord(record?.browser_action), 'default_title');
  return { name, defaultTitle: declared ?? name };
}

/**
 * This extension's tooltip texts, from its own manifest — the one declaring
 * site of the name (never re-typed in source).
 *
 * @returns The texts.
 * @throws {@link Error} When the manifest carries no usable name (a broken
 *   build: browsers refuse to load a nameless manifest).
 */
export function toolbarTitles(): ToolbarTitles {
  const titles = toolbarTitlesFrom(browser.runtime.getManifest());
  if (titles === null) throw new Error('The extension manifest carries no usable name');
  return titles;
}
