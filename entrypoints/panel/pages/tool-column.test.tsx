/** The Test tab column: a Tab stop exactly while it scrolls, painted in the canvas color, named. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OverflowWatcher } from '../../../components/ui/overflow-watch';
import { PAGE_CANVAS } from './page-frame';
import { ToolColumn } from './tool-column';

afterEach(() => {
  cleanup();
});

/** A watcher the test drives, recording what it watches and when it stops. */
function manualWatcher() {
  let report: (state: boolean) => void = () => undefined;
  const stop = vi.fn();
  const watched: [HTMLElement, HTMLElement][] = [];
  const watch: OverflowWatcher = (box, content, onChange) => {
    watched.push([box, content]);
    report = onChange;
    return stop;
  };
  return {
    watch,
    watched,
    stop,
    set: (state: boolean) => {
      report(state);
    }
  };
}

/** The rendered column. */
function column(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-fdt="col"]');
  if (element === null) throw new Error('no column');
  return element;
}

describe('ToolColumn', () => {
  it('watches itself against its content and takes a Tab stop only while it scrolls', () => {
    const watcher = manualWatcher();
    render(() => (
      <ToolColumn
        hook="col"
        area="@wide:[grid-area:x]"
        label="Things"
        watchOverflow={watcher.watch}
      >
        <p>child</p>
      </ToolColumn>
    ));
    expect(watcher.watched).toHaveLength(1);
    expect(watcher.watched[0]?.[0]).toBe(column());
    expect(watcher.watched[0]?.[1]).toBe(column().firstElementChild);
    expect(column().hasAttribute('tabindex')).toBe(false);
    watcher.set(true);
    expect(column().getAttribute('tabindex')).toBe('0');
    expect(column().hasAttribute('data-fdt-scrollable')).toBe(true);
    watcher.set(false);
    expect(column().hasAttribute('tabindex')).toBe(false);
    expect(column().hasAttribute('data-fdt-scrollable')).toBe(false);
  });

  it('stops watching on unmount', () => {
    const watcher = manualWatcher();
    render(() => (
      <ToolColumn hook="col" area="" label="Things" watchOverflow={watcher.watch}>
        <p>child</p>
      </ToolColumn>
    ));
    cleanup();
    expect(watcher.stop).toHaveBeenCalledTimes(1);
  });

  it('is named, opaque in the canvas color, scrolls from @wide only, and holds its area', () => {
    render(() => (
      <ToolColumn
        hook="col"
        area="@wide:[grid-area:x]"
        labelledBy="heading"
        watchOverflow={manualWatcher().watch}
      >
        <h2 id="heading">Heading</h2>
      </ToolColumn>
    ));
    expect(column().tagName).toBe('SECTION');
    expect(column().getAttribute('aria-labelledby')).toBe('heading');
    expect(column().hasAttribute('aria-label')).toBe(false);
    expect(column().className).toContain(PAGE_CANVAS);
    expect(column().className).toContain('@wide:overflow-y-auto');
    expect(column().className).not.toMatch(/(^|\s)overflow-y-auto/);
    expect(column().className).toContain('@wide:[grid-area:x]');
    expect(column().className).toContain('focus-visible:outline-2');
    expect(column().textContent).toBe('Heading');
  });
});
