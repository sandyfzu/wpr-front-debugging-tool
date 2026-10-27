import { describe, expect, it } from 'vitest';
import type { ProtocolMap } from './protocol';
import {
  TAB_PUSHES,
  TAB_PUSH_PORT_NAME,
  isTabPush,
  parseTabPushEnvelope,
  parseTabPushSubscription,
  tabPushEnvelope,
  type TabPushPayloads
} from './tab-pushes';

/** Compile-time: each relayed push's payload is the protocol row's own payload type. */
type RowPayload<K extends keyof ProtocolMap> = Parameters<ProtocolMap[K]>[0];
const payloadsMatchProtocol: {
  [K in keyof TabPushPayloads]: [TabPushPayloads[K]] extends [RowPayload<K>]
    ? [RowPayload<K>] extends [TabPushPayloads[K]]
      ? true
      : false
    : false;
} = { notifyPanelReload: true, allScriptsLoaded: true, undefinedReferencesUpdated: true };

describe('the closed push list', () => {
  it('relays exactly the three content-script → panel pushes', () => {
    expect(TAB_PUSHES).toEqual([
      'notifyPanelReload',
      'allScriptsLoaded',
      'undefinedReferencesUpdated'
    ]);
    expect(payloadsMatchProtocol).toBeTruthy();
    expect(TAB_PUSH_PORT_NAME).toBe('tab-pushes');
  });

  it('names only its own rows (never another protocol row or a prototype key)', () => {
    for (const push of TAB_PUSHES) expect(isTabPush(push)).toBe(true);
    for (const value of [
      'panelSearch',
      'getFdtData',
      'getPageHeaders',
      'toString',
      'constructor',
      '',
      1,
      null
    ]) {
      expect(isTabPush(value), String(value)).toBe(false);
    }
  });
});

describe('tabPushEnvelope — the background side', () => {
  it('wraps each push with its validated payload', () => {
    expect(tabPushEnvelope('notifyPanelReload', 4, undefined)).toEqual({
      tabId: 4,
      push: 'notifyPanelReload'
    });
    expect(tabPushEnvelope('allScriptsLoaded', 4, true)).toEqual({
      tabId: 4,
      push: 'allScriptsLoaded',
      data: true
    });
    expect(tabPushEnvelope('allScriptsLoaded', 4, false)).toEqual({
      tabId: 4,
      push: 'allScriptsLoaded',
      data: false
    });
    expect(tabPushEnvelope('undefinedReferencesUpdated', 4, ['jQuery', 'wp'])).toEqual({
      tabId: 4,
      push: 'undefinedReferencesUpdated',
      data: ['jQuery', 'wp']
    });
  });

  it('refuses a payload the panel’s own receiver would refuse', () => {
    expect(tabPushEnvelope('notifyPanelReload', 4, true)).toBeNull();
    for (const data of ['true', 1, null, undefined]) {
      expect(tabPushEnvelope('allScriptsLoaded', 4, data), String(data)).toBeNull();
    }
    for (const data of [
      null,
      'jQuery',
      [1],
      [''],
      ['x'.repeat(201)],
      Array.from({ length: 51 }, () => 'w')
    ]) {
      expect(
        tabPushEnvelope('undefinedReferencesUpdated', 4, data),
        JSON.stringify(data)
      ).toBeNull();
    }
  });

  it('rebuilds the word list (no extra array state rides along)', () => {
    const words = Object.assign(['a'], { extra: 1 });
    const envelope = tabPushEnvelope('undefinedReferencesUpdated', 4, words);
    expect(envelope).toEqual({ tabId: 4, push: 'undefinedReferencesUpdated', data: ['a'] });
    expect(envelope !== null && 'data' in envelope ? envelope.data : null).not.toBe(words);
  });
});

describe('parseTabPushEnvelope — the panel side', () => {
  it('round-trips every envelope the background builds', () => {
    for (const envelope of [
      tabPushEnvelope('notifyPanelReload', 0, undefined),
      tabPushEnvelope('allScriptsLoaded', 7, true),
      tabPushEnvelope('undefinedReferencesUpdated', 7, ['x'])
    ]) {
      expect(parseTabPushEnvelope(structuredClone(envelope))).toEqual(envelope);
    }
  });

  it('refuses every contract break', () => {
    for (const input of [
      null,
      'notifyPanelReload',
      [],
      { push: 'notifyPanelReload' },
      { tabId: -1, push: 'notifyPanelReload' },
      { tabId: 1.5, push: 'notifyPanelReload' },
      { tabId: '1', push: 'notifyPanelReload' },
      { tabId: 1, push: 'panelSearch', data: { action: 'cancelSearch' } },
      { tabId: 1, push: 'toString' },
      { tabId: 1, push: 'notifyPanelReload', extra: true },
      { tabId: 1, push: 'notifyPanelReload', data: 1 },
      { tabId: 1, push: 'allScriptsLoaded' },
      { tabId: 1, push: 'allScriptsLoaded', data: 'yes' },
      { tabId: 1, push: 'undefinedReferencesUpdated', data: [42] }
    ]) {
      expect(parseTabPushEnvelope(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('ignores an inherited field (a polluted prototype supplies nothing)', () => {
    const input = Object.create({ data: true }) as Record<string, unknown>;
    input['tabId'] = 1;
    input['push'] = 'allScriptsLoaded';
    expect(parseTabPushEnvelope(input)).toBeNull();
  });
});

describe('parseTabPushSubscription', () => {
  it('accepts exactly { tabId } with a usable id', () => {
    expect(parseTabPushSubscription({ tabId: 0 })).toBe(0);
    expect(parseTabPushSubscription({ tabId: 12 })).toBe(12);
  });

  it('refuses everything else', () => {
    for (const input of [
      null,
      12,
      {},
      { tabId: -1 },
      { tabId: '12' },
      { tabId: 12, push: 'x' },
      [12]
    ]) {
      expect(parseTabPushSubscription(input), JSON.stringify(input)).toBeNull();
    }
  });
});
