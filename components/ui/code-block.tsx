/**
 * The code surface — one component for every rendered source (script
 * excerpts, stylesheets, served markup, JSON payloads the *page itself*
 * wants shown as source).
 *
 * shiki highlights with the `CODE_BLOCK_LANGS` grammars and a light/dark
 * theme pair whose colors resolve through `light-dark()` — code follows the
 * document palette exactly like the design tokens, with no appearance hook
 * and no re-render on theme switches.
 *
 * Off the main thread: shiki runs only in the highlight worker
 * (`code-block-highlight.worker.ts`), reached through the shiki-free client
 * (`code-block-worker-client.ts`) — this file imports neither shiki nor the
 * worker's modules as values, so consumers' chunks never carry shiki. The
 * client bounds each block with a hard time budget (a runaway block's worker
 * is terminated), so no code shape can freeze the panel; the main thread only
 * mounts the result. Until it arrives — or when it never does (timeout, no
 * worker support, too large) — the raw text shows in a plain `<pre>`:
 * content is never hidden behind loading.
 *
 * Lazy rendering: highlight work latches behind an `IntersectionObserver` on
 * this block's always-mounted wrapper element, and the observer is
 * disconnected on unmount — no view keeps a live observer, and none ever
 * attaches to a not-yet-existing child (the latch targets the wrapper that
 * exists at mount, so an absent element can never be the observed one).
 *
 * Keyboard scrolling: the code area is the horizontal scroller; while its
 * content overflows on an axis the user can scroll — and while it holds
 * focus, so focus never drops out from under the keyboard — it is a named,
 * focusable group (`tabindex="0"`, `role="group"`, the focus ring). A block
 * that fits, or only clips, costs no Tab stop. Overflow is tracked by the
 * shared resize watcher in `overflow-watch.ts`.
 *
 * Clamping: `maxLines` caps the visible code at N lines — the
 * collapsed-preview mode; consumers own the control that reveals the rest
 * and never style the block's internals. The clamp lives on an inner box
 * (`overflow-y: clip`, so nothing can scroll it vertically), never on the
 * focusable scroller, whose focus ring a mask would cut off; the bottom
 * edge fades only while lines are actually cut off (`data-fdt-clipped`).
 *
 * Height cap: `maxHeight` instead bounds the code area itself (a CSS
 * length — container units included), past which the area scrolls on both
 * axes: the reading mode for a whole source inside a view of known height.
 */
import type { ComponentProps, JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  untrack
} from 'solid-js';
import { For, Show } from 'solid-js';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { Button } from './button';
import { FOCUS_RING } from './classes';
import { CODE_BLOCK_LANGS, type CodeLanguage } from './code-block-langs';
import type { HighlightedCode } from './code-block-highlighter';
import { installTokenStyles } from './code-block-token-styles';
import type { HighlightedBlock } from './code-block-worker-protocol';
import {
  HighlightUnavailableError,
  sharedWorkerHighlighter,
  type HighlightFailure
} from './code-block-worker-client';
import { isClippedVertically, watchOverflow, type OverflowWatcher } from './overflow-watch';

/** The logger for load failures — raw text stays the rendered fallback. */
const logger = createLogger('code-block');

/**
 * Code longer than this (chars) is never highlighted: it renders as plain
 * monospace text with a quiet note. Tokenizing runs in the worker, but the
 * markup is mounted on the main thread in one go. With class-tagged tokens
 * (no per-span inline styles) that mount measured, in Chromium (2026-10-14),
 * 17–18 ms at 31.7 K chars and 11–15 ms at 20 K at normal speed, but 68–76
 * and 44–45 ms under 4× CPU throttling; 20 K keeps a slow machine under a
 * long task (50 ms). It also bounds what a message carries; past it are
 * bundles, where colors stop paying for the work.
 */
export const HIGHLIGHT_MAX_CHARS = 20_000;

/**
 * The visible wrap label — one declaration for both render sites (this
 * toolbar's toggle and a consumer row's own toggle), so the vocabulary
 * cannot fork at one surface.
 */
export const WRAP_LABEL = 'Wrap';

/** How far ahead of the viewport a block pre-highlights (px of root margin). */
const INTERSECTION_MARGIN = '150px';

/**
 * The highlighter surface `CodeBlock` consumes — only `highlight` is needed,
 * and a thin shape keeps test doubles minimal.
 */
interface HighlighterLike {
  /**
   * Highlight code text (see the loader's safety TSDoc — output is safe for
   * `innerHTML` even for untrusted source text). The production client
   * answers asynchronously and rejects with a `HighlightUnavailableError`;
   * test doubles may answer synchronously.
   */
  highlight: (
    code: string,
    options: { lang: CodeLanguage; signal?: AbortSignal }
  ) => HighlightedBlock | Promise<HighlightedBlock>;
}

/** The toolbar note per reason a block stays plain. */
export const PLAIN_NOTES: Readonly<Partial<Record<HighlightFailure | 'too-large', string>>> = {
  'too-large': 'Not highlighted (too large)',
  timeout: 'Not highlighted (took too long)'
};

/**
 * The intersection gate: observe one element, latch first visibility, stop.
 * Swappable seam — tests inject manual gates and assert the disconnect pin.
 */
export interface IntersectionGate {
  /**
   * Start observing; the callback fires at most once, on first visibility.
   *
   * @param onVisible The latch callback.
   */
  observe: (onVisible: () => void) => void;
  /** Disconnect the observer — wired to unmount, unconditionally. */
  disconnect: () => void;
}

export type CodeBlockProps = {
  /** The code text — raw, unescaped (may be untrusted; output stays HTML-safe). */
  text: string;
  /** The language of the code (see {@link CODE_BLOCK_LANGS}). */
  lang: CodeLanguage;
  /** Whether lines wrap instead of scrolling horizontally (toggleable; default `false`). */
  defaultWrap?: boolean;
  /**
   * The loader seam: schedules the highlighter and resolves it. Defaults to
   * the dynamic `import()` of the shiki loader — tests inject doubles so no
   * dynamic chunk is ever fetched in unit runs.
   */
  loadHighlighter?: () => Promise<HighlighterLike>;
  /** The intersection seam; defaults to a real `IntersectionObserver` on the wrapper. */
  createObserver?: (host: HTMLElement) => IntersectionGate;
  /**
   * The scroll region's accessible name, announced when it takes focus
   * because it overflows. The default, "`<lang>` code" (e.g. "javascript
   * code"), repeats across blocks — a page showing several blocks passes a
   * distinct label per block (e.g. the script's URL or role) so each Tab
   * stop says which code it is.
   */
  label?: string;
  /**
   * Clamp the visible code to this many lines (a positive integer): the
   * area clips below them with a faded bottom edge — a collapsed preview.
   * The consumer offers the control that reveals the rest (e.g. an expand
   * button with `aria-controls`); `undefined` (default) shows every line.
   * Reactive: toggling it expands/collapses in place, instantly.
   */
  maxLines?: number;
  /**
   * Told whether the clamp currently cuts lines off (`false` while
   * unclamped) — on mount and on every change, e.g. when wrapping folds a
   * long line past the clamp. Lets the consumer offer its reveal control
   * only when there is something to reveal.
   */
  onClipChange?: (clipped: boolean) => void;
  /**
   * Cap the code area's height (a non-empty CSS length, e.g.
   * `max(10rem, 100cqh - 3.5rem)` in a size container): shorter code keeps its natural height,
   * taller code scrolls inside the area (the area turns into the focusable
   * scroll region like any overflowing block). `undefined` (default): the
   * area grows with the code. Exclusive with {@link CodeBlockProps.maxLines}
   * (a clamp hides lines, a cap scrolls them). Reactive.
   */
  maxHeight?: string;
  /**
   * Line indexes (0-based) the consumer cut short — e.g. a preview's long
   * lines. Each gets a muted `…` drawn **after** the line (`::after`), outside
   * the code text: never highlighted, never selected or copied.
   */
  cutLines?: readonly number[];
  /**
   * Render the toolbar chrome (language label, plain note, Wrap toggle) —
   * the default. Pass `false` for the toolbar-less chrome: the code alone,
   * and the consumer owns the language presentation and the one Wrap control.
   * Nothing is hid by CSS — the chrome is simply not rendered, and the plain
   * note gets its own muted strip above the code (reasons are still required
   * information in this mode). The area's wrap classes, focusability and
   * clipping are unchanged either way.
   */
  toolbar?: boolean;
  /**
   * The wrap state when the consumer owns it (reactive): it decides the
   * area's wrap instead of this block's internal signal, so a control outside
   * the block — a row's toolbar-less Wrap button — drives it. Ownership is
   * fixed per instance at mount, and a runtime flip is a caller bug either
   * way: absent→present is ignored (ownership was already decided), while
   * defined→undefined throws — the block cannot silently substitute its own
   * state once it was rendering from the caller's. Required with the
   * toolbar-less chrome, because without a reachable state the block's own
   * toggle has nothing to move.
   */
  wrap?: boolean;
  /**
   * Press notification for the block's own Wrap button (toolbar chrome +
   * consumer-owned state): the button computes the next state and hands it
   * over, and the consumer's re-render feeds the block back through
   * {@link CodeBlockProps.wrap}. Required with that combination — a visible
   * button with no writer is a dead control.
   */
  onWrapToggle?: (wrap: boolean) => void;
  /**
   * Extra toolbar controls, placed before the Wrap toggle (toolbar chrome
   * only) — e.g. a consumer's display toggle that swaps `text`.
   */
  actions?: JSX.Element;
  /** The overflow seam; defaults to the shared `ResizeObserver` watcher. */
  watchOverflow?: OverflowWatcher;
  /** Extra classes on the container, merged last so callers win. */
  class?: string;
} & Omit<ComponentProps<'div'>, 'class' | 'children'>;

/**
 * The default intersection seam: an `IntersectionObserver` latched to first
 * visibility of the host element.
 *
 * The host handed over is the component's own wrapper (the element is always
 * mounted and the `ref` is assigned before `onMount` runs) — observing a
 * not-yet-rendered or already-gone child is structurally impossible: the
 * element exists at wire-up time, and the observer is exactly as alive as
 * the component either way — its disconnect is owned by the component's
 * cleanup, never left to render-time bookkeeping.
 *
 * @param host The observed element (the always-mounted wrapper).
 * @returns The one-shot latch with its explicit disconnect.
 */
function defaultIntersectionGate(host: HTMLElement): IntersectionGate {
  let fired = false;
  // Declared before wiring: even a synchronously-fired callback meets a
  // defined (early-return) callback, not a TDZ reference.
  let onVisible: () => void = () => undefined;
  const observer = new IntersectionObserver(
    (entries) => {
      if (fired || !entries.some((entry) => entry.isIntersecting)) return;
      fired = true; // one-way latch within the connection's lifetime
      onVisible();
    },
    // Highlight shortly before the block scrolls in; loading cuts the paint
    // gap between scroll arrival and styled code.
    { rootMargin: INTERSECTION_MARGIN }
  );
  observer.observe(host);
  return {
    observe: (callback) => {
      onVisible = callback;
    },
    disconnect: () => {
      observer.disconnect();
    }
  };
}

/**
 * The chrome contract, resolved once at mount and never after — state
 * ownership is fixed per instance (a runtime flip is a caller bug, not a
 * lifecycle). The `onWrapToggle` callback is deliberately not part of it: the
 * press path reads the prop live at press time, so a consumer re-rendering
 * with a fresh inline callback identity stays honored (a mount-time capture
 * would answer stale closures).
 */
interface ChromeContract {
  /** The toolbar chrome renders (language label, plain note, Wrap toggle). */
  readonly toolbar: boolean;
  /** The wrap state is consumer-owned via the `wrap` prop. */
  readonly consumerWrap: boolean;
}

/**
 * Resolve the chrome contract and fail fast on the caller-bug combinations
 * that would strand a control or a callback: a consumer-owned state also
 * seeded by `defaultWrap`, a toolbar-less block with no reachable state, a
 * visible button with no writer, and a callback that can never fire.
 *
 * @param props The block's own (non-DOM) props, read once — not reactive.
 *   Presence decides the rules; the `onWrapToggle` callback itself stays a
 *   live prop (read at press time, see {@link ChromeContract}).
 * @returns The contract the render reads; it never changes per instance.
 * @throws {@link Error} naming the offending prop on any rule above.
 */
function resolveChrome(
  props: Pick<CodeBlockProps, 'toolbar' | 'wrap' | 'onWrapToggle' | 'defaultWrap'>
): ChromeContract {
  // `untrack` is semantic, not cosmetic: the contract is resolved exactly
  // once at mount; the lint rule then knows what the function is for.
  return untrack(() => {
    const consumerWrap = props.wrap !== undefined;
    const toolbar = props.toolbar !== false;
    if (consumerWrap && props.defaultWrap !== undefined) {
      throw new Error(
        'CodeBlock: wrap is consumer-owned; defaultWrap only seeds the block-internal state.'
      );
    }
    if (!consumerWrap && !toolbar) {
      throw new Error(
        'CodeBlock: toolbar=false renders no Wrap control of its own; pass wrap (the consumer-owned state).'
      );
    }
    if (consumerWrap && toolbar && props.onWrapToggle === undefined) {
      throw new Error(
        'CodeBlock: consumer-owned wrap with the toolbar also needs onWrapToggle, or the button is a dead control.'
      );
    }
    if (!consumerWrap && props.onWrapToggle !== undefined) {
      throw new Error(
        'CodeBlock: onWrapToggle only answers the toolbar button; without wrap the block owns the state, so it would never fire.'
      );
    }
    return { toolbar, consumerWrap };
  });
}

/**
 * Render the shared code block.
 *
 * Paint order: the fallback `<pre>` with raw text renders from first mount
 * (content never waits, never a skeleton); on first intersection the loader
 * seam resolves and the highlighted `<pre>` renders in its place, inside the
 * same container. The toolbar (language label + wrap toggle) never remounts.
 * The highlighted mount is `innerHTML`-safe-by-construction (see
 * `CodeHighlighter.highlight`'s safety note); native div props pass through
 * to the container for `aria-*`/context attributes.
 *
 * Chrome: the toolbar (default) renders the language label, the plain note
 * and the Wrap toggle; the toolbar-less chrome (`toolbar={false}`) renders
 * the code alone, the consumer owns the language presentation and the one
 * Wrap control through the reactive `wrap` state, and the plain note still
 * shows as its own strip. Ownership and combinations are resolved once at
 * mount (`resolveChrome`), which fails fast on caller bugs.
 *
 * @param props.text The code text.
 * @param props.lang The language (one of {@link CODE_BLOCK_LANGS}).
 * @param props.defaultWrap Initial wrap state (toggleable afterwards).
 * @param props.toolbar `false` renders the toolbar-less chrome (default: toolbar).
 * @param props.wrap Consumer-owned, reactive wrap state (toolbar-less requires it).
 * @param props.onWrapToggle Press notification of the toolbar's Wrap button when the state is consumer-owned.
 * @param props.loadHighlighter Loader seam (tests inject resolved doubles).
 * @param props.createObserver Intersection seam (tests inject manual gates).
 * @param props.label The scroll region's name (default "`<lang>` code";
 *   pass a distinct one per block when a page shows several).
 * @param props.maxLines Clamp to N visible lines (collapsed preview).
 * @param props.onClipChange Told whether the clamp cuts lines off.
 * @param props.maxHeight Cap the area's height; taller code scrolls inside.
 * @param props.watchOverflow Overflow seam (tests inject a manual watcher).
 * @param props.class Extra classes on the container.
 * @param props.* Native div props (`id`, `aria-*`, …) pass through.
 * @throws {@link Error} for a language outside {@link CODE_BLOCK_LANGS} — a
 *   call-site bug fails at analysis/injection time rather than shipping a
 *   mislabelled block — for a `maxLines` that is not a positive integer, and
 *   for an empty `maxHeight` or one combined with `maxLines`.
 */
export function CodeBlock(props: CodeBlockProps): JSX.Element {
  // Lang is a call-site constant — the guard must run synchronously with a
  // throw, outside any tracked scope; reactivity is not the concern here.
  const lang = createMemo<string>(() => props.lang);
  // eslint-disable-next-line solid/reactivity -- bootstrap: `lang` is a call-site constant; the guard throws at setup on a caller bug
  const validatedLang = lang() as CodeLanguage;
  if (!CODE_BLOCK_LANGS.includes(validatedLang)) {
    throw new Error(`CodeBlock: unsupported language "${validatedLang}".`);
  }
  const [own, rest] = splitProps(props, [
    'text',
    'lang',
    'defaultWrap',
    'loadHighlighter',
    'createObserver',
    'label',
    'maxLines',
    'maxHeight',
    'onClipChange',
    'cutLines',
    'toolbar',
    'wrap',
    'onWrapToggle',
    'actions',
    'watchOverflow',
    'class'
  ]);

  // The chrome contract is resolved once at mount; a chrome-ownership caller
  // bug throws here, never mid-flight. (Later prop-flip bugs surface in the
  // readers below — see `wrap` and `maxLines`.)
  const chrome = resolveChrome(own);
  const [internalWrap, setInternalWrap] = createSignal(own.defaultWrap ?? false);
  /**
   * The effective wrap state: consumer-owned when resolved so, else internal.
   * A controlled value must survive while the block renders from it: a prop
   * that was defined at mount and becomes `undefined` later is the caller
   * unowning its own state (a caller bug), so this read throws naming it
   * instead of silently substituting the block-uncontrolled `false`.
   */
  const wrap = createMemo<boolean>(() => {
    if (!chrome.consumerWrap) return internalWrap();
    const value = own.wrap;
    if (value === undefined) {
      throw new Error(
        'CodeBlock: consumer-owned wrap must stay defined — the prop became undefined after mount.'
      );
    }
    return value;
  });
  /**
   * The Wrap press, from whatever control: a consumer-owned state goes back
   * through its callback (the re-render feeds this block through `wrap`),
   * the internal state writes itself.
   */
  const toggleWrap = (): void => {
    if (chrome.consumerWrap) own.onWrapToggle?.(!wrap());
    else setInternalWrap(!wrap());
  };
  const [highlighter, setHighlighter] = createSignal<HighlighterLike | undefined>();

  // Whether the code area overflows a scrollable axis, and whether it holds
  // focus: together they drive its focusability and name (a focused area
  // stays focusable when its overflow ends, so focus is never yanked away).
  const [scrollable, setScrollable] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const focusable = (): boolean => scrollable() || focused();

  /** The validated line clamp (`undefined`: unclamped). */
  const maxLines = createMemo<number | undefined>(() => {
    const lines = own.maxLines;
    if (lines !== undefined && !(Number.isInteger(lines) && lines > 0)) {
      throw new Error(`CodeBlock: maxLines must be a positive integer, got ${String(lines)}.`);
    }
    return lines;
  });

  /** The validated height cap (`undefined`: the area grows with the code). */
  const maxHeight = createMemo<string | undefined>(() => {
    const cap = own.maxHeight;
    if (cap === undefined) return undefined;
    if (cap.trim() === '') throw new Error('CodeBlock: maxHeight must be a non-empty CSS length.');
    if (own.maxLines !== undefined) {
      throw new Error('CodeBlock: maxHeight and maxLines are exclusive — pick a cap or a clamp.');
    }
    return cap;
  });

  let container: HTMLDivElement | undefined;
  let area: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let lines: HTMLDivElement | undefined;
  // Whether the clamp currently cuts lines off (drives the fade).
  const [clipped, setClipped] = createSignal(false);

  /** The default loader: the panel's one worker client (shiki-free here). */
  const defaultLoader = (): Promise<HighlighterLike> => Promise.resolve(sharedWorkerHighlighter());

  onMount(() => {
    if (container === undefined) {
      // Defensive: a ref-less render cannot be observed; the fallback stays
      // readable (content is never hidden) and the failure is actionable.
      logger.warn('Intersection gate skipped: container ref missing at mount.');
      return;
    }
    // The seams are resolved inside the tracked mount scope (prop reads there
    // are one-shot bootstrap choices — the gate and loader are fixed per instance).
    const createObserver = own.createObserver;
    const loadHighlighter = () => (own.loadHighlighter ?? defaultLoader)();
    const gate =
      createObserver !== undefined ? createObserver(container) : defaultIntersectionGate(container);
    let startedLoading = false;
    // eslint-disable-next-line solid/reactivity -- browser-callback, not a Solid tracked scope: the latch fires from the observer, outside tracking by contract
    gate.observe(() => {
      // One-way latch — even an aggressive gate double (tests) cannot double-load.
      if (startedLoading) return;
      startedLoading = true;
      void loadHighlighter()
        .then((loaded) => setHighlighter(loaded))
        .catch((error: unknown) => {
          // Degradation, not a dead end: the raw-text fallback remains.
          logger.warn('Code highlighting failed to load; raw text stays visible.', error);
        });
    });
    // The observer dies with this component: cleanup always disconnects, so
    // no stray connection survives an unmount.
    onCleanup(gate.disconnect);
  });

  onMount(() => {
    if (area === undefined || content === undefined || lines === undefined) {
      // Defensive, like the gate: without the elements there is nothing to
      // measure; the area simply stays a plain (non-focusable) box.
      logger.warn('Overflow watch skipped: code area refs missing at mount.');
      return;
    }
    // One-shot bootstrap read: the watcher is fixed per instance.
    const watch = own.watchOverflow ?? watchOverflow;
    // Scrollability: the area against the content-sized box inside it.
    onCleanup(watch(area, content, setScrollable));
    // Clipping: the clamp box (the content-sized box) against its lines.
    onCleanup(watch(content, lines, setClipped, isClippedVertically));
  });

  // The clamp's cut-off state, reported to the consumer (unclamped: false).
  createEffect(() => {
    const cut = maxLines() !== undefined && clipped();
    untrack(() => own.onClipChange)?.(cut);
  });

  /** Too large to highlight: plain text, with the note in the toolbar. */
  const tooLarge = (): boolean => own.text.length > HIGHLIGHT_MAX_CHARS;

  // The highlighted output for the current text — requested once the
  // highlighter arrived; the raw text shows meanwhile. A text change drops
  // the stale colors at once (the shown text always matches `text`); a newer
  // text or unmount aborts the request in flight.
  const [highlighted, setHighlighted] = createSignal<HighlightedCode | undefined>();
  // Why the current text stays plain, when the highlighter gave up on it.
  const [failure, setFailure] = createSignal<HighlightFailure | undefined>();
  createEffect(() => {
    const loader = highlighter();
    const text = own.text;
    const language = own.lang;
    setHighlighted(undefined);
    setFailure(undefined);
    if (loader === undefined || tooLarge()) return;
    const controller = new AbortController();
    onCleanup(() => {
      controller.abort();
    });
    Promise.resolve()
      .then(() => loader.highlight(text, { lang: language, signal: controller.signal }))
      .then((block) => {
        if (controller.signal.aborted) return; // superseded: never paint stale colors
        // Token colors are classes: their rules go into this block's root first.
        if (container !== undefined) installTokenStyles(container.getRootNode(), block.styles);
        setHighlighted(block.html);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return; // superseded: nothing to report
        // Degradation, not a dead end: the raw text stays, the reason is logged.
        if (error instanceof HighlightUnavailableError) setFailure(error.reason);
        logger.warn('Highlighting unavailable; raw text stays visible.', error);
      });
  });
  // The cut marks: tag the rendered line elements (raw or highlighted) the
  // consumer named; the `…` itself is CSS generated content.
  createEffect(() => {
    // Re-run whenever the rendered lines change (new text, new markup).
    const rendered = [highlighted(), own.text];
    const cut = new Set(own.cutLines ?? []);
    if (lines === undefined || rendered.length === 0) return;
    lines.querySelectorAll('.line').forEach((line, index) => {
      line.toggleAttribute('data-fdt-cut', cut.has(index));
    });
  });

  /** The toolbar note, when the block stays plain for a reason worth naming. */
  const plainNote = (): string | undefined =>
    tooLarge() ? PLAIN_NOTES['too-large'] : PLAIN_NOTES[failure() ?? 'aborted'];

  return (
    <div
      ref={container}
      data-fdt="code-block"
      data-fdt-highlighted={highlighted() !== undefined ? '' : undefined}
      class={cn('rounded border border-line-1 bg-surface-1', own.class)}
      {...rest}
    >
      <Show
        when={chrome.toolbar}
        fallback={
          <Show when={plainNote()}>
            {(note) => (
              <div
                data-fdt-code-block-plain
                class="truncate border-b border-line-1 bg-surface-2 px-2 py-0.5 text-2xs text-fg-muted"
              >
                {note()}
              </div>
            )}
          </Show>
        }
      >
        <div class="flex items-center justify-between gap-2 border-b border-line-1 bg-surface-2 px-2 py-0.5">
          <span class="flex min-w-0 items-center gap-2">
            <span data-fdt-code-block-lang class="text-2xs font-medium text-fg-muted">
              {own.lang}
            </span>
            <Show when={plainNote()}>
              {(note) => (
                <span data-fdt-code-block-plain class="truncate text-2xs text-fg-muted">
                  {note()}
                </span>
              )}
            </Show>
          </span>
          <span class="flex shrink-0 items-center gap-1">
            {own.actions}
            <Button
              type="button"
              data-fdt-code-block-wrap
              variant="ghost"
              size="sm"
              aria-pressed={wrap()}
              onClick={toggleWrap}
              class="min-h-6 px-1.5 text-2xs"
            >
              {WRAP_LABEL}
            </Button>
          </span>
        </div>
      </Show>
      <div
        ref={area}
        data-fdt-code-area
        data-fdt-scrollable={scrollable() ? '' : undefined}
        data-fdt-clamped={maxLines() !== undefined ? '' : undefined}
        data-fdt-clipped={maxLines() !== undefined && clipped() ? '' : undefined}
        data-fdt-capped={maxHeight() !== undefined ? '' : undefined}
        style={maxHeight() === undefined ? undefined : { 'max-height': maxHeight() }}
        // Focusable and named only while there is something to scroll (or
        // while focus is already here).
        tabindex={focusable() ? 0 : undefined}
        role={focusable() ? 'group' : undefined}
        aria-label={focusable() ? (own.label ?? `${own.lang} code`) : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        class={cn(
          // Never masked: a mask would clip this element's focus ring.
          // Opaque in the block's own background (no visible change): a long
          // line scrolled sideways stays backed by this scroller — over a
          // transparent one it sits past the block's box, and contrast
          // checks report it undeterminable.
          'overflow-x-auto rounded-b bg-inherit',
          // A height cap scrolls the rest vertically, inside the area.
          maxHeight() !== undefined && 'overflow-y-auto',
          FOCUS_RING,
          // Shared `pre` typography for the one `pre` either surface renders
          // (the fallback's own, or shiki's inside the highlighted wrapper);
          // token-driven via the mono token, the pre's own chrome stays flat.
          '[&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-2xs [&_pre]:leading-relaxed',
          // Wrap mode may break inside an over-long token (a URL, a minified
          // line): `anywhere` also shrinks the min-content width, so the
          // content box can narrow to the area and nothing scrolls sideways.
          wrap() ? '[&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere' : '[&_pre]:whitespace-pre'
        )}
      >
        {/* Sized to its content (never narrower than the area), so its box
            changes whenever the content's width does — the scroll watch
            observes it next to the area. It is also the clamp: sized to the
            content horizontally, its mask covers every scrolled-to column. */}
        <div
          ref={content}
          data-fdt-code-content
          style={{
            '--fdt-code-max-lines': maxLines() === undefined ? undefined : String(maxLines())
          }}
          class={cn(
            'w-fit min-w-full',
            // The code's own size and leading, so `1lh` is one code line.
            'text-2xs leading-relaxed',
            // Clamp: N lines + the pre's vertical padding (`p-2`, 1rem in
            // total). `clip`, not `hidden`: no scroll container, so nothing
            // (find-in-page, `scrollIntoView`) can scroll the preview.
            maxLines() !== undefined &&
              'max-h-[calc(var(--fdt-code-max-lines)*1lh+1rem)] overflow-y-clip',
            // Fade only the bottom padding strip — the half-shown next line —
            // and only while lines are really cut off; the last whole line
            // stays fully legible.
            maxLines() !== undefined && clipped() && 'mask-b-from-[calc(100%-0.5rem)]',
            // A cut line ends in a muted ellipsis outside the code text.
            "[&_[data-fdt-cut]]:after:text-fg-muted [&_[data-fdt-cut]]:after:content-['…']"
          )}
        >
          {/* The natural-height lines, measured against the clamp. */}
          <div ref={lines} data-fdt-code-lines>
            <Show
              when={highlighted()}
              fallback={<RawPre text={own.text} lines={(own.cutLines?.length ?? 0) > 0} />}
            >
              {(html) => <HighlightedSurface html={html()} />}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The fallback surface: the raw text in a plain `<pre>`, present from first
 * mount — the "content is never hidden" guarantee, and the state unloading
 * resolves into (highlight-load failures degrade here, logged). When lines
 * carry cut marks, each line is its own `.line` element (shiki's structure),
 * so the marks show before highlighting too; otherwise one text node.
 *
 * @param props.text The raw code text.
 * @param props.lines Render one element per line.
 */
function RawPre(props: { text: string; lines: boolean }): JSX.Element {
  return (
    <pre data-fdt-code-fallback>
      <Show when={props.lines} fallback={props.text}>
        <For each={props.text.split('\n')}>
          {(line, index) => (
            <>
              {index() > 0 ? '\n' : ''}
              <span class="line">{line}</span>
            </>
          )}
        </For>
      </Show>
    </pre>
  );
}

/**
 * The highlighted surface — shiki's `<pre>` mounted through `innerHTML`,
 * deliberate and safe (untrusted code text is HTML-escaped by shiki's
 * pipeline; no transformers/decorations are configured to inject markup).
 * The wrapper is a `div`: shiki's markup brings its own `<pre>`, and a `pre`
 * inside a `pre` is invalid and would keep the inner one's UA
 * `white-space: pre` out of the wrap toggle's reach.
 *
 * @param props.html The highlighter's `<pre>` HTML string.
 */
function HighlightedSurface(props: { html: string }): JSX.Element {
  return (
    <div
      data-fdt-code-highlighted
      // Safe by construction: shiki escapes source text in its hast→HTML
      // pipeline (regression-pinned against the real loader in the
      // highlighter's node-env suite), and no transformer or
      // decoration config is passed that could inject markup. The warning is
      // for "unsanitized input" in general; the safety contract lives on
      // `CodeHighlighter.highlight`.
      // eslint-disable-next-line solid/no-innerhtml -- safe by construction: shiki escapes code text (regression-pinned), no transformers/decorations configured
      innerHTML={props.html}
    />
  );
}
