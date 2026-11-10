/**
 * The declared-only sentence on the Detections cards, over a real WP Rocket
 * page that declares Minify CSS/JS and Preload Links with nothing minified:
 * those cards keep their "Active" verdict and Meta chip and say, as visible
 * text, that nothing on the page was acted on (Preload Links: that the page
 * holds no per-link proof); a declared card with its own
 * footprint (the mobile cache render) shows no such sentence, and a
 * declared-only iframes card drops its preview-image subtitle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../../lib/detection/fixtures/corpus';
import { runDetection } from '../../../../lib/detection/run-detection';
import { makeFdtData } from '../../state/fixtures';
import { DetectionsView } from './page';

afterEach(cleanup);

/** The ids of the cards showing the declared-only sentence. */
function declaredCards(): (string | null)[] {
  return Array.from(
    document.querySelectorAll('[data-fdt-card-declared-line]'),
    (line) => line.closest('[data-fdt-card-id]')?.getAttribute('data-fdt-card-id') ?? null
  );
}

describe('the declared-only sentence on the Detections cards', () => {
  it('shows on each declared card with nothing on the page, beside the unchanged verdict', () => {
    const html = readFileSync(join(FIXTURE_DIR, 'qa-landing-page.html'), 'utf8');
    const data = makeFdtData({ wprDetections: runDetection(html).detections });
    render(() => <DetectionsView data={data} now={0} />);
    expect(declaredCards()).toEqual(['minify_css', 'minify_js', 'preload_links']);
    const card = document.querySelector<HTMLElement>('[data-fdt-card-id="minify_js"]');
    expect(card?.querySelector('[data-fdt-card-declared-line]')?.textContent).toContain(
      'Declared on this render, but no script on this page is minified.'
    );
    expect(card?.textContent).toContain('Active');
    expect(card?.querySelector('[data-fdt-card-source]')?.textContent).toContain('Meta');
  });

  it('a declared-only iframes card shows no preview-image subtitle; one with targets does', () => {
    const html = readFileSync(join(FIXTURE_DIR, 'qa-landing-page.html'), 'utf8');
    const { detections } = runDetection(html);
    /** The iframes card's text over the page with the row declared, given its targets. */
    const iframesCard = (targets: boolean): string => {
      const data = makeFdtData({
        wprDetections: {
          ...detections,
          lazyload_iframes: { present: true, replaceImage: true, source: 'meta', targets }
        }
      });
      const { unmount } = render(() => <DetectionsView data={data} now={0} />);
      const text =
        document.querySelector('[data-fdt-card-id="lazyload_iframes"]')?.textContent ?? '';
      unmount();
      return text;
    };
    const declaredOnly = iframesCard(false);
    expect(declaredOnly).toContain('no iframe or video on this page is lazy-loaded');
    expect(declaredOnly).not.toContain('Replace iframe with preview image');
    expect(iframesCard(true)).toContain('Replace iframe with preview image');
  });
});
