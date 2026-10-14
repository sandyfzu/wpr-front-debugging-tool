#!/usr/bin/env bash
# One-shot, idempotent site provisioning for the local WordPress debugging stack.
#
# Runs as the compose `wp-bootstrap` service on every boot. Goals:
#   - every boot converges to the SAME site state (an `up` after a `reset` needs zero
#     admin hand work),
#   - credentials flow in through compose environment and never get echoed or logged,
#   - failures name the offending step and stop the bootstrap (partial provisioning
#     would silently diverge future fixture runs).
#
# Provided by docker-compose.yml environment:
#   WORDPRESS_DB_HOST/NAME/USER/PASSWORD      db connection (also used by the WP image's
#                                             own wp-config bootstrap)
#   WPR_FDT_SITE_URL                          absolute site URL to install/force
#   WPR_FDT_ADMIN_USER/_PASSWORD/_EMAIL       wp-admin account settings
#   WPR_FDT_EXPECTED_WPR_VERSION              pin the installed WP Rocket must match
#
# Mounted by docker-compose.yml:
#   /var/www/html       the WP core + wp-content volume (shared with the site container)
#   /mnt/wpr/           directory containing the apvm-built wpr-rocket.zip
#   /mnt/conflicts.txt  the committed free conflict-plugin slug list
#   /mnt/bootstrap.sh   this script
set -Eeuo pipefail

WP_PATH=/var/www/html
WPR_ZIP=/mnt/wpr/wpr-rocket.zip
CONFLICTS_LIST=/mnt/conflicts.txt
# First boot pulls 60+ conflict plugins; later boots converge in seconds.
CORE_WAIT_TIMEOUT=900

step() { printf 'bootstrap: %s\n' "$1"; }
die() { printf 'bootstrap: FAILED in %s: %s\n' "$1" "$2" >&2; exit 1; }

run_wp() {
	# wp-cli runner — every call targets the shared WP path; this is the only place
	# the path root is written, so container layout changes stay one-line edits.
	wp --path="$WP_PATH" "$@"
}

# Wait until the site container's core files exist: the WordPress image entrypoint
# populates /var/www/html (and writes wp-config.php from env) before anything here can
# work, and it races this script's own start.
step "wait for WordPress core files (image entrypoint init)"
elapsed=0
until [ -f "$WP_PATH/wp-settings.php" ] && [ -f "$WP_PATH/wp-config.php" ]; do
	if [ "$elapsed" -ge "$CORE_WAIT_TIMEOUT" ]; then
		die "wait_core" "core files absent after ${CORE_WAIT_TIMEOUT}s — is the wordpress service healthy?"
	fi
	sleep 2
	elapsed=$((elapsed + 2))
done

# DB reachability, before any wp-cli write. `wp db check` exercises WP's own connection
# (mysqli), the same path the install and all later steps will take.
step "wait for database"
elapsed=0
until run_wp db check --quiet >/dev/null 2>&1; do
	if [ "$elapsed" -ge "$CORE_WAIT_TIMEOUT" ]; then
		die "wait_db" "database unreachable after ${CORE_WAIT_TIMEOUT}s — check db service health"
	fi
	sleep 2
	elapsed=$((elapsed + 2))
done

# Site install (first boot only — every later boot finds it installed and moves on).
if run_wp core is-installed >/dev/null 2>&1; then
	step "core: already installed"
else
	step "core: installing WP at the configured site URL"
	: "${WPR_FDT_SITE_URL:?core install needs WPR_FDT_SITE_URL}"
	: "${WPR_FDT_ADMIN_USER:?core install needs WPR_FDT_ADMIN_USER}"
	: "${WPR_FDT_ADMIN_PASSWORD:?core install needs WPR_FDT_ADMIN_PASSWORD}"
	: "${WPR_FDT_ADMIN_EMAIL:?core install needs WPR_FDT_ADMIN_EMAIL}"
	if ! wp --path="$WP_PATH" core install \
			--url="$WPR_FDT_SITE_URL" \
			--title='Local debug fixtures' \
			--admin_user="$WPR_FDT_ADMIN_USER" \
			--admin_password="$WPR_FDT_ADMIN_PASSWORD" \
			--admin_email="$WPR_FDT_ADMIN_EMAIL" \
			--skip-email >/dev/null 2>&1; then
		die "core install" "wp-cli returned failure — inspect with: docker compose logs wp-bootstrap; the wp-admin credentials live in docker/.env"
	fi
fi

# Force the site URL to match the configured port on every boot, so changing the port in
# .env reduces to a normal reset instead of a broken reference.
step "site: url pinned to configured value"
run_wp option update siteurl "$WPR_FDT_SITE_URL" >/dev/null
run_wp option update home "$WPR_FDT_SITE_URL" >/dev/null

# Pretty permalinks (/fdt/ etc). Plain permalinks make every non-home URL a 404 and the
# cache buffer silently declines those (verified first-hand: only / ever cached). Set on
# every boot so the URL table is a known quantity; the changed-event path regenerates
# WP Rocket's per-host config file on the spot (also requested below), which is what
# carries the permalink-structure state the cache buffer reads.
step "site: permalink structure pinned to /%postname%/"
run_wp rewrite structure '/%postname%/' >/dev/null
run_wp rewrite flush >/dev/null

# WP Rocket from the apvm-built zip (never committed; see docs/local-site-runbook.md).
[ -f "$WPR_ZIP" ] || die "wpr_install" "missing $WPR_ZIP — build it first: apvm build wp-rocket tag:latest-stable <output-dir> (see docs/local-site-runbook.md)"
if run_wp plugin is-installed wp-rocket >/dev/null 2>&1; then
	step "wp-rocket: installed; ensuring active"
	run_wp plugin activate wp-rocket >/dev/null
else
	step "wp-rocket: installing from the apvm-built zip"
	run_wp plugin install "$WPR_ZIP" --activate >/dev/null
fi

# WordPress config constants the caching/licence stack needs and the image template
# never sets:
#   WP_CACHE          loads WP Rocket's advanced-cache.php drop-in: without it the page
#                     cache silently writes nothing (observed first-hand on this stack)
#   WP_ROCKET_DEBUG   enables the plugin's own debug log under wp-rocket-config/, the
#                     observable evidence trail for every fixture verdict
#   WP_ROCKET_KEY /
#   WP_ROCKET_EMAIL   the plugin's own local licence-override channel (what its
#                     licence-data.php shim documents): their empty-string defaults
#                     shadow the database fields in Options_Data::get(), so without
#                     these defines a synthetic local key can never validate
# Idempotent insert right before the final wp-settings.php include; a template that no
# longer matches the anchor fails the boot with the actionable pointer, silently
# missing constants never do.
if ! grep -q "define( 'WP_ROCKET_KEY'" "$WP_PATH/wp-config.php" 2>/dev/null; then
	# The official image template ends wp-config with the ABSPATH guard; insert above it.
	if ! sed -i "s|if ( ! defined( .ABSPATH. ) ) {|if ( ! defined( 'WP_CACHE' ) ) {\n\tdefine( 'WP_CACHE', true );\n}\nif ( ! defined( 'WP_ROCKET_DEBUG' ) ) {\n\tdefine( 'WP_ROCKET_DEBUG', true );\n}\nif ( ! defined( 'WP_ROCKET_KEY' ) ) {\n\tdefine( 'WP_ROCKET_KEY', 'fdtlocal' );\n}\nif ( ! defined( 'WP_ROCKET_EMAIL' ) ) {\n\tdefine( 'WP_ROCKET_EMAIL', 'local-fdt-fixture@127.0.0.1' );\n}\nif ( ! defined( 'ABSPATH' ) ) {|" "$WP_PATH/wp-config.php" 2>/dev/null; then
		die "wp_config" "could not edit wp-config.php — is it writable (uid 33)?"
	fi
fi
grep -q "define( 'WP_CACHE', true );" "$WP_PATH/wp-config.php" || die "wp_config" "WP_CACHE define missing after edit — the image template changed; update docker/bootstrap/bootstrap.sh"
grep -q "define( 'WP_ROCKET_KEY', 'fdtlocal' );" "$WP_PATH/wp-config.php" || die "wp_config" "WP_ROCKET_KEY define missing after edit — the image template changed; update docker/bootstrap/bootstrap.sh"

# Build pin: the installed plugin version must match the environment pin. A zip built
# from an older/newer tag than the recorded pin means the fixture baselines are no
# longer those this repo was tuned against — fail boot, name the fix.
installed_version="$(run_wp plugin get wp-rocket --field=version 2>/dev/null || true)"
if [ "$installed_version" != "$WPR_FDT_EXPECTED_WPR_VERSION" ]; then
	die "wpr_pin" "installed wp-rocket ${installed_version:-unknown} != expected ${WPR_FDT_EXPECTED_WPR_VERSION} — rebuild with apvm and update WPR_FDT_EXPECTED_WPR_VERSION (docker/.env + docker/.env.example)"
fi
step "wp-rocket: version pin verified (${installed_version})"

# Local synthetic activation. WP Rocket's front-end optimization subscribers (minify,
# delay, defer, lazyload buffers) register ONLY when rocket_valid_key() finds the
# plugin's own local validity formula true: consumer_key of exactly eight characters
# AND secret_key equal to crc32 of consumer_email (verified in the 3.23.5.1 source).
# No license server, no real credentials: this fixture site is license-free by design
# and the values below are synthetic local-only test data, never logged anywhere.
# Without them the site caches pages but never optimizes any (observed first-hand).
step "wp-rocket: applying the local synthetic activation key"
php /mnt/activation.php || die "wpr_activation" "synthetic key application failed (exit $?) — see the activation message above"

# Seed WP Rocket's settings the way a first admin visit would. The plugin writes its
# defaults only from admin page context; wp-cli activation alone does not (is_admin() is
# false under wp-cli — verified against the bundled WP-CLI 2.12.0). Seeding here keeps
# the site's state formed BEFORE any suite visit, with zero admin hand work.
step "wp-rocket: seeding settings via one admin hit"
php /mnt/seed-settings.php || die "wpr_seed" "settings seeding failed (exit $?) — see the seed message above"

# Baseline optimization settings, re-applied on EVERY boot so no run can drift from the
# baselines the fixture scenarios assume:
#   page cache + separate mobile cache   the fixtures run inside a real cache stack
#   lazyload                             data-lazy-src images (lazyload-detection base)
#   defer_all_js                         data-rocket-defer / Defer JS fixtures
#   delay_js                             the delay-queue fixtures (?fdt-delay=1)
#   minify_css / minify_js               /wp-content/cache/min/ asset markers
#   remove_unused_css                    the RUCSS gate (wpr-usedcss + beacon surface)
#   cache_query_strings = [fdt-error, fdt-delay,
#                          fdt-fonts-on, fdt-oci-off,
#                          fdt-wpr-versionless]
#                                        the scenario FLAGS themselves become cached
#                                        URLs: the buffer pipeline only processes
#                                        parameters from this option (verified in the
#                                        3.23.5.1 source), so without them every query-
#                                        string fixture URL would serve unoptimized
#                                        HTML and the flagged scenarios would not run.
#                                        The two Priority-Elements knobs are here for
#                                        the same reason: a beacon-matrix round needs
#                                        the forced state inside an optimized cached
#                                        copy, not on the unprocessed fallback. The
#                                        versionless flag rides the same bus: its
#                                        filter arm acts inside the buffer pipeline,
#                                        so an unprocessed URL would show plain WP
#                                        output and never answer the versionless
#                                        question the fixture exists for.
# Everything else keeps the plugin's own defaults — the exclusion lists in particular
# stay at their untouched defaults so the delay queue mirrors a real site's baseline.
# NOTE: `cache` is not a settings key: page caching is unconditional in WP Rocket
# (verified in the 3.23.5.1 defaults), so there is nothing to force about it.
# NOTE: `remove_unused_css` (and `async_css`) are forced here at the option-row level,
# but 3.23.5.1's license check masks their RUNTIME reads to 0 (License/Renewal "expired
# >15 days" gate hooks the option read at PHP_INT_MAX; a synthetic local key has no
# expiration, so it always reads as expired). RUCSS/Async-CSS therefore never engage on
# this site by plugin design — see the runbook's baseline table and 05c's record.
step "wp-rocket: applying baseline settings"
for key in cache_mobile do_caching_mobile_files minify_css minify_js lazyload defer_all_js delay_js remove_unused_css; do
	run_wp option patch update wp_rocket_settings "$key" 1 >/dev/null
done
run_wp option patch update wp_rocket_settings cache_query_strings '["fdt-error", "fdt-delay", "fdt-fonts-on", "fdt-oci-off", "fdt-wpr-versionless"]' --format=json >/dev/null

# Re-publish WP Rocket's per-host config file (the drop-in reads its state from there):
# permalink + cached-query-string state must land in it before any page is served.
step "wp-rocket: regenerating site config file"
run_wp eval 'do_action( "permalink_structure_changed" );' >/dev/null

# Fixture pages: created exactly once (by slug), content is a fixed string — no admin
# state anywhere. Scenarios attach via URL flags, so page bodies stay deterministic.
step "pages: ensuring fixture pages"
ensure_page() {
	# $1 slug, $2 title, $3 content
	if [ -n "$(run_wp post list --post_type=page --name="$1" --field=ID 2>/dev/null)" ]; then
		return
	fi
	run_wp post create --post_type=page --post_status=publish --post_name="$1" --post_title="$2" --post_content="$3" >/dev/null
}
LCP_IMG="/wp-content/mu-plugins/assets/fdt-lcp.png"
ensure_page fdt 'Debug fixture hub' "<h1>Debug fixture hub</h1>
<p>This local site hosts the deterministic worst cases a front-end debugging tool has to catch. Scenarios attach to any page through URL flags and need no site configuration:</p>
<ul>
<li><a href=\"/fdt/?fdt-error=reference\">?fdt-error=reference</a> — ReferenceError at load</li>
<li><a href=\"/fdt/?fdt-error=reading\">?fdt-error=reading</a> — reading of undefined at load</li>
<li><a href=\"/fdt/?fdt-error=notfunction\">?fdt-error=notfunction</a> — not a function at load</li>
<li><a href=\"/fdt/?fdt-delay=1\">?fdt-delay=1</a> — Delay JS queue (interact with the page to run it)</li>
</ul>
<p>The image below is an in-page LCP candidate for Lazyload and critical-image runs.</p>
<img src=\"/wp-content/mu-plugins/assets/fdt-lcp.png\" alt=\"Independent LCP candidate\" width=\"320\" height=\"180\">
<p>Pages here are cached like any real site; a cache purge never changes scenario behavior because fixtures are code, not admin state.</p>"
ensure_page fdt-beacon 'Beacon fixture page' "<h1>Beacon fixture page</h1>
<p>Content-rich page used by beacon-based runs: several paragraphs, headings, an image and internal links so the used-CSS and critical-image beacons have honest work.</p>
<h2>Section one</h2><p>Paragraph one of the beacon page. Performance observers need renderable text above the fold and links below it to exercise preloading.</p>
<h2>Section two</h2><p>Paragraph two of the beacon page. The same fixture image reappears here so Lazyload and critical-image states are checkable on one page.</p>
<img src=\"$LCP_IMG\" alt=\"Second LCP candidate instance\" width=\"320\" height=\"180\">
<p><a href=\"/fdt/\">Back to the fixture hub</a>.</p>"

# Free conflict plugins (derived from the committed Known-Conflicts DB; see
# docker/scripts/derive-conflicts.sh). Installed inactive: a plugin row on plugins.php
# is enough for the known-conflicts scan to match names, while inactive plugins cannot
# alter front-end fixture behavior.
#
# This script runs under busybox sh (the wp-cli image is Alpine), so it stays POSIX:
# the derived list is exactly one slug per line with slug-safe characters only
# (enforced by the derivation script), which makes word-splitting the whole file safe.
step "conflicts: preinstalling free conflict plugins (inactive)"
if [ ! -f "$CONFLICTS_LIST" ]; then
	die "conflicts" "missing $CONFLICTS_LIST"
fi
installed=0
failed=0
failed_slugs=''
skipped=0
total=0
for slug in $(grep -Ev '^[[:space:]]*(#|$)' "$CONFLICTS_LIST"); do
	total=$((total + 1))
	if run_wp plugin is-installed "$slug" >/dev/null 2>&1; then
		skipped=$((skipped + 1))
		continue
	fi
	if run_wp plugin install "$slug" >/dev/null 2>&1; then
		installed=$((installed + 1))
	else
		# One unreachable slug must not hide the rest; the boot summary reports it.
		failed=$((failed + 1))
		failed_slugs="$failed_slugs $slug"
	fi
done
step "conflicts: total=${total} installed=${installed} failed=${failed} already-present=${skipped}"
if [ -n "$failed_slugs" ]; then
	# Slugs, not credentials: always safe to print. wp.org availability moves over time;
	# re-derive the list with docker/scripts/derive-conflicts.sh when this fires.
	printf 'bootstrap: conflicts failed to install:%s\n' "$failed_slugs"
fi
if [ "$total" -gt 0 ] && [ "$installed" -eq 0 ] && [ "$skipped" -eq 0 ]; then
	die "conflicts" "zero conflict plugins installed — network to wordpress.org broken from the container?"
fi

# Start every session from a cold cache: stale fixture-page HTML from a previous code
# state cannot leak into a new boot. `wp rocket clean` does not exist in 3.23.5.1 (the
# plugin registers only `rocket abilities-catalog` on wp-cli), so the purge calls the
# plugin's own purge/minify cleaners directly — the same entries the admin purge uses.
# Used-CSS state is deliberately NOT purged here: it is row-driven and stable across
# boots; a forthcoming suite resets it explicitly when a scenario needs a cold RUCSS.
step "wp-rocket: purge all caches"
run_wp eval 'rocket_clean_domain(); rocket_clean_minify();' >/dev/null 2>&1 || die "wpr_purge" "rocket_clean_domain()/rocket_clean_minify() eval failed — is WP Rocket active and loadable in CLI context?"

# Done marker consumed by docker/scripts/up.sh as the "site ready" signal.
printf 'bootstrap: done\n'
