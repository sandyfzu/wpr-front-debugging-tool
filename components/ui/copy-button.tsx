/**
 * The copy control — one button for every "copy this" affordance (evidence
 * snippets, exclusion lists, reports). Its feedback never degrades to silence:
 * a confirmed write confirms via the toast store (its title and hint are the
 * consumer's copy vocabulary); a rejected write renders the error toast with
 * the remedy — copy failures are never silent. The in-place check flash and
 * its window are shared too, so no consumer re-implements feedback.
 */
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { onCleanup } from 'solid-js';
import type { ComponentProps } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { Button } from './button';
import { STATUS_TEXT_CLASSES } from './status-badge';
import { toast } from './toast-store';

/** The logger for copy degradations — the toast is the user feedback, this is the operational record. */
const logger = createLogger('copy-button');

/**
 * How long the check confirmation state lingers after a successful copy (ms).
 * The shared flash's one declaring site — every flash consumer times with it,
 * so confirmation feedback keeps one rhythm everywhere.
 */
export const COPIED_FLASH_MS = 1600;

/** The error toast's title — the copy mechanism, not the copied thing, failed. */
const COPY_FAILED_TITLE = 'Copy failed';

/** The stable remedy line for a rejected clipboard write. */
const COPY_FAILED_DESCRIPTION = 'Copy it from selection instead.';

/** The clipboard seam — `navigator.clipboard` by default, injected for tests. */
export interface ClipboardLike {
  /**
   * Write text to the clipboard.
   *
   * Mirrors the platform promise so failures (context invalidated, permission
   * refused) reject exactly as they do in the browser.
   *
   * @param text The text to write.
   * @returns Resolves on success, rejects with the platform's error.
   */
  writeText: (text: string) => Promise<void>;
}

/**
 * Outcome callbacks of one copy — the sink `performCopy` reports through.
 * Splitting outcome from side-effect consequence keeps the pure core free of
 * toast/state wiring in both directions.
 */
export interface CopyOutcomeSink {
  /** The clipboard confirmed the write. */
  copied: () => void;
  /**
   * The clipboard rejected the write.
   *
   * @param error The platform failure (logged by the caller if wanted; never
   *   rendered — rendering raw platform errors leaks engine internals into UI copy).
   */
  failed: (error: unknown) => void;
}

/**
 * Run one copy and report its outcome through the sink.
 *
 * Pure decision core: clipboard seam in, outcome out. Unknown `writeText`
 * failures land in `sink.failed` — the clicks that fan out from it (toasts,
 * flash state) cannot crash a click handler.
 *
 * @param text The text to copy.
 * @param clipboard The clipboard seam (real or test double).
 * @param sink The outcome callbacks.
 * @returns `'copied'` exactly when the platform confirmed the write, else
 *   `'failed'` (the sink carried the consequence; callers branch on the result).
 */
export async function performCopy(
  text: string,
  clipboard: ClipboardLike,
  sink: CopyOutcomeSink
): Promise<'copied' | 'failed'> {
  try {
    await clipboard.writeText(text);
    sink.copied();
    return 'copied';
  } catch (error: unknown) {
    sink.failed(error);
    return 'failed';
  }
}

export interface CopyButtonProps {
  /** The text written to the clipboard. */
  text: string;
  /** Resolve complete text on demand; display text is never used as a fallback on failure. */
  loadText?: (signal: AbortSignal) => Promise<string>;
  /** Actionable remedy when a source read fails before the clipboard write. */
  sourceFailureDescription?: string;
  /**
   * The name of what is copied — the visible label, the fallback accessible
   * name when the label is hidden (`"<label> — copy"`), and the success
   * toast's default title (`"<label> copied"`). Required so no unnamed copy
   * control reaches a surface.
   */
  label: string;
  /**
   * The full accessible name when it must differ from the visible label
   * (a per-row say: the file or pattern the name should identify). Set means
   * the name is stable across the flash even when {@link copiedLabel} swaps
   * the visible text; unset, the name follows the rendered text.
   */
  ariaLabel?: string;
  /** The control's hover hint (its full intent; never the accessible name). */
  title?: string;
  /**
   * Whether the label renders beside the icon: `true` (default) always,
   * `false` never (accessible name synthesized), `'regular-up'` visible from
   * the regular tier and sr-only below (an icon-only compact row keeps the
   * name), so a dense row's copy control shrinks with the page.
   */
  showLabel?: boolean | 'regular-up';
  /**
   * The visible label's wording while the check flash shows (default: the
   * label stays). The flash text with no {@link ariaLabel} changes the name
   * with it; pair them when the name must hold still.
   */
  copiedLabel?: string;
  /** The success toast's title override (default `"<label> copied"`). */
  successTitle?: string;
  /** The success toast's secondary line — a destination hint ("paste it into …"). */
  successDescription?: string;
  /** The failure toast's remedy override (default {@link COPY_FAILED_DESCRIPTION}). */
  failureDescription?: string;
  /** Visual weight (same variants as `Button`, default `ghost`). */
  variant?: ComponentProps<typeof Button>['variant'];
  /** Density (same sizes as `Button`, default `sm`). */
  size?: ComponentProps<typeof Button>['size'];
  /** The clipboard seam (default `navigator.clipboard`). */
  clipboard?: ClipboardLike;
  /** Extra classes, merged last so callers win. */
  class?: string;
}

/**
 * Render the shared copy button.
 *
 * Feedback: success = the toast (`"<label> copied"` unless
 * {@link CopyButtonProps.successTitle} overrides it, with the destination
 * hint when one is given) plus the shared check flash — the icon turns to a
 * confirmation for {@link COPIED_FLASH_MS}, to the ok status color while
 * {@link CopyButtonProps.copiedLabel} may reword the label. Failure = the
 * error toast: the mechanism's title with the remedy line
 * ({@link CopyButtonProps.failureDescription} or the shared fallback) — never
 * the platform's error text, never silence — and a standing success flash is
 * flushed, so the error never sits beside the stale check it contradicts.
 * A pending read/write keeps keyboard focus and announces busy/disabled through
 * ARIA; the invocation guard suppresses repeat activation without native disabling.
 * Disposal aborts source reads and suppresses late write feedback.
 * The flash reintroduced timer edge auto-resets — state must not stick.
 * Disabling is caller-owned: hiding a control that cannot copy (empty
 * content) is the page's call, an always-present control that never copies is
 * a dead end this marker would point at itself.
 *
 * @param props.text The payload.
 * @param props.loadText Optional complete-source reader, cancelled on disposal.
 * @param props.sourceFailureDescription Remedy for a failed source read.
 * @param props.label The base name: visible label, fallback name, toast default.
 * @param props.ariaLabel Accessible-name override when the visible label differs.
 * @param props.title Hover hint (not the accessible name).
 * @param props.showLabel Label rendering (`true`/`false`/`'regular-up'`).
 * @param props.copiedLabel Label wording while the flash shows.
 * @param props.successTitle Success-toast title override.
 * @param props.successDescription Success-toast hint line.
 * @param props.failureDescription Failure-toast remedy override.
 * @param props.variant Button variant (default `ghost`).
 * @param props.size Button size (default `sm`).
 * @param props.clipboard Clipboard seam; defaults to `navigator.clipboard`.
 * @param props.class Extra classes.
 * @returns The rendered control (never a dead end: every failure path —
 *   seam construction included — resolves into the error toast + warn log;
 *   nothing escapes past the click handler).
 */
export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  let pending: AbortController | undefined;
  let flashReset: ReturnType<typeof setTimeout> | undefined;
  // The flash never outlives the control: a disposed button's timer dies with it.
  onCleanup(() => {
    clearTimeout(flashReset);
    pending?.abort();
  });

  /**
   * Drop a standing success flash: a later failure (rejected write, failed
   * source read) must not sit beside the stale check it contradicts.
   */
  const flashDown = (): void => {
    setCopied(false);
    clearTimeout(flashReset);
  };

  const sink: CopyOutcomeSink = {
    copied: () => {
      if (pending?.signal.aborted) return;
      toast.success(props.successTitle ?? `${props.label} copied`, {
        description: props.successDescription
      });
      setCopied(true);
      clearTimeout(flashReset);
      flashReset = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    },
    failed: (error: unknown) => {
      if (pending?.signal.aborted) return;
      // One degradation, two channels: the actionable toast (the platform
      // error text is never rendered) + the warn log naming the cause.
      logger.warn('Copy rejected; the error toast stays the visible feedback.', error);
      toast.error(COPY_FAILED_TITLE, {
        description: props.failureDescription ?? COPY_FAILED_DESCRIPTION
      });
      // The failure is the live feedback: flush a standing success flash from
      // an earlier attempt so no stale check claims success beside it.
      flashDown();
    }
  };

  /**
   * The guarded invocation: the clipboard seam can throw synchronously (no
   * clipboard in the current context) or the write can reject — any failure
   * path funnels into the same guarded async body, and nothing escapes past
   * the click handler. The control never dead-ends: the error toast is
   * the feedback for every failure shape, not for write rejections only.
   *
   * @returns Resolves after the outcome landed in the sink (never rejects).
   */
  const guardedCopy = async (): Promise<void> => {
    if (loading()) return;
    const controller = new AbortController();
    pending = controller;
    const loadText = props.loadText;
    const text = props.text;
    setLoading(true);
    try {
      let complete = text;
      if (loadText !== undefined) {
        try {
          complete = await loadText(controller.signal);
        } catch {
          // Same flash flush as a rejected write: this failure is the live feedback.
          if (!controller.signal.aborted) {
            flashDown();
            toast.error(COPY_FAILED_TITLE, {
              description: props.sourceFailureDescription ?? COPY_FAILED_DESCRIPTION
            });
          }
          return;
        }
      }
      if (!controller.signal.aborted)
        await performCopy(complete, props.clipboard ?? defaultClipboard(), sink);
    } catch (error: unknown) {
      if (!controller.signal.aborted) sink.failed(error);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (pending === controller) pending = undefined;
    }
  };

  /** The click handler: non-throwing by construction (see {@link guardedCopy}). */
  const onCopy = (): void => {
    void guardedCopy();
  };

  return (
    <Button
      type="button"
      data-fdt="copy-button"
      data-fdt-copied={copied() ? '' : undefined}
      title={props.title}
      aria-label={
        props.ariaLabel ?? (props.showLabel === false ? `${props.label} — copy` : undefined)
      }
      variant={props.variant ?? 'ghost'}
      size={props.size ?? 'sm'}
      onClick={onCopy}
      // Native disabling would remove focus during a slow read; the guarded action stays focusable.
      aria-disabled={loading() || undefined}
      aria-busy={loading() || undefined}
      data-fdt-loading={loading() ? '' : undefined}
      class={cn('gap-1', props.class)}
    >
      {loading() ? (
        <LoaderCircle size={14} class="animate-spin shrink-0" aria-hidden="true" data-fdt-spinner />
      ) : copied() ? (
        <Check size={14} class={cn('shrink-0', STATUS_TEXT_CLASSES.ok)} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      {props.showLabel !== false && (
        <span class={cn(props.showLabel === 'regular-up' && '@max-regular:sr-only')}>
          {copied() && props.copiedLabel !== undefined ? props.copiedLabel : props.label}
        </span>
      )}
    </Button>
  );
}

/**
 * The real clipboard seam, resolved lazily at call time (some surfaces only
 * get the secure-context clipboard after mount). Shared: any surface that
 * performs its own copy (the export action's fallback) resolves through it.
 *
 * @returns The secure-context clipboard.
 * @throws {@link Error} when `navigator.clipboard` is missing, naming the
 *   surface so a code-path regression fails loudly rather than shipping a dead control.
 */
export function defaultClipboard(): ClipboardLike {
  // The type says the clipboard is always there; at runtime an insecure or
  // blocked context may omit it — narrow through the runtime shape, never the
  // type's promise.
  const writeText = (navigator.clipboard as Partial<ClipboardLike> | undefined)?.writeText;
  if (typeof writeText !== 'function') {
    throw new Error('The secure-context clipboard is unavailable in this context.');
  }
  return {
    writeText: (text) => writeText.call(navigator.clipboard, text)
  };
}
