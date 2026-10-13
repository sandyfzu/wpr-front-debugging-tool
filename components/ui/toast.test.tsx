/**
 * Render tests for the toast flow — the queue semantics (cap, dismiss, clear)
 * plus the region behaviors that carry them: `status`/`alert` roles per tone,
 * the auto-dismiss countdown, hover/focus pausing, and the close control.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from './toast';
import { toast, toastItems } from './toast-store';

beforeEach(() => {
  toast.clear();
});

afterEach(() => {
  cleanup();
});

describe('toast store (queue)', () => {
  it('enqueues with the tone, title, description and default duration', () => {
    toast.success('Report copied');
    toast.error('Clipboard unavailable', { description: 'Retry from the toolbar' });
    toast.info('Heads up');
    const items = toastItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ tone: 'success', title: 'Report copied', duration: 4000 });
    expect(items[1]).toMatchObject({
      tone: 'error',
      title: 'Clipboard unavailable',
      duration: 8000
    });
    // The quiet tone's default is pinned too: confirmations outlive nothing,
    // errors dwell longest, context sits in between.
    expect(items[2]).toMatchObject({ tone: 'info', title: 'Heads up', duration: 4000 });
    expect(items[1]?.description).toBe('Retry from the toolbar');
  });

  it('caps the queue and drops the oldest when overflowing', () => {
    for (let index = 1; index <= 8; index++) {
      toast.info('Toast ' + String(index));
    }
    const items = toastItems();
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.title)).toEqual([
      'Toast 3',
      'Toast 4',
      'Toast 5',
      'Toast 6',
      'Toast 7',
      'Toast 8'
    ]);
  });

  it('dismiss removes exactly the addressed toast', () => {
    const first = toast.info('First');
    toast.info('Second');
    toast.dismiss(first);
    const items = toastItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Second');
  });

  it('clear empties the queue', () => {
    toast.info('One');
    toast.info('Two');
    toast.clear();
    expect(toastItems()).toHaveLength(0);
  });

  it('honors an explicit duration', () => {
    toast.info('Sticky', { duration: 10_000 });
    expect(toastItems()[0]?.duration).toBe(10_000);
  });
});

describe('toast region', () => {
  it('renders queued toasts with the tone role, icon and description', () => {
    render(() => <Toasts />);
    toast.success('Report copied');
    toast.error('Clipboard unavailable', { description: 'Retry the copy' });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-fdt-tone')).toBe('success');
    expect(status.textContent).toContain('Report copied');
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-fdt-tone')).toBe('error');
    expect(within(alert).getByText('Retry the copy')).toBeTruthy();
  });

  it('auto-dismisses after the tone duration (fake timers)', () => {
    vi.useFakeTimers();
    try {
      render(() => <Toasts />);
      toast.success('Report copied', { duration: 2100 });
      expect(screen.getByRole('status').textContent).toContain('Report copied');
      vi.advanceTimersByTime(2000);
      expect(screen.getByRole('status')).toBeTruthy();
      vi.advanceTimersByTime(200);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the countdown while hovered and resumes on leave', () => {
    vi.useFakeTimers();
    try {
      render(() => <Toasts />);
      toast.info('Notice', { duration: 1000 });
      const item = screen.getByRole('status');
      fireEvent.pointerEnter(item);
      vi.advanceTimersByTime(3000);
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.pointerLeave(item);
      vi.advanceTimersByTime(1000);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the countdown while focused (screen-reader reading), resumes on blur', () => {
    vi.useFakeTimers();
    try {
      render(() => <Toasts />);
      toast.info('Notice', { duration: 1000 });
      const item = screen.getByRole('status');
      fireEvent.focusIn(item);
      vi.advanceTimersByTime(3000);
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.focusOut(item);
      vi.advanceTimersByTime(1000);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes on the close control click', () => {
    render(() => <Toasts />);
    toast.info('Notice');
    expect(screen.getByRole('status')).toBeTruthy();
    // The accessible name names WHICH toast it dismisses (a stacked queue of
    // identical "Dismiss notification" names would be indistinguishable).
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss — Notice' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
