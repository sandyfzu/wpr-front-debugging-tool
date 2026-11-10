/**
 * The host-layer hint copy: complete against the vocabulary in both
 * directions (every documented form has copy, no copy for a form the
 * vocabulary does not read), each status named in its copy, and no copy
 * claiming a WP Rocket add-on or naming SiteGround for the generic proxy.
 */
import { describe, expect, it } from 'vitest';
import { HOST_LAYER_HINTS, hostLayerHint } from './host-layer-hints';
import { HOST_LAYERS, IDENTITY_FORM } from './host-layers';

/** Every vocabulary marker with its documented forms. */
const MARKERS = HOST_LAYERS.flatMap((layer) => layer.markers);

describe('HOST_LAYER_HINTS', () => {
  it('covers exactly the vocabulary: every marker, every form', () => {
    expect(Object.keys(HOST_LAYER_HINTS).sort()).toEqual(
      MARKERS.map((marker) => marker.header).sort()
    );
    for (const marker of MARKERS) {
      expect(Object.keys(HOST_LAYER_HINTS[marker.header] ?? {}).sort(), marker.header).toEqual(
        Object.keys(marker.forms).sort()
      );
    }
  });

  it('names each status in its copy (identity and Varnish forms state theirs in words)', () => {
    for (const marker of MARKERS) {
      for (const form of Object.keys(marker.forms)) {
        const text = HOST_LAYER_HINTS[marker.header]?.[form] ?? '';
        if (form === IDENTITY_FORM) expect(text).toContain('not a cache status');
        else if (marker.header === 'x-varnish') expect(text).toContain('request id');
        else expect(text, `${marker.header} ${form}`).toContain(`(${form})`);
      }
    }
  });

  it('never claims an add-on, never calls the generic proxy SiteGround', () => {
    for (const forms of Object.values(HOST_LAYER_HINTS)) {
      for (const text of Object.values(forms)) expect(text).not.toMatch(/add-on/i);
    }
    expect(Object.values(HOST_LAYER_HINTS['x-proxy-cache'] ?? {}).join(' ')).not.toContain(
      'SiteGround'
    );
  });
});

describe('HOST_LAYER_HINTS — Varnish', () => {
  // Two ids also stand on a hit Varnish's rules passed to the backend.
  it('reads two request ids as a found object, never as a proven serve', () => {
    const hit = HOST_LAYER_HINTS['x-varnish']?.HIT ?? '';
    expect(hit).toContain('found this object in its cache');
    expect(hit).not.toContain('served this response');
  });
});

describe('hostLayerHint', () => {
  it('returns the copy for a read form, null for a form without copy', () => {
    expect(hostLayerHint('sg-f-cache', { reading: 'served', form: 'HIT' })).toBe(
      "SiteGround's file cache served this response (HIT)."
    );
    expect(hostLayerHint('sg-f-cache', { reading: 'served', form: 'STALE' })).toBeNull();
    expect(hostLayerHint('x-unknown', { reading: 'present', form: IDENTITY_FORM })).toBeNull();
  });
});
