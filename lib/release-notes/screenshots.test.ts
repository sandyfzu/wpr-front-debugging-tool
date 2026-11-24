/**
 * Screenshot resolution: the palette's bundled file under the extension
 * root, with the row's alt text and fixed size; nothing for an unknown or
 * absent id (a text-only card, never a broken image).
 */
import { describe, expect, it } from 'vitest';
import {
  RELEASE_SCREENSHOTS,
  resolveScreenshot,
  screenshotPath,
  type ScreenshotMeta
} from './screenshots';

const TABLE: Readonly<Record<string, ScreenshotMeta>> = {
  palette: { alt: 'The command palette over a page', width: 800, height: 450, format: 'webp' }
};

describe('screenshotPath', () => {
  it('names the palette file under the page folder', () => {
    expect(screenshotPath('palette', 'dark', 'webp')).toBe('whats-new/palette-dark.webp');
    expect(screenshotPath('palette', 'light', 'png')).toBe('whats-new/palette-light.png');
  });
});

describe('resolveScreenshot', () => {
  it('serves the palette on screen, with its metadata', () => {
    expect(resolveScreenshot('palette', 'light', TABLE)).toEqual({
      ...TABLE['palette'],
      src: '/whats-new/palette-light.webp'
    });
    expect(resolveScreenshot('palette', 'dark', TABLE)?.src).toBe('/whats-new/palette-dark.webp');
  });

  it('resolves nothing for an absent, unknown or inherited id', () => {
    expect(resolveScreenshot(undefined, 'light', TABLE)).toBeNull();
    expect(resolveScreenshot('missing', 'light', TABLE)).toBeNull();
    expect(resolveScreenshot('toString', 'light', TABLE)).toBeNull();
  });

  it('defaults to the bundled table', () => {
    expect(resolveScreenshot('command-palette', 'dark')).toEqual({
      ...RELEASE_SCREENSHOTS['command-palette'],
      src: '/whats-new/command-palette-dark.webp'
    });
    expect(resolveScreenshot('palette', 'light')).toBeNull();
  });
});
