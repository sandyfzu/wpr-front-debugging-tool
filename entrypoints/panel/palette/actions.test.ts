/**
 * The action registry's shape and dispatch: the five rows in order with
 * honest disabled states (export and copy-report require loaded data), the runs delegating to the seams exactly
 * once, the appearance cycle's rejection toasting its own stable remedy, and
 * the page rows mirroring the nav registry walk by navigate (same-route runs
 * land the heading focus instead).
 */
import { describe, expect, it, vi } from 'vitest';
import { toastItems, type ToastItem } from '../../../components/ui/toast-store';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { NAV_ROUTES, type RouteId } from '../routes';
import { makeFdtData } from '../state/fixtures';
import { SHORTCUTS_OVERLAY_BINDING } from './shortcuts';
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
  shortcuts: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
  copyReport: ReturnType<typeof vi.fn>;
}

/** The action seams, per call — no cross-test shared state. */
function actionDeps(options?: { data: FdtData | null }): {
  deps: PanelActionDeps;
  calls: ActionCalls;
  /** The last export dispatch's data (the dep consumed it). */
  seenExportData: () => FdtData | null;
} {
  /** The export dispatch's data, scoped to this deps round (never shared). */
  let seenExport: FdtData | null = null;
  const calls = {
    reload: vi.fn(),
    cycle: vi.fn((): Promise<void> => Promise.resolve(undefined)),
    shortcuts: vi.fn(),
    export: vi.fn((data: FdtData): 'downloaded' => {
      seenExport = data;
      return 'downloaded';
    }),
    copyReport: vi.fn((): Promise<'copied'> => Promise.resolve('copied'))
  };
  const deps: PanelActionDeps = {
    reload: calls.reload,
    loadedData: () => (options ? options.data : makeFdtData()),
    cycleAppearance: calls.cycle,
    openShortcuts: calls.shortcuts,
    exportData: (data: FdtData) =>
      Promise.resolve(calls.export(data)).then(() => 'downloaded' as const),
    copyReport: calls.copyReport
  };
  return { deps, calls, seenExportData: () => seenExport };
}

describe('createPageCommands (the pages half)', () => {
  it('mirrors the nav registry exactly: order, labels, group hints, always enabled', () => {
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
      // Every page exists, so no page row is ever gated.
      expect(row.disabled).toBeUndefined();
      expect(row.disabledNote).toBeUndefined();
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
      'action-copy-report',
      'action-toggle-appearance',
      'action-show-shortcuts'
    ]);
    const labels = createPanelActions(deps).map((row) => row.label);
    expect(labels).toEqual([
      'Reload data',
      'Export JSON',
      'Copy report',
      'Toggle appearance',
      'Show keyboard shortcuts'
    ]);
    // The shortcuts row's hint is the overlay binding's advertised key — the
    // palette hint says what actually works (and pins the exact typed key).
    const shortcutsRow = createPanelActions(deps).find((row) => row.id === 'action-show-shortcuts');
    expect(shortcutsRow?.hint).toBe(SHORTCUTS_OVERLAY_BINDING.hint);
    expect(shortcutsRow?.hint).toBe('/');
  });

  it('disables export honestly while nothing is loaded, and runs the export when it is', async () => {
    const unloaded = actionDeps({ data: null });
    const exportRow = createPanelActions(unloaded.deps).find(
      (row) => row.id === 'action-export-json'
    );
    expect(exportRow?.disabled).toBe(true);
    expect(exportRow?.disabledNote).toBe('No page data loaded');
    // A stale dispatch on a disabled row is the honest no-op.
    await exportRow?.run();
    expect(unloaded.calls.export).not.toHaveBeenCalled();

    const loaded = actionDeps({ data: makeFdtData() });
    const readyRow = createPanelActions(loaded.deps).find((row) => row.id === 'action-export-json');
    expect(readyRow?.disabled).toBe(false);
    await readyRow?.run();
    expect(loaded.seenExportData()).toEqual(makeFdtData());
  });

  it('dispatches every enabled run seam exactly once', async () => {
    const { deps, calls } = actionDeps({ data: makeFdtData() });
    const rows = createPanelActions(deps);
    for (const row of rows) {
      await row.run();
    }
    expect(calls.reload).toHaveBeenCalledTimes(1);
    expect(calls.export).toHaveBeenCalledTimes(1);
    expect(calls.cycle).toHaveBeenCalledTimes(1);
    expect(calls.shortcuts).toHaveBeenCalledTimes(1);
    expect(calls.copyReport).toHaveBeenCalledTimes(1);
  });

  it('gates the Copy report row on loaded data and hands it the loaded payload', async () => {
    const unloaded = actionDeps({ data: null });
    const disabledRow = createPanelActions(unloaded.deps).find(
      (row) => row.id === 'action-copy-report'
    );
    expect(disabledRow?.disabled).toBe(true);
    expect(disabledRow?.disabledNote).toBe('No page data loaded');
    await disabledRow?.run();
    expect(unloaded.calls.copyReport).not.toHaveBeenCalled();

    const data = makeFdtData({ undefinedReferencesOnPage: ['jQuery'] });
    const loaded = actionDeps({ data });
    const row = createPanelActions(loaded.deps).find((row) => row.id === 'action-copy-report');
    expect(row?.disabled).toBe(false);
    expect(row?.hint).toBe('Detections');
    expect(row?.keywords).toContain('support');
    await row?.run();
    expect(loaded.calls.copyReport).toHaveBeenCalledExactlyOnceWith(data);
  });

  it('runs the shell report binding when no copy seam is injected', async () => {
    let written = '';
    const writeText = vi.fn((text: string): Promise<void> => {
      written = text;
      return Promise.resolve();
    });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const { deps } = actionDeps({ data: makeFdtData() });
      const row = createPanelActions({ ...deps, copyReport: undefined }).find(
        (row) => row.id === 'action-copy-report'
      );
      await row?.run();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(written).toContain('## WP Rocket page report');
      expect(latestToast()?.title).toBe('Report copied');
    } finally {
      vi.unstubAllGlobals();
    }
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
