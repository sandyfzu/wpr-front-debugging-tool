/**
 * The attachment machine: the full state × event matrix (every accepted
 * pair and every refusal), the effects, and the rewrite gate.
 */
import { describe, expect, it } from 'vitest';
import {
  DETACHED,
  mayRewrite,
  transitionAttachment,
  type Attachment,
  type AttachmentEvent
} from './attachment';

const STATES: Record<Attachment['phase'], Attachment> = {
  detached: DETACHED,
  attaching: { phase: 'attaching', generation: 5 },
  armed: { phase: 'armed', generation: 5 },
  detaching: { phase: 'detaching' }
};

const EVENTS: Record<AttachmentEvent['type'], AttachmentEvent> = {
  attach: { type: 'attach', generation: 9 },
  confirm: { type: 'confirm', generation: 9 },
  enabled: { type: 'enabled' },
  lost: { type: 'lost' },
  detach: { type: 'detach' },
  detached: { type: 'detached' },
  'browser-detached': { type: 'browser-detached' }
};

/** Every accepted pair → [next, effect]; every pair not listed is refused (null). */
const ACCEPTED: Record<string, [Attachment, unknown]> = {
  'detached/attach': [{ phase: 'attaching', generation: 9 }, null],
  'armed/confirm': [{ phase: 'armed', generation: 9 }, null],
  'attaching/enabled': [{ phase: 'armed', generation: 5 }, null],
  'attaching/lost': [DETACHED, null],
  'armed/lost': [DETACHED, null],
  'attaching/detach': [{ phase: 'detaching' }, null],
  'armed/detach': [{ phase: 'detaching' }, null],
  'detaching/detached': [DETACHED, null],
  'detached/browser-detached': [DETACHED, null],
  'attaching/browser-detached': [DETACHED, { kind: 'arm-aborted' }],
  'armed/browser-detached': [DETACHED, { kind: 'interception-ended', generation: 5 }],
  'detaching/browser-detached': [DETACHED, null]
};

describe('transitionAttachment', () => {
  for (const [phase, state] of Object.entries(STATES)) {
    for (const [type, event] of Object.entries(EVENTS)) {
      const key = `${phase}/${type}`;
      const expected = ACCEPTED[key];
      it(`${key} → ${expected === undefined ? 'refused' : expected[0].phase}`, () => {
        const step = transitionAttachment(state, event);
        if (expected === undefined) expect(step).toBeNull();
        else expect(step).toEqual({ next: expected[0], effect: expected[1] });
      });
    }
  }

  it('pins the matrix size (12 accepted of 28 pairs)', () => {
    expect(Object.keys(ACCEPTED)).toHaveLength(12);
    expect(Object.keys(STATES).length * Object.keys(EVENTS).length).toBe(28);
  });
});

describe('mayRewrite', () => {
  it('holds in every phase but detaching', () => {
    expect(mayRewrite(STATES.detached)).toBe(true);
    expect(mayRewrite(STATES.attaching)).toBe(true);
    expect(mayRewrite(STATES.armed)).toBe(true);
    expect(mayRewrite(STATES.detaching)).toBe(false);
  });
});
