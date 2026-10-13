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
 * `import()` inside this file's default loader (`code-block-highlighter` is
 * never in the static import graph), so consuming pages' main chunks stay
 * lean until a block actually needs code. Until the highlighter resolves,
 * the raw text shows in a plain `<pre>` fallback — content is never hidden
 * behind loading.
 *
 * Lazy rendering (parity of the source's `useLazyLoad`, fixing master #24 +
 * #40): highlight work latches behind an `IntersectionObserver` on this
 * block's always-mounted wrapper element, and the observer is disconnected
 * on unmount — no view keeps an observer, and none ever attaches to a
 * not-yet-existing child.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { createMemo, createSignal, onCleanup, onMount, splitProps } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { Button } from './button';
import {
  CODE_BLOCK_LANGS,
  type CodeLanguage,
  type HighlightedCode
} from './code-block-highlighter';

/** The logger for load failures — raw text stays the rendered fallback. */
const logger = createLogger('code-block');

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
  /** Disconnect the observer — wired to unmount, always (master #24). */
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
  /** Extra classes on the container, merged last so callers win. */
  class?: string;
} & Omit<ComponentProps<'div'>, 'class' | 'children'>;

/**
 * The default intersection seam: an `IntersectionObserver` latched to first
 * visibility of the host element.
 *
 * The host handed over is the component's own wrapper (the element is always
 * mounted and the `ref` is assigned before `onMount` runs) — the failure of
 * the source's non-reactive `elementRef` (master #40) is structural here: no
 * child rendered later is ever the observed element, and the observer is
 * exactly as alive as the component either way — its disconnect is owned by
 * the component's cleanup, not by user code.
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
 * @param props.class Extra classes on the container.
 * @param props.* Native div props (`id`, `aria-*`, …) pass through.
 * @throws {@link Error} for a language outside {@link CODE_BLOCK_LANGS} — a
 *   call-site bug fails at analysis/injection time rather than shipping a
 *   mislabelled block.
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
    'class'
  ]);

  const [wrap, setWrap] = createSignal(own.defaultWrap ?? false);
  const [highlighter, setHighlighter] = createSignal<HighlighterLike | undefined>();

  let container: HTMLDivElement | undefined;

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
    // Master #24 pin: the observer dies with this component — no stray
    // connection survives cleanup.
    onCleanup(gate.disconnect);
  });

  /**
   * The highlighted output — computed only when the highlighter arrived;
   * sync per highlight-center (verified: `codeToHtml` is synchronous on a
   * constructed core highlighter).
   */
  const highlighted = createMemo<HighlightedCode | undefined>(() => {
    const loader = highlighter();
    if (loader === undefined) return undefined;
    try {
      return loader.highlight(own.text, { lang: own.lang });
    } catch (error: unknown) {
      // Structural failure (never reached with the two registered languages) —
      // degrade to the fallback rather than unmounting content.
      logger.warn('Highlighting threw; falling back to raw text.', error);
      return undefined;
    }
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
        <span data-fdt-code-block-lang class="text-2xs font-medium text-fg-muted">
          {own.lang}
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
        data-fdt-code-area
        class={cn(
          // Shared `pre` typography for both fallback and highlighted surface
          // (Token-driven via the mono token; the pre's own chrome stays flat).
          '[&>pre]:overflow-x-auto [&>pre]:p-2 [&>pre]:font-mono [&>pre]:text-2xs [&>pre]:leading-relaxed',
          wrap() ? '[&>pre]:whitespace-pre-wrap' : '[&>pre]:whitespace-pre'
        )}
      >
        <Show when={highlighted()} fallback={<RawPre text={own.text} />}>
          {(html) => <HighlightedPre html={html()} />}
        </Show>
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
 *
 * @param props.html The highlighter's `<pre>` HTML string.
 */
function HighlightedPre(props: { html: string }): JSX.Element {
  return (
    <pre
      data-fdt-code-highlighted
      // Safe by construction: shiki escapes source text in its hast→HTML
      // pipeline (empirically pinned in the loader), and no transformer or
      // decoration config is passed that could inject markup. The warning is
      // for "unsanitized input" in general; the safety contract lives on
      // `CodeHighlighter.highlight`.
      // eslint-disable-next-line solid/no-innerhtml -- safe by construction: shiki escapes code text (empirically pinned), no transformers/decorations configured
      innerHTML={props.html}
    />
  );
}
