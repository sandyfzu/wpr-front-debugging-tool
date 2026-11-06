/**
 * The global scope the extension namespace is resolved from: `globalThis` in
 * the build, a hand-made object in tests (an inherited key there stands for a
 * DOM named property, which a window serves from its prototype chain).
 */
export interface ExtensionApiScope {
  /** The promise-based namespace (native on Firefox and recent Chromium) — or a page element. */
  readonly browser?: unknown;
  /** Chromium's namespace (Firefox exposes it too). */
  readonly chrome?: unknown;
}

/** The one part of a namespace candidate a resolver reads: its `runtime.id`. */
export type RuntimeIdHolder = { readonly runtime?: { readonly id?: unknown } } | undefined;

/** The part of a namespace candidate the `chrome` pin reads: its `runtime.sendMessage`. */
export type MessageSender = { readonly runtime?: { readonly sendMessage?: unknown } } | undefined;
