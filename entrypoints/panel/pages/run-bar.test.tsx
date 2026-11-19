/** The shared run bar: Run with its held and busy states, the note beside it, the page's hooks. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import Info from 'lucide-solid/icons/info';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUN_LABELS, RunBar } from './run-bar';

afterEach(() => {
  cleanup();
});

/** Render a bar on signals the test drives. */
function renderBar() {
  const [running, setRunning] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const onRun = vi.fn();
  render(() => (
    <RunBar
      page="tool"
      running={running()}
      held={held()}
      onRun={onRun}
      note="What a run does."
      noteIcon={Info}
    />
  ));
  const button = () => {
    const element = document.querySelector<HTMLButtonElement>('[data-fdt-tool-run]');
    if (element === null) throw new Error('no Run');
    return element;
  };
  return { setRunning, setHeld, onRun, button };
}

describe('RunBar', () => {
  it('carries the page’s hooks: the bar, the button and the note beside it', () => {
    const { button } = renderBar();
    const bar = document.querySelector('[data-fdt="tool-run"]');
    expect(bar?.contains(button())).toBe(true);
    const note = bar?.querySelector('[data-fdt-tool-disclosure]');
    expect(note?.textContent).toBe('What a run does.');
    // Beside the button, wrapping under it when narrow.
    expect(note?.previousElementSibling).toBe(button());
    expect(bar?.className).toContain('flex-wrap');
    expect(note?.className).toContain('basis-60');
    expect(note?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('runs on click, with the idle words and the play icon', () => {
    const { button, onRun } = renderBar();
    expect(button().textContent).toBe(RUN_LABELS.idle);
    expect(button().querySelector('svg')).not.toBeNull();
    fireEvent.click(button());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('is held while the settings are not ready', () => {
    const { button, onRun, setHeld } = renderBar();
    setHeld(true);
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(onRun).not.toHaveBeenCalled();
  });

  it('shows the busy state while running, keeping focus and swallowing clicks', () => {
    const { button, onRun, setRunning } = renderBar();
    button().focus();
    setRunning(true);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(false);
    expect(document.activeElement).toBe(button());
    expect(screen.getByText(RUN_LABELS.running)).toBeTruthy();
    fireEvent.click(button());
    expect(onRun).not.toHaveBeenCalled();
    setRunning(false);
    expect(button().textContent).toBe(RUN_LABELS.idle);
  });
});
