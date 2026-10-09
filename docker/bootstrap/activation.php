<?php
/**
 * Local synthetic activation for the fixture site — writes the validity formula the
 * plugin verifies itself (8-char consumer key + crc32(consumer_email) secret), through
 * the plugin's own update_rocket_option() so the settings API invariants hold.
 *
 * No license server is contacted and no real credentials exist here: this is deliberately
 * local-only test data. Nothing about it is printed but a single confirmation word; the
 * values themselves live only in the site's database.
 *
 * Run: php /mnt/activation.php   (from the wp-bootstrap compose service)
 */

if ( ! defined( 'WP_USE_THEMES' ) ) {
	define( 'WP_USE_THEMES', false );
}
require '/var/www/html/wp-load.php';

// The plugin's validity function compares secret_key against crc32 of the email — the
// same primitives, computed with the same PHP functions, keep this valid across boots.
$email = 'local-fdt-fixture@127.0.0.1';
$secret = hash( 'crc32', $email );

update_rocket_option( 'consumer_email', $email );
update_rocket_option( 'consumer_key', 'fdtlocal' );
update_rocket_option( 'secret_key', $secret );

// Validate the same way the plugin does on the next request; a wrong state here is a
// boot-level bug, not a site condition to debug later.
$valid = rocket_valid_key();
if ( ! $valid ) {
	fwrite( STDERR, "activation: validity check failed after writing the local key\n" );
	exit( 1 );
}
echo "activation: wp-rocket key valid locally\n";
