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
    expect(status.closest('li')?.getAttribute('data-fdt-tone')).toBe('success');
    expect(status.textContent).toContain('Report copied');
    const alert = screen.getByRole('alert');
    expect(alert.closest('li')?.getAttribute('data-fdt-tone')).toBe('error');
    expect(within(alert).getByText('Retry the copy')).toBeTruthy();
  });

  it('keeps every tone in a native list item with only its message announced', () => {
    render(() => <Toasts />);
    toast.success('Copied');
    toast.info('Context', { description: 'Details' });
    toast.error('Failed', { description: 'Retry' });
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect([...list.children]).toEqual(items);
    for (const [index, item] of items.entries()) {
      expect(item.tagName).toBe('LI');
      expect(item.hasAttribute('role')).toBe(false);
      const message = within(item).getByRole(index === 2 ? 'alert' : 'status');
      expect(message.tagName).toBe('DIV');
      expect(message.getAttribute('aria-atomic')).toBe('true');
      expect(message.textContent).toBe(['Copied', 'ContextDetails', 'FailedRetry'][index]);
      expect(within(message).queryByRole('button')).toBeNull();
      expect(within(item).getByRole('button').getAttribute('aria-label')).toMatch(/^Dismiss — /);
    }
  });

  it('ranks the region above the dialog plate (the notifications layer intent)', () => {
    // The layer rank is structural (scrim 40 < plate/tooltips 50 < toasts 60):
    // pinned at the class literal so a rank change is a deliberate edit.
    render(() => <Toasts />);
    expect(screen.getByRole('region', { name: 'Notifications' }).className).toContain('z-[60]');
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
      const item = screen.getByRole('listitem');
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
      const item = screen.getByRole('listitem');
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

  it.each(['pointer', 'focus'] as const)(
    'keeps overlapping interactions paused when %s leaves first',
    (leavingFirst) => {
      vi.useFakeTimers();
      try {
        render(() => <Toasts />);
        toast.info('Notice', { duration: 1000 });
        vi.advanceTimersByTime(300);
        const item = screen.getByRole('listitem');
        const dismiss = screen.getByRole('button');
        if (leavingFirst === 'pointer') {
          fireEvent.pointerEnter(item);
          fireEvent.focusIn(dismiss);
          fireEvent.pointerLeave(item);
        } else {
          fireEvent.focusIn(dismiss);
          fireEvent.pointerEnter(item);
          fireEvent.focusOut(dismiss);
        }
        vi.advanceTimersByTime(3000);
        expect(screen.getByRole('status')).toBeTruthy();
        expect(vi.getTimerCount()).toBe(0);

        if (leavingFirst === 'pointer') fireEvent.focusOut(dismiss);
        else fireEvent.pointerLeave(item);
        vi.advanceTimersByTime(600);
        expect(screen.getByRole('status')).toBeTruthy();
        vi.advanceTimersByTime(100);
        expect(screen.queryByRole('status')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('keeps focus paused across descendants until focus leaves the whole toast', () => {
    vi.useFakeTimers();
    try {
      render(() => <Toasts />);
      toast.info('Notice', { duration: 1000 });
      const item = screen.getByRole('listitem');
      const dismiss = screen.getByRole('button');
      fireEvent.focusIn(item);
      fireEvent.focusOut(item, { relatedTarget: dismiss });
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(3000);
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.focusIn(dismiss);
      fireEvent.focusOut(dismiss, { relatedTarget: document.body });
      vi.advanceTimersByTime(1000);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up paused and running cards without leaking their state into new toasts', () => {
    vi.useFakeTimers();
    try {
      const view = render(() => <Toasts />);
      toast.info('Paused', { duration: 1000 });
      fireEvent.pointerEnter(screen.getByRole('listitem'));
      fireEvent.focusIn(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('button'));
      expect(vi.getTimerCount()).toBe(0);
      toast.info('Fresh', { duration: 1000 });
      vi.advanceTimersByTime(1000);
      expect(screen.queryByRole('status')).toBeNull();
      toast.info('Running', { duration: 1000 });
      expect(vi.getTimerCount()).toBe(1);
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
      toast.clear();
      render(() => <Toasts />);
      toast.info('Remounted', { duration: 1000 });
      vi.advanceTimersByTime(1000);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
