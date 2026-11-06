/**
 * The shared recovery row: the reload left out where the context cannot
 * reload, review-settings where no settings are bound (and the row when
 * nothing is left), the first available recovery primary, each button's
 * hook and action.
 */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableRecoveries, RecoveryButtons, type PageRecovery } from './recovery-buttons';

const LABELS: Readonly<Record<PageRecovery, string>> = {
  retry: 'Ask again',
  'reload-page': 'Reload page',
  'review-settings': 'Review settings'
};

afterEach(() => {
  cleanup();
});

describe('availableRecoveries', () => {
  it('keeps the order and drops the reload only where the context cannot reload', () => {
    const reload = { reload: true, reviewSettings: false };
    const noReload = { reload: false, reviewSettings: false };
    expect(availableRecoveries(['reload-page', 'retry'], reload)).toEqual(['reload-page', 'retry']);
    expect(availableRecoveries(['reload-page', 'retry'], noReload)).toEqual(['retry']);
    expect(availableRecoveries(['reload-page'], noReload)).toEqual([]);
  });

  it('drops review-settings only where the tool has no settings to go back to', () => {
    const recoveries = ['review-settings', 'retry'] as const;
    expect(availableRecoveries(recoveries, { reload: false, reviewSettings: true })).toEqual([
      'review-settings',
      'retry'
    ]);
    expect(availableRecoveries(recoveries, { reload: true, reviewSettings: false })).toEqual([
      'retry'
    ]);
  });
});

describe('RecoveryButtons', () => {
  it('renders the first available recovery primary and runs each action', () => {
    const onRetry = vi.fn();
    const reloadPage = vi.fn();
    const { container } = render(() => (
      <RecoveryButtons
        recoveries={['reload-page', 'retry']}
        labels={LABELS}
        onRetry={onRetry}
        reloadPage={reloadPage}
        hook="tool"
      />
    ));
    const reload = container.querySelector<HTMLButtonElement>(
      '[data-fdt-recovery="tool:reload-page"]'
    );
    const retry = container.querySelector<HTMLButtonElement>('[data-fdt-recovery="tool:retry"]');
    expect(reload?.textContent).toBe('Reload page');
    expect(retry?.textContent).toBe('Ask again');
    // The primary look (accent fill) is the first one's only.
    expect(reload?.className).toContain('bg-accent-strong');
    expect(retry?.className).not.toContain('bg-accent-strong');
    fireEvent.click(reload as HTMLButtonElement);
    fireEvent.click(retry as HTMLButtonElement);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('promotes the next recovery to primary when the reload is left out', () => {
    const { container } = render(() => (
      <RecoveryButtons
        recoveries={['reload-page', 'retry']}
        labels={LABELS}
        onRetry={() => undefined}
        hook="tool"
      />
    ));
    expect(container.querySelector('[data-fdt-recovery="tool:reload-page"]')).toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.className).toContain('bg-accent-strong');
  });

  it('offers review-settings when bound, primary when first', () => {
    const onReviewSettings = vi.fn();
    const { container } = render(() => (
      <RecoveryButtons
        recoveries={['review-settings', 'retry']}
        labels={LABELS}
        onRetry={() => undefined}
        onReviewSettings={onReviewSettings}
        hook="tool"
      />
    ));
    const review = container.querySelector<HTMLButtonElement>(
      '[data-fdt-recovery="tool:review-settings"]'
    );
    expect(review?.textContent).toBe('Review settings');
    expect(review?.className).toContain('bg-accent-strong');
    fireEvent.click(review as HTMLButtonElement);
    expect(onReviewSettings).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no recovery is left', () => {
    const { container } = render(() => (
      <RecoveryButtons
        recoveries={['reload-page']}
        labels={LABELS}
        onRetry={() => undefined}
        hook="tool"
      />
    ));
    expect(container.innerHTML).toBe('');
  });
});
