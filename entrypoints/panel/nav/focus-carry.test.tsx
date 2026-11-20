/**
 * The focus carry: a focused control keeps focus when a form switch swaps
 * its element; an unfocused one never takes it; a control that leaves
 * altogether hands nothing on; focus that moved elsewhere is never stolen.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { Show, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createFocusCarry } from './focus-carry';

afterEach(() => {
  cleanup();
});

/** One control rendered in two forms (A / B), optionally removed. */
function renderControl() {
  const [formA, setFormA] = createSignal(true);
  const [present, setPresent] = createSignal(true);
  render(() => (
    <>
      <button type="button" data-testid="other">
        other
      </button>
      <Show when={present()}>
        {(() => {
          const ref = createFocusCarry();
          return (
            <Show
              when={formA()}
              fallback={
                <a ref={ref} href="#/b" data-testid="b">
                  B
                </a>
              }
            >
              <button ref={ref} type="button" data-testid="a">
                A
              </button>
            </Show>
          );
        })()}
      </Show>
    </>
  ));
  const byId = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { setFormA, setPresent, byId };
}

describe('createFocusCarry', () => {
  it('keeps focus on the control across swaps both ways', () => {
    const { setFormA, byId } = renderControl();
    byId('a')?.focus();
    setFormA(false);
    expect(document.activeElement).toBe(byId('b'));
    setFormA(true);
    expect(document.activeElement).toBe(byId('a'));
  });

  it('never focuses a successor whose predecessor was not focused', () => {
    const { setFormA, byId } = renderControl();
    setFormA(false);
    expect(document.activeElement).toBe(document.body);
    byId('other')?.focus();
    setFormA(true);
    expect(document.activeElement).toBe(byId('other'));
  });

  it('hands nothing on once focus has left (no stale hand-off on a later swap)', () => {
    const { setFormA, byId } = renderControl();
    byId('a')?.focus();
    setFormA(false);
    byId('other')?.focus();
    (document.activeElement as HTMLElement).blur();
    setFormA(true);
    expect(document.activeElement).toBe(document.body);
  });

  it('dies with its control: a removed then re-added control takes no focus', () => {
    const { setPresent, byId } = renderControl();
    byId('a')?.focus();
    setPresent(false);
    expect(document.activeElement).toBe(document.body);
    setPresent(true);
    expect(byId('a')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
