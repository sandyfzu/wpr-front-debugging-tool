/**
 * Test fixtures for the namespace resolvers: genuine-looking namespaces and
 * the DOM values a page's named properties put in their place. Test-only.
 */

import type { ExtensionApiScope } from './scope';

/** The extension id the genuine fixtures carry. */
export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

/**
 * A namespace stand-in with a runtime id.
 *
 * @param id The runtime id (default {@link EXTENSION_ID}).
 */
export function namespace(id: string = EXTENSION_ID): { runtime: { id: string } } {
  return { runtime: { id } };
}

/**
 * A namespace stand-in that can send (what the `chrome` pin requires).
 *
 * @param id The runtime id (default {@link EXTENSION_ID}).
 */
export function sendingNamespace(id: string = EXTENSION_ID): {
  runtime: { id: string; sendMessage: () => void };
} {
  return { runtime: { id, sendMessage: () => undefined } };
}

/**
 * The page's `<form id="browser"><input name="runtime" id="…">`: what a
 * window's named access answers for `browser`, its `runtime` the input.
 *
 * @param inputId The input's id (what `runtime.id` then reads).
 */
export function clobberingForm(
  inputId: string
): HTMLFormElement & { readonly runtime: HTMLInputElement } {
  const form = document.createElement('form') as HTMLFormElement & {
    readonly runtime: HTMLInputElement;
  };
  form.id = 'browser';
  const input = document.createElement('input');
  input.name = 'runtime';
  input.id = inputId;
  form.append(input);
  // Chromium's form named access (`form.runtime` → the input), set explicitly
  // so the fixture holds whatever the test DOM implements.
  Object.defineProperty(form, 'runtime', { value: input });
  return form;
}

/**
 * Two `id="browser"` elements: a window answers an HTMLCollection, and
 * Chromium decorates it with the real API (`runtime` an own property) — so it
 * even carries the genuine runtime id.
 */
export function clobberingCollection(): HTMLCollection {
  const host = document.createElement('div');
  host.innerHTML = '<form id="browser"></form><form id="browser"></form>';
  // The test DOM's collection refuses new properties, so the decorated value
  // is a collection-derived object with the own `runtime` Chromium adds.
  const decorated = Object.create(host.getElementsByTagName('form')) as HTMLCollection;
  Object.defineProperty(decorated, 'runtime', { value: namespace().runtime });
  return decorated;
}

/**
 * A scope shaped like a window: `own` keys are own properties of the global
 * (real globals), `named` keys come from its prototype chain (DOM named
 * properties).
 *
 * @param own The global's own properties.
 * @param named The names a page's DOM answers.
 */
export function windowScope(
  own: Record<string, unknown>,
  named: Record<string, unknown> = {}
): ExtensionApiScope {
  return Object.assign(Object.create(named) as ExtensionApiScope, own);
}
