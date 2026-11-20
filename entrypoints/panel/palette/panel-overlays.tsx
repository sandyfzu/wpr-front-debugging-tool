/**
 * The panel's keyboard overlays — the command palette and the shortcuts
 * list: the shell's keyboard-first layer rendered as one composed surface.
 *
 * The two never mount together (the overlay store closes one before opening
 * the other), each is mount-gated by its store signal, and the palette's
 * content is registry-driven: the nav pages plus the action rows, matched by
 * the pure matcher. The action rows' production seams wire here — the stores
 * stay one hop from this component, keeping the whole layer swappable in
 * tests. The rows assemble per palette open (the store signal is the
 * assembly's reactive key), so the action gates hold the store's state at
 * the moment of use.
 */
import { Show, createMemo, untrack, type JSX } from 'solid-js';
import { rankCommands } from '../../../components/ui/command-matcher';
import { CommandPalette, type PaletteCommand } from '../../../components/ui/command-palette';
import { defaultClipboard } from '../../../components/ui/copy-button';
import { cycleAppearanceOption } from '../../../lib/storage/options';
import type { ChordBinding } from '../../../lib/palette-chord/keydown';
import type { FdtData } from '../../../lib/wp-rocket/types';
import type { FdtDataStore } from '../state/use-fdt-data';
import {
  createPageCommands,
  createPanelActions,
  type PanelActionDeps,
  type PanelCommand
} from './actions';
import { exportPageDataJson, type JsonExportResult } from './export-json';
import type { OverlayStore } from './overlays';
import { PaletteFooter } from './palette-footer';
import { ShortcutsOverlay } from './shortcuts-overlay';
import type { RouteId } from '../routes';

export interface PanelOverlaysProps {
  /** The overlay store (open/close/toggle/run, focus restore). */
  overlays: OverlayStore;
  /** The data store the reload and export actions read. */
  data: FdtDataStore;
  /** The route the panel is on (the page rows' dispatch input). */
  currentRoute: () => RouteId;
  /** Walk to a route (the shell's hash router). */
  navigate: (route: RouteId) => void;
  /** The route-switch focus move (the palette's same-page landing). */
  focusRouteHeading: () => void;
  /** The live chosen palette chord (the shortcuts overlay names it); null while unresolved. */
  paletteChord: () => ChordBinding | null;
}

/** The panel document's production anchor download: a Blob and one-shot click. */
function anchorDownload(payload: string, filename: string): void {
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  // The anchor exists only for the browser to confirm the transfer; its
  // object URL dies with this turn (a leaked blob URL would pin memory) —
  // and the disposal runs even when the click refuses, so a failed
  // download leaves neither node nor URL pinned.
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * The action rows' event-time seams over the accessor seeds: every store
 * read happens when an action runs, never at assembly time (the assembly
 * only gates the export row's disabled state off the passed snapshot).
 *
 * @param data The panel's data store, behind the caller's accessor.
 * @param overlays The overlay store, behind the caller's accessor.
 */
export function productionActionDeps(
  data: () => FdtDataStore,
  overlays: () => OverlayStore
): PanelActionDeps {
  return {
    reload: () => {
      data().reload();
    },
    loadedData: () => {
      const state = data().state();
      return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
    },
    cycleAppearance: cycleAppearanceOption,
    openShortcuts: () => {
      overlays().openShortcuts();
    },
    exportData: (pageData: FdtData): Promise<JsonExportResult> =>
      exportPageDataJson(pageData, {
        download: anchorDownload,
        clipboard: () => defaultClipboard(),
        now: () => new Date()
      })
  };
}

/**
 * One open's assembled rows: the registry pages, then the shell actions —
 * in that order, the palette's empty-query order.
 *
 * @param props The shell seams (the runs read them through the closures).
 * @returns The palette rows with their run closures attached.
 */
export function assembleCommands(props: PanelOverlaysProps): readonly PanelCommand[] {
  const pages = createPageCommands({
    navigate: (route) => {
      props.navigate(route);
    },
    currentRoute: () => props.currentRoute(),
    focusRouteHeading: () => {
      props.focusRouteHeading();
    }
  });
  const actions = createPanelActions(
    productionActionDeps(
      () => props.data,
      () => props.overlays
    )
  );
  return [...pages, ...actions];
}

/**
 * Render the palette + shortcuts overlays (each mounts when its store opens).
 *
 * @param props The stores and the navigation seams.
 */
export function PanelOverlays(props: PanelOverlaysProps): JSX.Element {
  // The rows assemble per palette open: the gate keeps the palette signal
  // tracked (each open re-computes), and the assembled rows are a snapshot —
  // the store reads inside the assembly are deliberately untracked, so a
  // push or refresh landing while the palette is up never churns the
  // combobox collection (and never yanks the user's arrow position); the
  // current open keeps the state it opened with and the next open
  // re-assembles fresh.
  const commands = createMemo(() => {
    if (!props.overlays.paletteOpen()) return [];
    return untrack(() => assembleCommands(props));
  });

  return (
    <>
      <Show when={props.overlays.paletteOpen()}>
        <CommandPalette
          variant="panel"
          footer={<PaletteFooter />}
          commands={commands()}
          filter={rankCommands}
          onClose={() => {
            props.overlays.closePalette();
          }}
          onRun={(row: PaletteCommand) => {
            // The event's dispatch reads the current command set (the
            // assembly memo of the open that produced it) exactly once.
            const command = commands().find((entry) => entry.id === row.id);
            if (command === undefined) return;
            props.overlays.runCommand(command.run);
          }}
        />
      </Show>
      <Show when={props.overlays.shortcutsOpen()}>
        <ShortcutsOverlay
          paletteChord={props.paletteChord}
          onClose={() => {
            props.overlays.closeShortcuts();
          }}
        />
      </Show>
    </>
  );
}
