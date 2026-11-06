/**
 * The current-visit vitals read's guard: the reducer's input is rebuilt
 * exactly (support flags, timings, bounded entry lists, interaction ids
 * and count, the optional CLS carry, dropped-interaction count and restore
 * time — absent stays absent) and anything else is refused.
 */
import { describe, expect, it } from 'vitest';
import type { VitalsInput } from '../web-vitals/current-visit';
import { CURRENT_VISIT_LIMITS, parseCurrentVisitVitalsReply } from './current-visit-vitals';

/** A full input. */
const INPUT: VitalsInput = {
  supported: { lcp: true, cls: true, inp: true },
  activationStart: 0,
  firstHiddenTime: null,
  fcpTime: 300,
  lcpEntries: [{ startTime: 400 }, { startTime: 900 }],
  layoutShifts: [{ startTime: 500, value: 0.05, hadRecentInput: false }],
  events: [{ interactionId: 7, duration: 120 }],
  interactionCount: 3
};

/** The reply with one input field replaced. */
const withInput = (fields: Record<string, unknown>): unknown => ({
  input: { ...INPUT, ...fields },
  capped: false
});

describe('parseCurrentVisitVitalsReply', () => {
  it('rebuilds a reply', () => {
    expect(parseCurrentVisitVitalsReply({ input: INPUT, capped: true })).toEqual({
      input: INPUT,
      capped: true
    });
  });

  it('rebuilds the optional fields when present, and keeps them absent otherwise', () => {
    const full: VitalsInput = {
      ...INPUT,
      clsCarry: { largest: 0.4, windowSum: 0.1, windowFirst: 200, previous: 300 },
      interactionsDropped: 4,
      restoredAt: 1500
    };
    expect(parseCurrentVisitVitalsReply({ input: full, capped: true })).toEqual({
      input: full,
      capped: true
    });
    const plain = parseCurrentVisitVitalsReply({ input: INPUT, capped: false });
    expect(plain?.input).not.toHaveProperty('clsCarry');
    expect(plain?.input).not.toHaveProperty('interactionsDropped');
    expect(plain?.input).not.toHaveProperty('restoredAt');
  });

  it('accepts the nullable fields as null', () => {
    expect(
      parseCurrentVisitVitalsReply(
        withInput({ firstHiddenTime: null, fcpTime: null, interactionCount: null })
      )
    ).not.toBeNull();
    expect(parseCurrentVisitVitalsReply(withInput({ firstHiddenTime: 0 }))).not.toBeNull();
  });

  it('accepts each list at its cap and refuses one past it', () => {
    const lists = [
      ['lcpEntries', CURRENT_VISIT_LIMITS.lcpEntries, { startTime: 1 }],
      [
        'layoutShifts',
        CURRENT_VISIT_LIMITS.layoutShifts,
        { startTime: 1, value: 0, hadRecentInput: true }
      ],
      ['events', CURRENT_VISIT_LIMITS.interactions, { interactionId: 1, duration: 1 }]
    ] as const;
    for (const [key, max, entry] of lists) {
      const at = Array<unknown>(max).fill(entry);
      expect(parseCurrentVisitVitalsReply(withInput({ [key]: at }))).not.toBeNull();
      expect(parseCurrentVisitVitalsReply(withInput({ [key]: [...at, entry] }))).toBeNull();
    }
  });

  it.each([
    ['a non-record', 'x'],
    ['an extra key', { input: INPUT, capped: false, x: 1 }],
    ['a non-boolean capped', { input: INPUT, capped: 1 }],
    ['an input with an extra key', withInput({ x: 1 })],
    ['malformed support flags', withInput({ supported: { lcp: true, cls: true } })],
    ['a non-boolean support flag', withInput({ supported: { lcp: 1, cls: true, inp: true } })],
    [
      'support flags with an extra key',
      withInput({ supported: { lcp: true, cls: true, inp: true, x: true } })
    ],
    ['a negative activation start', withInput({ activationStart: -1 })],
    ['a CLS carry not a record', withInput({ clsCarry: 1 })],
    [
      'a CLS carry missing a field',
      withInput({ clsCarry: { largest: 1, windowSum: 0, windowFirst: 0 } })
    ],
    [
      'a CLS carry with a negative field',
      withInput({ clsCarry: { largest: 1, windowSum: -1, windowFirst: 0, previous: 0 } })
    ],
    [
      'a CLS carry with an extra key',
      withInput({ clsCarry: { largest: 1, windowSum: 0, windowFirst: 0, previous: 0, x: 0 } })
    ],
    ['an undefined CLS carry key', withInput({ clsCarry: undefined })],
    ['a fractional dropped count', withInput({ interactionsDropped: 1.5 })],
    ['a negative dropped count', withInput({ interactionsDropped: -1 })],
    ['a negative restore time', withInput({ restoredAt: -1 })],
    ['a string restore time', withInput({ restoredAt: '5' })],
    ['a NaN first-hidden time', withInput({ firstHiddenTime: NaN })],
    ['a string FCP time', withInput({ fcpTime: '1' })],
    ['a negative interaction count', withInput({ interactionCount: -1 })],
    ['a fractional interaction count', withInput({ interactionCount: 1.5 })],
    ['LCP entries not a list', withInput({ lcpEntries: {} })],
    ['an LCP entry with an element', withInput({ lcpEntries: [{ startTime: 1, element: {} }] })],
    ['a negative LCP time', withInput({ lcpEntries: [{ startTime: -1 }] })],
    ['a shift without its input flag', withInput({ layoutShifts: [{ startTime: 1, value: 0.1 }] })],
    [
      'a shift with a negative value',
      withInput({ layoutShifts: [{ startTime: 1, value: -0.1, hadRecentInput: false }] })
    ],
    [
      'a shift with an extra key',
      withInput({ layoutShifts: [{ startTime: 1, value: 0, hadRecentInput: false, sources: [] }] })
    ],
    [
      'an event without an interaction id',
      withInput({ events: [{ interactionId: 0, duration: 1 }] })
    ],
    ['an event with a fractional id', withInput({ events: [{ interactionId: 1.5, duration: 1 }] })],
    [
      'an event with an infinite duration',
      withInput({ events: [{ interactionId: 1, duration: Infinity }] })
    ],
    [
      'an event with an extra key',
      withInput({ events: [{ interactionId: 1, duration: 1, name: 'click' }] })
    ]
  ])('refuses %s', (_label, input) => {
    expect(parseCurrentVisitVitalsReply(input)).toBeNull();
  });
});
