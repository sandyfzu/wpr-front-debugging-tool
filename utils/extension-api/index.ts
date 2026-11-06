/**
 * The extension API namespace every `browser` import resolves to.
 *
 * `wxt.config.ts` aliases `@wxt-dev/browser` (behind `wxt/browser`, the
 * auto-imported `browser`, and WXT's own runtime) to this module in every
 * build, replacing a lookup a page's DOM can forge (see `./chromium`). Code
 * never imports this module: it keeps using the auto-imported `browser`, which
 * the test runner maps to its fake browser. The target browser's resolver
 * runs once, at the bundle's start; the build drops the other one. On
 * Chromium it also pins the namespace as the world's own `chrome`, for bare
 * `chrome` readers (the build evaluates this module before the messaging
 * library — see `wxt.config.ts`).
 */

import type { Browser } from 'wxt/browser';
import { chromiumExtensionApi, pinChromeNamespace } from './chromium';
import { firefoxExtensionApi } from './firefox';

/** The resolved namespace (typed as the package it replaces types it). */
export const browser = (
  import.meta.env.BROWSER === 'firefox'
    ? firefoxExtensionApi(globalThis)
    : pinChromeNamespace(globalThis, chromiumExtensionApi(globalThis))
) as typeof Browser;
