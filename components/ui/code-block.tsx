/**
 * The code surface — one component for every rendered source (script
 * excerpts, JSON payloads the *page itself* wants shown as source; structured
 * JSON data goes through `json-value.tsx`, never through a highlighter).
 *
 * shiki highlights with the javascript+json grammar pair and a light/dark
 * theme pair whose colors resolve through `light-dark()` — code follows the
 * document palette exactly like the design tokens, with no appearance hook
 * and no re-render on theme switches.
 *
 * Loading discipline: shiki is reached **only** through the dynamic
 * `import()` inside this file's default loader — this component file carries
 * no value import of the highlighter module (its types come through a pure
 * `import type`, erased at build time), and the language vocabulary comes
 * from the shiki-free `code-block-langs.ts`. Consumers importing `CodeBlock`
 * therefore keep shiki out of their static chunk — the property proven by
 * an esbuild consumer spike in the 2026-10-12 audit round (entry/eager
 * chunk: no shiki; a separate lazy chunk: all of it). Until the highlighter
 * resolves, the raw text shows in a plain `<pre>` fallback — content is
 * never hidden behind loading.
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
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { Button } from './button';
import { FOCUS_RING } from './classes';
import { CODE_BLOCK_LANGS, type CodeLanguage } from './code-block-langs';
import { fitsOneSlice } from './code-block-slices';
import type { HighlightedCode } from './code-block-highlighter';
import { isClippedVertically, watchOverflow, type OverflowWatcher } from './overflow-watch';

/** The logger for load failures — raw text stays the rendered fallback. */
const logger = createLogger('code-block');

/**
 * Code longer than this (chars) is never highlighted: it renders as plain
 * monospace text with a quiet "not highlighted" note. Tokenizing is sliced
 * (never a long task), but the highlighted markup is mounted in one go and
 * weighs ≈ 33 HTML chars per code char; measured in Chromium (2026-10-14),
 * mounting stays under 50 ms up to ≈ 47 K chars and becomes one 85–107 ms
 * task from ≈ 66 K. 32 K keeps a margin for slower machines; scripts past it
 * are bundles, where colors stop paying for the work.
 */
export const HIGHLIGHT_MAX_CHARS = 32_000;

/** How far ahead of the viewport a block pre-highlights (px of root margin). */
const INTERSECTION_MARGIN = '150px';

/**
 * The highlighter surface `CodeBlock` consumes — only `highlight` is needed,
 * and a thin shape keeps test doubles minimal.
 */
interface HighlighterLike {
  /**
   * Highlight code text (see the loader's safety TSDoc — output is safe for
   * `innerHTML` even for untrusted source text).
   */
  highlight: (code: string, options: { lang: CodeLanguage }) => HighlightedCode;
  /**
   * The sliced variant for longer code (same output); doubles may omit
   * it, then every size goes through {@link HighlighterLike.highlight}.
   */
  highlightSliced?: (
    code: string,
    options: { lang: CodeLanguage; signal?: AbortSignal }
  ) => Promise<HighlightedCode>;
}

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
 * @param props.text The code text.
 * @param props.lang The language (`javascript` | `json`).
 * @param props.defaultWrap Initial wrap state (toggleable afterwards).
 * @param props.loadHighlighter Loader seam (tests inject resolved doubles).
 * @param props.createObserver Intersection seam (tests inject manual gates).
 * @param props.label The scroll region's name (default "`<lang>` code";
 *   pass a distinct one per block when a page shows several).
 * @param props.maxLines Clamp to N visible lines (collapsed preview).
 * @param props.onClipChange Told whether the clamp cuts lines off.
 * @param props.watchOverflow Overflow seam (tests inject a manual watcher).
 * @param props.class Extra classes on the container.
 * @param props.* Native div props (`id`, `aria-*`, …) pass through.
 * @throws {@link Error} for a language outside {@link CODE_BLOCK_LANGS} — a
 *   call-site bug fails at analysis/injection time rather than shipping a
 *   mislabelled block — and for a `maxLines` that is not a positive integer.
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
    'onClipChange',
    'watchOverflow',
    'class'
  ]);

  const [wrap, setWrap] = createSignal(own.defaultWrap ?? false);
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

  let container: HTMLDivElement | undefined;
  let area: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let lines: HTMLDivElement | undefined;
  // Whether the clamp currently cuts lines off (drives the fade).
  const [clipped, setClipped] = createSignal(false);

  /**
   * The default loader: the dynamic `import()` of the shiki module graph —
   * the single place shiki can ever enter a build; the component file itself
   * stays statically free of it.
   */
  const defaultLoader = (): Promise<HighlighterLike> =>
    import('./code-block-highlighter').then((module) => module.getHighlighter());

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

  // The highlighted output for the current text — set once the highlighter
  // arrived. Short code highlights synchronously; longer code in slices, the
  // raw text showing meanwhile (a text change drops the stale colors at once,
  // so the shown text always matches `text`). A newer text or unmount aborts
  // the slices in flight.
  const [highlighted, setHighlighted] = createSignal<HighlightedCode | undefined>();
  createEffect(() => {
    const loader = highlighter();
    const text = own.text;
    const language = own.lang;
    setHighlighted(undefined);
    if (loader === undefined || tooLarge()) return;
    // Code within one bounded slice highlights synchronously (no plain-text
    // flash); anything longer goes through the slices, never a long task.
    if (loader.highlightSliced === undefined || fitsOneSlice(text)) {
      try {
        setHighlighted(loader.highlight(text, { lang: language }));
      } catch (error: unknown) {
        // Structural failure (never reached with the two registered
        // languages) — degrade to the fallback rather than unmounting content.
        logger.warn('Highlighting threw; falling back to raw text.', error);
      }
      return;
    }
    const controller = new AbortController();
    onCleanup(() => {
      controller.abort();
    });
    loader
      .highlightSliced(text, { lang: language, signal: controller.signal })
      .then(setHighlighted)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return; // superseded: nothing to report
        logger.warn('Highlighting threw; falling back to raw text.', error);
      });
  });

  return (
    <div
      ref={container}
      data-fdt="code-block"
      data-fdt-highlighted={highlighted() !== undefined ? '' : undefined}
      class={cn('rounded border border-line-1 bg-surface-1', own.class)}
      {...rest}
    >
      <div class="flex items-center justify-between gap-2 border-b border-line-1 bg-surface-2 px-2 py-0.5">
        <span class="flex min-w-0 items-center gap-2">
          <span data-fdt-code-block-lang class="text-2xs font-medium text-fg-muted">
            {own.lang}
          </span>
          <Show when={tooLarge()}>
            <span data-fdt-code-block-plain class="truncate text-2xs text-fg-muted">
              Not highlighted (too large)
            </span>
          </Show>
        </span>
        <Button
          type="button"
          data-fdt-code-block-wrap
          variant="ghost"
          size="sm"
          aria-pressed={wrap()}
          onClick={() => setWrap((value) => !value)}
          class="min-h-6 px-1.5 text-2xs"
        >
          Wrap
        </Button>
      </div>
      <div
        ref={area}
        data-fdt-code-area
        data-fdt-scrollable={scrollable() ? '' : undefined}
        data-fdt-clamped={maxLines() !== undefined ? '' : undefined}
        data-fdt-clipped={maxLines() !== undefined && clipped() ? '' : undefined}
        // Focusable and named only while there is something to scroll (or
        // while focus is already here).
        tabindex={focusable() ? 0 : undefined}
        role={focusable() ? 'group' : undefined}
        aria-label={focusable() ? (own.label ?? `${own.lang} code`) : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        class={cn(
          // Never masked: a mask would clip this element's focus ring.
          'overflow-x-auto rounded-b',
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
            maxLines() !== undefined && clipped() && 'mask-b-from-[calc(100%-0.5rem)]'
          )}
        >
          {/* The natural-height lines, measured against the clamp. */}
          <div ref={lines} data-fdt-code-lines>
            <Show when={highlighted()} fallback={<RawPre text={own.text} />}>
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
 * resolves into (highlight-load failures degrade here, logged).
 *
 * @param props.text The raw code text.
 */
function RawPre(props: { text: string }): JSX.Element {
  return <pre data-fdt-code-fallback>{props.text}</pre>;
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
