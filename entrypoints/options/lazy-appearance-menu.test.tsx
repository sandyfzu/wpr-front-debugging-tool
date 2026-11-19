/**
 * The lazily loaded appearance menu: the stand-in's face matches the menu
 * trigger's, the early fetch lands the menu (handing focus over when the
 * stand-in held it), a first press before the fetch opens the menu the way
 * the press asked unless the user moved on (focus left, Escape), a failed
 * fetch keeps the stand-in and retries on the next press, an unmounted
 * mount lands nothing, and an already loaded menu renders at once.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceMenu } from '../../components/appearance-menu';
import { fakeScheme } from '../../components/system-dark.fake';
import { FOCUS_RING, TOOLTIP_TRIGGER_FRAME } from '../../components/ui/classes';
import { MENU_ICON_TRIGGER_CLASSES } from '../../components/ui/menu-classes';
import { createChunkLoader, type ChunkLoader } from '../../utils/chunk-loader';
import type { Appearance } from '../../utils/theme';
import {
  LazyAppearanceMenu,
  pendingOpenFromKey,
  pressStillStands,
  replayOpen,
  type AppearanceMenuComponent
} from './lazy-appearance-menu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

/** A loader over the real menu (no early fetch of its own), with its load spy. */
function realLoader(): {
  loader: ChunkLoader<AppearanceMenuComponent>;
  load: ReturnType<typeof vi.fn<() => Promise<AppearanceMenuComponent>>>;
} {
  const load = vi.fn(() => Promise.resolve<AppearanceMenuComponent>(AppearanceMenu));
  return { loader: createChunkLoader(load, null), load };
}

/** A loader whose one fetch resolves only when the test says so. */
function deferredLoader(): {
  loader: ChunkLoader<AppearanceMenuComponent>;
  land: () => Promise<void>;
} {
  let resolve: ((menu: AppearanceMenuComponent) => void) | undefined;
  const load = (): Promise<AppearanceMenuComponent> =>
    new Promise((done) => {
      resolve = done;
    });
  return {
    loader: createChunkLoader(load, null),
    land: async () => {
      resolve?.(AppearanceMenu);
      await settle();
    }
  };
}

/** Press a key on an element (bubbling, cancelable, as a browser does). */
function pressKey(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** A focusable control elsewhere on the page (removed by the next test's cleanup). */
function otherControl(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Elsewhere';
  document.body.append(button);
  return button;
}

/**
 * Mount the lazy menu over a controlled value.
 *
 * @param loader The menu's loader.
 * @param prefetch The early-fetch scheduler (default: none).
 * @param initial The stored choice.
 */
function mount(
  loader: ChunkLoader<AppearanceMenuComponent>,
  prefetch: ((fetch: () => void) => void) | null = null,
  initial: Appearance = 'light'
): { onChange: ReturnType<typeof vi.fn>; setValue: (next: Appearance) => void } {
  const [value, setValue] = createSignal<Appearance>(initial);
  const onChange = vi.fn();
  render(() => (
    <LazyAppearanceMenu
      value={value()}
      onChange={onChange}
      systemScheme={fakeScheme(true)}
      loader={loader}
      prefetch={prefetch}
    />
  ));
  return { onChange, setValue };
}

/** The stand-in button, or null once the menu landed. */
function standIn(): HTMLElement | null {
  return document.querySelector('[data-fdt="appearance-menu-stand-in"]');
}

/** The real menu trigger, or null before it landed. */
function realTrigger(): HTMLElement | null {
  return document.querySelector('[data-fdt="appearance-menu"] [data-fdt="tooltip-trigger"]');
}

describe('pendingOpenFromKey', () => {
  it.each(['Enter', ' ', 'ArrowDown', 'ArrowUp'])('"%s" opens the menu', (key) => {
    expect(pendingOpenFromKey(key)).toEqual({ kind: 'key', key });
  });

  it.each(['Tab', 'Escape', 'a', 'ArrowLeft', ''])('"%s" opens nothing', (key) => {
    expect(pendingOpenFromKey(key)).toBeNull();
  });
});

describe('replayOpen', () => {
  it('replays a key as a bubbling, cancelable keydown', () => {
    const target = document.createElement('button');
    const seen = vi.fn((event: Event) => event);
    document.body.append(target);
    document.body.addEventListener('keydown', seen, { once: true });
    replayOpen(target, { kind: 'key', key: 'ArrowUp' });
    const event = seen.mock.results[0]?.value as KeyboardEvent;
    expect(event.key).toBe('ArrowUp');
    expect(event.cancelable).toBe(true);
    expect(event.target).toBe(target);
    target.remove();
  });

  it('replays a pointer press as a primary-button mouse pointerdown', () => {
    const target = document.createElement('button');
    const seen = vi.fn((event: Event) => event);
    target.addEventListener('pointerdown', seen);
    replayOpen(target, { kind: 'pointer' });
    const event = seen.mock.results[0]?.value as PointerEvent;
    expect(event.button).toBe(0);
    expect(event.pointerType).toBe('mouse');
    expect(event.bubbles).toBe(true);
  });
});

describe('pressStillStands', () => {
  const key = { kind: 'key', key: 'Enter' } as const;
  const pointer = { kind: 'pointer' } as const;

  it('keeps any press while the stand-in holds focus', () => {
    const standInButton = document.createElement('button');
    expect(pressStillStands(key, standInButton, standInButton)).toBe(true);
    expect(pressStillStands(pointer, standInButton, standInButton)).toBe(true);
  });

  it('keeps a pointer press, never a key press, while focus rests on the body', () => {
    const standInButton = document.createElement('button');
    expect(pressStillStands(pointer, standInButton, document.body)).toBe(true);
    expect(pressStillStands(pointer, standInButton, null)).toBe(true);
    expect(pressStillStands(key, standInButton, document.body)).toBe(false);
  });

  it('drops any press once another control holds focus', () => {
    const standInButton = document.createElement('button');
    const other = document.createElement('input');
    expect(pressStillStands(key, standInButton, other)).toBe(false);
    expect(pressStillStands(pointer, standInButton, other)).toBe(false);
    expect(pressStillStands(pointer, undefined, other)).toBe(false);
  });
});

describe('LazyAppearanceMenu', () => {
  it('renders the stand-in with the trigger face and frame, fetching nothing unpressed', async () => {
    const { loader, load } = realLoader();
    const { setValue } = mount(loader, null, 'system');
    const button = standIn();
    expect(button?.getAttribute('aria-label')).toBe('Appearance: System (Dark)');
    expect(button?.getAttribute('aria-haspopup')).toBe('menu');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.querySelector('svg')?.classList.contains('lucide-moon')).toBe(true);
    expect(button?.closest('[data-fdt="appearance-menu"]')?.getAttribute('data-fdt-resolved')).toBe(
      'dark'
    );
    setValue('light');
    expect(standIn()?.getAttribute('aria-label')).toBe('Appearance: Light');
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it('wears exactly the real trigger’s classes (the swap shows no change)', async () => {
    const { loader } = realLoader();
    let early: (() => void) | undefined;
    mount(loader, (fetch) => (early = fetch));
    const before = new Set(standIn()?.className.split(/\s+/u));
    // The frame and the menu's icon-trigger look, focus ring included.
    for (const token of [TOOLTIP_TRIGGER_FRAME, FOCUS_RING, MENU_ICON_TRIGGER_CLASSES]
      .join(' ')
      .split(' ')
      .filter((name) => name !== 'rounded'))
      expect(before.has(token), token).toBe(true);
    early?.();
    await waitFor(() => {
      expect(realTrigger()).toBeTruthy();
    });
    expect(new Set(realTrigger()?.className.split(/\s+/u))).toEqual(before);
  });

  it('lands the early fetch as the real menu, leaving focus where it was', async () => {
    const { loader, load } = realLoader();
    let early: (() => void) | undefined;
    mount(loader, (fetch) => (early = fetch));
    expect(early).toBeTypeOf('function');
    early?.();
    await waitFor(() => {
      expect(realTrigger()).toBeTruthy();
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(standIn()).toBeNull();
    expect(realTrigger()?.getAttribute('aria-label')).toBe('Appearance: Light');
    expect(document.activeElement).toBe(document.body);
  });

  it('hands focus from a focused stand-in to the real trigger, the menu still closed', async () => {
    const { loader } = realLoader();
    let early: (() => void) | undefined;
    mount(loader, (fetch) => (early = fetch));
    standIn()?.focus();
    early?.();
    await waitFor(() => {
      expect(realTrigger()).toBeTruthy();
    });
    expect(document.activeElement).toBe(realTrigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a key press before the fetch opens the menu at its first item', async () => {
    const { loader, load } = realLoader();
    mount(loader);
    const button = standIn() as HTMLElement;
    button.focus();
    const press = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    const menu = await screen.findByRole('menu');
    expect(load).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    });
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(realTrigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('a pointer press before the fetch opens the menu once (the click adds nothing)', async () => {
    const { loader, load } = realLoader();
    mount(loader);
    const button = standIn() as HTMLElement;
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
    fireEvent.click(button);
    await screen.findByRole('menu');
    expect(load).toHaveBeenCalledTimes(1);
    expect(realTrigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens nothing when focus moved on before the menu landed, leaving focus there', async () => {
    const { loader, land } = deferredLoader();
    mount(loader);
    const button = standIn() as HTMLElement;
    button.focus();
    pressKey(button, 'Enter');
    const other = otherControl();
    other.focus();
    await land();
    expect(realTrigger()).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(other);
  });

  it.each([
    ['the pressed stand-in held focus', true],
    ['the press left focus on the body', false]
  ])(
    'opens nothing for a pointer press once another control took focus (%s)',
    async (_, focused) => {
      const { loader, land } = deferredLoader();
      mount(loader);
      const button = standIn() as HTMLElement;
      // Some browsers never focus a pressed button: the stand-in then sees no blur.
      if (focused) button.focus();
      fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
      const other = otherControl();
      other.focus();
      await land();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(other);
    }
  );

  it('Escape withdraws a waiting press: the menu lands closed, focus on its trigger', async () => {
    const { loader, land } = deferredLoader();
    mount(loader);
    const button = standIn() as HTMLElement;
    button.focus();
    pressKey(button, 'Enter');
    pressKey(button, 'Escape');
    await land();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(realTrigger());
  });

  it('ignores keys that open nothing', async () => {
    const { loader, load } = realLoader();
    mount(loader);
    fireEvent.keyDown(standIn() as HTMLElement, { key: 'Tab' });
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(standIn()).toBeTruthy();
  });

  it('keeps the stand-in on a failed fetch, logs it, and retries on the next press', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<AppearanceMenuComponent>>()
      .mockRejectedValueOnce(new Error('chunk gone'))
      .mockResolvedValueOnce(AppearanceMenu);
    mount(createChunkLoader(load, null));
    fireEvent.click(standIn() as HTMLElement);
    await settle();
    expect(standIn()).toBeTruthy();
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).toContain('chunk gone');
    fireEvent.click(standIn() as HTMLElement);
    await screen.findByRole('menu');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a retry after a failed fetch replays the retry’s own press, not the failed one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<AppearanceMenuComponent>>()
      .mockRejectedValueOnce(new Error('chunk gone'))
      .mockResolvedValueOnce(AppearanceMenu);
    mount(createChunkLoader(load, null));
    const button = standIn() as HTMLElement;
    button.focus();
    // A pointer open focuses the menu itself; a key open focuses its first row.
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
    await settle();
    expect(standIn()).toBe(button);
    pressKey(button, 'Enter');
    await screen.findByRole('menu');
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    });
  });

  it('renders an already loaded menu at once, scheduling no early fetch', async () => {
    const { loader } = realLoader();
    await loader.fetch();
    const prefetch = vi.fn();
    mount(loader, prefetch);
    expect(standIn()).toBeNull();
    expect(realTrigger()).toBeTruthy();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('a menu pick reaches the surface writer', async () => {
    const { loader } = realLoader();
    const { onChange } = mount(loader);
    fireEvent.pointerDown(standIn() as HTMLElement, { button: 0, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    const dark = [...menu.querySelectorAll('[role="menuitemradio"]')].find(
      (item) => item.textContent === 'Dark'
    ) as HTMLElement;
    fireEvent.pointerUp(dark, { button: 0 });
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('lands nothing after unmounting mid-fetch', async () => {
    let resolve!: (menu: AppearanceMenuComponent) => void;
    const load = vi.fn(
      () =>
        new Promise<AppearanceMenuComponent>((done) => {
          resolve = done;
        })
    );
    mount(createChunkLoader(load, null));
    const slot = document.querySelector('[data-fdt="appearance-menu-slot"]') as HTMLElement;
    fireEvent.click(standIn() as HTMLElement);
    cleanup();
    // A trigger planted in the detached slot: a landing that still ran would replay onto it.
    const planted = document.createElement('button');
    planted.dataset['fdt'] = 'tooltip-trigger';
    const replayed = vi.fn();
    planted.addEventListener('pointerdown', replayed);
    slot.append(planted);
    resolve(AppearanceMenu);
    await settle();
    expect(replayed).not.toHaveBeenCalled();
    expect(document.querySelector('[data-fdt="appearance-menu"]')).toBeNull();
  });

  it('hints the name natively on the stand-in only (the menu’s tooltip takes over)', async () => {
    const { loader, land } = deferredLoader();
    mount(loader, (fetch) => {
      fetch();
    });
    expect(standIn()?.getAttribute('title')).toBe('Appearance: Light');
    await land();
    expect(realTrigger()?.hasAttribute('title')).toBe(false);
    expect(document.querySelector('[data-fdt="appearance-menu"] [title]')).toBeNull();
  });
});
