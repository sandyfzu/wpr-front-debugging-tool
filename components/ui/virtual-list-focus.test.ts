/** DOM focus restoration is guarded against removals, deliberate changes and disposal. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preserveMovedFocus } from './virtual-list-focus';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Build a list with a focused row control and an unrelated control. */
function fixture(): {
  container: HTMLDivElement;
  button: HTMLButtonElement;
  outside: HTMLButtonElement;
} {
  const container = document.createElement('div');
  const button = document.createElement('button');
  const outside = document.createElement('button');
  container.append(button);
  document.body.append(container, outside);
  button.focus();
  return { container, button, outside };
}

describe('preserveMovedFocus', () => {
  it('restores a moved control without scrolling', async () => {
    const { container, button } = fixture();
    const focus = vi.spyOn(button, 'focus');
    preserveMovedFocus(container);
    button.blur();
    button.remove();
    container.append(button);
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
  it.each([
    'removed',
    'outside',
    'cancelled',
    'unchanged',
    'moved-outside',
    'outside-then-blur'
  ] as const)('does not steal focus when %s', async (state) => {
    const { container, button, outside } = fixture();
    const focus = vi.spyOn(button, 'focus');
    const cancel = preserveMovedFocus(container);
    if (state !== 'unchanged') button.blur();
    if (state === 'removed') button.remove();
    if (state === 'outside') outside.focus();
    if (state === 'outside-then-blur') {
      outside.focus();
      outside.blur();
    }
    if (state === 'cancelled') cancel();
    if (state === 'moved-outside') document.body.append(button);
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });
  it('ignores a control outside the list', async () => {
    const { container, button, outside } = fixture();
    outside.focus();
    preserveMovedFocus(container);
    outside.blur();
    await Promise.resolve();
    expect(document.activeElement).not.toBe(button);
  });

  it('does not reclaim a deliberate blur when no control moved', async () => {
    const { container, button } = fixture();
    const focus = vi.spyOn(button, 'focus');
    preserveMovedFocus(container);
    button.blur();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not confuse unrelated DOM changes with moving the focused control', async () => {
    const { container, button } = fixture();
    const sibling = document.createElement('span');
    container.append(sibling);
    preserveMovedFocus(container);
    sibling.remove();
    container.prepend(sibling);
    button.blur();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it('recognizes a moved ancestor and releases its observer after settling', async () => {
    const { container, button } = fixture();
    const wrapper = document.createElement('div');
    wrapper.append(button);
    container.append(wrapper);
    button.focus();
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    preserveMovedFocus(container);
    button.blur(); // Emulate the native focus loss that happy-dom does not reproduce reliably.
    wrapper.remove();
    container.append(wrapper);
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
    expect(disconnect).toHaveBeenCalled();
  });

  it('cancellation disconnects observation and prevents restoration after a real move', async () => {
    const { container, button } = fixture();
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const cancel = preserveMovedFocus(container);
    button.blur();
    button.remove();
    container.append(button);
    cancel();
    expect(disconnect).toHaveBeenCalled();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it('respects a deliberate focus transfer even when a control stops bubbling focus events', async () => {
    const { container, button, outside } = fixture();
    outside.addEventListener('focusin', (event) => {
      event.stopPropagation();
    });
    preserveMovedFocus(container);
    button.blur();
    button.remove();
    container.append(button);
    outside.focus();
    outside.blur();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it('restores a moved control inside a shadow root (focus read from the root, not the document)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    const button = document.createElement('button');
    container.append(button);
    root.append(container);
    button.focus();
    expect(root.activeElement).toBe(button);
    preserveMovedFocus(container);
    button.blur();
    button.remove();
    container.append(button);
    await Promise.resolve();
    expect(root.activeElement).toBe(button);
  });
});
