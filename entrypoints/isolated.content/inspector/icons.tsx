/**
 * The detection widget's stroke icons, as inline SVG path data consumed
 * through the entrypoint's shared factory — one declaring site per icon,
 * geometry verified against the lucide package the panel surfaces ship
 * (an icon runtime is not justified inside this bundle's budget).
 *
 * The set is the widget's glyph family: one glyph per group (Tools
 * lands with the tool phases and is declared against that landing now), the
 * in-tab modifier glyphs (the Exclusion Builder pair, the simulation pair)
 * and the pill's presence marker.
 */

import type { BuilderBadgeKind, HudGroupId } from '../../../lib/detection/hud';
import type { SimulationFact } from '../../../lib/wp-rocket/types';
import type { IconCircle, IconEllipse } from '../ui/icons';

/** One glyph's stroke geometry exactly as the factory consumes it. */
export interface StripIconGlyph {
  /** Stroke path data, viewBox 24. */
  paths: readonly string[];
  /** Optional circle node (rendered before the paths, like lucide's own order). */
  circle?: IconCircle | null;
  /** Optional ellipse node (lucide's database-family glyphs carry one). */
  ellipse?: IconEllipse | null;
}

/** Cache group glyph (lucide `database` — the family's one ellipse-shaped node). */
export const CACHE_GROUP_ICON: StripIconGlyph = {
  paths: ['M3 5V19A9 3 0 0 0 21 19V5', 'M3 12A9 3 0 0 0 21 12'],
  ellipse: { cx: 12, cy: 5, rx: 9, ry: 3 }
};

/** JavaScript & CSS group glyph (lucide `file-sliders`). */
export const FILE_OPTIMIZATION_GROUP_ICON: StripIconGlyph = {
  paths: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M8 12h8',
    'M10 11v2',
    'M8 17h8',
    'M14 16v2'
  ]
};

/**
 * Media group glyph (lucide `image`): the source's `rect` node expressed as
 * its exact path equivalent (a rounded rectangle) so the factory stays
 * path+node based — x 3, y 3, w 18, h 18, r 2.
 */
export const MEDIA_GROUP_ICON: StripIconGlyph = {
  paths: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'
  ],
  circle: { cx: 9, cy: 9, r: 2 }
};

/** Preload group glyph (lucide `cloud-download`, aliased `download-cloud`). */
export const PRELOAD_GROUP_ICON: StripIconGlyph = {
  paths: [
    'M12 13v8l-4-4',
    'm12 21 4-4',
    'M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284'
  ]
};

/** CDN group glyph (lucide `globe`). */
export const CDN_GROUP_ICON: StripIconGlyph = {
  paths: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
  circle: { cx: 12, cy: 12, r: 10 }
};

/** Features group glyph (lucide `puzzle`). */
export const FEATURES_GROUP_ICON: StripIconGlyph = {
  paths: [
    'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z'
  ]
};

/** Each HUD group's glyph (the strip's group-heading scent). */
export const GROUP_ICONS: Readonly<Record<HudGroupId, StripIconGlyph>> = {
  'file-optimization': FILE_OPTIMIZATION_GROUP_ICON,
  media: MEDIA_GROUP_ICON,
  preload: PRELOAD_GROUP_ICON,
  cdn: CDN_GROUP_ICON,
  features: FEATURES_GROUP_ICON
};

/** Tools group glyph (lucide `wrench`) — declared for the tool phases' landing. */
export const TOOLS_GROUP_ICON: StripIconGlyph = {
  paths: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z'
  ]
};

/** Builder modifier glyph: turned off in this tab (lucide `circle-off`). */
export const BUILDER_OFF_ICON: StripIconGlyph = {
  paths: ['m2 2 20 20', 'M8.35 2.69A10 10 0 0 1 21.3 15.65', 'M19.08 19.08A10 10 0 1 1 4.92 4.92']
};

/** Builder modifier glyph: rows excluded (lucide `list-x`). */
export const BUILDER_EXCLUDED_ICON: StripIconGlyph = {
  paths: ['M16 5H3', 'M11 12H3', 'M16 19H3', 'm15.5 9.5 5 5', 'm20.5 9.5-5 5']
};

/** Simulation modifier glyph: simulated in this tab (lucide `flask-conical`). */
export const SIMULATED_ICON: StripIconGlyph = {
  paths: [
    'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2',
    'M6.453 15h11.094',
    'M8.5 2h7'
  ]
};

/** Simulation modifier glyph: marker not verified (lucide `shield-question-mark`). */
export const UNVERIFIED_ICON: StripIconGlyph = {
  paths: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    'M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3',
    'M12 17h.01'
  ]
};

/** A RUCSS test replaced the page's styles (lucide `test-tube-diagonal`). */
export const RUCSS_TEST_ICON: StripIconGlyph = {
  paths: [
    'M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3',
    'm16 2 6 6',
    'M12 16H4'
  ]
};

/** A row modifier's kind: the builder's effect, or the simulation fact. */
export type StripModifierKind = BuilderBadgeKind | SimulationFact;

/** Each row modifier kind's glyph (the panel badges' icons). */
export const MODIFIER_ICONS: Readonly<Record<StripModifierKind, StripIconGlyph>> = {
  off: BUILDER_OFF_ICON,
  excluded: BUILDER_EXCLUDED_ICON,
  simulated: SIMULATED_ICON,
  unverified: UNVERIFIED_ICON
};

/**
 * The pill's one presence marker: the rocket (lucide `rocket`), tinted by the
 * chrome's mood — identity, not a state claim (the recorded deviation: no
 * swapped icon pair, so a red failure never reads as an absence claim).
 */
export const PRESENT_ICON_PATHS = [
  'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09',
  'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z',
  'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05'
] as const;
