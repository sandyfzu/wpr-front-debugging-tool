<?php
/**
 * Plugin Name: Debug fixture scenarios
 * Description: Query-flag-driven problem injection for the front-end debugging site.
 *              Designed to never require admin-UI state: every scenario is a URL flag on
 *              any page, so runs reproduce identically after every reset.
 * Version:     1.1.0
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
 * Two request-truth fixtures the side-by-side device-simulation rounds read (they echo
 * the request's own facts — per-request state, nothing stored, nothing to reset):
 *
 *   GET /wp-json/fdt/v1/ua-echo   a text endpoint echoing the request's `User-Agent`
 *                                 header (the marker line names the fixture). The site's
 *                                 compiled cache config rejects every `wp-json` request
 *                                 outright, so the echo is uncached by the plugin's own
 *                                 rule and reads the UA of exactly the request it served —
 *                                 the assert surface for what the network really carried.
 *   ?fdt-mobile-cache=1           forces WP Rocket's `do_caching_mobile_files` option on
 *                                 for the request (option-level filter). The served copy's
 *                                 `wpr_mobile`/`wpr_desktop` generator markers are the
 *                                 round's verdict on which rendering the plugin served.
 *
 * Two Priority-Elements knobs drive the beacon-matrix rounds (the beacon's `status` map
 * is what they move — same per-request pattern as the mobile-cache flag, nothing stored):
 *
 *   ?fdt-fonts-on=1               forces the opt-in `auto_preload_fonts` option on for the
 *                                 request, so the Preload-fonts factory runs with the site
 *                                 baseline (fonts off) untouched.
 *   ?fdt-oci-off=1                returns false from the `rocket_above_the_fold_optimization`
 *                                 filter for the request — the filter/helper disable path
 *                                 the plugin documents — so Optimize-critical-images never
 *                                 runs while its siblings behave normally.
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
const FIXTURE_FLAG_MOBILE_CACHE = 'fdt-mobile-cache';
const FIXTURE_FLAG_FONTS_ON = 'fdt-fonts-on';
const FIXTURE_FLAG_OCI_OFF = 'fdt-oci-off';

// The fixed external-origin hint the beacon-page fixture carries: the Preconnect factory
// needs at least one non-site hostname on the page (link/script/iframe elements only) for
// its collecting phase to produce domains, and the host must stay unreachable so the hint
// is provably inert (never fetched, never breaks the page). `.invalid` is reserved for
// exactly this and never resolves.
const FIXTURE_EXTERNAL_ORIGIN = 'http://ExampleInvalidHost.invalid:8493';

// The request-truth endpoint: its namespace/route pair plus the marker string the body
// opens with (the round pins that marker to prove the served text is this fixture's).
const FIXTURE_REST_NAMESPACE = 'fdt/v1';
const FIXTURE_REST_ECHO_ROUTE = 'ua-echo';
const FIXTURE_UA_ECHO_MARKER = 'fdt-ua-echo';

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

/**
 * The uncached request-truth endpoint: text-form echo of the request's `User-Agent`.
 *
 * Registered under this plugin's own REST namespace. WP Rocket's compiled cache config
 * rejects every `wp-json` request (`cache_reject_uri`), which keeps the echo live per
 * request — never buffered, never cached, and always reporting the UA of exactly the
 * request that fetched it, whatever session rules rewrote that header. The response is
 * deliberately plain text, not JSON: iframe document bodies for text/plain are the raw
 * bytes with no viewer markup, so a reader gets one stable assertion surface
 * (`body.textContent`). The handler also pins `no-store` + `Expires: 0` because the
 * site's expires-by-type fallback would otherwise give this one MIME type a 30-day HTTP
 * cache lifetime (see the serve filter below).
 *
 * The endpoint is read-only and carries nothing sensitive: it answers with the UA the
 * caller sent and a fixture marker, so an open permission callback is fine here.
 *
 * @return void Registers only; serving happens in the response filters below.
 */
function fixture_register_ua_echo_endpoint(): void {
	register_rest_route(
		FIXTURE_REST_NAMESPACE,
		FIXTURE_REST_ECHO_ROUTE,
		[
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => 'fixture_ua_echo_response',
		]
	);
}
add_action( 'rest_api_init', 'fixture_register_ua_echo_endpoint' );

/**
 * Serve the echo route's body as plain text, not JSON.
 *
 * WP core hardcodes every REST response `Content-Type: application/json` before the
 * response goes out, and labels it `nosniff`, so the body cannot be re-typed from the
 * response object: the one core-sanctioned override is this filter — returning true here
 * means "already served", and the server skips its own serialization entirely. Text is
 * the deliberate choice over JSON: an iframe document body for text/plain is the raw
 * bytes with no viewer markup, giving the wire rounds one stable assertion surface.
 *
 * The branch clears only this fixture's route and method — every other REST request must
 * fall through untouched (double-serving an intercepted one is refused for the same
 * reason).
 *
 * @param bool            $served  Whether the request was already served elsewhere.
 * @param mixed           $result  The response object under construction (unused here).
 * @param WP_REST_Request $request The request being served.
 * @return bool True when the echo text was served directly, false to keep core's flow.
 */
function fixture_serve_ua_echo_text( bool $served, $result, WP_REST_Request $request ): bool {
	$route = '/' . FIXTURE_REST_NAMESPACE . '/' . FIXTURE_REST_ECHO_ROUTE;
	if ( $served || $route !== $request->get_route() || 'GET' !== $request->get_method() ) {
		return false;
	}

	// The response must never be reused from an HTTP cache: the tab's requests can flip
	// UA under a session rule mid-run, and the httpd's expires defaults (an explicit
	// 30-day `ExpiresDefault` with no text/plain rule) would otherwise hand a stale
	// literal back. Declaring both here makes the fixture's "live per request" property
	// hold at the HTTP layer too.
	header( 'Cache-Control: no-store' );
	header( 'Expires: 0' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo fixture_ua_echo_response(); // phpcs:ignore WordPress.Security.EscapeOutput -- deliberate verbatim echo; text/plain is not parsed as markup.
	return true;
}
add_filter( 'rest_pre_serve_request', 'fixture_serve_ua_echo_text', 10, 3 );

/**
 * Build the echo text for one request: the marker, a stable explanation line, then the
 * request's `User-Agent` header exactly as received (missing header → an explicit
 * absent marker, never silently empty).
 *
 * @return string The text body served for the request.
 */
function fixture_ua_echo_response(): string {
	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- a deliberate verbatim echo: this endpoint's job is reporting the request's own header untouched.
	$user_agent = (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' );

	// Both the unset and the stripped-empty header read a request with no UA:
	// the echo is never silently empty, whatever the client did.
	if ( '' === $user_agent ) {
		$user_agent = '(no User-Agent header)';
	}

	$lines = [
		FIXTURE_UA_ECHO_MARKER,
		'User-Agent carried by this request:',
		(string) $user_agent,
	];

	return implode( "\n", $lines );
}

/**
 * Force WP Rocket's separate-mobile-files option on for one request.
 *
 * `?fdt-mobile-cache=1` turns `do_caching_mobile_files` on via the option-read filter —
 * the hook the plugin's own mobile-subscription integrations use, so the runtime reads
 * (`Meta.php`'s marker emission) see the forced value for exactly this request. The
 * state is per-request by construction: the flag rides the URL, nothing is written to
 * the database, and the next request without it reads the stored value again — the
 * self-resetting fixture property.
 *
 * Note the boundary this fixture reaches: WP Rocket's compiled per-host buffer config
 * ($rocket_do_caching_mobile_files, written from the stored options at config time) is
 * outside the option-read filter's reach — it keeps the site's boot-seeded state. This
 * site seeds the option on at every boot, so the flag is a no-op against the current
 * baseline; it exists so a round can still force the state after any config shift, and
 * so the fixture list owns the knob instead of the baseline.
 *
 * @return int|null 1 when the flag is present, null (pass-through) otherwise.
 */
function fixture_force_separate_mobile_cache() {
	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses per-request state only, like every fixture flag here.
	if ( ! isset( $_GET[ FIXTURE_FLAG_MOBILE_CACHE ] ) || '1' !== $_GET[ FIXTURE_FLAG_MOBILE_CACHE ] ) {
		return null;
	}

	return 1;
}
add_filter( 'pre_get_rocket_option_do_caching_mobile_files', 'fixture_force_separate_mobile_cache' );

/**
 * Force the opt-in `auto_preload_fonts` option on for one request.
 *
 * `?fdt-fonts-on=1` passes 1 through the option-read filter the Preload-fonts context
 * gates on — the same filter shape the plugin's own integrations hook — so the beacon's
 * `status.preload_fonts` moves from "omitted" (the site's default, off) to `true` while
 * the stored option stays exactly what it is. Nothing is written: the flag rides the URL
 * and the next request reads the stored value again (the self-resetting fixture property).
 *
 * @return int|null 1 when the flag asks for it, null (pass-through) otherwise.
 */
function fixture_force_auto_preload_fonts() {
	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses per-request state only, like every fixture flag here.
	if ( ! isset( $_GET[ FIXTURE_FLAG_FONTS_ON ] ) || '1' !== $_GET[ FIXTURE_FLAG_FONTS_ON ] ) {
		return null;
	}

	return 1;
}
add_filter( 'pre_get_rocket_option_auto_preload_fonts', 'fixture_force_auto_preload_fonts' );

/**
 * Return false from the critical-images (Optimize critical images) gate for one request.
 *
 * `?fdt-oci-off=1` answers the `rocket_above_the_fold_optimization` filter — the exact
 * filter/helper disable path the plugin documents for this feature — so the Optimize-
 * critical-images factory, its beacon status key, and its applied markup all turn off
 * while every sibling feature keeps its normal behavior. When the flag is absent the
 * passed-in decision is returned untouched: an absent flag must be a no-op, not a
 * typed-coercion hazard.
 *
 * @param bool $allow The decision the filter chain would otherwise produce.
 * @return bool The forced decision (false) or the passed-through one.
 */
function fixture_disable_critical_images_optimization( bool $allow ): bool {
	// phpcs:ignore WordPress.Security.NonceVerification -- flag chooses per-request state only, like every fixture flag here.
	if ( ! isset( $_GET[ FIXTURE_FLAG_OCI_OFF ] ) || '1' !== $_GET[ FIXTURE_FLAG_OCI_OFF ] ) {
		return $allow;
	}

	return false;
}
add_filter( 'rocket_above_the_fold_optimization', 'fixture_disable_critical_images_optimization' );

/**
 * Print the fixed external-origin hint the Preconnect factory collects.
 *
 * The host in {@see FIXTURE_EXTERNAL_ORIGIN} is deliberately unresolvable (the reserved
 * `.invalid` suffix), so the hint never fetches anything — it exists so the collections
 * phase has at least one external hostname to report on every page, with zero network
 * behavior attached. `rel="novelty"` is unseen by the plugin's own exclusion vocabulary
 * (it matches on `rel="preconnect"`/`rel="dns-prefetch"`/`rel="icon"`/`rel="profile"`)
 * and no browser action attaches to an unknown rel, so the element is fully inert.
 *
 * @return void
 */
function fixture_print_external_origin_hint(): void {
	echo '<link rel="novelty" href="' . esc_url( FIXTURE_EXTERNAL_ORIGIN . '/wp-includes/empty.txt' ) . '">';
}
add_action( 'wp_head', 'fixture_print_external_origin_hint', 5 );
