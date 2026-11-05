/**
 * The delayed-type rule (Delay JS runtime's `script[type$=rocketlazyloadscript]`)
 * and the served-URL rule built on it.
 */
import { describe, expect, it } from 'vitest';
import { delayedSrcOf, isDelayedScriptType, servedSrcOf } from './delayed-script';

const DELAYED_URL = 'https://s.example/wp-content/cache/min/1/a.js';

describe('isDelayedScriptType', () => {
  it.each(['rocketlazyloadscript', 'text/rocketlazyloadscript', 'Text/RocketLazyLoadScript'])(
    'accepts %j (both written values, any case)',
    (type) => {
      expect(isDelayedScriptType(type)).toBe(true);
    }
  );

  it.each([null, undefined, '', 'text/javascript', 'module', 'rocketlazyloadscript-x'])(
    'rejects %j (the runtime selector is a suffix match)',
    (type) => {
      expect(isDelayedScriptType(type)).toBe(false);
    }
  );
});

describe('delayedSrcOf', () => {
  it('names a delayed tag’s non-empty delayed URL only', () => {
    expect(delayedSrcOf('rocketlazyloadscript', DELAYED_URL)).toBe(DELAYED_URL);
    expect(delayedSrcOf('rocketlazyloadscript', '')).toBeNull();
    expect(delayedSrcOf('rocketlazyloadscript', null)).toBeNull();
    expect(delayedSrcOf('rocketlazyloadscript-x', DELAYED_URL)).toBeNull();
    expect(delayedSrcOf(null, DELAYED_URL)).toBeNull();
  });
});

describe('servedSrcOf', () => {
  it.each([
    ['delayed', 'text/rocketlazyloadscript', DELAYED_URL, 'https://s.example/x.js', DELAYED_URL],
    ['delayed, older type, any case', 'RocketLazyLoadScript', DELAYED_URL, null, DELAYED_URL],
    [
      'delayed, empty delayed URL',
      'rocketlazyloadscript',
      '',
      'https://s.example/x.js',
      'https://s.example/x.js'
    ],
    [
      'undelayed with a stray delayed URL',
      'module',
      DELAYED_URL,
      'https://s.example/x.js',
      'https://s.example/x.js'
    ],
    ['valueless src', null, null, '', ''],
    ['no URL at all', 'rocketlazyloadscript', '', null, null]
  ])('%s', (_label, type, delayedSrc, src, expected) => {
    expect(servedSrcOf({ type, delayedSrc, src })).toBe(expected);
  });
});
