/** Pins the public support contact and the link built from it. */
import { describe, expect, it } from 'vitest';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from './contact';

describe('support contact', () => {
  it('is WP Rocket’s support mailbox', () => {
    expect(SUPPORT_EMAIL).toBe('support@wp-rocket.me');
  });

  it('opens that address and nothing else (no subject, body or second recipient)', () => {
    expect(SUPPORT_MAILTO).toBe(`mailto:${SUPPORT_EMAIL}`);
    const url = new URL(SUPPORT_MAILTO);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(SUPPORT_EMAIL);
    expect(url.search).toBe('');
  });
});
