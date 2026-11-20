import { describe, expect, it } from 'vitest';
import { createConsentTabs } from './consent-tabs';

describe('createConsentTabs', () => {
  it('starts empty', () => {
    const tabs = createConsentTabs();
    expect(tabs.entryFor('rucss')).toBeNull();
    expect(tabs.entryFor('pagespeed')).toBeNull();
    expect(tabs.left(1)).toBeNull();
  });

  it('remembers one tab per tool, unanswered', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 4, 'own-tab');
    tabs.shown('pagespeed', 5, 'own-tab');
    expect(tabs.entryFor('rucss')).toEqual({ tabId: 4, answered: false });
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 5, answered: false });
    // A newer tab for the same tool replaces the older one.
    tabs.shown('rucss', 6, 'own-tab');
    expect(tabs.entryFor('rucss')).toEqual({ tabId: 6, answered: false });
    expect(tabs.left(4)).toBeNull();
  });

  it('a tab reloaded for another tool moves to it', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 4, 'own-tab');
    tabs.shown('pagespeed', 4, 'own-tab');
    expect(tabs.entryFor('rucss')).toBeNull();
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 4, answered: false });
  });

  it('a tab that leaves unanswered names its tool once', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 4, 'own-tab');
    expect(tabs.left(4)).toBe('rucss');
    expect(tabs.entryFor('rucss')).toBeNull();
    expect(tabs.left(4)).toBeNull();
  });

  it('a grant forgets the tab: its leaving tells nobody', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 4, 'own-tab');
    tabs.answered(4, true);
    expect(tabs.entryFor('rucss')).toBeNull();
    expect(tabs.left(4)).toBeNull();
  });

  it('a decline keeps the tab, answered: its leaving tells nobody; a reload asks anew', () => {
    const tabs = createConsentTabs();
    tabs.shown('pagespeed', 9, 'own-tab');
    tabs.answered(9, false);
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 9, answered: true });
    tabs.shown('pagespeed', 9, 'own-tab');
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 9, answered: false });
    tabs.answered(9, false);
    expect(tabs.left(9)).toBeNull();
    expect(tabs.entryFor('pagespeed')).toBeNull();
  });

  it('ignores answers from tabs it never showed', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 4, 'own-tab');
    tabs.answered(5, true);
    expect(tabs.entryFor('rucss')).toEqual({ tabId: 4, answered: false });
  });

  it('never offers an asking tab for reuse, yet tracks its answer and leaving', () => {
    const tabs = createConsentTabs();
    tabs.shown('pagespeed', 3, 'asking-tab');
    expect(tabs.entryFor('pagespeed')).toBeNull();
    // An own tab for the same tool sits beside it; neither drops the other.
    tabs.shown('pagespeed', 7, 'own-tab');
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 7, answered: false });
    tabs.shown('pagespeed', 8, 'asking-tab');
    expect(tabs.entryFor('pagespeed')).toEqual({ tabId: 7, answered: false });
    tabs.answered(3, false);
    expect(tabs.left(3)).toBeNull();
    expect(tabs.left(8)).toBe('pagespeed');
    expect(tabs.left(7)).toBe('pagespeed');
  });

  it('an asking tab later opened as own tab becomes reusable', () => {
    const tabs = createConsentTabs();
    tabs.shown('rucss', 3, 'asking-tab');
    tabs.shown('rucss', 3, 'own-tab');
    expect(tabs.entryFor('rucss')).toEqual({ tabId: 3, answered: false });
  });
});
