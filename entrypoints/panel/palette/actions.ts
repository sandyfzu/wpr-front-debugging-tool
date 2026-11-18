/**
 * The panel's command palette content — the typed registry the palette
 * renders: every nav page and every shell action, in one list order.
 *
 * Adding a row = adding it to the page or action factory here (+ its tests);
 * the palette, matcher and shortcut surfaces need nothing else. Rows carry
 * their run closure with the shell seams injected — the pages navigate (the
 * shell's route-switch leg owns the focus move), the actions delegate to
 * their mechanism modules (which own their own toast feedback).
 *
 * Pages and actions share one row contract, so a later phase's rows (tool
 * pages) land as one more row here.
 */
import ClipboardCopy from 'lucide-solid/icons/clipboard-copy';
import Download from 'lucide-solid/icons/download';
import Keyboard from 'lucide-solid/icons/keyboard';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import SunMoon from 'lucide-solid/icons/sun-moon';
import type { PaletteCommand } from '../../../components/ui/command-palette';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { createLogger } from '../../../lib/logger';
import { toast } from '../../../components/ui/toast-store';
import { copySupportReport, type CopyReportOutcome } from '../report/copy-report';
import type { JsonExportResult } from './export-json';
import { SHORTCUTS_OVERLAY_BINDING } from './shortcuts';
import { NAV_ROUTES, type RouteId } from '../routes';

const log = createLogger('panel');

/**
 * One executable palette row: the surface contract plus its run closure.
 * Runs hand their promises to the overlay store's guard, so an escape past
 * their own handling is logged there, never unhandled.
 */
export interface PanelCommand extends PaletteCommand {
  /** The row's execution (an arrow closure over the injected seams — no `this`). */
  run: () => void | Promise<void>;
}

/** What the page rows need to dispatch a navigation. */
export interface PageCommandDeps {
  /** Walk to a route (the shell's hash router). */
  navigate(route: RouteId): void;
  /** The route the panel is on right now. */
  currentRoute(): RouteId;
  /** The route-switch focus move (the palette's same-page landing). */
  focusRouteHeading(): void;
}

/** What the action rows delegate to (the mechanisms own their feedback). */
export interface PanelActionDeps {
  /** The data store's reload control (the machine-gated refresh trigger). */
  reload(): void;
  /** The loaded page data, or null while nothing is loaded (export's gate). */
  loadedData(): FdtData | null;
  /** Advance the stored appearance one cycle step; rejects on a failed write. */
  cycleAppearance(): Promise<void>;
  /** Open the shortcuts overlay (the palette's own row path). */
  openShortcuts(): void;
  /** Run the whole JSON export (the mechanism module owns its toast feedback). */
  exportData(data: FdtData): Promise<JsonExportResult>;
  /**
   * Copy the support report (the mechanism owns its toast feedback).
   * Optional: absent, the row runs the shell's report binding — the same
   * one the Detections page's `Copy report` button runs.
   */
  copyReport?: (data: FdtData) => Promise<CopyReportOutcome>;
}

/**
 * The page rows, in registry order (the palette's empty-query order). Each
 * row walks to its route; running the row for the route the panel is already
 * on lands explicit focus on the heading, since the route effect (keyed on
 * route changes) has nothing to fire for a same-value navigate.
 *
 * @param deps The navigation seams.
 */
export function createPageCommands(deps: PageCommandDeps): PanelCommand[] {
  return NAV_ROUTES.map((row): PanelCommand => ({
    id: `page-${row.id}`,
    label: row.label,
    icon: row.icon,
    hint: row.group,
    keywords: [row.group.toLocaleLowerCase()],
    run: () => {
      if (deps.currentRoute() === row.id) {
        deps.focusRouteHeading();
      } else {
        deps.navigate(row.id);
      }
    }
  }));
}

/** The appearance row's cycle, phrased once (the row's keywords repeat the states). */
const APPEARANCE_CYCLE_NOTE = 'system → dark → light';

/** The stable remedy line for a rejected appearance write. */
const APPEARANCE_SAVE_NOTE = 'The choice did not save; the panel keeps its current palette.';

/**
 * The five shell actions, in row order. Each run routes through its
 * mechanism and reports there — a mechanism that rejects despite its own
 * guarding is a wiring bug, so the runs hand their promises to the overlay's
 * guard (which logs an escape) instead of re-catching here; only the
 * appearance cycle carries its own user-facing rejection path, because the
 * storage write has no mechanism module of its own.
 *
 * @param deps The action seams.
 */
export function createPanelActions(deps: PanelActionDeps): PanelCommand[] {
  return [
    {
      id: 'action-reload-data',
      label: 'Reload data',
      icon: RefreshCw,
      keywords: ['refresh', 'update', 'refetch'],
      run: () => {
        deps.reload();
      }
    },
    {
      id: 'action-export-json',
      label: 'Export JSON',
      icon: Download,
      keywords: ['save', 'download'],
      disabled: deps.loadedData() === null,
      disabledNote: 'No page data loaded',
      run: () => {
        const data = deps.loadedData();
        // A dispatch reaching a disabled row is stale bookkeeping; the
        // honest behavior is the no-op, never a fabricated export.
        if (data === null) return;
        return deps.exportData(data).then(() => undefined);
      }
    },
    {
      id: 'action-copy-report',
      label: 'Copy report',
      icon: ClipboardCopy,
      hint: 'Detections',
      keywords: ['support', 'ticket', 'markdown', 'clipboard', 'share'],
      disabled: deps.loadedData() === null,
      disabledNote: 'No page data loaded',
      run: () => {
        const data = deps.loadedData();
        // Same stale-dispatch rule as the export: no data, no report.
        if (data === null) return;
        const copy = deps.copyReport ?? ((loaded: FdtData) => copySupportReport(loaded));
        return copy(data).then(() => undefined);
      }
    },
    {
      id: 'action-toggle-appearance',
      label: 'Toggle appearance',
      icon: SunMoon,
      hint: APPEARANCE_CYCLE_NOTE,
      keywords: ['theme', 'dark', 'light', 'system'],
      run: () => {
        return deps
          .cycleAppearance()
          .then(() => undefined)
          .catch((cause: unknown) => {
            // A failed persistence is user-facing: the toast frames the
            // outcome, the log carries the cause. Never a silent swallow.
            log.warn('The appearance cycle could not be persisted', {
              cause: cause instanceof Error ? { message: cause.message } : cause
            });
            toast.error('The appearance could not be changed', {
              description: APPEARANCE_SAVE_NOTE
            });
          });
      }
    },
    {
      id: 'action-show-shortcuts',
      label: 'Show keyboard shortcuts',
      icon: Keyboard,
      // The row's hint advertises the overlay's real activation read from
      // the same declared binding the listener accepts (what actually
      // works, not the host-claimed chord).
      hint: SHORTCUTS_OVERLAY_BINDING.hint,
      keywords: ['keys', 'help', '?', 'slash', '/'],
      run: () => {
        deps.openShortcuts();
      }
    }
  ];
}
