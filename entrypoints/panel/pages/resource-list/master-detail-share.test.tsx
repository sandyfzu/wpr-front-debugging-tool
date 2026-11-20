/**
 * The master–detail controller's pane-width writes against the shell share:
 * a splitter width becomes a share only while the list is measured and wider
 * than it (a share lies in (0, 1)); a drag the pane's unmount cut short
 * persists the share on screen as is.
 */
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetailPresence, DetailPresenceContext } from '../../state/detail-presence';
import { createDetailShare, DetailShareContext } from '../../state/detail-share';
import { createMasterDetail, type MasterDetailController } from './master-detail';

/** Each test's unmount. */
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/**
 * Build a controller over a list of the given measured width, inside the
 * shell's presence + share providers.
 *
 * @param initialWidth The list's content width (px; 0 = unmeasured).
 * @param initialShare The stored share (`null`: the default).
 */
function setup(initialWidth: number, initialShare: number | null = null) {
  const write = vi.fn(() => Promise.resolve());
  const [width, setWidth] = createSignal(initialWidth);
  let controller: MasterDetailController | undefined;
  let share: ReturnType<typeof createDetailShare> | undefined;
  const view = render(() => {
    share = createDetailShare(initialShare, write);
    return (
      <DetailPresenceContext.Provider value={createDetailPresence(() => 'javascript')}>
        <DetailShareContext.Provider value={share}>
          {(() => {
            controller = createMasterDetail({
              width,
              visibleIds: () => [],
              allIds: () => [],
              rowsShown: () => true,
              hasRows: () => true,
              findRequest: () => null,
              detailEnabled: true,
              focusFallback: () => null
            });
            return null;
          })()}
        </DetailShareContext.Provider>
      </DetailPresenceContext.Provider>
    );
  });
  dispose = view.unmount;
  if (controller === undefined || share === undefined) throw new Error('setup failed');
  return { controller, share, write, setWidth };
}

describe('createMasterDetail pane width', () => {
  it('turns a splitter width into the share it stores', async () => {
    const { controller, share, write } = setup(1000);
    controller.previewPaneWidth(400);
    expect(share.share()).toBe(0.4);
    expect(write).not.toHaveBeenCalled();
    controller.commitPaneWidth(600);
    expect(share.share()).toBe(0.6);
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledExactlyOnceWith(0.6);
    });
  });

  it('stores nothing (and never throws) while the list is unmeasured or not wider than the width', async () => {
    const { controller, share, write, setWidth } = setup(0, 0.45);
    // Without the guard these reach `paneShareOf`, which rejects them (RangeError).
    expect(() => {
      controller.previewPaneWidth(400);
      controller.commitPaneWidth(400);
    }).not.toThrow();
    setWidth(400);
    expect(() => {
      controller.commitPaneWidth(400);
      controller.previewPaneWidth(500);
    }).not.toThrow();
    expect(share.share()).toBe(0.45);
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
  });

  it('persists the share on screen when a cut-short drag settles, whatever the list width now', async () => {
    const { controller, share, write, setWidth } = setup(1000);
    controller.previewPaneWidth(420);
    // The panel narrowed into the drill-in mid-drag: no width is recomputed.
    setWidth(600);
    controller.settlePaneWidth();
    expect(share.share()).toBe(0.42);
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledExactlyOnceWith(0.42);
    });
  });
});
