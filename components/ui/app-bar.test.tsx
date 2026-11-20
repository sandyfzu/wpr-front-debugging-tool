/**
 * Render tests for the app bar frame: the `header` landmark with the
 * caller's hook and name, the 44 px raised band with its bottom hairline,
 * and the two slots (start shrinks and clips, end never shrinks).
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { AppBar } from './app-bar';

afterEach(() => {
  cleanup();
});

/** The rendered slot element of one side. */
function slot(side: 'start' | 'end'): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-fdt-app-bar-slot="${side}"]`);
  if (found === null) throw new Error(`no ${side} slot`);
  return found;
}

describe('AppBar', () => {
  it('renders a named header landmark with the caller hook and both slots', () => {
    render(() => (
      <AppBar
        data-fdt="test-bar"
        label="Page status"
        start={<span>Identity</span>}
        end={<button type="button">Act</button>}
      />
    ));
    const bar = screen.getByRole('banner', { name: 'Page status' });
    expect(bar.tagName).toBe('HEADER');
    expect(bar.getAttribute('data-fdt')).toBe('test-bar');
    expect(slot('start').textContent).toBe('Identity');
    expect(screen.getByRole('button', { name: 'Act' }).parentElement).toBe(slot('end'));
  });

  it('is the 44 px raised band with a bottom hairline, clipping its own overflow', () => {
    render(() => <AppBar data-fdt="test-bar" start={null} />);
    const bar = document.querySelector('[data-fdt="test-bar"]') as HTMLElement;
    for (const token of [
      'h-11',
      'shrink-0',
      'bg-surface-1',
      'border-b',
      'border-line-1',
      'overflow-hidden'
    ]) {
      expect(bar.classList).toContain(token);
    }
    expect(bar.getAttribute('aria-label')).toBeNull();
  });

  it('lets the start slot shrink and clip while the end slot keeps its width', () => {
    render(() => <AppBar data-fdt="test-bar" start={null} end={null} />);
    for (const token of ['min-w-0', 'flex-1', 'overflow-hidden', 'self-stretch']) {
      expect(slot('start').classList).toContain(token);
    }
    expect(slot('end').classList).toContain('shrink-0');
    expect(slot('end').childElementCount).toBe(0);
  });

  it('keeps ring room at both ends of the clipping start slot', () => {
    // 3 px = the shared focus ring's 2 px outline + 1 px offset: a flush
    // first or last start item keeps its whole ring inside the clip; the
    // frame's start padding gives those 3 px back (content starts 12 px in).
    render(() => <AppBar data-fdt="test-bar" start={null} />);
    expect(slot('start').classList).toContain('px-0.75');
    const bar = document.querySelector('[data-fdt="test-bar"]') as HTMLElement;
    expect(bar.classList).toContain('pl-2.25');
  });

  it('merges placement classes last', () => {
    render(() => <AppBar data-fdt="test-bar" class="sticky top-0 z-10" start={null} />);
    const bar = document.querySelector('[data-fdt="test-bar"]') as HTMLElement;
    expect(bar.classList).toContain('sticky');
    expect(bar.classList).toContain('z-10');
  });
});
