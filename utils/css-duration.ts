/** One CSS `<time>`: a number (sign, decimals, exponent allowed) with its `s`/`ms` unit. */
const CSS_TIME = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i;

/** The computed transition timing a class-driven transition runs on (a `CSSStyleDeclaration` fits). */
export interface TransitionTiming {
  readonly transitionProperty: string;
  readonly transitionDuration: string;
  readonly transitionDelay: string;
}

/**
 * One CSS `<time>` in milliseconds, sign kept (a delay may be negative).
 *
 * @param entry One trimmed list entry (`"0.18s"`, `"-50ms"`).
 * @returns The time in ms, or null when it is not a finite `<time>`.
 */
export function parseCssTimeMs(entry: string): number | null {
  const match = CSS_TIME.exec(entry);
  if (match === null) return null;
  const amount = Number(match[1]) * (match[2]?.toLowerCase() === 's' ? 1000 : 1);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * A computed CSS time list (`"0.18s, 280ms"`) in ms, one per entry, an
 * unparseable entry as 0 — positions kept, since entries pair by index.
 *
 * @param value The computed list (empty when unset → no entries).
 * @returns The entries in ms.
 */
function cssTimeListMs(value: string): number[] {
  if (value.trim() === '') return [];
  return value.split(',').map((entry) => parseCssTimeMs(entry.trim()) ?? 0);
}

/**
 * When a class-driven transition has finished, in ms after it starts — the
 * longest `delay + duration` over its entries, read from the browser instead
 * of re-typing a motion token in script (so the reduced-motion collapse
 * reaches it too). Entries pair as CSS pairs them: one per
 * `transition-property` entry, the time lists repeated to that length (the
 * longer time list's length when the property list is unknown). A negative
 * delay starts the run part-way through (its end comes sooner); a negative
 * duration is invalid (0). Never negative, never infinite, so a caller
 * waiting on it can never wait forever.
 *
 * @param timing The element's computed transition timing.
 * @returns The transition's end in ms (0 when nothing runs).
 */
export function transitionEndMs(timing: TransitionTiming): number {
  const durations = cssTimeListMs(timing.transitionDuration);
  if (durations.length === 0) return 0;
  const delays = cssTimeListMs(timing.transitionDelay);
  const properties = timing.transitionProperty.trim();
  const count =
    properties === '' ? Math.max(durations.length, delays.length) : properties.split(',').length;
  let end = 0;
  for (let index = 0; index < count; index += 1) {
    const duration = Math.max(0, durations[index % durations.length] ?? 0);
    const delay = delays.length === 0 ? 0 : (delays[index % delays.length] ?? 0);
    end = Math.max(end, delay + duration);
  }
  return end;
}
