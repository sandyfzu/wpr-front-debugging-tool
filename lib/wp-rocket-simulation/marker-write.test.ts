import { describe, expect, it } from 'vitest';
import { writeBuilderMarker } from '../exclusion-builder/builder-marker-write';
import { writeSimulationMarker } from './marker-write';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER_ID = 'ffffffffffffffffffffffffffffffff';

/** The marker element the step writes for `id`. */
function marker(id: string = ID): string {
  return `<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=${id}">`;
}

/** A page with `head` markup inside `<head>` and `body` inside `<body>`. */
function page(head: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;
}

describe('writeSimulationMarker', () => {
  it('appends one marker at the end of <head> on a simulated page', () => {
    expect(writeSimulationMarker(page('', '<p>x</p>'), ID, ['delay_js'])).toEqual({
      html: page(marker(), '<p>x</p>'),
      written: true
    });
  });

  it('lands after the builder marker (the builder step runs first)', () => {
    const built = writeBuilderMarker(page('', ''), { lazyload: { excluded: 2 } });
    const out = writeSimulationMarker(built, ID, ['delay_js']);
    expect(out.html).toBe(
      page(
        `<meta name="wpr-fdt-exclusion-builder" content="v1 lazyload=excluded:2">${marker()}`,
        ''
      )
    );
  });

  it('writes nothing without an id or without a simulated feature', () => {
    const html = page('', '');
    expect(writeSimulationMarker(html, undefined, ['delay_js'])).toEqual({ html, written: false });
    expect(writeSimulationMarker(html, ID, [])).toEqual({ html, written: false });
  });

  it('writes nothing for an id the grammar cannot state', () => {
    const html = page('', '');
    expect(writeSimulationMarker(html, 'ABCDEF', ['delay_js'])).toEqual({ html, written: false });
  });

  it('removes every served copy — head, body, spelled with references — before writing', () => {
    const served = page(
      marker(OTHER_ID),
      `<meta name="wpr-fdt-simulation" content="v1"><meta name="wpr-fdt&#45;simulation" content="x">`
    );
    expect(writeSimulationMarker(served, ID, ['delay_js']).html).toBe(page(marker(), ''));
    expect(writeSimulationMarker(served, undefined, []).html).toBe(page('', ''));
  });

  it('keeps metas whose name only resembles the marker', () => {
    const kept =
      '<meta name="wpr-fdt-simulations" content="a"><meta name="WPR-FDT-SIMULATION" content="b"><meta property="wpr-fdt-simulation" content="c">';
    expect(writeSimulationMarker(page(kept, ''), undefined, []).html).toBe(page(kept, ''));
  });

  it('is idempotent for a given id', () => {
    const once = writeSimulationMarker(page('', ''), ID, ['delay_js']).html;
    expect(writeSimulationMarker(once, ID, ['delay_js']).html).toBe(once);
  });

  it('closes an unclosed head at <body>', () => {
    const html = '<html><head><title>t</title><body><p>x</p></body></html>';
    expect(writeSimulationMarker(html, ID, ['delay_js']).html).toBe(
      `<html><head><title>t</title>${marker()}<body><p>x</p></body></html>`
    );
  });

  it('appends at the end of a document that spells neither </head> nor <body>', () => {
    const html = '<title>t</title><p>x</p>';
    expect(writeSimulationMarker(html, ID, ['delay_js'])).toEqual({
      html: `${html}${marker()}`,
      written: true
    });
  });

  it('never reads a </head> inside raw text as the end of the head', () => {
    const html = page('<noscript></head></noscript>', '');
    const out = writeSimulationMarker(html, ID, ['delay_js']).html;
    expect(out).toBe(page(`<noscript></head></noscript>${marker()}`, ''));
  });
});
