/**
 * Render tests for the error view — the no-dead-ends pattern's owner (UX-D9).
 * The retry affordance is required by the type system; tests pin the alert
 * semantics and the recovery dispatch.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorState } from './error-state';

afterEach(() => {
  cleanup();
});

describe('ErrorState', () => {
  it('names the failure and recovers on the retry control', () => {
    const onRetry = vi.fn();
    render(() => (
      <ErrorState
        title="Extension context lost"
        message="The tool was reloaded. Retry to reconnect."
        onRetry={onRetry}
      />
    ));
    const region = screen.getByRole('alert');
    expect(region.dataset.fdt).toBe('error-state');
    expect(screen.getByText('Extension context lost')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels the retry control and carries extra affordances', () => {
    render(() => (
      <ErrorState message="Data unreadable." onRetry={() => undefined} retryLabel="Reload data">
        <button type="button">Copy report</button>
      </ErrorState>
    ));
    expect(screen.getByRole('button', { name: 'Reload data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeTruthy();
  });

  it('defaults the headline and retry label', () => {
    render(() => <ErrorState onRetry={() => undefined} />);
    expect(screen.getByText("Couldn't load this view")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('uses one visible page heading only when it owns the whole page', () => {
    render(() => <ErrorState pageHeading title="Page data unavailable" onRetry={vi.fn()} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Page data unavailable' });
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(heading.classList).toContain('text-base');
    expect(heading.classList).not.toContain('sr-only');
    expect(screen.getByRole('alert').contains(heading)).toBe(true);
  });
});
