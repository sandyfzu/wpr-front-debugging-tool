/** The tool pages' empty result card: dashed on the canvas color, icon tile, words, action, preview. */
import { cleanup, render, screen } from '@solidjs/testing-library';
import TestTubeDiagonal from 'lucide-solid/icons/test-tube-diagonal';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolEmptyCard } from './tool-empty-card';

afterEach(() => {
  cleanup();
});

/** The card frame around the hook. */
function frame(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-fdt="tool-empty"]');
  const card = element?.closest<HTMLElement>('[data-fdt="card"]');
  if (card === null || card === undefined) throw new Error('no card');
  return card;
}

describe('ToolEmptyCard', () => {
  it('says what is missing on a dashed canvas-colored card, the icon on an accent tile', () => {
    render(() => (
      <ToolEmptyCard
        hook="tool-empty"
        icon={TestTubeDiagonal}
        title="No test run yet"
        description="Run a test to see it."
      />
    ));
    expect(screen.getByText('No test run yet')).toBeTruthy();
    expect(screen.getByText('Run a test to see it.')).toBeTruthy();
    expect(frame().className).toContain('border-dashed');
    expect(frame().className).toContain('bg-surface-0');
    expect(frame().className).not.toContain('@wide:flex-1');
    const tile = document.querySelector('[data-fdt="tool-empty"] .bg-accent-soft');
    expect(tile?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-fdt="empty-state"]')?.className).not.toContain('pb-0');
  });

  it('fills the column from @wide on request, with the action and the preview under the words', () => {
    render(() => (
      <ToolEmptyCard
        hook="tool-empty"
        icon={TestTubeDiagonal}
        title="Nothing"
        description="Words."
        action={<button type="button">Act</button>}
        fill
      >
        <ul data-testid="preview">
          <li>Tile</li>
        </ul>
      </ToolEmptyCard>
    ));
    expect(frame().className).toContain('@wide:flex-1');
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy();
    // Built once (the preview is resolved a single time).
    expect(screen.getAllByTestId('preview')).toHaveLength(1);
    expect(document.querySelector('[data-fdt="empty-state"]')?.className).toContain('pb-0');
  });
});
