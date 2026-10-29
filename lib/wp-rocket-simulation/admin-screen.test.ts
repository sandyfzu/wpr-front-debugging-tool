import { describe, expect, it } from 'vitest';
import { isWordPressAdminScreen } from './admin-screen';

const SITE = 'https://example.com';

describe('isWordPressAdminScreen', () => {
  it.each([
    '/wp-admin',
    '/wp-admin/',
    '/wp-admin/post.php?post=1&action=edit',
    '/blog/wp-admin/',
    '/wp/wp-admin/',
    '/WP-Admin/',
    '/wp%2Dadmin/',
    '/wp-login.php',
    '/blog/wp-login.php?action=lostpassword',
    '/wp-login.php#x',
    '/WP-LOGIN.PHP',
    // A trailing slash is path info: the server still runs the login script.
    '/wp-login.php/',
    '/blog/wp-login.php//?action=login'
  ])('%s is an admin or login screen', (path) => {
    expect(isWordPressAdminScreen(`${SITE}${path}`)).toBe(true);
  });

  it.each([
    '/wp-admin-tips/',
    '/my-wp-admin/',
    '/?redirect_to=%2Fwp-admin%2F',
    '/#/wp-admin/',
    '/wp-login.php.bak',
    '/blog/wp-login',
    '/wp-login.php/extra',
    '/wp-content/x.js',
    '/',
    '/%zz/page'
  ])('%s is not', (path) => {
    expect(isWordPressAdminScreen(`${SITE}${path}`)).toBe(false);
  });

  it('keeps a malformed escape raw instead of throwing', () => {
    expect(isWordPressAdminScreen(`${SITE}/%E0%A4%A/wp-admin/`)).toBe(true);
  });

  it('is false for an invalid URL', () => {
    expect(isWordPressAdminScreen('not a url')).toBe(false);
    expect(isWordPressAdminScreen('')).toBe(false);
  });
});
