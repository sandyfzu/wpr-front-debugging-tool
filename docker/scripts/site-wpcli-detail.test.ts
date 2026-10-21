/**
 * The browser tier's wp-cli failure detail (`tests/e2e/helpers/site-wpcli.ts`):
 * a failed settings write must name the PHP fatal that caused it, even when
 * the fatal's stack trace pushes that line out of the stderr tail. (The
 * Playwright tier is excluded from this runner, so its pure helpers are
 * pinned here, next to the stack they drive.)
 */
import { describe, expect, it } from 'vitest';
import { wpCliFailureDetail } from '../../tests/e2e/helpers/site-wpcli';

/** A wp-cli fatal as the container prints it: log line, trace, display copy. */
const FATAL_STDERR = [
  '[21-Oct-2026 02:20:13 UTC] PHP Fatal error:  Uncaught Error: Undefined constant "FS_CHMOD_FILE" in /var/www/html/wp-admin/includes/class-wp-filesystem-direct.php:170',
  'Stack trace:',
  '#0 /var/www/html/wp-admin/includes/class-wp-filesystem-direct.php(70): WP_Filesystem_Direct->chmod()',
  '#29 {main}',
  '  thrown in /var/www/html/wp-admin/includes/class-wp-filesystem-direct.php on line 170',
  'Error: There has been a critical error on this website.',
  ''
].join('\n');

describe('wpCliFailureDetail', () => {
  it('leads with the fatal line a long trace pushed out of the tail', () => {
    expect(wpCliFailureDetail(FATAL_STDERR)).toBe(
      [
        '[21-Oct-2026 02:20:13 UTC] PHP Fatal error:  Uncaught Error: Undefined constant "FS_CHMOD_FILE" in /var/www/html/wp-admin/includes/class-wp-filesystem-direct.php:170',
        '#29 {main}',
        '  thrown in /var/www/html/wp-admin/includes/class-wp-filesystem-direct.php on line 170',
        'Error: There has been a critical error on this website.'
      ].join(' | ')
    );
  });

  it('never repeats a fatal line already in the tail', () => {
    expect(wpCliFailureDetail('noise\nFatal error: boom\nthrown in x.php\n')).toBe(
      'noise | Fatal error: boom | thrown in x.php'
    );
  });

  it('reports the plain tail when no fatal was printed', () => {
    expect(wpCliFailureDetail('a\nb\n\n  \nc\nd\nError: Could not update option\n')).toBe(
      'c | d | Error: Could not update option'
    );
  });

  it('reports nothing for empty stderr', () => {
    expect(wpCliFailureDetail('')).toBe('');
    expect(wpCliFailureDetail('\n \n')).toBe('');
  });
});
