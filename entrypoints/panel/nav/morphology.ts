/**
 * The adaptive nav's morphology rule: at what container width the panel
 * renders the nav as a top tab bar instead of an icon rail.
 *
 * The rule lives in one place — this constant — because the DOM never
 * re-renders on resize: the browser restyles the same elements through CSS
 * container queries, and container-query conditions cannot read a JS value.
 * The nav's `@min-[768px]:` variant classes are the rule's CSS arm, so they
 * carry the same threshold as a class literal; a sync guard in the
 * morphology tests pins those literals (the nav component, the shell, and
 * this constant) to one number.
 */
export const NAV_TAB_BAR_MIN_WIDTH = 768;

/** The two nav forms, as the container width picks them. */
export type NavMorphology = 'tab-bar' | 'icon-rail';

/**
 * Resolve the nav's morphology for a container inline width.
 *
 * DevTools geometry mapping: `tab-bar` is the wide forms (docked bottom,
 * undocked window); `icon-rail` is the narrow one (docked right).
 *
 * @param containerWidth The container's inline size in px (fractional values allowed).
 * @returns The morphology the container's width selects.
 */
export function navMorphology(containerWidth: number): NavMorphology {
  return containerWidth >= NAV_TAB_BAR_MIN_WIDTH ? 'tab-bar' : 'icon-rail';
}
