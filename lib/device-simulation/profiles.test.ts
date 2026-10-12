/**
 * The profile contract: the single row is pinned exactly (its string is a
 * network identity — any change is a recorded correction, never a drift),
 * device-class tokens survive, and the viewport is a portrait in CSS px.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_SIMULATION_PROFILE } from './profiles';

describe('DEVICE_SIMULATION_PROFILE', () => {
  it('is the single phone row, pinned exactly', () => {
    expect(DEVICE_SIMULATION_PROFILE).toEqual({
      id: 'phone',
      userAgent:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
      viewport: { width: 412, height: 892 }
    });
  });

  it('keeps the device-class tokens UA decisions listen for', () => {
    const { userAgent } = DEVICE_SIMULATION_PROFILE;
    expect(userAgent).toContain('Android');
    expect(userAgent).toContain('Mobile');
  });

  it('carries a reduced-UA phone shape and a portrait viewport', () => {
    const { userAgent, viewport } = DEVICE_SIMULATION_PROFILE;
    expect(userAgent).toMatch(/Chrome\/\d+\.0\.0\.0 Mobile Safari/);
    expect(viewport.width).toBeLessThan(viewport.height);
  });
});
