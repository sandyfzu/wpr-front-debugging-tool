/**
 * Clipboard writes: the async clipboard first, the selection copy as the
 * fallback when it is missing or refuses; `copied` only on a confirmed
 * write. The selection copier leaves nothing behind and gives focus back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asyncClipboardOf,
  pageClipboardWriter,
  selectionCopier,
  writeClipboard,
  type ClipboardDeps
} from './clipboard';

/** Deps with a fake async clipboard and selection copy. */
function deps(overrides: Partial<ClipboardDeps> = {}): ClipboardDeps & {
  readonly warn: ReturnType<typeof vi.fn>;
} {
  const warn = vi.fn();
  return {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    copyBySelection: vi.fn(() => true),
    ...overrides,
    warn
  };
}

describe('writeClipboard', () => {
  it('writes through the async clipboard and stops there', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const run = deps({ clipboard: { writeText } });
    expect(await writeClipboard('a\nb', run)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('a\nb');
    expect(run.copyBySelection).not.toHaveBeenCalled();
    expect(run.warn).not.toHaveBeenCalled();
  });

  it('falls back to the selection copy when the async write is refused', async () => {
    const refused = new Error('Write permission denied.');
    const run = deps({ clipboard: { writeText: () => Promise.reject(refused) } });
    expect(await writeClipboard('x', run)).toBe('copied');
    expect(run.copyBySelection).toHaveBeenCalledWith('x');
    expect(run.warn).toHaveBeenCalledWith(expect.stringMatching(/refused/), refused);
  });

  it('uses the selection copy alone where the page has no async clipboard', async () => {
    const run = deps({ clipboard: null });
    expect(await writeClipboard('x', run)).toBe('copied');
    expect(run.copyBySelection).toHaveBeenCalledWith('x');
  });

  it('fails when the selection copy reports nothing copied, or throws', async () => {
    const declined = deps({ clipboard: null, copyBySelection: () => false });
    expect(await writeClipboard('x', declined)).toBe('failed');
    expect(declined.warn).toHaveBeenCalledWith(expect.stringMatching(/nothing copied/));
    const broken = new Error('no command');
    const threw = deps({
      clipboard: { writeText: () => Promise.reject(new Error('no')) },
      copyBySelection: () => {
        throw broken;
      }
    });
    expect(await writeClipboard('x', threw)).toBe('failed');
    expect(threw.warn).toHaveBeenLastCalledWith(expect.stringMatching(/failed/), broken);
  });
});

describe('asyncClipboardOf', () => {
  /** A window shape with the given security and clipboard. */
  const win = (isSecureContext: boolean, clipboard: unknown): Window =>
    ({ isSecureContext, navigator: { clipboard } }) as unknown as Window;

  it('is null in an insecure context, even with a clipboard object', () => {
    expect(asyncClipboardOf(win(false, { writeText: vi.fn() }))).toBeNull();
  });

  it('is null when the clipboard or its writeText is missing', () => {
    expect(asyncClipboardOf(win(true, undefined))).toBeNull();
    expect(asyncClipboardOf(win(true, {}))).toBeNull();
  });

  it('calls writeText on the clipboard itself (never detached)', async () => {
    const clipboard = {
      writeText: vi.fn(function (this: unknown) {
        expect(this).toBe(clipboard);
        return Promise.resolve();
      })
    };
    await asyncClipboardOf(win(true, clipboard))?.writeText('t');
    expect(clipboard.writeText).toHaveBeenCalledWith('t');
  });
});

describe('selectionCopier', () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(document, 'execCommand');
  });

  /** Install a fake copy command that records what was selected when it ran. */
  function fakeCommand(result: boolean | Error): { seen: () => string | null } {
    let seen: string | null = null;
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        expect(command).toBe('copy');
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement) {
          seen = active.value.slice(active.selectionStart, active.selectionEnd);
        }
        if (result instanceof Error) throw result;
        return result;
      }
    });
    return { seen: () => seen };
  }

  it('copies the selected text, then removes the field and gives focus back', () => {
    const container = document.createElement('section');
    const button = document.createElement('button');
    container.append(button);
    document.body.append(container);
    button.focus();
    const command = fakeCommand(true);
    expect(selectionCopier(container)('a\nb')).toBe(true);
    expect(command.seen()).toBe('a\nb');
    expect(container.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('backs the page writer: an insecure page copies through a selection in the container', async () => {
    const container = document.createElement('section');
    document.body.append(container);
    const command = fakeCommand(true);
    const insecure = { isSecureContext: false, navigator: {} } as unknown as Window;
    const warn = vi.fn();
    expect(await pageClipboardWriter(insecure, warn)('a\nb', container)).toBe('copied');
    expect(command.seen()).toBe('a\nb');
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the browser's refusal and cleans up when the command throws", () => {
    const container = document.createElement('section');
    document.body.append(container);
    fakeCommand(false);
    expect(selectionCopier(container)('x')).toBe(false);
    fakeCommand(new Error('unsupported'));
    expect(() => selectionCopier(container)('x')).toThrow('unsupported');
    expect(container.querySelector('textarea')).toBeNull();
  });
});
