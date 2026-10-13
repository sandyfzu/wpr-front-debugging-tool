/**
 * The copy control — one button for every "copy this" affordance (evidence
 * snippets, exclusion lists, reports). Its feedback never degrades to silence:
 * a confirmed write confirms via the toast store; a rejected write renders the
 * error toast with the remedy — copy failures are never silent.
 */
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { onCleanup } from 'solid-js';
import type { ComponentProps } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { Button } from './button';
import { toast } from './toast-store';

/** The logger for copy degradations — the toast is the user feedback, this is the operational record. */
const logger = createLogger('copy-button');

/** How long the check confirmation state lingers after a successful copy (ms). */
const COPIED_FLASH_MS = 1600;

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
  /**
   * The name of what is copied — phrased into the confirmation toast
   * (`"<label> copied"`) and the accessible name when the label text is
   * hidden. Required so no unnamed copy control reaches a surface.
   */
  label: string;
  /** Visual weight (same variants as `Button`, default `ghost`). */
  variant?: ComponentProps<typeof Button>['variant'];
  /** Density (same sizes as `Button`, default `sm`). */
  size?: ComponentProps<typeof Button>['size'];
  /** Whether the label renders beside the icon (default `true`; icon-only otherwise). */
  showLabel?: boolean;
  /** The clipboard seam (default `navigator.clipboard`). */
  clipboard?: ClipboardLike;
  /** Extra classes, merged last so callers win. */
  class?: string;
}

/**
 * Render the shared copy button.
 *
 * Feedback: success = `"<label> copied"` toast + check-icon flash; failure =
 * the error toast with {@link COPY_FAILED_DESCRIPTION} as its one action line.
 * The flash reintroduced timer edge auto-resets — state must not stick.
 * Disabling is caller-owned: hiding a control that cannot copy (empty
 * content) is the page's call, an always-present control that never copies is
 * a dead end this marker would point at itself.
 *
 * @param props.text The payload.
 * @param props.label What to name in feedback.
 * @param props.variant Button variant (default `ghost`).
 * @param props.size Button size (default `sm`).
 * @param props.showLabel Whether to render the visible label (default `true`).
 * @param props.clipboard Clipboard seam; defaults to `navigator.clipboard`.
 * @param props.class Extra classes.
 * @returns The rendered control (never a dead end: every failure path —
 *   seam construction included — resolves into the error toast + warn log;
 *   nothing escapes past the click handler).
 */
export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let flashReset: ReturnType<typeof setTimeout> | undefined;
  // The flash never outlives the control: a disposed button's timer dies with it.
  onCleanup(() => {
    clearTimeout(flashReset);
  });

  const sink: CopyOutcomeSink = {
    copied: () => {
      toast.success(`${props.label} copied`);
      setCopied(true);
      clearTimeout(flashReset);
      flashReset = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    },
    failed: (error: unknown) => {
      // One degradation, two channels: the actionable toast (the platform
      // error text is never rendered) + the warn log naming the cause.
      logger.warn('Copy rejected; the error toast stays the visible feedback.', error);
      toast.error('Copy failed', { description: COPY_FAILED_DESCRIPTION });
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
    try {
      await performCopy(props.text, props.clipboard ?? defaultClipboard(), sink);
    } catch (error: unknown) {
      sink.failed(error);
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
      aria-label={props.showLabel === false ? `${props.label} — copy` : undefined}
      variant={props.variant ?? 'ghost'}
      size={props.size ?? 'sm'}
      onClick={onCopy}
      class={cn('gap-1', props.class)}
    >
      {copied() ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {props.showLabel !== false && props.label}
    </Button>
  );
}

/**
 * The real clipboard seam, resolved lazily at call time (some surfaces only
 * get the secure-context clipboard after mount).
 *
 * @returns The secure-context clipboard.
 * @throws {@link Error} when `navigator.clipboard` is missing, naming the
 *   surface so a code-path regression fails loudly rather than shipping a dead control.
 */
function defaultClipboard(): ClipboardLike {
  // The type says the clipboard is always there; at runtime an insecure or
  // blocked context may omit it — narrow through the runtime shape, never the
  // type's promise.
  const writeText = (navigator.clipboard as Partial<ClipboardLike> | undefined)?.writeText;
  if (typeof writeText !== 'function') {
    throw new Error('CopyButton: navigator.clipboard is unavailable in this context.');
  }
  return {
    writeText: (text) => writeText.call(navigator.clipboard, text)
  };
}
