/**
 * Page-world capture of undefined references.
 *
 * The page's own error reporting is the only observable source of its runtime
 * failures, so this module attaches quiet observers (`error` +
 * `unhandledrejection`, non-capture, never intercepting — no
 * `preventDefault`, no rethrows) and scans the reported text for the three
 * recognizable undefined-reference shapes (text and phrasing per engine
 * dialect: {@link CHROMIUM_ERROR_DIALECT} by default). Found identifiers are
 * deduplicated per page lifetime, bounded, batched behind a short quiet
 * period, and pushed to the isolated world through the window bridge. The
 * cross-origin sentinel rides those batches under its own once-per-page
 * flags — it is never a ledger entry, so the full unique-identifier cap stays
 * available to the page's identifiers.
 *
 * Page-world safety, hard requirements:
 * - every listener body is wrapped — a capture failure logs and returns, it
 *   never reaches the page as our own uncaught error;
 * - admission filtering mirrors the bridge guard's acceptance rules (count,
 *   length, printability) so one malformed word can never reject the whole
 *   batch on the receiving side ("the capture side owns producing
 *   well-formed batches");
 * - footprints stay minimal: the batch itself is capped, the cap holds the
 *   number of bridge messages per page lifetime to roughly the unique-word
 *   ceiling.
 */

import { debounce } from '../../utils/debounce';
import { createLogger } from '../../lib/logger';
import {
  CROSS_ORIGIN_ERROR_MESSAGE,
  CROSS_ORIGIN_ERROR_WORD,
  windowMessenger
} from '../../lib/messaging/window-bridge';
import { ERROR_WORD_LIMITS, isPrintable } from '../../lib/messaging/error-words';

/** Silenceable diagnostics on the page console under the shared tool prefix. */
const log = createLogger('main-world');

/** Quiet period before a burst of fresh identifiers ships as one batch. */
export const DEFAULT_FLUSH_DELAY_MS = 500;

/**
 * One recognizable undefined-reference shape: the identifier it names in the
 * given error text, or null when the text does not carry the shape (the next
 * shape is then tried).
 */
export type UndefinedReferenceShape = (errorText: string) => string | null;

/**
 * How one engine reports a thrown value: the text to scan, and the shapes to
 * scan it for, in priority order. Engines differ in both (stack header, error
 * phrasing), so each build passes its own.
 */
export interface ErrorTextDialect {
  /**
   * The scannable text of an object-shaped thrown value, or null when it has
   * none. May run page getters — callers guard it.
   */
  readText: (thrown: object) => string | null;
  /** Shapes tried in order; the first non-null answer wins. */
  shapes: readonly UndefinedReferenceShape[];
}

/** Extract the undefined reference out of an error `ReferenceError`. */
const REFERENCE_ERROR_PATTERN = /ReferenceError: (.*) is not defined/;
/** Extract the property name inside an "object is undefined" `TypeError`. */
const READING_UNDEFINED_PATTERN =
  /TypeError: Cannot read properties of undefined \(reading '(.*)'\)/;
/** Extract the whole call chain out of an "is not a function" `TypeError`. */
const NOT_A_FUNCTION_PATTERN = /TypeError: (.*) is not a function/;

/**
 * The first capture of a pattern, empty counting as none.
 *
 * @param pattern A pattern with one capture group.
 * @param errorText The text to scan.
 * @returns The capture, or null when absent or empty (pattern-shaped yet
 *   identifier-less text names nothing).
 */
const firstCapture = (pattern: RegExp, errorText: string): string | null =>
  errorText.match(pattern)?.[1] || null;

/** `x is not defined` — the identifier itself (V8 and SpiderMonkey alike). */
export const REFERENCE_ERROR_SHAPE: UndefinedReferenceShape = (errorText) =>
  firstCapture(REFERENCE_ERROR_PATTERN, errorText);

/** V8's property read on undefined — the key being read. */
export const READING_UNDEFINED_SHAPE: UndefinedReferenceShape = (errorText) =>
  firstCapture(READING_UNDEFINED_PATTERN, errorText);

/**
 * `a.b.c is not a function` (V8 and SpiderMonkey alike) — the chain reduces
 * to its last `.` segment, the missing symbol. Always the last shape of a
 * dialect: an empty chain answers `''`, which admission then refuses.
 */
export const NOT_A_FUNCTION_SHAPE: UndefinedReferenceShape = (errorText) => {
  const notAFunction = errorText.match(NOT_A_FUNCTION_PATTERN)?.[1];
  if (notAFunction === undefined) return null;
  const missingSymbol = notAFunction.split('.').at(-1);
  return typeof missingSymbol === 'string' ? missingSymbol : null;
};

/** The shapes of V8 (Chromium) messages, in priority order. */
const V8_SHAPES: readonly UndefinedReferenceShape[] = [
  REFERENCE_ERROR_SHAPE,
  READING_UNDEFINED_SHAPE,
  NOT_A_FUNCTION_SHAPE
];

/**
 * Scan error text with the given shapes, in order.
 *
 * @param errorText The text to scan.
 * @param shapes The shapes to try; the first non-null answer wins.
 * @returns The identifier it names, or null when no shape matches.
 */
export function extractWithShapes(
  errorText: string,
  shapes: readonly UndefinedReferenceShape[]
): string | null {
  for (const shape of shapes) {
    const word = shape(errorText);
    if (word !== null) return word;
  }
  return null;
}

/**
 * Scan V8 error text — a stack, or a message — for an undefined reference.
 *
 * The three shapes are matched in order, verbatim: the reference error wins
 * over the property-read error, which wins over the not-a-function error; a
 * not-a-function chain reduces to its last `.` segment (the missing symbol).
 * The `.` of these patterns cannot cross line terminators, so matching stays
 * line-local in multi-line stacks.
 *
 * @param errorText The text to scan (a V8 stack opens with its
 *   `Name: message` line, so the stack alone carries the message).
 * @returns The identifier it names, or null when nothing recognizable
 *   (including empty captures, pattern-shaped yet identifier-less text).
 */
export function extractUndefinedReference(errorText: string): string | null {
  return extractWithShapes(errorText, V8_SHAPES);
}

/**
 * The thrown value's stack. Shared by every dialect: the frames, and in V8
 * the `Name: message` header line too.
 *
 * @param thrown The object-shaped thrown value (its getter may throw).
 * @returns `stack` when it is a string, else null.
 */
export function readStack(thrown: object): string | null {
  const stack: unknown = (thrown as { stack?: unknown }).stack;
  return typeof stack === 'string' ? stack : null;
}

/** Chromium (V8): the stack alone carries the message, scanned for V8 phrasing. */
export const CHROMIUM_ERROR_DIALECT: ErrorTextDialect = {
  readText: readStack,
  shapes: V8_SHAPES
};

/**
 * Runtime dependencies of the capture, injectable for tests and for future
 * surfaces (e.g. an embedded page in a frame). Everything falls back to the
 * one production configuration.
 */
export interface UndefinedReferenceCaptureDeps {
  /**
   * The window whose error events are captured. The page window in the real
   * deployment; tests pass their own.
   */
  eventTarget?: Window;
  /**
   * Sink of every flushed batch. The default sends through the window bridge;
   * overrides exist to observe flushing without a listener registered.
   * Implementations must not throw for cloneable data (the payload is only
   * strings) — a throw is a degraded batch delivered nothing and is logged.
   */
  sendBatch?: (words: string[]) => void;
  /**
   * How the engine reports thrown values. Defaults to
   * {@link CHROMIUM_ERROR_DIALECT}; the Firefox build passes its own.
   */
  dialect?: ErrorTextDialect;
  /** Quiet period before shipping (milliseconds). */
  flushDelayMs?: number;
  /**
   * Unique identifiers admitted per page lifetime. New identifiers beyond it
   * are refused (the page reported it — this only bounds what the bridge
   * carries), and the refusal is logged once, not per word.
   */
  maxUniqueWords?: number;
  /** Character ceiling per word; longer captures are refused whole. */
  maxWordChars?: number;
  /**
   * Hard ceiling on words per flushed batch (the receiver refuses more). With
   * the production ceilings this only ever binds when the cap-exempt
   * cross-origin sentinel lands on a full burst — the overflow drops the
   * newest identifiers, never the sentinel.
   */
  maxBatchWords?: number;
}

/**
 * Start the capture. Installs two listeners ({@link UndefinedReferenceCaptureDeps.eventTarget}
 * errors + unhandled rejections) and returns their removal. Invalidation note
 * (verified against WXT 0.21.4's MAIN-world entrypoint wrapper, which calls
 * `main()` without any context object): MAIN-world content scripts have no
 * `ContentScriptContext` and no invalidation handshake — the returned stop
 * handle is the only seam, and the effective production lifetime is the page
 * lifetime (an error capture's breadcrumb for its whole page; extension
 * reloads fully outlive scripts only until the next navigation anyway).
 */
export function startUndefinedReferenceCapture(
  deps: UndefinedReferenceCaptureDeps = {}
): () => void {
  const eventTarget = deps.eventTarget ?? window;
  const sendBatch = deps.sendBatch ?? sendThroughBridge;
  const dialect = deps.dialect ?? CHROMIUM_ERROR_DIALECT;
  const flushDelayMs = deps.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const maxUniqueWords = deps.maxUniqueWords ?? ERROR_WORD_LIMITS.count;
  const maxWordChars = deps.maxWordChars ?? ERROR_WORD_LIMITS.chars;
  const maxBatchWords = deps.maxBatchWords ?? ERROR_WORD_LIMITS.count;

  /** Everything admitted over the page lifetime — the dedupe and cap ledger. */
  const seenWords = new Set<string>();
  /** Fresh words since the last flush, in arrival order. */
  const pendingBatch = new Set<string>();
  /** Whether the unique-word ceiling has already announced itself. */
  let capWasLogged = false;
  /** Whether the cross-origin sentinel still awaits a ride in the next flush. */
  let sentinelQueued = false;
  /** Whether that sentinel was accepted already — its once-per-page dedupe. */
  let sentinelAccepted = false;

  /** Whether a word fits the receiver's contract (see {@link ERROR_WORD_LIMITS}). */
  const isAdmissibleWord = (word: string): boolean =>
    word.length >= 1 && word.length <= maxWordChars && isPrintable(word);

  /** Ship the pending words, if any; a failed send is logged and dropped. */
  const flush = (): void => {
    if (pendingBatch.size === 0 && !sentinelQueued) return;
    const identifiers = [...pendingBatch];
    // Cleared before the send: words are already charged to their ledgers, and
    // the flush must not end up re-delivered by a retrying later flush.
    pendingBatch.clear();
    // The queued sentinel reserves its own slot in this batch and is never a
    // drop candidate (losing it would mute every cross-origin error of the
    // page); only identifiers spill, and always the newest ones.
    const carriesSentinel = sentinelQueued;
    sentinelQueued = false;
    const batch = carriesSentinel
      ? [...identifiers.slice(0, maxBatchWords - 1), CROSS_ORIGIN_ERROR_WORD]
      : identifiers.slice(0, maxBatchWords);
    const overflowCount = identifiers.length + (carriesSentinel ? 1 : 0) - maxBatchWords;
    if (overflowCount > 0) {
      log.warn('Batch overflow; newest identifiers dropped', overflowCount, batch.length);
    }
    try {
      sendBatch(batch);
    } catch (cause) {
      log.error('Undefined-reference batch could not be sent (words dropped)', batch.length, cause);
    }
  };

  /** The debounced flush of a burst of fresh words. */
  const scheduleFlush = debounce(flush, flushDelayMs);

  /** Flush now (sentinel path), losing no pending words and no pending timer. */
  const flushNow = (): void => {
    scheduleFlush.cancel();
    flush();
  };

  const considerWord = (word: string | null): void => {
    if (word === null || !isAdmissibleWord(word)) return;
    if (seenWords.has(word)) return;
    if (seenWords.size >= maxUniqueWords) {
      if (!capWasLogged) {
        capWasLogged = true;
        log.warn(
          'Undefined-reference cap reached; further unique identifiers dropped',
          maxUniqueWords
        );
      }
      return;
    }
    seenWords.add(word);
    pendingBatch.add(word);
    scheduleFlush();
  };

  const considerCrossOriginError = (): void => {
    if (sentinelAccepted) return;
    // Deduped through its own flag pair, never a `Set` entry: the identifier
    // ledger (dedupe and cap alike) stays entirely for page identifiers, so a
    // cross-origin error can never shave a slot off the 50-identifier cap —
    // and the constant cannot flood the bridge either way. Accepted once per
    // page, it flushes immediately instead of waiting out the debounce — one
    // meaningful bite of information, not part of a burst — and whatever
    // identifiers were pending the debounce ride along in that same batch.
    sentinelAccepted = true;
    sentinelQueued = true;
    flushNow();
  };

  /**
   * Scan one thrown value through the dialect. Only object-shaped values are
   * read: primitives and callables carry no engine-built error text.
   */
  const considerThrown = (thrown: unknown): void => {
    if (thrown === null || typeof thrown !== 'object') return;
    const errorText = dialect.readText(thrown);
    if (errorText !== null) considerWord(extractWithShapes(errorText, dialect.shapes));
  };

  const onError = (event: ErrorEvent): void => {
    try {
      if (event.message === CROSS_ORIGIN_ERROR_MESSAGE) considerCrossOriginError();
      // Cross-origin errors arrive message-only (error withheld by the
      // browser); readable ones carry the thrown value, read per dialect.
      considerThrown(event.error);
    } catch (cause) {
      // A hostile thrown value (e.g. a throwing `stack` getter) must not
      // become an error in the page's own console — swallow and log.
      log.debug('Error event could not be read', cause);
    }
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    try {
      considerThrown(event.reason);
    } catch (cause) {
      log.debug('Rejection event could not be read', cause);
    }
  };

  // Non-capture on purpose: the capture observes, it never intercepts (also
  // symmetric with removal, which matches by capture flag).
  eventTarget.addEventListener('error', onError, { capture: false });
  eventTarget.addEventListener('unhandledrejection', onRejection, { capture: false });
  return () => {
    eventTarget.removeEventListener('error', onError, { capture: false });
    eventTarget.removeEventListener('unhandledrejection', onRejection, { capture: false });
    scheduleFlush.cancel();
  };
}

/**
 * The production sink: one bridge message per flush. The send's promise is
 * fire-and-handled — it settles only when the isolated receiver acknowledges
 * (a missing receiver leaves it pending, the bridge's documented no-receiver
 * semantics; sends per page lifetime are bounded by the unique-word ceiling,
 * so no unbounded listener growth is possible), and a receiver-reported
 * rejection is surfaced in the log rather than left unhandled.
 */
function sendThroughBridge(words: string[]): void {
  void windowMessenger.sendMessage('undefinedReferenceBatch', words).catch((cause: unknown) => {
    log.error('Undefined-reference batch was rejected by the isolated world', cause);
  });
}
