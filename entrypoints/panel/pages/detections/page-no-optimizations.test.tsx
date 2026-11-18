/**
 * The Detections control row when no card counts as an optimization. A valid
 * payload always yields optimization cards (the detections type requires
 * every row), so the card classifier is mocked behind a switch: the row, its
 * chips and the filtered-empty reset's focus target must survive that edge.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DetectionsSummary from '../../../../lib/panel/detections-summary';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { DetectionsView, SHOW_ALL_OPTIMIZATIONS } from './page';

/** The switch the mocked classifier reads: true → no card is an optimization. */
const classifier = vi.hoisted(() => ({ none: false }));

vi.mock('../../../../lib/panel/detections-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof DetectionsSummary>();
  return {
    ...actual,
    isOptimizationCard: (id: Parameters<typeof actual.isOptimizationCard>[0]): boolean =>
      !classifier.none && actual.isOptimizationCard(id)
  };
});

afterEach(() => {
  cleanup();
  classifier.none = false;
});

/** The page clock reading the view renders against. */
const NOW = 1_700_000_000_000;

/** A payload with one optimization active, so the Active chip is selectable. */
function oneActive(): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    wprDetections: {
      ...base.wprDetections,
      delay_js: { present: true, scripts: [], version: '2.0', delayedScripts: 0 }
    }
  });
}

/**
 * One status filter chip by id.
 *
 * @param id The chip's filter id.
 * @returns The chip button.
 * @throws {@link Error} When the chip is not rendered.
 */
function chip(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-fdt-filter-chip="${id}"]`);
  if (!found) throw new Error(`no chip ${id}`);
  return found;
}

/** The control row, when mounted. */
function controls(): Element | null {
  return document.querySelector('[data-fdt="detections-controls"]');
}

describe('DetectionsView with no optimization card', () => {
  it('keeps the control row with honest zero counts and an enabled All chip', () => {
    classifier.none = true;
    render(() => <DetectionsView data={oneActive()} now={NOW} />);
    expect(controls()).not.toBeNull();
    const counts = ['all', 'active', 'inactive'].map(
      (id) => chip(id).querySelector('[data-fdt-filter-count]')?.textContent
    );
    expect(counts).toEqual(['0', '0', '0']);
    // All is the reset target, so it stays selectable at zero; the empty buckets do not.
    expect(chip('all').disabled).toBe(false);
    expect(chip('active').disabled).toBe(true);
    expect(chip('inactive').disabled).toBe(true);
    expect(document.querySelector('[data-fdt="detections-filtered-empty"]')).toBeNull();
  });

  it('lands focus on the connected All chip after a refresh emptied every optimization', () => {
    const [data, setData] = createSignal(oneActive());
    render(() => <DetectionsView data={data()} now={NOW} />);
    fireEvent.click(chip('active'));
    classifier.none = true;
    setData(oneActive());
    const back = screen.getByRole('button', { name: SHOW_ALL_OPTIMIZATIONS });
    back.focus();
    fireEvent.click(back);
    const all = chip('all');
    expect(all.isConnected).toBe(true);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(all);
    expect(controls()).not.toBeNull();
  });
});
