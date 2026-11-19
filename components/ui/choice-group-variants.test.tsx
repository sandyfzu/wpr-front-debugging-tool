/**
 * The choice group's looks: the default `tiles` look pinned byte-for-byte
 * (injected UIs rely on it), the opt-in `segmented` tray, the leading
 * caption, per-option counts and icons, and the unavailable states — on the one radio
 * anatomy both looks share (so the native radio keyboard contract holds for
 * either).
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LayoutList from 'lucide-solid/icons/layout-list';
import List from 'lucide-solid/icons/list';
import { ChoiceGroup, type ChoiceGroupVariant, type ChoiceOption } from './choice-group';
import { describeAxeViolations, runAxeAudit } from './a11y-audit';
import {
  SEGMENT_COUNT,
  SEGMENT_RAISED,
  SEGMENT_STRETCH,
  SEGMENTED_CAPTION,
  SEGMENTED_TRAY,
  SEGMENTED_TRAY_STRETCH
} from './segmented';

afterEach(() => {
  cleanup();
});

type Delay = 'any' | 'delayed' | 'non-delayed';

/** The facet's "Any" option. */
const ANY: ChoiceOption<Delay> = { value: 'any', label: 'Any', count: 14 };
/** A zero-count value. */
const DELAYED: ChoiceOption<Delay> = { value: 'delayed', label: 'Delayed', count: 0 };
/** A value whose count needs grouping. */
const NON_DELAYED: ChoiceOption<Delay> = {
  value: 'non-delayed',
  label: 'Non-delayed',
  count: 1204
};
/** A facet-shaped option set: an "Any" plus two values, one with a zero count. */
const DELAY: readonly ChoiceOption<Delay>[] = [ANY, DELAYED, NON_DELAYED];
/** The same set with the zero-count value disabled. */
const DELAY_WITH_DISABLED: readonly ChoiceOption<Delay>[] = [
  ANY,
  { ...DELAYED, disabled: true },
  NON_DELAYED
];

/** The rendered group element. */
function group(): HTMLElement {
  return screen.getByRole('radiogroup');
}

/** The item wrapper of one option. */
function item(value: string): HTMLElement {
  const found = group().querySelector<HTMLElement>(`[data-fdt-choice-value="${value}"]`);
  if (found === null) throw new Error(`no choice "${value}"`);
  return found;
}

/** The visible tile (the radio's `<label for>`) of one option. */
function tile(value: string): HTMLElement {
  const found = item(value).querySelector<HTMLElement>('label');
  if (found === null) throw new Error(`no tile for "${value}"`);
  return found;
}

/** The hidden native radio of one option. */
function radio(value: string): HTMLInputElement {
  const found = item(value).querySelector<HTMLInputElement>('input[type="radio"]');
  if (found === null) throw new Error(`no radio for "${value}"`);
  return found;
}

/** Every class token used anywhere inside the group (the group included). */
function allClasses(): string[] {
  return [group(), ...group().querySelectorAll('*')].flatMap((element) =>
    [...element.classList].map(String)
  );
}

describe('ChoiceGroup default look (tiles)', () => {
  // The exact class strings the group rendered before looks existed: the
  // exclusion overlay and every non-opted surface depend on them unchanged.
  const TILES_GROUP = 'flex flex-wrap items-center gap-1 data-held:opacity-50';
  const TILES_ITEM =
    'inline-flex rounded has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent data-disabled:opacity-50 data-disabled:cursor-not-allowed';
  const TILES_CHECKED =
    'flex h-7 select-none items-center justify-center whitespace-nowrap rounded border px-2 text-xs font-medium border-transparent bg-accent-strong text-on-accent cursor-pointer data-disabled:opacity-50 data-disabled:cursor-not-allowed';
  const TILES_IDLE =
    'flex h-7 select-none items-center justify-center whitespace-nowrap rounded border px-2 text-xs font-medium border-line-2 bg-surface-2 text-fg-primary cursor-pointer hover:border-line-3 hover:bg-surface-3 data-disabled:opacity-50 data-disabled:cursor-not-allowed';

  it.each<ChoiceGroupVariant | undefined>([undefined, 'tiles'])(
    'renders the pinned class strings and DOM (variant=%s)',
    (variant) => {
      render(() => (
        <ChoiceGroup
          variant={variant}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' }
          ]}
          value="a"
          onChange={() => {}}
          aria-label="Pick"
          class="extra"
        />
      ));
      expect(group().className).toBe(`${TILES_GROUP} extra`);
      expect(item('a').className).toBe(TILES_ITEM);
      expect(tile('a').className).toBe(TILES_CHECKED);
      expect(tile('b').className).toBe(TILES_IDLE);
      // No caption, no count: the tile holds its label text only.
      expect(group().querySelector('[data-fdt="choice-group-label"]')).toBeNull();
      expect(tile('b').innerHTML).toBe('B');
    }
  );

  // The tile's fixed geometry and its trailing data-disabled pair, shared by
  // every state row below (the state classes sit between them).
  const TILE_BASE =
    'flex h-7 select-none items-center justify-center whitespace-nowrap rounded border px-2 text-xs font-medium';
  const TILE_DISABLED = 'data-disabled:opacity-50 data-disabled:cursor-not-allowed';
  const CHECKED_FILL = 'border-transparent bg-accent-strong text-on-accent';
  const IDLE_FILL = 'border-line-2 bg-surface-2 text-fg-primary';

  it.each([
    {
      state: 'held',
      props: { held: 'Busy' },
      checked: `${TILE_BASE} ${CHECKED_FILL} cursor-not-allowed ${TILE_DISABLED}`,
      idle: `${TILE_BASE} ${IDLE_FILL} cursor-not-allowed ${TILE_DISABLED}`,
      offered: `${TILE_BASE} ${IDLE_FILL} cursor-not-allowed ${TILE_DISABLED}`
    },
    {
      state: 'group-disabled',
      props: { disabled: true },
      checked: `${TILE_BASE} ${CHECKED_FILL} cursor-pointer ${TILE_DISABLED}`,
      idle: `${TILE_BASE} ${IDLE_FILL} cursor-pointer ${TILE_DISABLED}`,
      offered: `${TILE_BASE} ${IDLE_FILL} cursor-pointer ${TILE_DISABLED}`
    },
    {
      state: 'option-disabled',
      props: {},
      checked: `${TILE_BASE} ${CHECKED_FILL} cursor-pointer ${TILE_DISABLED}`,
      idle: `${TILE_BASE} ${IDLE_FILL} cursor-pointer ${TILE_DISABLED}`,
      offered: `${TILE_BASE} ${IDLE_FILL} cursor-pointer hover:border-line-3 hover:bg-surface-3 ${TILE_DISABLED}`
    }
  ])(
    'pins the $state tile class strings byte-for-byte (the exclusion overlay holds its group)',
    ({ props: extra, checked, idle, offered }) => {
      // `b` is disabled on its own; `c` is a plain, offered option.
      render(() => (
        <ChoiceGroup
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B', disabled: true },
            { value: 'c', label: 'C' }
          ]}
          value="a"
          onChange={() => {}}
          aria-label="Pick"
          {...extra}
        />
      ));
      expect(group().className).toBe(TILES_GROUP);
      expect(item('b').className).toBe(TILES_ITEM);
      expect(tile('a').className).toBe(checked);
      expect(tile('b').className).toBe(idle);
      expect(tile('c').className).toBe(offered);
    }
  );

  it('renders a count on tiles too, in the checked fill’s own text pair', () => {
    render(() => (
      <ChoiceGroup options={DELAY} value="any" onChange={() => {}} aria-label="Delay" />
    ));
    const count = (value: string): string =>
      item(value).querySelector('[data-fdt-choice-count]')?.className ?? '';
    expect(count('any')).toBe('ms-1.5 text-2xs tabular-nums text-on-accent');
    expect(count('delayed')).toBe('ms-1.5 text-2xs tabular-nums text-fg-muted');
  });

  it('names the group by a caption on tiles too, leading the tiles', () => {
    render(() => <ChoiceGroup options={DELAY} value="any" onChange={() => {}} label="Delay" />);
    const named = screen.getByRole('radiogroup', { name: 'Delay' });
    const caption = named.querySelector('[data-fdt="choice-group-label"]');
    expect(named.firstElementChild).toBe(caption);
    expect(caption?.className).toBe('text-xs font-medium text-fg-muted');
  });
});

describe('ChoiceGroup segmented variant', () => {
  it('draws the tray, raises exactly the checked segment, and never dims through opacity', () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value="delayed"
        onChange={() => {}}
        label="Delay"
      />
    ));
    expect(group().className).toBe(SEGMENTED_TRAY);
    expect(tile('delayed').className).toContain(SEGMENT_RAISED);
    expect(tile('delayed').className).toContain('text-fg-primary');
    for (const idle of ['any', 'non-delayed']) {
      expect(tile(idle).className).not.toContain('shadow-elev-1');
      expect(tile(idle).className).toContain('text-fg-secondary');
      expect(tile(idle).className).toContain('hover:text-fg-primary');
    }
    expect(allClasses().filter((token) => /opacity|accent-strong/u.test(token))).toEqual([]);
    // The keyboard ring rides every item wrapper, as in the default look.
    expect(item('any').className).toContain('has-[input:focus-visible]:outline-2');
  });

  it('names the group by its visible caption (no aria-label needed)', () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value="any"
        onChange={() => {}}
        label="Delay"
      />
    ));
    const named = screen.getByRole('radiogroup', { name: 'Delay' });
    const caption = named.querySelector('[data-fdt="choice-group-label"]');
    expect(caption?.textContent).toBe('Delay');
    expect(caption?.className).toBe(SEGMENTED_CAPTION);
    // The caption leads the options.
    expect(named.firstElementChild).toBe(caption);
    expect(named.getAttribute('aria-labelledby')).toBe(caption?.id);
  });

  it('shows each count muted with aligned digits, inside the radio’s name', () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value="any"
        onChange={() => {}}
        label="Delay"
      />
    ));
    const counts = [...group().querySelectorAll('[data-fdt-choice-count]')];
    expect(counts.map((count) => count.textContent)).toEqual(['14', '0', '1,204']);
    for (const count of counts) expect(count.className).toBe(SEGMENT_COUNT);
    expect(screen.getByRole('radio', { name: 'Non-delayed 1,204' })).toBe(radio('non-delayed'));
  });

  it('keeps a zero-count option selectable (only `disabled` refuses)', () => {
    const onChange = vi.fn<(value: Delay) => void>();
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value="any"
        onChange={onChange}
        label="Delay"
      />
    ));
    expect(radio('delayed').disabled).toBe(false);
    fireEvent.click(tile('delayed'));
    expect(onChange).toHaveBeenCalledWith('delayed');
  });

  it('skips a disabled option: native-disabled radio, muted readable text, no hover, no pick', () => {
    const onChange = vi.fn<(value: Delay) => void>();
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY_WITH_DISABLED}
        value="any"
        onChange={onChange}
        label="Delay"
      />
    ));
    // Native disabled: arrow keys skip it (platform radio roving).
    expect(radio('delayed').disabled).toBe(true);
    expect(radio('non-delayed').disabled).toBe(false);
    const label = tile('delayed').className;
    expect(label).toContain('text-fg-muted');
    expect(label).toContain('cursor-not-allowed');
    expect(label).not.toMatch(/hover:|opacity/u);
    fireEvent.click(tile('delayed'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(tile('non-delayed'));
    expect(onChange).toHaveBeenCalledWith('non-delayed');
  });

  it.each([
    { state: 'disabled', props: { disabled: true } },
    { state: 'held', props: { held: 'Busy' } }
  ])('mutes every segment while the group is $state (no opacity)', ({ props: extra }) => {
    const onChange = vi.fn();
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value="any"
        onChange={onChange}
        label="Delay"
        {...extra}
      />
    ));
    for (const option of DELAY) {
      expect(tile(option.value).className).toContain('text-fg-muted');
      expect(tile(option.value).className).not.toContain('hover:');
    }
    // The checked segment stays raised: the value is still shown.
    expect(tile('any').className).toContain(SEGMENT_RAISED);
    expect(allClasses().filter((token) => token.includes('opacity'))).toEqual([]);
    fireEvent.click(tile('non-delayed'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the radio anatomy behind the keyboard contract: one group name, label-linked radios, checked state', async () => {
    const [value, setValue] = createSignal<Delay>('any');
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY}
        value={value()}
        onChange={setValue}
        label="Delay"
      />
    ));
    const inputs = [...group().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(inputs).toHaveLength(3);
    // One shared, per-instance name: what lets native arrow keys rove the set.
    expect(new Set(inputs.map((input) => input.name)).size).toBe(1);
    expect(inputs[0]?.name).not.toBe('');
    for (const option of DELAY) {
      expect(tile(option.value).getAttribute('for')).toBe(radio(option.value).id);
    }
    // Selection is the radio's checked state (never `aria-pressed`).
    expect(group().querySelector('[aria-pressed]')).toBeNull();
    expect(radio('any').checked).toBe(true);
    // A keyboard (or pointer) pick lands on the native radio; the controlled
    // loop then checks it and raises its segment.
    fireEvent.click(radio('non-delayed'));
    await expect.poll(() => radio('non-delayed').checked, { timeout: 300 }).toBe(true);
    expect(tile('non-delayed').className).toContain(SEGMENT_RAISED);
    expect(tile('any').className).not.toContain(SEGMENT_RAISED);
  });

  it('throws naming the option when a count is not a non-negative integer', () => {
    expect(() =>
      render(() => (
        <ChoiceGroup
          variant="segmented"
          options={[{ value: 'any', label: 'Any', count: -1 }]}
          value="any"
          onChange={() => {}}
          label="Delay"
        />
      ))
    ).toThrow(/"any": count must be a non-negative integer/u);
  });

  it('stretches on request: full-width tray, every item and tile sharing the width', () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        stretch
        options={DELAY}
        value="delayed"
        onChange={() => {}}
        aria-label="Delay"
      />
    ));
    expect(group().className).toBe(SEGMENTED_TRAY_STRETCH);
    for (const value of ['any', 'delayed', 'non-delayed']) {
      expect(item(value).className.split(' ')).toContain(SEGMENT_STRETCH);
      expect(tile(value).className.split(' ')).toContain('w-full');
    }
    // The state look is the plain segmented one (stretch changes geometry only).
    expect(tile('delayed').className).toContain(SEGMENT_RAISED);
    expect(tile('any').className).toContain('text-fg-secondary');
  });

  it('keeps the hugging tray without stretch (stretch={false} = default)', () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        stretch={false}
        options={DELAY}
        value="any"
        onChange={() => {}}
        aria-label="Delay"
      />
    ));
    expect(group().className).toBe(SEGMENTED_TRAY);
    expect(item('any').className.split(' ')).not.toContain(SEGMENT_STRETCH);
    expect(tile('any').className.split(' ')).not.toContain('w-full');
  });

  it.each([undefined, 'tiles'] as const)(
    'throws when stretch is asked of the tiles look (%s)',
    (variant) => {
      expect(() =>
        render(() => (
          <ChoiceGroup
            variant={variant}
            stretch
            options={DELAY}
            value="any"
            onChange={() => {}}
            aria-label="Delay"
          />
        ))
      ).toThrow(/`stretch` needs the segmented variant/u);
    }
  );

  it('still throws when nothing names the group', () => {
    expect(() =>
      render(() => (
        <ChoiceGroup variant="segmented" options={DELAY} value="any" onChange={() => {}} />
      ))
    ).toThrow(/label, an aria-label or an aria-labelledby/u);
  });

  it.each(['', '   '])(
    'throws on a blank label (%j), which would leave the group nameless',
    (label) => {
      expect(() =>
        render(() => (
          <ChoiceGroup
            variant="segmented"
            options={DELAY}
            value="any"
            onChange={() => {}}
            label={label}
            aria-label="Delay"
          />
        ))
      ).toThrow(/the label must not be empty or whitespace only/u);
    }
  );

  it('raises zero a11y violations with caption and counts (axe, component tier)', async () => {
    render(() => (
      <ChoiceGroup
        variant="segmented"
        options={DELAY_WITH_DISABLED}
        value="any"
        onChange={() => {}}
        label="Delay"
      />
    ));
    const result = await runAxeAudit();
    expect(describeAxeViolations(result.violations)).toBe('');
  });
});

describe('ChoiceGroup option icon', () => {
  /** A layout-shaped set: two options with icons, one without. */
  const LAYOUTS: readonly ChoiceOption<'grouped' | 'list' | 'cards'>[] = [
    { value: 'grouped', label: 'Grouped', icon: LayoutList },
    { value: 'list', label: 'List', icon: List },
    { value: 'cards', label: 'Cards' }
  ];

  it.each<ChoiceGroupVariant>(['tiles', 'segmented'])(
    'leads the label with a decorative icon on the %s look, the name unchanged',
    (variant) => {
      render(() => (
        <ChoiceGroup
          variant={variant}
          options={LAYOUTS}
          value="grouped"
          onChange={() => {}}
          aria-label="Layout"
        />
      ));
      const icon = tile('grouped').querySelector('[data-fdt-choice-icon]');
      expect(icon?.tagName.toLowerCase()).toBe('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('class')).toContain('me-1 shrink-0');
      // First child of the tile, before the label text.
      expect(tile('grouped').firstElementChild).toBe(icon);
      expect(tile('grouped').textContent).toBe('Grouped');
      expect(screen.getByRole('radio', { name: 'Grouped' })).toBeTruthy();
    }
  );

  it('renders nothing extra without an icon (the icon-less DOM is unchanged)', () => {
    render(() => (
      <ChoiceGroup options={LAYOUTS} value="grouped" onChange={() => {}} aria-label="Layout" />
    ));
    expect(tile('cards').children).toHaveLength(0);
    expect(tile('cards').innerHTML).toBe('Cards');
  });
});
