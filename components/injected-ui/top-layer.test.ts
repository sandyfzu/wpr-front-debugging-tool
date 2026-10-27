/**
 * The top-layer z-order helpers, over a fake popover API (the resource-less
 * DOM's popover support is not the subject): a show (re-)enters the top
 * layer — hiding first when already shown, which moves the element above
 * later ones — a refused show falls back to the fixed element (logged), a
 * hide leaves the top layer, and missing popover support is a no-op.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../../lib/logger';
import { hideFromTopLayer, showInTopLayer } from './top-layer';

/** A logger whose warnings are recorded (`warnings`). */
function logger(): Logger & { warnings: Mock<(message: string) => void> } {
  const warnings = vi.fn<(message: string) => void>();
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings(message);
    },
    error: () => undefined,
    warnings
  };
}

/** An element with a scripted popover API. */
function layer(options: { open?: boolean; refuse?: boolean } = {}) {
  const element = document.createElement('div');
  let open = options.open ?? false;
  const calls: string[] = [];
  Object.assign(element, {
    showPopover: () => {
      calls.push('show');
      if (options.refuse === true) throw new Error('InvalidStateError');
      open = true;
    },
    hidePopover: () => {
      calls.push('hide');
      open = false;
    }
  });
  const matches = element.matches.bind(element);
  element.matches = (selector: string) => (selector === ':popover-open' ? open : matches(selector));
  return { element, calls, isOpen: () => open };
}

describe('showInTopLayer', () => {
  it('shows a closed element as a manual popover', () => {
    const { element, calls, isOpen } = layer();
    showInTopLayer(element, logger());
    expect(element.getAttribute('popover')).toBe('manual');
    expect(calls).toEqual(['show']);
    expect(isOpen()).toBe(true);
  });

  it('re-enters the top layer when already shown (moving above later surfaces)', () => {
    const { element, calls } = layer({ open: true });
    showInTopLayer(element, logger());
    expect(calls).toEqual(['hide', 'show']);
  });

  it('falls back to the fixed element when the document refuses, logged', () => {
    const { element } = layer({ refuse: true });
    const log = logger();
    showInTopLayer(element, log);
    expect(element.hasAttribute('popover')).toBe(false);
    expect(log.warnings).toHaveBeenCalledTimes(1);
  });

  it('does nothing without popover support', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'showPopover', { value: undefined });
    showInTopLayer(element, logger());
    expect(element.hasAttribute('popover')).toBe(false);
  });
});

describe('hideFromTopLayer', () => {
  it('hides a shown popover and keeps its attribute', () => {
    const { element, calls, isOpen } = layer();
    showInTopLayer(element, logger());
    hideFromTopLayer(element, logger());
    expect(calls).toEqual(['show', 'hide']);
    expect(isOpen()).toBe(false);
    expect(element.getAttribute('popover')).toBe('manual');
  });

  it('leaves an element that never entered the top layer alone', () => {
    const { element, calls } = layer();
    hideFromTopLayer(element, logger());
    expect(calls).toEqual([]);
  });

  it('logs a refused hide', () => {
    const { element } = layer();
    showInTopLayer(element, logger());
    Object.assign(element, {
      hidePopover: () => {
        throw new Error('InvalidStateError');
      }
    });
    const log = logger();
    hideFromTopLayer(element, log);
    expect(log.warnings).toHaveBeenCalledTimes(1);
  });
});
