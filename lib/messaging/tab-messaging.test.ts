import { describe, expect, it } from 'vitest';
import { canMessageRuntime, canMessageTabs } from './tab-messaging';

describe('canMessageTabs', () => {
  it('is true when tabs.sendMessage is a function', () => {
    expect(canMessageTabs({ tabs: { sendMessage: () => undefined } })).toBe(true);
  });

  it('is false without a tabs namespace (a Firefox DevTools page)', () => {
    expect(canMessageTabs({ runtime: {}, devtools: {} })).toBe(false);
    expect(canMessageTabs({ tabs: undefined })).toBe(false);
    expect(canMessageTabs({ tabs: null })).toBe(false);
  });

  it('is false when sendMessage is missing or not callable', () => {
    expect(canMessageTabs({ tabs: {} })).toBe(false);
    expect(canMessageTabs({ tabs: { sendMessage: 'x' } })).toBe(false);
  });

  it('is false for a non-object api', () => {
    expect(canMessageTabs(undefined)).toBe(false);
    expect(canMessageTabs(null)).toBe(false);
    expect(canMessageTabs('browser')).toBe(false);
  });
});

describe('canMessageRuntime', () => {
  it('is true when runtime.sendMessage is a function (a Firefox DevTools page has it)', () => {
    expect(canMessageRuntime({ runtime: { sendMessage: () => undefined }, devtools: {} })).toBe(
      true
    );
  });

  it('is false without a callable runtime.sendMessage, whatever tabs offers', () => {
    expect(canMessageRuntime({ tabs: { sendMessage: () => undefined } })).toBe(false);
    expect(canMessageRuntime({ runtime: null })).toBe(false);
    expect(canMessageRuntime({ runtime: {} })).toBe(false);
    expect(canMessageRuntime({ runtime: { sendMessage: 1 } })).toBe(false);
  });

  it('is false for a non-object api', () => {
    expect(canMessageRuntime(undefined)).toBe(false);
    expect(canMessageRuntime(null)).toBe(false);
  });
});
