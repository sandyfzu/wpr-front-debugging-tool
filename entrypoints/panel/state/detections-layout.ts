/**
 * The Detections page's layout choice — a shell-session preference: the
 * shell creates one store per panel mount and provides it, so the choice
 * survives route switches and soft refreshes (the page remounts, the store
 * does not) and resets with the panel document. Never persisted.
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import LayoutGrid from 'lucide-solid/icons/layout-grid';
import LayoutList from 'lucide-solid/icons/layout-list';
import List from 'lucide-solid/icons/list';
import type { ChoiceOption } from '../../../components/ui/choice-group';
import { listTier } from '../../../lib/panel/list-tier';

/**
 * `grouped`: the rows under WP Rocket's settings sections, the tiles stating
 * the page facts. `list`: every row (page facts included) in one bounded
 * column, in the view model's order. `cards`: the same full set as a
 * container-driven card grid (calm rows at compact, cards from the regular
 * tier up).
 */
export type DetectionLayout = 'grouped' | 'list' | 'cards';

/** The layout choices, in display order (the page's control maps over them). */
export const DETECTION_LAYOUTS: readonly ChoiceOption<DetectionLayout>[] = [
  { value: 'grouped', label: 'Grouped', icon: LayoutList },
  { value: 'list', label: 'List', icon: List },
  { value: 'cards', label: 'Cards', icon: LayoutGrid }
];

/** The layout a fresh panel starts in. */
export const DEFAULT_DETECTION_LAYOUT: DetectionLayout = 'grouped';

/**
 * The layout the page renders for the session's choice at a measured page
 * width. Below the regular tier the layout control is hidden, so the page
 * shows Grouped there (no hidden choice can strand it in List or Cards);
 * the choice itself stays in the store and applies again once the page is
 * wide enough. The threshold is the `@regular` variant's, so the rendered
 * layout and the control's visibility agree.
 *
 * @param choice The session's choice.
 * @param contentWidth The page container's content-box width in px; `0`
 *   (not measured yet, or no layout engine) keeps the choice.
 * @returns `grouped` for a measured compact width, else `choice`.
 * @throws {@link RangeError} For a negative or non-finite width (a measuring bug).
 */
export function shownDetectionLayout(
  choice: DetectionLayout,
  contentWidth: number
): DetectionLayout {
  const compact = listTier(contentWidth) === 'compact';
  return compact && contentWidth > 0 ? 'grouped' : choice;
}

/** The session's layout state. */
export interface DetectionsLayoutStore {
  /** The current layout. */
  readonly layout: Accessor<DetectionLayout>;
  /** Switch the layout (an equal value is a no-op for subscribers). */
  setLayout(next: DetectionLayout): void;
}

/**
 * Create a layout store. A factory, never a module-level signal: each shell
 * (and each test) owns its own state, so nothing leaks between mounts.
 *
 * @returns A store starting at {@link DEFAULT_DETECTION_LAYOUT}.
 */
export function createDetectionsLayout(): DetectionsLayoutStore {
  const [layout, setLayout] = createSignal<DetectionLayout>(DEFAULT_DETECTION_LAYOUT);
  return {
    layout,
    setLayout: (next) => {
      setLayout(next);
    }
  };
}

/** The shell-provided layout store (absent outside the panel shell). */
export const DetectionsLayoutContext = createContext<DetectionsLayoutStore>();

/**
 * The provisioned layout store inside the shell's component tree.
 *
 * @returns The store the shell created.
 * @throws {@link Error} outside the panel shell (a wiring bug: the choice
 *   would silently stop surviving route switches).
 */
export function useDetectionsLayout(): DetectionsLayoutStore {
  const store = useContext(DetectionsLayoutContext);
  if (store === undefined) {
    throw new Error('useDetectionsLayout() ran outside the panel shell.');
  }
  return store;
}
