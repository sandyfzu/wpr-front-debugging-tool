/**
 * Frame settling for layout reads after a resize or a mount: the panel
 * shell decides width rules (the nav form, the top bar fold) in a frame's
 * ResizeObserver step, before that frame paints — a script task right after
 * `setViewportSize` or `goto` can still read the previous (never painted)
 * layout. Two animation frames put the read after that decision.
 */
import type { Page } from '@playwright/test';

/**
 * Wait two animation frames in the page.
 *
 * @param page The page whose frames to wait for.
 */
export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}
