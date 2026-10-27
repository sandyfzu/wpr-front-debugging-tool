import { describe, expect, it, vi } from 'vitest';
import { mountOverlay, type MountOverlayDeps, type OverlayUi } from './mount-overlay';

/** A fake WXT factory whose `mount` runs the onMount hook, like the real one. */
function factory(options: { invalidateDuringCreate?: () => void } = {}) {
  const ui = { mount: vi.fn(), remove: vi.fn() };
  let hooks: Parameters<MountOverlayDeps['createUi']>[0] | undefined;
  const createUi: MountOverlayDeps['createUi'] = async (given) => {
    hooks = given;
    await Promise.resolve();
    options.invalidateDuringCreate?.();
    const handle: OverlayUi = {
      mount: () => {
        ui.mount();
        hooks?.onMount(
          document.createElement('div'),
          document.createElement('div').attachShadow({ mode: 'open' }),
          document.createElement('div')
        );
      },
      remove: () => {
        ui.remove();
        hooks?.onRemove();
      }
    };
    return handle;
  };
  return { ui, createUi };
}

describe('mountOverlay', () => {
  it('mounts and renders when the context stays alive', async () => {
    const dispose = vi.fn();
    const { ui, createUi } = factory();
    const render = vi.fn(() => Promise.resolve(dispose));
    expect(await mountOverlay({ isInvalid: () => false, createUi, render, onError: vi.fn() })).toBe(
      'mounted'
    );
    expect(ui.mount).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('a newer injection during the stylesheet wait leaves no second overlay', async () => {
    let invalid = false;
    const { ui, createUi } = factory({
      invalidateDuringCreate: () => {
        invalid = true;
      }
    });
    const render = vi.fn(() => Promise.resolve(vi.fn()));
    const outcome = await mountOverlay({
      isInvalid: () => invalid,
      createUi,
      render,
      onError: vi.fn()
    });
    expect(outcome).toBe('superseded');
    expect(ui.mount).not.toHaveBeenCalled();
    expect(ui.remove).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it('a removal while the view mounts disposes the view', async () => {
    const dispose = vi.fn();
    let finish: (value: () => void) => void = () => undefined;
    const render = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          finish = resolve;
        })
    );
    const handles: OverlayUi[] = [];
    const createUi: MountOverlayDeps['createUi'] = (hooks) => {
      const handle: OverlayUi = {
        mount: () => {
          hooks.onMount(
            document.createElement('div'),
            document.createElement('div').attachShadow({ mode: 'open' }),
            document.createElement('div')
          );
        },
        remove: () => {
          hooks.onRemove();
        }
      };
      handles.push(handle);
      return Promise.resolve(handle);
    };
    await mountOverlay({ isInvalid: () => false, createUi, render, onError: vi.fn() });
    handles[0]?.remove();
    finish(dispose);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('never starts on a dead context, and reports render failures', async () => {
    const { createUi } = factory();
    expect(
      await mountOverlay({ isInvalid: () => true, createUi, render: vi.fn(), onError: vi.fn() })
    ).toBe('superseded');
    const onError = vi.fn();
    const failing = factory();
    await mountOverlay({
      isInvalid: () => false,
      createUi: failing.createUi,
      render: () => Promise.reject(new Error('boom')),
      onError
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
  });
});
