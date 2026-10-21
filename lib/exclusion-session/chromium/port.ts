/**
 * The debugger-protocol port the Chromium backend runs over: the small
 * slice of the browser's debugger API it needs, injected so the backend's
 * logic never touches a real browser API (the background binds it to
 * `browser.debugger` + `browser.tabs`). Every method is promise-style and
 * rejects with the browser's own error on failure.
 */

/** A protocol session: the tab's root session, or a child session inside it. */
export interface DebuggerTarget {
  readonly tabId: number;
  /** A child session's id; absent for the tab's root session. */
  readonly sessionId?: string;
}

/** What a tab is now, as far as this extension may see without the `tabs` permission. */
export type TabPresence =
  /** The tab no longer exists. */
  | 'gone'
  /** The tab shows an http(s) page (its URL is readable through the host permissions). */
  | 'web'
  /** The tab exists but shows something else (its URL is unreadable or not http(s)). */
  | 'elsewhere';

/** The handlers the backend registers once, synchronously, when it is created. */
export interface DebuggerEventHandlers {
  /** A protocol event of one of this extension's sessions. */
  event(source: unknown, method: string, params: unknown): void;
  /** The browser ended one of this extension's sessions (never fired for a self-detach). */
  detach(source: unknown, reason: unknown): void;
}

/** The debugger API slice. */
export interface DebuggerPort {
  /** Attach this extension to the tab. */
  attach(tabId: number): Promise<void>;
  /** Detach this extension from the tab. */
  detach(tabId: number): Promise<void>;
  /** Send one protocol command; resolves with its result object. */
  send(target: DebuggerTarget, method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** The id of the tab's page target (its main frame's protocol frame id), or null. */
  pageTargetId(tabId: number): Promise<string | null>;
  /** What the tab is now (never rejects: an unreadable tab is `elsewhere`, a missing one `gone`). */
  tabPresence(tabId: number): Promise<TabPresence>;
  /** Register the event handlers (synchronously — no wake event may be missed). */
  listen(handlers: DebuggerEventHandlers): void;
}
