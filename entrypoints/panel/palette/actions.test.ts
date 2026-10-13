/**
 * The action registry's shape and dispatch: the five rows in order with
 * honest disabled states (export requires loaded data, the builder tab
 * requires the browser surface), the runs delegating to the seams exactly
 * once, the appearance cycle's rejection toasting its own stable remedy, and
 * the page rows mirroring the nav registry walk by navigate (same-route runs
 * land the heading focus instead).
 */
import { describe, expect, it, vi } from 'vitest';
import { toastItems, type ToastItem } from '../../../components/ui/toast-store';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { NAV_ROUTES, type RouteId } from '../routes';
import { makeFdtData } from '../state/fixtures';
import {
  createPageCommands,
  createPanelActions,
  type PageCommandDeps,
  type PanelActionDeps
} from './actions';

function latestToast(): ToastItem | undefined {
  const items = toastItems();
  return items[items.length - 1];
}

/** What one actionDeps round records (the export's seen snapshot included). */
interface ActionCalls {
  reload: ReturnType<typeof vi.fn>;
  cycle: ReturnType<typeof vi.fn>;
  builder: ReturnType<typeof vi.fn>;
  shortcuts: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
}

/** The action seams, per call — no cross-test shared state. */
function actionDeps(options?: { data: FdtData | null; tabsAvailable: boolean }): {
  deps: PanelActionDeps;
  calls: ActionCalls;
  /** The last export dispatch's data (the dep consumed it). */
  seenExportData: () => FdtData | null;
} {
  const tabsAvailable = options?.tabsAvailable ?? true;
  /** The export dispatch's data, scoped to this deps round (never shared). */
  let seenExport: FdtData | null = null;
  const calls = {
    reload: vi.fn(),
    cycle: vi.fn((): Promise<void> => Promise.resolve(undefined)),
    builder: vi.fn((): Promise<'opened'> => Promise.resolve('opened')),
    shortcuts: vi.fn(),
    export: vi.fn((data: FdtData): 'downloaded' => {
      seenExport = data;
      return 'downloaded';
    })
  };
  const deps: PanelActionDeps = {
    reload: calls.reload,
    loadedData: () => (options ? options.data : makeFdtData()),
    cycleAppearance: calls.cycle,
    openExclusionBuilder: calls.builder,
    exclusionBuilderAvailable: () => tabsAvailable,
    openShortcuts: calls.shortcuts,
    exportData: (data: FdtData) =>
      Promise.resolve(calls.export(data)).then(() => 'downloaded' as const)
  };
  return { deps, calls, seenExportData: () => seenExport };
}

describe('createPageCommands (the pages half)', () => {
  it('mirrors the nav registry exactly: order, labels, group hints, reserved gates', () => {
    const deps: PageCommandDeps = {
      navigate: vi.fn(),
      currentRoute: () => 'detections',
      focusRouteHeading: vi.fn()
    };
    const rows = createPageCommands(deps);
    expect(rows).toHaveLength(NAV_ROUTES.length);
    rows.forEach((row, index) => {
      const source = NAV_ROUTES[index];
      if (source === undefined) throw new Error('the row registry is shorter than the page rows');
      expect(row.id).toBe(`page-${source.id}`);
      expect(row.label).toBe(source.label);
      expect(row.hint).toBe(source.group);
      expect(row.disabled).toBe(source.reserved ?? false);
      expect(row.disabledNote).toBe(source.reservedNote);
    });
  });

  it('navigates on a foreign route and focuses the heading on the current route', async () => {
    let route: RouteId = 'detections';
    const navigate = vi.fn((to: RouteId) => {
      route = to;
    });
    const focusRouteHeading = vi.fn();
    const deps: PageCommandDeps = { navigate, currentRoute: () => route, focusRouteHeading };
    const rows = createPageCommands(deps);
    // Already on detections: the row lands the heading focus itself (the
    // route effect has nothing to fire for a same-value navigate).
    const detections = rows.find((row) => row.id === 'page-detections');
    await detections?.run();
    expect(focusRouteHeading).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    // A foreign route navigates.
    const javascript = rows.find((row) => row.id === 'page-javascript');
    await javascript?.run();
    expect(navigate).toHaveBeenCalledWith('javascript');
  });
});

describe('createPanelActions (the actions half)', () => {
  it('ships the five committed rows, in order, with their vocabulary', () => {
    const { deps } = actionDeps();
    const ids = createPanelActions(deps).map((row) => row.id);
    expect(ids).toEqual([
      'action-reload-data',
      'action-export-json',
      'action-toggle-appearance',
      'action-open-exclusion-builder',
      'action-show-shortcuts'
    ]);
    const labels = createPanelActions(deps).map((row) => row.label);
    expect(labels).toEqual([
      'Reload data',
      'Export JSON',
      'Toggle appearance',
      'Open Exclusion Builder',
      'Show keyboard shortcuts'
    ]);
  });

  it('disables export honestly while nothing is loaded, and runs the export when it is', async () => {
    const unloaded = actionDeps({ data: null, tabsAvailable: true });
    const exportRow = createPanelActions(unloaded.deps).find(
      (row) => row.id === 'action-export-json'
    );
    expect(exportRow?.disabled).toBe(true);
    expect(exportRow?.disabledNote).toBe('No page data loaded');
    // A stale dispatch on a disabled row is the honest no-op.
    await exportRow?.run();
    expect(unloaded.calls.export).not.toHaveBeenCalled();

    const loaded = actionDeps({ data: makeFdtData(), tabsAvailable: true });
    const readyRow = createPanelActions(loaded.deps).find((row) => row.id === 'action-export-json');
    expect(readyRow?.disabled).toBe(false);
    await readyRow?.run();
    expect(loaded.seenExportData()).toEqual(makeFdtData());
  });

  it('disables the builder tab row when the browser surface is missing', async () => {
    const unavailable = actionDeps({ data: makeFdtData(), tabsAvailable: false });
    const row = createPanelActions(unavailable.deps).find(
      (row) => row.id === 'action-open-exclusion-builder'
    );
    expect(row?.disabled).toBe(true);
    expect(row?.disabledNote).toContain('unavailable');
    // The row still explains itself even though it cannot run.
    await row?.run();
    expect(unavailable.calls.builder).not.toHaveBeenCalled();
  });

  it('dispatches every enabled run seam exactly once', async () => {
    const { deps, calls } = actionDeps({ data: makeFdtData(), tabsAvailable: true });
    const rows = createPanelActions(deps);
    for (const row of rows) {
      await row.run();
    }
    expect(calls.reload).toHaveBeenCalledTimes(1);
    expect(calls.export).toHaveBeenCalledTimes(1);
    expect(calls.cycle).toHaveBeenCalledTimes(1);
    expect(calls.builder).toHaveBeenCalledTimes(1);
    expect(calls.shortcuts).toHaveBeenCalledTimes(1);
  });

  it('answers a rejected appearance write with the stable remedy toast', async () => {
    const { deps, calls } = actionDeps();
    calls.cycle.mockRejectedValueOnce(new Error('storage invalidated'));
    const row = createPanelActions(deps).find((row) => row.id === 'action-toggle-appearance');
    await row?.run();
    const item = latestToast();
    expect(item?.tone).toBe('error');
    expect(item?.description).toContain('did not save');
  });
});
