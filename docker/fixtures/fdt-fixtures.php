<?php
/**
 * Plugin Name: Debug fixture scenarios
 * Description: Query-flag-driven problem injection for the front-end debugging site.
 *              Designed to never require admin-UI state: every scenario is a URL flag on
 *              any page, so runs reproduce identically after every reset.
 * Version:     1.0.0
 *
 * This must-use plugin injects the deterministic problems the debugging tool exists to
 * catch. It acts only on request data at render time: no options, no database writes, no
 * scheduled tasks — nothing to configure or reset between runs. The scenarios it serves
 * (one URL flag each, combinable on the same page):
 *
 *   ?fdt-error=reference    immediate `ReferenceError: X is not defined` at load
 *   ?fdt-error=reading      immediate `TypeError: Cannot read properties of undefined (reading 'X')` at load
 *   ?fdt-error=notfunction  immediate `TypeError: X is not a function` at load
 *   ?fdt-delay=1            two scripts handed to WP Rocket's Delay JS queue (the
 *                           delayed-execution reproduction: one throws exactly when the
 *                           delay queue runs; one completes benignly and tags its script
 *                           element `data-fdt-delay="executed"`)
 *
 * The `fdt-error` scripts stay out of WP Rocket's Delay/Defer handling via this plugin's
 * own exclusion filters below, so those errors fire at load time with no interaction; the
 * `fdt-delay` scripts stay in the delay queue so Delay JS exercises them. Unknown flag
 * values and flags on non-front-end requests are ignored outright: this is a front-end
 * render-time fixture and must never alter any other surface.
 */

declare( strict_types = 1 );

// Scenario flag names. The fixture assets live next to this plugin (the whole
// wp-content/mu-plugins tree in the compose stack comes from the fixture folder), so the
// URLs are built from this file's own location.
const FIXTURE_FLAG_ERROR = 'fdt-error';
const FIXTURE_FLAG_DELAY = 'fdt-delay';

/**
 * Map the `fdt-error` flag value to the asset that produces that exact error class.
 *
 * The asset stems double as the Delay/Defer exclusion patterns (matched as regexes over
 * the script markup by WP Rocket, without the `.js` suffix so the match also holds if the
 * minification pipeline renames the file to a `-<hash>` variant).
 *
 * @return array<string, string> Flag value => asset filename stem.
 */
function fixture_error_assets(): array {
	return [
		'reference'   => 'fdt-error-reference',
		'reading'     => 'fdt-error-reading',
		'notfunction' => 'fdt-error-notfunction',
	];
}

/**
 * The two assets handed to WP Rocket's Delay JS queue by `?fdt-delay=1`.
 *
 * @return string[] Asset filename stems, in enqueue (delay-execution) order.
 */
function fixture_delay_assets(): array {
	return [
		'fdt-delayed-reference', // throws the ReferenceError exactly when Delay JS runs it
		'fdt-delayed-lifecycle', // completes benignly: sets fdtDelayExecutedAt marker
	];
}

/**
 * Enqueue the scenario scripts the current URL's flags select, footer-only.
 *
 * Footer placement is deliberate: the not-a-function fixture dereferences
 * `document.body`, so scripts always run where the body element exists; the other
 * fixtures need no DOM but inherit the same deterministic ordering. Flag values outside
 * the known vocabulary enqueue nothing — a typo'd flag must keep the page clean rather
 * than fail half-open.
 */
function fixture_enqueue_scenario_scripts(): void {
	$base_url = untrailingslashit( plugin_dir_url( __FILE__ ) ) . '/assets';

	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses a bundled fixture asset only
	$flag = isset( $_GET[ FIXTURE_FLAG_ERROR ] ) && is_string( $_GET[ FIXTURE_FLAG_ERROR ] )
		? sanitize_key( wp_unslash( $_GET[ FIXTURE_FLAG_ERROR ] ) )
		: '';
	if ( array_key_exists( $flag, fixture_error_assets() ) ) {
		$stem = fixture_error_assets()[ $flag ];
		wp_enqueue_script( $stem, $base_url . '/' . $stem . '.js', [], null, true );
	}

	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses a bundled fixture asset only
	if ( isset( $_GET[ FIXTURE_FLAG_DELAY ] ) && '1' === $_GET[ FIXTURE_FLAG_DELAY ] ) {
		foreach ( fixture_delay_assets() as $stem ) {
			wp_enqueue_script( $stem, $base_url . '/' . $stem . '.js', [], null, true );
		}
	}
}
add_action( 'wp_enqueue_scripts', 'fixture_enqueue_scenario_scripts' );

/**
 * Keep the immediate-error fixtures out of WP Rocket's Delay JS queue.
 *
 * The exclusion patterns are regex stems (matched over the full script markup by
 * WP Rocket), so both the plain asset URL and any minified/renamed variant that keeps the
 * stem still match. The `?fdt-delay=1` scripts are deliberately absent from this list:
 * the error produced exactly when the delay queue runs them IS their fixture.
 *
 * @param string[] $excluded Patterns WP Rocket will not delay.
 * @return string[] The list plus this fixture's immediate-error stems.
 */
function fixture_exclude_immediate_errors_from_delay( array $excluded ): array {
	return array_merge( $excluded, array_values( fixture_error_assets() ) );
}
add_filter( 'rocket_delay_js_exclusions', 'fixture_exclude_immediate_errors_from_delay' );

/**
 * Keep the immediate-error fixtures out of WP Rocket's Defer JS handling too.
 *
 * Without this they could pick up `data-rocket-defer` + deferred execution, which still
 * fires at load — but keeping them plain makes their failure time exact and independent
 * of the Defer/Delay pipeline mix this site runs as its baseline.
 *
 * @param string[] $excluded Patterns WP Rocket will not defer.
 * @return string[] The list plus this fixture's immediate-error stems.
 */
function fixture_exclude_immediate_errors_from_defer( array $excluded ): array {
	return array_merge( $excluded, array_values( fixture_error_assets() ) );
}
add_filter( 'rocket_exclude_defer_js', 'fixture_exclude_immediate_errors_from_defer' );
