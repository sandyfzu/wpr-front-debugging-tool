/**
 * The page side of a RUCSS test, in two steps so the page changes only
 * once everything is known:
 *
 * - `start` asks the background for the service's CSS, then snapshots the
 *   page's styles: inline ones are judged here (substring checks only, but
 *   markers × inline CSS — so in slices that hand the page its thread back,
 *   within a time budget), stylesheet URLs go back to the caller to judge
 *   (user patterns: unbounded cost, never run here). The page is not
 *   touched; any failure answers typed.
 * - `apply` injects the built CSS, confirms the page took it, then removes
 *   the snapshot's styles that are not kept — only for the current run, at
 *   most once, and only within {@link RUCSS_SNAPSHOT_TTL_MS} of the start.
 *
 * Styles added after the snapshot are left alone. Pure over its seams (the
 * document, the background ask, the id source, the timer), so the DOM
 * effects are unit-tested on a fake document.
 */
import type {
  RucssApplyReply,
  RucssApplyRequest,
  RucssApplySummary,
  RucssFetchReply,
  RucssFetchRequest,
  RucssStartReply,
  RucssStartRequest
} from '../../../lib/messaging/rucss-test';
import { scheduleWithTimeout, type ScheduleTimer } from '../../../lib/messaging/bounded-ask';
import { RUCSS_TEST_LIMITS } from '../../../lib/messaging/rucss-test';
import {
  RUCSS_INLINE_CHECK_BUDGET_MS,
  RUCSS_INLINE_CHECK_SLICE_MS,
  RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS,
  RUCSS_SNAPSHOT_TTL_MS
} from '../../../lib/rucss-tester/deadlines';
import {
  decideInlineStyle,
  RUCSS_RESULT_STYLE_ID,
  RUCSS_STRIP_SELECTOR
} from '../../../lib/rucss-tester/run-plan';

/** One snapshot style and how it was judged. */
type SnapshotEntry =
  | { readonly element: Element; readonly kind: 'inline'; readonly preserved: boolean }
  | { readonly element: Element; readonly kind: 'link'; readonly linkIndex: number };

/** The styles one start saw. */
interface StyleSnapshot {
  readonly runId: string;
  readonly entries: readonly SnapshotEntry[];
  /** The stylesheet URLs, indexed by the entries' `linkIndex`. */
  readonly links: readonly string[];
}

/** The page's test state (read by the page's own surfaces). */
export interface RucssTestMode {
  /** Whether a test's CSS was applied on this page (until it reloads). */
  readonly applied: boolean;
  /** Tests applied on this page. */
  readonly runs: number;
}

/** What the executor runs against (tests inject doubles). */
export interface RucssTestExecutorDeps {
  readonly document: Document;
  /** The page's current address. */
  readonly pageUrl: () => string;
  /** Ask the background; null when it did not answer usably (any reason). */
  readonly fetchShakenCss: (request: RucssFetchRequest) => Promise<RucssFetchReply | null>;
  /** A fresh run id. */
  readonly newRunId: () => string;
  /** Whether the content script's context died (extension reloaded). */
  readonly isInvalid: () => boolean;
  /** Timer seam for the snapshot's expiry (default `setTimeout`). */
  readonly schedule?: ScheduleTimer;
  /** Clock seam (ms) pacing the inline-style judging (default `performance.now`). */
  readonly now?: () => number;
  /** Hands the page its thread back for a moment (default: a message-channel turn). */
  readonly yieldToPage?: () => Promise<void>;
  /** Told the page's new test state after each applied test (the page surfaces follow it). */
  readonly onModeChange?: (mode: RucssTestMode) => void;
}

/** The executor. */
export interface RucssTestExecutor {
  readonly start: (request: RucssStartRequest) => Promise<RucssStartReply>;
  readonly apply: (request: RucssApplyRequest) => RucssApplyReply;
  /** The page's test state. */
  readonly mode: () => RucssTestMode;
}

/**
 * A stylesheet link's resolved URL, or null for an inline style.
 *
 * @param element A snapshot element.
 */
function linkHref(element: Element): string | null {
  if (element.localName !== 'link') return null;
  const href: unknown = (element as Partial<HTMLLinkElement>).href;
  return typeof href === 'string' ? href : '';
}

/**
 * Paces the inline-style judging: between slices the page gets its thread
 * back, and past the budget the judging stops.
 */
export interface InlineCheckPacer {
  /**
   * Call between checks: `true` to go on now, else a promise that resolves
   * `true` after a turn of the page's event loop, or `false` once the budget
   * is spent or, after that turn, the judging is to stop.
   */
  readonly checkpoint: () => true | Promise<boolean>;
}

/**
 * Create the pacer of one snapshot ({@link RUCSS_INLINE_CHECK_SLICE_MS}
 * slices within {@link RUCSS_INLINE_CHECK_BUDGET_MS}).
 *
 * @param now The clock (ms).
 * @param yieldToPage Hands the page its thread back for a moment.
 * @param stopped Read after each hand-back (the only time a newer start or a
 *   dead context can arise): `true` ends the judging at once.
 */
export function createInlineCheckPacer(
  now: () => number,
  yieldToPage: () => Promise<void>,
  stopped: () => boolean = () => false
): InlineCheckPacer {
  const start = now();
  let sliceStart = start;
  return {
    checkpoint: () => {
      const time = now();
      if (time - start > RUCSS_INLINE_CHECK_BUDGET_MS) return Promise.resolve(false);
      if (time - sliceStart < RUCSS_INLINE_CHECK_SLICE_MS) return true;
      return yieldToPage().then(() => {
        if (stopped()) return false;
        sliceStart = now();
        return true;
      });
    }
  };
}

/**
 * Whether the pacer lets the judging go on (awaiting only when it yields).
 *
 * @param pacer The snapshot's pacer.
 */
async function goOn(pacer: InlineCheckPacer): Promise<boolean> {
  const next = pacer.checkpoint();
  return next === true || (await next);
}

/**
 * Judge one inline style against the markers, one marker per check.
 *
 * @param element The style element.
 * @param preserves The preserve markers.
 * @param pacer The snapshot's pacer.
 * @returns Whether a marker keeps it, or `too-slow` past the budget.
 */
async function judgeInline(
  element: Element,
  preserves: readonly string[],
  pacer: InlineCheckPacer
): Promise<boolean | 'too-slow'> {
  const markup = element.outerHTML;
  for (const marker of preserves) {
    if (decideInlineStyle(element.id, markup, [marker]) === 'preserved') return true;
    if (!(await goOn(pacer))) return 'too-slow';
  }
  return false;
}

/**
 * Snapshot the page's styles, judging inline ones against the markers.
 *
 * @param doc The page's document.
 * @param runId The run's id.
 * @param preserves The preserve markers.
 * @param pacer Paces the inline judging (slices within a budget).
 * @returns The snapshot; `too-many-links` when its links pass
 *   {@link RUCSS_TEST_LIMITS}; `too-slow` when the pacer ended the inline
 *   judging (its budget spent, or told to stop).
 */
export async function snapshotStyles(
  doc: Document,
  runId: string,
  preserves: readonly string[],
  pacer: InlineCheckPacer
): Promise<StyleSnapshot | 'too-many-links' | 'too-slow'> {
  const entries: SnapshotEntry[] = [];
  const links: string[] = [];
  let linkChars = 0;
  for (const element of doc.querySelectorAll(RUCSS_STRIP_SELECTOR)) {
    const href = linkHref(element);
    if (href === null) {
      const preserved = await judgeInline(element, preserves, pacer);
      if (preserved === 'too-slow') return 'too-slow';
      entries.push({ element, kind: 'inline', preserved });
      if (!(await goOn(pacer))) return 'too-slow';
      continue;
    }
    linkChars += href.length;
    if (links.length === RUCSS_TEST_LIMITS.links || linkChars > RUCSS_TEST_LIMITS.linkChars) {
      return 'too-many-links';
    }
    entries.push({ element, kind: 'link', linkIndex: links.length });
    links.push(href);
  }
  return { runId, entries, links };
}

/**
 * One turn of the page's event loop (its input and rendering run
 * meanwhile), through a message channel: unlike a timer, never throttled in
 * a background tab. Where a channel cannot be made, a `setTimeout(0)` turn;
 * a channel that never delivers is cut by a
 * {@link RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS} timer. Resolves once, on the
 * first of them, closing the channel and clearing the timer.
 */
export const yieldThroughMessage = (): Promise<void> =>
  new Promise((resolve) => {
    let channel: MessageChannel | null = null;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (channel !== null) {
        channel.port1.onmessage = null;
        channel.port1.close();
      }
      resolve();
    };
    const fallback = setTimeout(settle, RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS);
    try {
      channel = new MessageChannel();
    } catch {
      // A sandbox without channels still has timers (throttled only in hidden tabs).
      setTimeout(settle, 0);
      return;
    }
    channel.port1.onmessage = settle;
    channel.port2.postMessage(null);
  });

/**
 * Remove the snapshot's styles that are not kept.
 *
 * @param snapshot The run's snapshot.
 * @param keepLinks The kept link indexes.
 * @returns The counts (without `cssChars`).
 */
function removeStyles(
  snapshot: StyleSnapshot,
  keepLinks: ReadonlySet<number>
): Omit<RucssApplySummary, 'cssChars'> {
  let removed = 0;
  let preserved = 0;
  let excluded = 0;
  let gone = 0;
  for (const entry of snapshot.entries) {
    if (!entry.element.isConnected) gone++;
    else if (entry.kind === 'inline' && entry.preserved) preserved++;
    else if (entry.kind === 'link' && keepLinks.has(entry.linkIndex)) excluded++;
    else {
      entry.element.remove();
      removed++;
    }
  }
  return { removed, preserved, excluded, gone };
}

/** The HTML namespace: a `style` element in it is an HTML one in any document. */
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * Inject the built CSS last in `target` and confirm the page took it. The
 * style is created in the HTML namespace, so it is an HTML style element
 * even in an SVG or XML document (where `createElement` would make an inert
 * namespace-less element). An HTML style element gets its style sheet
 * synchronously on insertion unless the page's Content Security Policy
 * blocks inline styles; without one (or when the element is not an HTML
 * style element at all) the CSS is not applied, and the style is removed again.
 *
 * @param doc The page's document.
 * @param target The element to append to.
 * @param css The CSS.
 * @returns Whether the CSS is on the page.
 */
function injectCss(doc: Document, target: Element, css: string): boolean {
  const style = doc.createElementNS(XHTML_NAMESPACE, 'style');
  style.id = RUCSS_RESULT_STYLE_ID;
  // `textContent`, not `innerText`: the latter turns line breaks into `<br>`
  // children, which a style element ignores — the CSS's lines would merge.
  style.textContent = css;
  target.appendChild(style);
  // `== null`: a non-HTML element has no `sheet` at all (undefined), a blocked one has null.
  if (style instanceof HTMLStyleElement && style.sheet != null) return true;
  style.remove();
  return false;
}

/**
 * Create the executor (one per page).
 *
 * @param deps See {@link RucssTestExecutorDeps}.
 */
export function createRucssTestExecutor(deps: RucssTestExecutorDeps): RucssTestExecutor {
  const schedule = deps.schedule ?? scheduleWithTimeout;
  const now = deps.now ?? (() => performance.now());
  const yieldToPage = deps.yieldToPage ?? yieldThroughMessage;
  let latestStart = 0;
  let current: StyleSnapshot | null = null;
  // Cancels the current snapshot's expiry timer.
  let cancelExpiry: (() => void) | null = null;
  let runs = 0;

  /** Drop the current snapshot (its element references with it) and its timer. */
  const dropSnapshot = (): void => {
    cancelExpiry?.();
    cancelExpiry = null;
    current = null;
  };

  const start = async (request: RucssStartRequest): Promise<RucssStartReply> => {
    const ticket = ++latestStart;
    // An older start's snapshot can never be applied once a newer one began.
    dropSnapshot();
    const reply = await deps.fetchShakenCss({
      pageUrl: deps.pageUrl(),
      safelist: request.safelist,
      mobile: request.mobile,
      home: request.home
    });
    if (ticket !== latestStart || deps.isInvalid()) {
      return { ok: false, failure: { kind: 'superseded' } };
    }
    if (reply === null) return { ok: false, failure: { kind: 'background-unreachable' } };
    if (reply.kind === 'refused') return { ok: false, failure: { kind: 'refused' } };
    const { requestUrl, outcome } = reply;
    if (!outcome.ok) {
      return { ok: false, failure: { kind: 'fetch', requestUrl, failure: outcome.failure } };
    }
    // Snapshot after the answer: styles loaded during the wait are included.
    const snapshot = await snapshotStyles(
      deps.document,
      deps.newRunId(),
      request.inlinePreserves,
      // A newer start (or a dead context) ends the judging at its next hand-back.
      createInlineCheckPacer(now, yieldToPage, () => ticket !== latestStart || deps.isInvalid())
    );
    // The judging may have yielded: a newer start (or a dead context) wins.
    if (ticket !== latestStart || deps.isInvalid()) {
      return { ok: false, failure: { kind: 'superseded' } };
    }
    if (snapshot === 'too-many-links') return { ok: false, failure: { kind: 'too-many-styles' } };
    if (snapshot === 'too-slow') return { ok: false, failure: { kind: 'inline-check-too-slow' } };
    current = snapshot;
    // An abandoned run (the panel closed, its build failed) must not pin page elements.
    cancelExpiry = schedule(dropSnapshot, RUCSS_SNAPSHOT_TTL_MS);
    return {
      ok: true,
      runId: snapshot.runId,
      requestUrl,
      shakenCss: outcome.shakenCss,
      links: snapshot.links
    };
  };

  const apply = (request: RucssApplyRequest): RucssApplyReply => {
    const snapshot = current;
    if (snapshot === null || snapshot.runId !== request.runId || deps.isInvalid()) {
      return { ok: false, failure: 'stale-run' };
    }
    if (request.keepLinks.some((index) => index >= snapshot.links.length)) {
      return { ok: false, failure: 'invalid-request' };
    }
    const doc = deps.document;
    // Queried, not read from `doc.head`: a page script may have removed
    // either element (the DOM types claim both always exist).
    const target = doc.querySelector('head') ?? doc.querySelector(':root');
    // Checked before anything is removed: no page loses its styles without the result.
    if (target === null) return { ok: false, failure: 'no-document' };
    dropSnapshot();
    if (!injectCss(doc, target, request.css)) return { ok: false, failure: 'css-blocked' };
    const counts = removeStyles(snapshot, new Set(request.keepLinks));
    runs++;
    deps.onModeChange?.(mode());
    return { ok: true, summary: { ...counts, cssChars: request.css.length } };
  };

  /** The page's test state now. */
  const mode = (): RucssTestMode => ({ applied: runs > 0, runs });

  return { start, apply, mode };
}
