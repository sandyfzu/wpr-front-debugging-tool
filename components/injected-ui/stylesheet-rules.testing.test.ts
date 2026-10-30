import { describe, expect, it } from 'vitest';

import { declaredValue } from './stylesheet-rules.testing';

const CSS = `
/* .a { overflow: scroll; } — commented out, never read */
.a {
  /* overflow: auto; */
  overflow: hidden;
  overflow: clip;
  overflow-y: auto;
}

.a .b {
  position: relative;
}
`;

describe('declaredValue', () => {
  it('reads the last declaration of a property, comments ignored', () => {
    expect(declaredValue(CSS, '.a', 'overflow')).toBe('clip');
  });

  it('never matches a longer property by its prefix', () => {
    expect(declaredValue(CSS, '.a', 'overflow-y')).toBe('auto');
    expect(declaredValue(CSS, '.a', 'y')).toBeUndefined();
  });

  it('reads only the exact top-level selector', () => {
    expect(declaredValue(CSS, '.a', 'position')).toBeUndefined();
  });

  it('answers undefined for a property the rule does not set', () => {
    expect(declaredValue(CSS, '.a', 'z-index')).toBeUndefined();
  });

  it('throws on a rule the stylesheet lacks, naming it', () => {
    expect(() => declaredValue(CSS, '.missing', 'overflow')).toThrow(
      'stylesheet has no top-level ".missing" rule'
    );
  });
});
