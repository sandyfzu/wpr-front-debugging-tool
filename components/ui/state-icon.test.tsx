/**
 * Render tests for the state icon tile: every tone and size, the decorative
 * contract and the caller's classes.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import Info from 'lucide-solid/icons/info';
import {
  STATE_ICON_SIZE_CLASSES,
  STATE_ICON_TONE_CLASSES,
  STATE_ICON_TONES,
  StateIcon
} from './state-icon';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from './status-badge';

afterEach(() => {
  cleanup();
});

/** The rendered tile. */
function tile(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-fdt="state-icon"]');
  if (element === null) throw new Error('no tile');
  return element;
}

describe('StateIcon', () => {
  it('defaults to the quiet neutral 36 px tile, hidden from assistive tech', () => {
    render(() => (
      <StateIcon>
        <Info size={16} />
      </StateIcon>
    ));
    expect(tile().getAttribute('aria-hidden')).toBe('true');
    for (const token of ['rounded-lg', 'size-9', 'bg-surface-3', 'text-fg-muted']) {
      expect(tile().classList).toContain(token);
    }
    expect(tile().querySelector('svg')).not.toBeNull();
  });

  it.each(STATE_ICON_TONES)('paints the %s tone from its token pair', (tone) => {
    render(() => (
      <StateIcon tone={tone} size="lg">
        <Info size={22} />
      </StateIcon>
    ));
    for (const token of STATE_ICON_TONE_CLASSES[tone].split(' ')) {
      expect(tile().classList).toContain(token);
    }
    expect(tile().classList).toContain(STATE_ICON_SIZE_CLASSES.lg);
  });

  it('takes the status tones from the status vocabulary (one declaring site)', () => {
    expect(STATE_ICON_TONE_CLASSES.error).toBe(
      `${STATUS_SOFT_CLASSES.error} ${STATUS_TEXT_CLASSES.error}`
    );
    expect(STATE_ICON_TONE_CLASSES.info).toBe(
      `${STATUS_SOFT_CLASSES.info} ${STATUS_TEXT_CLASSES.info}`
    );
    expect(Object.values(STATE_ICON_TONE_CLASSES).join(' ')).not.toMatch(/#|rgb|opacity/);
  });

  it('merges the caller classes last', () => {
    render(() => (
      <StateIcon class="mb-1">
        <Info size={16} />
      </StateIcon>
    ));
    expect(tile().classList).toContain('mb-1');
  });
});
