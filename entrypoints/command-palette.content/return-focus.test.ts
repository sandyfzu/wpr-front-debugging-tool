/**
 * The palette's return-focus target: a page control, never the body nor
 * the palette's own host, and the focused element inside another extension
 * surface's shadow root rather than its host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMMAND_PALETTE_HOST_NAME,
  OVERLAY_HOST_NAME
} from '../../components/injected-ui/key-guard';
import { returnFocusTarget } from './return-focus';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A shadow host with a focusable button inside.
 *
 * @param name The host's tag name.
 */
function surface(name: string): { host: HTMLElement; button: HTMLButtonElement } {
  const host = document.createElement(name);
  const button = document.createElement('button');
  host.attachShadow({ mode: 'open' }).append(button);
  document.body.append(host);
  return { host, button };
}

describe('returnFocusTarget', () => {
  it('returns the focused page control', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(returnFocusTarget(document)).toBe(input);
  });

  it('returns nothing when the body has focus', () => {
    expect(returnFocusTarget(document)).toBeNull();
  });

  it('never returns the palette’s own host (nor anything inside it)', () => {
    const { button } = surface(COMMAND_PALETTE_HOST_NAME);
    button.focus();
    expect(returnFocusTarget(document)).toBeNull();
  });

  it('returns the focused element inside another extension surface, not its host', () => {
    const { host, button } = surface(OVERLAY_HOST_NAME);
    button.focus();
    expect(document.activeElement).toBe(host);
    expect(returnFocusTarget(document)).toBe(button);
  });

  it('returns nothing for a focused surface host with nothing focused inside', () => {
    const { host } = surface('wpr-fdt-side-by-side');
    host.tabIndex = 0;
    host.focus();
    expect(returnFocusTarget(document)).toBeNull();
  });
});
