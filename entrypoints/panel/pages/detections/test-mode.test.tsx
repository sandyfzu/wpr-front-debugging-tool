/**
 * TEST MODE on the Detections page: one notice above the summary while the
 * payload carries the page's RUCSS test fact (its reload remedy only where
 * the context can reload), none otherwise — and the notice on its own.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUCSS_TEST_MODE_SENTENCE,
  RUCSS_TEST_MODE_TAG
} from '../../../../lib/rucss-tester/test-mode';
import { makeFdtData } from '../../state/fixtures';
import { TestModeNotice } from '../test-mode-notice';
import { DetectionsView } from './page';

afterEach(cleanup);

describe('Detections — TEST MODE', () => {
  it('shows the notice once, above the summary, with the reload remedy', () => {
    const reload = vi.fn();
    render(() => (
      <DetectionsView
        data={makeFdtData({ rucssTestMode: { runs: 2 } })}
        now={0}
        reloadInspectedPage={reload}
      />
    ));
    const notices = document.querySelectorAll('[data-fdt="test-mode-notice"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toContain(RUCSS_TEST_MODE_TAG);
    expect(notices[0]?.textContent).toContain(RUCSS_TEST_MODE_SENTENCE);
    expect(document.body.textContent.split(RUCSS_TEST_MODE_TAG)).toHaveLength(2);
    // Above the overview tiles.
    const summary = document.querySelector('[data-fdt="detections-summary"]');
    expect(
      (notices[0] as Node).compareDocumentPosition(summary as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows nothing on an untested page', () => {
    render(() => <DetectionsView data={makeFdtData()} now={0} />);
    expect(document.querySelector('[data-fdt="test-mode-notice"]')).toBeNull();
    expect(document.body.textContent).not.toContain(RUCSS_TEST_MODE_TAG);
  });
});

describe('TestModeNotice', () => {
  it('leaves the reload out where the context cannot reload', () => {
    render(() => <TestModeNotice fact={{ runs: 1 }} />);
    expect(document.querySelector('[data-fdt="test-mode-notice"]')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
