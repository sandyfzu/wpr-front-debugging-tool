/**
 * The Detections page's layout choice — a shell-session preference: the
 * shell creates one store per panel mount and provides it, so the choice
 * survives route switches and soft refreshes (the page remounts, the store
 * does not) and resets with the panel document. Never persisted.
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import type { ChoiceOption } from '../../../components/ui/choice-group';

/**
 * `adaptive`: the container-driven card grid (rows at compact, cards from
 * the regular tier up). `list`: one bounded column of rows at every width.
 */
export type DetectionLayout = 'adaptive' | 'list';

/** The layout choices, in display order (the page's control maps over them). */
export const DETECTION_LAYOUTS: readonly ChoiceOption<DetectionLayout>[] = [
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'list', label: 'List' }
];

/** The layout a fresh panel starts in: today's width-driven grid. */
export const DEFAULT_DETECTION_LAYOUT: DetectionLayout = 'adaptive';

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
