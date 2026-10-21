<?php
/**
 * Edge-layer fixture: what a hosting cache or CDN in front of the site does to a response.
 *
 * Loaded from wp-config.php (the bootstrap inserts a guarded `require_once` before
 * wp-settings.php), so it runs BEFORE WordPress and before WP Rocket's advanced-cache
 * drop-in: its output buffer is the outermost one, and it applies to cached copies the
 * drop-in serves as much as to live renders. It lives in a sub-folder of the fixture
 * mount on purpose: WordPress loads only the top-level files of mu-plugins, so this file
 * is never also loaded as a must-use plugin.
 *
 * Two independent per-request flags (nothing stored, nothing to reset):
 *
 *   ?fdt-edge-strip=1          remove WP Rocket's page-cache signature comment (the normal
 *                              footer and both white-label forms) from the served HTML —
 *                              the comment-stripping a host/CDN HTML minifier performs. The
 *                              cached file on disk keeps its signature; only the response
 *                              loses it.
 *   ?fdt-edge-header=<layer>   send one hosting cache-layer header (table below), the way
 *                              the host's edge would. Headers only: the HTML is untouched.
 *
 * Both flags are listed in WP Rocket's `cache_query_strings` by the bootstrap, so every
 * flagged URL is a real optimized, cached page. Unknown values are a no-op; CLI runs (the
 * bootstrap's wp-cli shares this wp-config) never reach either branch.
 */

declare( strict_types = 1 );

const FDT_EDGE_FLAG_STRIP  = 'fdt-edge-strip';
const FDT_EDGE_FLAG_HEADER = 'fdt-edge-header';

/**
 * The hosting cache-layer headers a round can ask the edge to send.
 *
 * Values are the real vendors' wire forms: SiteGround's file cache `sg-f-cache: HIT`,
 * Cloudflare's `cf-cache-status` served (`HIT`) and not-served (`DYNAMIC`) statuses, and
 * the generic `x-proxy-cache` header many hosts' proxies send — not a vendor marker.
 *
 * @return array<string, array{0: string, 1: string}> Flag value => [header name, value].
 */
function fdt_edge_layer_headers(): array {
	return [
		'sg'         => [ 'sg-f-cache', 'HIT' ],
		'cf'         => [ 'cf-cache-status', 'HIT' ],
		'cf-dynamic' => [ 'cf-cache-status', 'DYNAMIC' ],
		'proxy'      => [ 'x-proxy-cache', 'HIT' ],
	];
}

/**
 * Read one fixture flag from the query string, or '' when absent/not a string.
 *
 * @param string $name The flag name.
 * @return string The raw value (compared against fixed vocabularies only).
 */
function fdt_edge_flag( string $name ): string {
	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses per-request fixture state only.
	$value = $_GET[ $name ] ?? '';
	return is_string( $value ) ? $value : '';
}

/**
 * Remove WP Rocket's cache signature comment(s) from a response body.
 *
 * Anchored on the plugin's own footer openings so no other comment is touched; the
 * leading newline the plugin writes before its footer goes with it.
 *
 * @param string $buffer The response body (or one chunk of it).
 * @return string The body without the signature.
 */
function fdt_edge_strip_signature( string $buffer ): string {
	$stripped = preg_replace(
		'/\n?<!-- (?:This website is like a Rocket, isn\'t it\?|Cached for great performance|Optimized for great performance).*?-->/s',
		'',
		$buffer
	);
	// A regex failure must never blank the page: serve the body unchanged.
	return null === $stripped ? $buffer : $stripped;
}

/**
 * Apply the request's edge flags: send the chosen layer header, arm the stripper.
 *
 * @return void
 */
function fdt_edge_apply(): void {
	if ( 'cli' === PHP_SAPI ) {
		return;
	}

	$layer = fdt_edge_layer_headers()[ fdt_edge_flag( FDT_EDGE_FLAG_HEADER ) ] ?? null;
	if ( null !== $layer ) {
		header( $layer[0] . ': ' . $layer[1] );
	}

	if ( '1' === fdt_edge_flag( FDT_EDGE_FLAG_STRIP ) ) {
		ob_start( 'fdt_edge_strip_signature' );
	}
}

fdt_edge_apply();
