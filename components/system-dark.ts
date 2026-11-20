/**
 * The OS color-scheme preference as a Solid signal — what a stored `system`
 * appearance resolves to right now. The extension documents never need it
 * to paint (their token stylesheet follows the media query itself); a
 * control that *names* the resolved palette (the appearance menu's icon and
 * tooltip) does.
 */
import { createSignal, onCleanup, type Accessor } from 'solid-js';

/** The media query the OS dark preference answers. */
export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

/** The slice of `MediaQueryList` the signal reads (tests hand fakes). */
export type ColorSchemeQuery = Pick<
  MediaQueryList,
  'matches' | 'addEventListener' | 'removeEventListener'
>;

/**
 * The real query, or null where the document has no `matchMedia` (then the
 * signal answers light, the token stylesheet's own no-preference branch).
 */
function realQuery(): ColorSchemeQuery | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(PREFERS_DARK_QUERY) : null;
}

/**
 * Track whether the OS prefers dark, live. Call inside a reactive owner: the
 * change listener is removed when the owner cleans up.
 *
 * @param query The preference query (default: the window's real one).
 * @returns Whether the OS currently prefers dark.
 */
export function createSystemDark(query: ColorSchemeQuery | null = realQuery()): Accessor<boolean> {
  const [dark, setDark] = createSignal(query?.matches ?? false);
  if (query === null) return dark;
  const onChange = (event: MediaQueryListEvent): void => {
    setDark(event.matches);
  };
  query.addEventListener('change', onChange);
  onCleanup(() => {
    query.removeEventListener('change', onChange);
  });
  return dark;
}
