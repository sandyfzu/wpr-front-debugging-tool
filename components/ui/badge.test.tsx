/**
 * Render tests for the generic badge — soft fill or outlined ghost, borrowing
 * the shared vocabulary colors per kind.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './badge';

afterEach(() => {
  cleanup();
});

describe('Badge', () => {
  it('defaults to the neutral soft chip', () => {
    render(() => <Badge>2 040</Badge>);
    const badge = screen.getByText('2 040').closest('span[data-fdt]');
    expect(badge?.className).toContain('bg-status-neutral-soft');
    expect(badge?.className).toContain('text-status-neutral');
  });

  it('borrows a vocabulary kind for the soft chip and the outline', () => {
    render(() => (
      <div>
        <Badge kind="ok">passing</Badge>
        <Badge kind="error" variant="outline">
          failed
        </Badge>
      </div>
    ));
    expect(screen.getByText('passing').closest('span[data-fdt]')?.className).toContain(
      'bg-status-ok-soft'
    );
    const outlined = screen.getByText('failed').closest('span[data-fdt]');
    expect(outlined?.className).toContain('border-line-2');
    expect(outlined?.className).toContain('text-status-error');
  });

  it("draws the dashed ghost in the kind's own color, without a fill", () => {
    render(() => (
      <Badge kind="info" variant="dashed">
        simulated
      </Badge>
    ));
    const dashed = screen.getByText('simulated').closest('span[data-fdt]');
    expect(dashed?.className).toContain('border-dashed');
    expect(dashed?.className).toContain('border-current');
    expect(dashed?.className).toContain('text-status-info');
    expect(dashed?.className).not.toContain('bg-status-info-soft');
    expect(dashed?.className).not.toContain('border-line-2');
  });

  it('merges caller classes last', () => {
    render(() => <Badge class="ms-1">edge</Badge>);
    expect(screen.getByText('edge').closest('span[data-fdt]')?.className).toContain('ms-1');
  });

  it('carries an optional title, none by default', () => {
    render(() => (
      <>
        <Badge title="Also: Minified">+1</Badge>
        <Badge>plain</Badge>
      </>
    ));
    expect(screen.getByText('+1').getAttribute('title')).toBe('Also: Minified');
    expect(screen.getByText('plain').hasAttribute('title')).toBe(false);
  });
});
