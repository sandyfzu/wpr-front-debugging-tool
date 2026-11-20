import { describe, expect, it, vi } from 'vitest';
import {
  DATA_CONSENT_FEATURES,
  DATA_CONSENT_PERMISSIONS,
  DATA_CONSENT_TYPE,
  hasDataConsent,
  isDataConsentFeature
} from './consent';

describe('the consent vocabulary', () => {
  it('asks for the one data type the manifest declares optional', () => {
    expect(DATA_CONSENT_TYPE).toBe('browsingActivity');
    expect(DATA_CONSENT_PERMISSIONS).toEqual({ data_collection: ['browsingActivity'] });
  });

  it('names both tools, each with one sentence naming its destination', () => {
    expect(Object.keys(DATA_CONSENT_FEATURES).sort()).toEqual(['pagespeed', 'rucss']);
    expect(DATA_CONSENT_FEATURES.rucss.sends).toContain('mega.wp-rocket.me');
    expect(DATA_CONSENT_FEATURES.pagespeed.sends).toContain('pagespeed.web.dev');
  });

  it('recognizes only own feature names', () => {
    expect(isDataConsentFeature('rucss')).toBe(true);
    expect(isDataConsentFeature('pagespeed')).toBe(true);
    for (const value of ['toString', 'RUCSS', '', null, 1, undefined]) {
      expect(isDataConsentFeature(value)).toBe(false);
    }
  });
});

describe('hasDataConsent', () => {
  it('is true once the type is granted', async () => {
    const getAll = vi.fn().mockResolvedValue({ data_collection: ['browsingActivity'] });
    await expect(hasDataConsent({ getAll })).resolves.toBe(true);
  });

  it('is false while the type is not granted (never, declined, or revoked)', async () => {
    await expect(
      hasDataConsent({ getAll: () => Promise.resolve({ data_collection: [] }) })
    ).resolves.toBe(false);
    await expect(
      hasDataConsent({ getAll: () => Promise.resolve({ data_collection: ['websiteContent'] }) })
    ).resolves.toBe(false);
  });

  it('is true where the browser has no built-in consent (no `data_collection` key)', async () => {
    await expect(hasDataConsent({ getAll: () => Promise.resolve({}) })).resolves.toBe(true);
  });

  it('rejects when the API does (the caller decides: nothing is sent)', async () => {
    await expect(
      hasDataConsent({ getAll: () => Promise.reject(new Error('dead context')) })
    ).rejects.toThrow('dead context');
  });
});
