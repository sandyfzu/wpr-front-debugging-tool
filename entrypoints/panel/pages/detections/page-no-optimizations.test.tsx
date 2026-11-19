/**
 * The Detections control row when no card counts as an optimization. A valid
 * payload always yields optimization cards (the detections type requires
 * every row), so the card classifier is mocked behind a switch: the row, its
 * segments and the filtered-empty reset's focus target must survive that edge.
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

/** A payload with one optimization active, so the Active segment is selectable. */
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
 * One status filter segment's radio by id.
 *
 * @param id The segment's filter id.
 * @returns The radio input.
 * @throws {@link Error} When the segment is not rendered.
 */
function segment(id: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `[data-fdt="detections-filter"] [data-fdt-choice-value="${id}"] input`
  );
  if (!found) throw new Error(`no segment ${id}`);
  return found;
}

/**
 * A segment's visible count.
 *
 * @param id The segment's filter id.
 * @returns The count text.
 */
function count(id: string): string | null | undefined {
  return segment(id).closest('[data-fdt="choice"]')?.querySelector('[data-fdt-choice-count]')
    ?.textContent;
}

/** The control row, when mounted. */
function controls(): Element | null {
  return document.querySelector('[data-fdt="detections-controls"]');
}

describe('DetectionsView with no optimization card', () => {
  it('keeps the control row with honest zero counts and an enabled All segment', () => {
    classifier.none = true;
    render(() => <DetectionsView data={oneActive()} now={NOW} />);
    expect(controls()).not.toBeNull();
    expect(['all', 'active', 'collecting', 'off'].map(count)).toEqual(['0', '0', '0', '0']);
    // All is the reset target, so it stays selectable at zero; the empty buckets do not.
    expect(segment('all').disabled).toBe(false);
    expect(segment('active').disabled).toBe(true);
    expect(segment('collecting').disabled).toBe(true);
    expect(segment('off').disabled).toBe(true);
    expect(document.querySelector('[data-fdt="detections-filtered-empty"]')).toBeNull();
  });

  it('lands focus on the connected All segment after a refresh emptied every optimization', () => {
    const [data, setData] = createSignal(oneActive());
    render(() => <DetectionsView data={data()} now={NOW} />);
    const label = segment('active').closest('[data-fdt="choice"]')?.querySelector('label');
    if (!label) throw new Error('no Active label');
    fireEvent.click(label);
    classifier.none = true;
    setData(oneActive());
    const back = screen.getByRole('button', { name: SHOW_ALL_OPTIMIZATIONS });
    back.focus();
    fireEvent.click(back);
    const all = segment('all');
    expect(all.isConnected).toBe(true);
    expect(all.checked).toBe(true);
    expect(document.activeElement).toBe(all);
    expect(controls()).not.toBeNull();
  });
});
