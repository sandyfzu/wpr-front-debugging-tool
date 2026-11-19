/**
 * The capture's raw-text repair: the exact inverse of XML text escaping on
 * HTML raw-text elements only, proven on real `XMLSerializer` round trips.
 */
import { describe, expect, it } from 'vitest';
import { restoreRawText, unescapeXmlText } from './snapshot-text';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * A re-parsed snapshot as a real browser yields it: raw-text elements hold
 * the serializer's escaped text verbatim (happy-dom's serializer does not
 * escape, so the escaped state is written directly; the real round trip is
 * proven by the browser tier).
 *
 * @param texts Per raw-text tag, the escaped text the re-parse keeps.
 * @returns The snapshot document.
 */
function snapshotWith(texts: readonly (readonly [tag: string, text: string])[]): Document {
  const snapshot = document.implementation.createHTMLDocument('');
  for (const [tag, text] of texts) {
    const element = snapshot.createElement(tag);
    element.textContent = text;
    snapshot.body.append(element);
  }
  return snapshot;
}

describe('unescapeXmlText', () => {
  it('restores the three escapes XML text serialization writes', () => {
    expect(unescapeXmlText('a &gt; b &amp;&amp; c &lt; d')).toBe('a > b && c < d');
  });

  it('decodes one level only: an escaped escape is the page’s own entity text', () => {
    expect(unescapeXmlText('"&amp;lt;" &amp;amp; &amp;gt;')).toBe('"&lt;" &amp; &gt;');
  });

  it('leaves every other entity-shaped text alone', () => {
    expect(unescapeXmlText('&nbsp; &quot; &#60; &ltx; &amp')).toBe(
      '&nbsp; &quot; &#60; &ltx; &amp'
    );
  });

  it('returns the very string when there is nothing to decode', () => {
    const text = 'body{margin:0}';
    expect(unescapeXmlText(text)).toBe(text);
    expect(unescapeXmlText('')).toBe('');
  });
});

describe('restoreRawText', () => {
  it('makes inline script and style text the page’s own text', () => {
    const snapshot = snapshotWith([
      ['style', 'a&gt;b{content:"&amp;amp;"}'],
      ['script', 'var x = a &gt; b &amp;&amp; c &lt; d; var e = "&amp;lt;";']
    ]);
    expect(restoreRawText(snapshot)).toBe(2);
    expect(snapshot.querySelector('script')?.textContent).toBe(
      'var x = a > b && c < d; var e = "&lt;";'
    );
    expect(snapshot.querySelector('style')?.textContent).toBe('a>b{content:"&amp;"}');
  });

  it('keeps element identity, so lists collected before the repair stay valid', () => {
    const snapshot = snapshotWith([['script', 'a &amp;&amp; b']]);
    const script = snapshot.querySelector('script');
    restoreRawText(snapshot);
    expect(snapshot.querySelector('script')).toBe(script);
    expect(script?.textContent).toBe('a && b');
  });

  it('never decodes SVG content twice (foreign content already decoded its text)', () => {
    const snapshot = snapshotWith([]);
    const svg = snapshot.createElementNS(SVG, 'svg');
    const style = snapshot.createElementNS(SVG, 'style');
    const script = snapshot.createElementNS(SVG, 'script');
    // The page's own text, entity-shaped: a second decode would corrupt it.
    style.textContent = 'q > r &lt;';
    script.textContent = 'a &amp;&amp; b';
    svg.append(style, script);
    snapshot.body.append(svg);
    expect(restoreRawText(snapshot)).toBe(0);
    expect(style.textContent).toBe('q > r &lt;');
    expect(script.textContent).toBe('a &amp;&amp; b');
  });

  it('leaves ordinary text and attributes alone (the HTML parser decoded them)', () => {
    const snapshot = snapshotWith([['p', 'x &lt; y']]);
    snapshot.querySelector('p')?.setAttribute('title', 'a&amp;b');
    expect(restoreRawText(snapshot)).toBe(0);
    expect(snapshot.querySelector('p')?.textContent).toBe('x &lt; y');
    expect(snapshot.querySelector('p')?.getAttribute('title')).toBe('a&amp;b');
  });

  it('restores every raw-text element kind and skips untouched ones', () => {
    const snapshot = snapshotWith([
      ['xmp', 'a&lt;b'],
      ['noembed', 'c&gt;d'],
      ['noframes', 'e&amp;f'],
      ['iframe', 'g&lt;h'],
      ['style', 'plain{}']
    ]);
    expect(restoreRawText(snapshot)).toBe(4);
    expect(snapshot.querySelector<HTMLElement>('xmp')?.textContent).toBe('a<b');
    expect(snapshot.querySelector<HTMLElement>('noembed')?.textContent).toBe('c>d');
    expect(snapshot.querySelector<HTMLElement>('noframes')?.textContent).toBe('e&f');
    expect(snapshot.querySelector('iframe')?.textContent).toBe('g<h');
    expect(snapshot.querySelector('style')?.textContent).toBe('plain{}');
  });

  it('handles empty raw-text elements and a document without any', () => {
    expect(
      restoreRawText(
        snapshotWith([
          ['script', ''],
          ['style', '']
        ])
      )
    ).toBe(0);
    expect(restoreRawText(snapshotWith([]))).toBe(0);
  });
});
