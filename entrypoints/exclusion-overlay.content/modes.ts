/**
 * The overlay shell's tool modes — one typed row per tool that runs on the
 * page's session. The shell owns everything a mode shares (header with the
 * session indicator, dock/fold/close, the pill, the session banners, the
 * footer's session actions, picking on the page, the highlight, live
 * announcements); a mode owns only its panels: a config panel (its inputs)
 * and, when its results are not shown inline, a results panel.
 *
 * Adding a tool = one row here + its folder; the shell renders the active
 * row's panels and never branches on a mode. The mode switch appears with
 * the second row (one mode needs none).
 */
import type { Accessor, JSX } from 'solid-js';
import type { VirtualizerFactory } from '../../components/ui/virtual-list';
import type { OverlayController } from './controller';
import { ExclusionsConfig } from './exclusions/mode';
import type { PageTools, PointedPick } from './page-tools';

/** What the shell's highlight draws over a page element. */
export interface HighlightTarget {
  readonly element: Element;
  /** The highlight label's lead (e.g. the feature it belongs to). */
  readonly label: string;
  /** What the element is (e.g. its file or id). */
  readonly subject: string;
}

/** What a mode hands the shell's picking. */
export interface PickEvents {
  /** The highlight label's lead for a hovered hit. */
  label(pick: PointedPick): string;
  /** A hit (picking has ended). */
  onPick(pick: PointedPick): void;
}

/** The shell services a mode's panels use. */
export interface OverlayModeContext {
  readonly controller: OverlayController;
  readonly page: PageTools;
  /** The panel is unfolded (not folded to the pill). */
  readonly panelOpen: Accessor<boolean>;
  /** One animation-frame request (context-owned). */
  readonly requestFrame: (run: () => void) => void;
  /** The lists' virtualizer seam (tests render every row). */
  readonly createVirtualizer?: VirtualizerFactory | undefined;
  /**
   * Pick on the page: the shell runs the picking bar and the highlight,
   * ends picking on a hit and hands it over; a cancel returns focus to
   * `returnTo`.
   */
  pick(returnTo: HTMLElement | undefined, events: PickEvents): void;
  /** Draw (or clear, `null`) the highlight over a page element. */
  highlight(target: HighlightTarget | null): void;
  /** Announce a result politely (screen readers). */
  announce(text: string): void;
}

/** A mode panel's props. */
export interface OverlayModePanelProps {
  readonly context: OverlayModeContext;
}

/** One tool mode. */
export interface OverlayMode {
  readonly id: string;
  /** The mode's name (the pill's label; the mode switch's once there are two). */
  readonly label: string;
  /** The inputs the session applies. */
  readonly Config: (props: OverlayModePanelProps) => JSX.Element;
  /** What the session reports for this page, or null when shown inline in the config. */
  readonly Results: ((props: OverlayModePanelProps) => JSX.Element) | null;
}

/** The modes, in switch order (the first is the one an open shows). */
export const OVERLAY_MODES: readonly [OverlayMode, ...OverlayMode[]] = [
  {
    id: 'exclusions',
    label: 'Exclusions',
    Config: ExclusionsConfig,
    // Per-lane and per-row counts render inline in the lanes.
    Results: null
  }
];
