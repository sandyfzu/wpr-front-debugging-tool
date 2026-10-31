import { describe, expect, it } from 'vitest';
import { decodeAttributeValue } from './html-attribute-value';

describe('decodeAttributeValue', () => {
  it('returns text without references as is', () => {
    expect(decodeAttributeValue("script-src 'self'")).toBe("script-src 'self'");
  });

  it('decodes decimal and hex references, with or without the semicolon', () => {
    expect(decodeAttributeValue('&#39;self&#039; &#x27;none&#X27')).toBe("'self' 'none'");
  });

  it('decodes every ASCII-expanding named reference with its semicolon', () => {
    expect(decodeAttributeValue('&amp;&lt;&gt;&quot;&apos;&AMP;&LT;&GT;&QUOT;')).toBe('&<>"\'&<>"');
    expect(decodeAttributeValue('&Tab;&NewLine;&semi;&comma;&colon;&equals;&fjlig;')).toBe(
      '\t\n;,:=fj'
    );
    // Nonce characters spelled as references.
    expect(decodeAttributeValue('N&plus;0&sol;x&lowbar;&equals;')).toBe('N+0/x_=');
  });

  it('decodes a legacy name without its semicolon unless `=` follows it', () => {
    expect(decodeAttributeValue('a&amp b&LT')).toBe('a& b<');
    expect(decodeAttributeValue('?x=1&amp=2')).toBe('?x=1&amp=2');
  });

  it('is unreadable when any other named reference (or alphanumeric run) follows `&`', () => {
    expect(decodeAttributeValue('a&nbsp;b')).toBeNull();
    expect(decodeAttributeValue('&apos')).toBeNull();
    expect(decodeAttributeValue('&ampx')).toBeNull();
    expect(decodeAttributeValue('&#39;self&#39;&copy;')).toBeNull();
    expect(decodeAttributeValue('?a=1&b=2')).toBeNull();
  });

  it('keeps a lone `&` and malformed numeric references as text', () => {
    expect(decodeAttributeValue('a & b &; &# &#x; &#xg')).toBe('a & b &; &# &#x; &#xg');
  });

  it('reads NUL, surrogates and out-of-range code points as U+FFFD', () => {
    expect(decodeAttributeValue('&#0;&#xD800;&#x110000;&#99999999999999999999;')).toBe(
      '�'.repeat(4)
    );
    expect(decodeAttributeValue('&#x1F600;')).toBe('😀');
  });
});
