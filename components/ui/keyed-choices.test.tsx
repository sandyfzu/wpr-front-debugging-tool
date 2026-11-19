/** createKeyedChoices: option identity per value across recomputations, and the group it feeds. */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoiceGroup, type ChoiceOption } from './choice-group';
import { createKeyedChoices } from './keyed-choices';

type Value = 'a' | 'b' | 'c';

/** Fresh option objects on every call, like a derivation over counts. */
function optionsFor(count: number, values: readonly Value[] = ['a', 'b']): ChoiceOption<Value>[] {
  return values.map((value) => ({ value, label: value.toUpperCase(), count }));
}

afterEach(cleanup);

describe('createKeyedChoices', () => {
  it('keeps each option object per value and patches changed fields', () => {
    createRoot((dispose) => {
      const [count, setCount] = createSignal(1);
      const options = createKeyedChoices(() => optionsFor(count()));
      const [first, second] = options;
      expect(first?.count).toBe(1);
      setCount(5);
      expect(options[0]).toBe(first);
      expect(options[1]).toBe(second);
      expect(options[0]?.count).toBe(5);
      dispose();
    });
  });

  it('follows added, removed and reordered values', () => {
    createRoot((dispose) => {
      const [values, setValues] = createSignal<readonly Value[]>(['a', 'b']);
      const options = createKeyedChoices(() => optionsFor(1, values()));
      const a = options[0];
      setValues(['c', 'a']);
      expect(options.map((option) => option.value)).toEqual(['c', 'a']);
      expect(options[1]).toBe(a);
      setValues([]);
      expect(options).toHaveLength(0);
      dispose();
    });
  });

  it('copies the source (a frozen or shared array is never adopted as the store)', () => {
    createRoot((dispose) => {
      const source = Object.freeze(optionsFor(1));
      const options = createKeyedChoices(() => source);
      expect(options).not.toBe(source);
      expect(options.map((option) => option.value)).toEqual(['a', 'b']);
      dispose();
    });
  });

  it('feeds a ChoiceGroup whose radios and focus survive a count change and a pick', () => {
    const [count, setCount] = createSignal(1);
    const [value, setValue] = createSignal<Value>('a');
    const onChange = vi.fn((next: Value) => setValue(next));
    render(() => {
      const options = createKeyedChoices(() => optionsFor(count()));
      return (
        <ChoiceGroup aria-label="Pick" options={options} value={value()} onChange={onChange} />
      );
    });
    const input = (v: Value): HTMLInputElement =>
      document.querySelector(`[data-fdt-choice-value="${v}"] input`) as HTMLInputElement;
    const b = input('b');
    b.focus();
    fireEvent.click(b);
    setCount(7);
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(input('b').checked).toBe(true);
    expect(input('b')).toBe(b);
    expect(document.activeElement).toBe(b);
    expect(
      document.querySelector('[data-fdt-choice-value="b"] [data-fdt-choice-count]')?.textContent
    ).toBe('7');
  });
});
