/**
 * Logger behavior: the shared prefix, per-surface tags, and level gating
 * (`debug` silenced in production builds, everything else always emitted).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

const spies = [
  vi.spyOn(console, 'debug').mockImplementation(() => {}),
  vi.spyOn(console, 'info').mockImplementation(() => {}),
  vi.spyOn(console, 'warn').mockImplementation(() => {}),
  vi.spyOn(console, 'error').mockImplementation(() => {})
];

afterEach(() => {
  for (const spy of spies) spy.mockClear();
});

describe('createLogger', () => {
  it('writes under the [WPR FDT] prefix with the caller tag', () => {
    const log = createLogger('detection');
    log.error('could not parse page');
    expect(spies[3]).toHaveBeenCalledWith('[WPR FDT] [detection] could not parse page');
  });

  it('keeps the prefix alone when no tag is given', () => {
    createLogger('').info('hello');
    expect(spies[1]).toHaveBeenCalledWith('[WPR FDT] hello');
  });

  it('routes levels to the matching console method', () => {
    const log = createLogger('ui');
    log.debug('detail');
    log.info('state');
    log.warn('slow');
    log.error('boom');
    expect(spies[0]).toHaveBeenCalledWith('[WPR FDT] [ui] detail');
    expect(spies[1]).toHaveBeenCalledWith('[WPR FDT] [ui] state');
    expect(spies[2]).toHaveBeenCalledWith('[WPR FDT] [ui] slow');
    expect(spies[3]).toHaveBeenCalledWith('[WPR FDT] [ui] boom');
  });

  it('forwards extra details after the prefixed message', () => {
    const log = createLogger('messaging');
    log.warn('unknown message', { type: 'x' }, 42);
    expect(spies[2]).toHaveBeenCalledWith(
      '[WPR FDT] [messaging] unknown message',
      { type: 'x' },
      42
    );
  });
});
