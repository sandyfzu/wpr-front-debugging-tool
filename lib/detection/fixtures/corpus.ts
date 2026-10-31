/**
 * The fixture corpus, single-sourced: the snapshot gate (parity ≡ reviewed
 * expectations) and the speed bench must always measure exactly these pages —
 * a fixture added in one list and missing from the other would silently
 * escape one of the two gates.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding the corpus (this file's own folder). */
export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

/** Every fixture file: real captured pages plus the crafted adversarial ones. */
export const FIXTURES = [
  // Real: wp-rocket.me (the product site's own optimization stack).
  'me-home-cached.html',
  'me-blog-alr.html',
  'me-support-cdn.html',
  'me-nowprocket.html',
  // Real: qa-suite pages (beacon + cache footer, generator without version).
  'qa-llcssbg.html',
  'qa-llbg-single-colon.html',
  'qa-llbg-double-colon.html',
  'qa-elementor-overlay.html',
  'qa-landing-page.html',
  // Real: the RocketCDN site + PageSpeed Insights shell (foreign page).
  'rocketcdn-site.html',
  'psi-shell.html',
  // Crafted integrations/adversarial cases (see the file headers).
  'synthetic-all-features.html',
  'footprint-branches.html',
  'adversarial-lazyload-classes.html',
  'adversarial-exclusion-tokens.html',
  // Real plugin pass: Delay JS on without a generator meta (served URLs).
  'delay-on-no-meta.html',
  // Crafted Priority-Elements states: pending (beacon + config), applied,
  // collecting, mixed, and the adversarial markup/degrade cases.
  'priority-elements-pending.html',
  'priority-elements-pending-no-fonts.html',
  'priority-elements-applied-oci.html',
  'priority-elements-applied-lrc.html',
  'priority-elements-applied-fonts.html',
  'priority-elements-applied-preconnect.html',
  'priority-elements-collecting-lrc.html',
  'mixed-partial-applied.html',
  'priority-elements-adversarial.html'
] as const;
