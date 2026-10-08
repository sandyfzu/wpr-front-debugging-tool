/**
 * The debug-silencing gate: in production builds `debug` writes nothing; in
 * every other mode it flows to console.debug. The gate is a module-level
 * const, so each mode needs a fresh module evaluation.
 */
import { describe, expect, it, vi } from 'vitest';

describe('createLogger level gating', () => {
  it('debug reaches console.debug outside production', async () => {
    vi.stubEnv('MODE', 'test');
    vi.resetModules();
    const { createLogger } = await import('./logger');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      createLogger('gating').debug('visible');
      expect(debugSpy).toHaveBeenCalledWith('[WPR FDT] [gating] visible');
    } finally {
      debugSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('debug is silenced in production builds', async () => {
    vi.stubEnv('MODE', 'production');
    vi.resetModules();
    const { createLogger } = await import('./logger');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const log = createLogger('gating');
      log.debug('hidden');
      expect(debugSpy).not.toHaveBeenCalled();
      // info still flows in production (the processing timing line).
      log.info('kept');
      expect(infoSpy).toHaveBeenCalledWith('[WPR FDT] [gating] kept');
    } finally {
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
