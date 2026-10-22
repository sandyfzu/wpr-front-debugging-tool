<?php
/**
 * WP Rocket parity harness: runs the REAL plugin and WordPress core code on
 * fixture inputs and prints the observed outputs as JSON. Driven by
 * `scripts/wp-rocket-parity.ts` (`pnpm parity:wp-rocket`), never by hand and
 * never in CI.
 *
 * Usage: php -n wp-rocket-parity.php <plugin-root> <wp-root> < cases.json > results.json
 *
 * Only I/O is stubbed (options, transients, translations, cron, notices, the
 * service container). Every save/match decision comes from the plugin's own
 * functions and classes; the glue here only feeds inputs and reads back which
 * elements the plugin optimized.
 *
 * Input (stdin): {"cases":[…]} — strings that may be invalid UTF-8 (typed and
 * stored rows) arrive base64-encoded:
 *   save:  {id, kind:"save", feature, typed:[b64…], safeMode:bool}
 *   match: {id, kind:"match", feature, rows:[b64…], html}
 * Output (stdout): {"env":{…}, "results":[…]} (see save_case / match_case).
 */

declare(strict_types=1);

error_reporting(E_ALL);

/** Any PHP notice/warning outside an explicitly silenced call is a harness defect. */
set_error_handler(static function (int $no, string $message, string $file, int $line): bool {
	if (!(error_reporting() & $no)) {
		return false; // @-silenced by the plugin itself (its own pattern checks).
	}
	throw new ErrorException("$message ($file:$line)", 0, $no, $file, $line);
});

if ($argc !== 3) {
	fwrite(STDERR, "usage: php -n wp-rocket-parity.php <plugin-root> <wp-root>\n");
	exit(2);
}
if (!extension_loaded('dom')) {
	fwrite(STDERR, "ext-dom is not loaded under `php -n`: the lazy-render processor needs DOMDocument.\n");
	exit(2);
}

$PLUGIN = rtrim($argv[1], '/');
$WP     = rtrim($argv[2], '/');

// ---------------------------------------------------------------------------
// Bootstrap: WordPress core (hooks + formatting) and the plugin's own files.
// ---------------------------------------------------------------------------

define('ABSPATH', $WP . '/');
define('WPINC', 'wp-includes');
define('WEEK_IN_SECONDS', 604800);
define('WP_ROCKET_SLUG', 'wp_rocket_settings');
define('WP_ROCKET_PLUGIN_SLUG', 'wp_rocket');

require ABSPATH . WPINC . '/plugin.php';

// --- I/O stubs: only what the exercised code paths reach ------------------
function get_option($name, $default = false) { return $name === 'blog_charset' ? 'UTF-8' : $default; }
function is_utf8_charset($charset = null) { return true; }
function _canonical_charset($charset) { return 'UTF-8'; }
function wp_trigger_error($function_name, $message, $error_level = E_USER_NOTICE) { trigger_error($message, $error_level); }
function __($text, $domain = 'default') { return $text; }
function _n($single, $plural, $number, $domain = 'default') { return $number === 1 ? $single : $plural; }
function rocket_is_ssl_website() { return false; }
function wp_get_environment_type() { return 'production'; }
function rocket_generate_advanced_cache_file() {}
function get_transient($key) { return false; }
function delete_transient($key) {}
function add_settings_error($setting, $code, $message, $type = 'error') {} // The drop itself is read from the returned rows.
function wp_next_scheduled($hook) { return false; }
function create_rocket_uniqid() { return 'parity'; }

// --- WordPress core functions the Lazyload pass reaches, copied verbatim from
// the pinned core (their files pull in far more than the harness loads):
// `absint` (wp-includes/load.php; `width`/`height` attributes),
// `wp_allowed_protocols` (wp-includes/functions.php; `esc_url` on absolute and
// `data:` sources), `array_any` (the PHP 8.4 polyfill in wp-includes/compat.php,
// reached by kses on PHP < 8.4).
function absint( $maybeint ) {
	return abs( (int) $maybeint );
}
function wp_allowed_protocols() {
	static $protocols = array();

	if ( empty( $protocols ) ) {
		$protocols = array( 'http', 'https', 'ftp', 'ftps', 'mailto', 'news', 'irc', 'irc6', 'ircs', 'gopher', 'nntp', 'feed', 'telnet', 'mms', 'rtsp', 'sms', 'svn', 'tel', 'fax', 'xmpp', 'webcal', 'urn' );
	}

	if ( ! did_action( 'wp_loaded' ) ) {
		$protocols = array_unique( (array) apply_filters( 'kses_allowed_protocols', $protocols ) );
	}

	return $protocols;
}
if ( ! function_exists( 'array_any' ) ) {
	function array_any( array $array, callable $callback ): bool {
		foreach ( $array as $key => $value ) {
			if ( $callback( $value, $key ) ) {
				return true;
			}
		}

		return false;
	}
}

require ABSPATH . WPINC . '/utf8.php';
if (file_exists(ABSPATH . WPINC . '/compat-utf8.php')) {
	require_once ABSPATH . WPINC . '/compat-utf8.php';
}
require ABSPATH . WPINC . '/formatting.php';
require ABSPATH . WPINC . '/kses.php';

require $PLUGIN . '/inc/constants.php';
require $PLUGIN . '/inc/functions/formatting.php';
require $PLUGIN . '/inc/functions/options.php';
require $PLUGIN . '/inc/API/bypass.php';
require $PLUGIN . '/vendor/autoload.php';
require $PLUGIN . '/inc/admin/options.php';

// rocket_pre_main_option reads the beacon service only to link its notice.
add_filter('rocket_container', static function () {
	return new class {
		public function get($id) {
			return new class {
				public function get_suggest($key) { return ['url' => '', 'id' => '']; }
			};
		}
	};
});

use WP_Rocket\Admin\Options;
use WP_Rocket\Admin\Options_Data;
use WP_Rocket\Dependencies\RocketLazyload\Assets;
use WP_Rocket\Dependencies\RocketLazyload\Iframe;
use WP_Rocket\Dependencies\RocketLazyload\Image;
use WP_Rocket\Engine\Admin\Settings\Settings as AdminSettings;
use WP_Rocket\Engine\Common\Context\ContextInterface;
use WP_Rocket\Engine\Media\Lazyload\AdminSubscriber as LazyloadAdminSubscriber;
use WP_Rocket\Engine\Media\Lazyload\Subscriber as LazyloadSubscriber;
use WP_Rocket\Engine\Optimization\DeferJS\DeferJS;
use WP_Rocket\Engine\Optimization\DelayJS\Admin\Settings as DelaySettings;
use WP_Rocket\Engine\Optimization\DelayJS\HTML as DelayHtml;
use WP_Rocket\Engine\Optimization\DynamicLists\DefaultLists\DataManager;
use WP_Rocket\Engine\Optimization\IEConditionalSubscriber;
use WP_Rocket\Engine\Optimization\LazyRenderContent\Frontend\Controller as LazyRenderController;
use WP_Rocket\Engine\Optimization\LazyRenderContent\Frontend\Processor\Dom as LazyRenderDom;
use WP_Rocket\Engine\Optimization\LazyRenderContent\Frontend\Processor\Processor as LazyRenderProcessor;
use WP_Rocket\Logger\Logger;

/** Option key of each feature's settings field (the fixture feature ids are the extension's). */
const FIELD = [
	'delay_js'     => 'delay_js_exclusions',
	'defer_all_js' => 'exclude_defer_js',
	'lazyload'     => 'exclude_lazyload',
];

/**
 * The Defer JS dynamic list the harness serves: one never-matching sentinel.
 * A live site always has a non-empty list; with an empty list and no rows the
 * plugin joins `#()#i`, which matches every URL and defers nothing — so the
 * baseline would have no candidates. The sentinel sits first, as the list does.
 */
const DEFER_LIST = ['wpr-fdt-parity-sentinel-never-matches'];

/**
 * A DataManager double: fixed dynamic lists, no filesystem or network.
 *
 * @param array $lists List name => rows.
 */
function lists(array $lists): DataManager {
	return new class((object) $lists) extends DataManager {
		private $fixed;
		public function __construct($fixed) { $this->fixed = $fixed; }
		public function get_lists() { return $this->fixed; }
	};
}

// ---------------------------------------------------------------------------
// Save: the settings-form chain per field.
// ---------------------------------------------------------------------------

/**
 * The rows the settings form stores for one field: the field's own sanitize
 * site, then the form-submit validation (`rocket_pre_main_option`).
 *
 * @param string $feature  Fixture feature id.
 * @param string $text     The submitted textarea text.
 * @param bool   $safeMode Delay JS "Safe Mode for jQuery" checkbox.
 * @return string[] Stored rows, re-indexed.
 */
function form_save(string $feature, string $text, bool $safeMode): array {
	$field = FIELD[$feature];
	if ($feature === 'delay_js') {
		$input = (new DelaySettings(new Options('wp_rocket_')))->sanitize_options(
			['delay_js' => 1, 'delay_js_execution_safe_mode' => $safeMode ? 1 : 0, $field => $text],
			new AdminSettings(new Options_Data([]))
		);
	} elseif ($feature === 'lazyload') {
		$input = (new LazyloadAdminSubscriber())->sanitize_exclude_lazyload([$field => $text]);
	} else {
		// Settings::sanitize_callback's exclude_defer_js line, verbatim (the
		// callback sanitizes every other option too, which needs a full WP).
		$input = [$field => !empty($text) ? rocket_sanitize_textarea_field($field, $text) : []];
	}
	$_POST['option_page'] = WP_ROCKET_PLUGIN_SLUG; // A settings-form submit.
	$saved = rocket_pre_main_option($input, []);
	return array_values($saved[$field] ?? []);
}

/**
 * Why one typed line is not stored, observed stage by stage with the real
 * code on that line alone (every stage but the dedupe is per row).
 *
 * @return array{0:?string,1:?string} [reason|null, sanitized form|null]
 */
function line_fate(string $feature, string $line, bool $safeMode): array {
	$field     = FIELD[$feature];
	$sanitized = rocket_sanitize_textarea_field($field, $line);
	if ($sanitized === []) {
		$trimmed = trim($line);
		$zero    = $trimmed === '0' || sanitize_text_field($trimmed) === '0';
		return [$zero ? 'zero' : 'empty', null];
	}
	$form = array_values($sanitized)[0];
	if ($feature === 'delay_js' && $safeMode && form_save($feature, $line, false) !== []
		&& form_save($feature, $line, true) === []) {
		return ['safe-mode', $form];
	}
	if (form_save($feature, $line, false) === []) {
		return ['invalid-pattern', $form];
	}
	return [null, $form];
}

/**
 * One save case: the stored rows from the whole-field submit, and each
 * dropped typed line with its reason. The per-line attribution is checked
 * against the whole-field result, so a mismatch fails the run.
 *
 * @return array{id:string,stored:string[],dropped:array<int,array{index:int,reason:string}>}
 */
function save_case(array $case): array {
	$lines    = array_map('base64_decode', $case['typed']);
	$safeMode = (bool) ($case['safeMode'] ?? false);
	// A form submit sends textarea line breaks as CRLF.
	$stored  = form_save($case['feature'], implode("\r\n", $lines), $safeMode);
	$dropped = [];
	$kept    = [];
	$seen    = [];
	foreach ($lines as $index => $line) {
		[$reason, $form] = line_fate($case['feature'], $line, $safeMode);
		if ($form !== null) {
			if (in_array($form, $seen, true)) {
				$reason = 'duplicate'; // array_unique runs before safe mode and validation.
			}
			$seen[] = $form;
		}
		if ($reason === null) {
			$kept[] = $form;
		} else {
			$dropped[] = ['index' => $index, 'reason' => $reason];
		}
	}
	if ($kept !== $stored) {
		throw new RuntimeException("save {$case['id']}: per-line attribution " . json_encode($kept) . ' != stored ' . json_encode($stored));
	}
	return ['id' => $case['id'], 'stored' => $stored, 'dropped' => $dropped];
}

// ---------------------------------------------------------------------------
// Match: the feature's real buffer pass, baseline vs rows.
// ---------------------------------------------------------------------------

/** HTML comments (incl. IE conditionals): never subjects, on both scanning sides. */
const HTML_COMMENT = '#<!--.*?-->#s';

/**
 * Subject keys of one element name outside comments, in document order: the
 * `id` attribute, else `#n` for the n-th (0-based) id-less tag of that name.
 *
 * @return array<int,array{0:string,1:string}> [[key, opening tag], …]
 */
function subject_tags(string $caseId, string $html, string $name): array {
	preg_match_all('#<' . $name . '\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>#i', preg_replace(HTML_COMMENT, '', $html), $m);
	$keys      = [];
	$anonymous = 0;
	foreach ($m[0] as $tag) {
		$key = tag_id($tag) ?? '#' . $anonymous++;
		if (in_array($key, array_column($keys, 0), true)) {
			throw new RuntimeException("match $caseId: duplicate <$name> id \"$key\"");
		}
		$keys[] = [$key, $tag];
	}
	return $keys;
}

/** An opening tag's `id` value, or null. */
function tag_id(string $tag): ?string {
	if (!preg_match('#\sid\s*=\s*(?:"([^"]*)"|\'([^\']*)\')#i', $tag, $m)) {
		return null;
	}
	return $m[1] !== '' ? $m[1] : ($m[2] ?? '');
}

/**
 * Keys of the subjects the plugin optimized in an output.
 *
 * @param callable(string):bool $optimized Whether an opening tag carries the feature's optimization.
 * @return string[]
 */
function optimized_keys(string $caseId, string $html, string $name, callable $optimized): array {
	$keys = [];
	foreach (subject_tags($caseId, $html, $name) as [$key, $tag]) {
		if ($optimized($tag)) {
			$keys[] = $key;
		}
	}
	return $keys;
}

/**
 * Run one rocket_buffer pass the way the plugin's buffer does: IE conditional
 * comments are extracted first (IEConditionalSubscriber, priority 1) and
 * re-injected last (priority 34), so the pass never sees their content.
 *
 * @param callable(string):string $pass
 */
function buffer_pass(callable $pass, string $html): string {
	$ie = new IEConditionalSubscriber();
	return $ie->inject_ie_conditionals($pass($ie->extract_ie_conditionals($html)));
}

/**
 * Delay JS: the real DelayJS\HTML::delay_js with the rows as the stored
 * option. A row PCRE rejects makes the plugin's own preg_match warn once per
 * script, as live; only that warning, raised in DelayJS/HTML.php, is tolerated.
 */
function delay_pass(array $rows, string $html): string {
	$options = new Options_Data(['delay_js' => 1, 'delay_js_exclusions' => $rows]);
	$pass    = new DelayHtml($options, lists(['delay_js_exclusions' => []]), new Logger());
	set_error_handler(static function (int $no, string $message, string $file, int $line): bool {
		if ($no === E_WARNING && str_starts_with($message, 'preg_match(): ') && str_ends_with($file, '/DelayJS/HTML.php')) {
			return true;
		}
		throw new ErrorException("$message ($file:$line)", 0, $no, $file, $line);
	});
	try {
		return buffer_pass([$pass, 'delay_js'], $html);
	} finally {
		restore_error_handler();
	}
}

/**
 * Defer JS: the real DeferJS::defer_js with the rows as the stored option.
 *
 * @param bool $off Set to whether defer_js returned its input untouched (its joined-pattern pre-check failed).
 */
function defer_pass(array $rows, string $html, ?bool &$off = null): string {
	$options = new Options_Data(['defer_all_js' => 1, 'exclude_defer_js' => $rows]);
	$pass    = new DeferJS($options, lists(['defer_js_external_exclusions' => DEFER_LIST, 'defer_js_inline_exclusions' => []]));
	return buffer_pass(static function (string $page) use ($pass, &$off): string {
		$result = $pass->defer_js($page);
		$off    = $result === $page;
		return $result;
	}, $html);
}

/**
 * Image Lazyload: the real Image::lazyloadImages, with the rows merged into
 * the exclusion filters by the real Subscriber::add_exclusions. The buffer
 * is the page itself — fixtures carry no <script>, <noscript> or <picture>,
 * so the Subscriber's hide_scripts/hide_noscripts/lazyloadPictures steps
 * would not change it.
 */
function lazyload_pass(array $rows, string $html): string {
	$image      = new Image();
	$subscriber = new LazyloadSubscriber(new Options_Data(['exclude_lazyload' => $rows]), new Assets(), $image, new Iframe());
	add_filter('rocket_lazyload_excluded_attributes', [$subscriber, 'add_exclusions']);
	add_filter('rocket_lazyload_excluded_src', [$subscriber, 'add_exclusions']);
	try {
		return buffer_pass(static fn(string $page): string => $image->lazyloadImages($page, $page, false), $html);
	} finally {
		remove_all_filters('rocket_lazyload_excluded_attributes');
		remove_all_filters('rocket_lazyload_excluded_src');
	}
}

/** Automatic Lazy Rendering: the real Dom processor's hash pass under the rows. */
function lazy_render_hashes(array $rows, string $html): string {
	$dom = new LazyRenderDom();
	$dom->set_exclusions($rows);
	return buffer_pass([$dom, 'add_hashes'], $html);
}

/** Id => location hash of every element the hash pass stamped. */
function location_hashes(string $id, string $html): array {
	$hashes = [];
	preg_match_all('#<[a-zA-Z][a-zA-Z0-9-]*\s+data-rocket-location-hash="([0-9a-f]{32})"(?:[^>"\']|"[^"]*"|\'[^\']*\')*>#', $html, $m, PREG_SET_ORDER);
	foreach ($m as [$tag, $hash]) {
		$tagId = tag_id($tag);
		if ($tagId === null) {
			throw new RuntimeException("match $id: every hashed element needs an id: $tag");
		}
		$hashes[$tagId] = $hash;
	}
	return $hashes;
}

/**
 * The page WP Rocket serves for a hashed page: the real Controller::optimize
 * with every given hash recorded as below the fold.
 */
function lazy_render_serve(string $hashedHtml, array $belowTheFold): string {
	$context = new class implements ContextInterface {
		public function is_allowed(array $data = []): bool { return true; }
	};
	$row = new class($belowTheFold) {
		public $below_the_fold;
		public function __construct(array $hashes) { $this->below_the_fold = json_encode(array_values($hashes)); }
		public function has_lrc() { return true; }
	};
	return (new LazyRenderController(new LazyRenderProcessor(), $context))->optimize($hashedHtml, $row);
}

/** Reject fixture markup the harness's Lazyload pass does not model. */
function check_lazyload_fixture(string $id, string $html): void {
	foreach (['<noscript', '<script', '<picture'] as $tag) {
		if (stripos($html, $tag) !== false) {
			throw new RuntimeException("match $id: Lazyload fixture html must not contain $tag (the harness skips the Subscriber's hide/picture steps)");
		}
	}
}

/**
 * One match case. `served` = the page served with no user rows (the
 * engine's input); `subjects` = every subject key of the served page in
 * document order (comments skipped); `candidates` = subjects optimized there;
 * `excluded` = candidates the rows leave un-optimized. Defer adds
 * `featureOff` (the pre-check returned the page untouched); lazy rendering
 * keys by id only and adds `hashed` (ids hashed under the rows) and `rekeyed`
 * (ids hashed in both runs whose hash changed — stored below-the-fold data
 * no longer matches them).
 */
function match_case(array $case): array {
	$id   = $case['id'];
	$rows = array_map('base64_decode', $case['rows']);
	$html = $case['html'];
	$out  = ['id' => $id];
	switch ($case['feature']) {
		case 'delay_js':
			$isDelayed = static fn(string $tag): bool => (bool) preg_match('#\stype="(?:text/)?rocketlazyloadscript"#', $tag);
			$served    = delay_pass([], $html);
			$subjects  = array_column(subject_tags($id, $served, 'script'), 0);
			$base      = optimized_keys($id, $served, 'script', $isDelayed);
			$after     = optimized_keys($id, delay_pass($rows, $html), 'script', $isDelayed);
			break;
		case 'defer_all_js':
			$isDeferred = static fn(string $tag): bool => strpos($tag, 'data-rocket-defer') !== false;
			$served     = defer_pass([], $html);
			$subjects   = array_column(subject_tags($id, $served, 'script'), 0);
			$base       = optimized_keys($id, $served, 'script', $isDeferred);
			if ($base === []) {
				throw new RuntimeException("match $id: a Defer fixture needs at least one deferred script (featureOff would be meaningless)");
			}
			$after      = optimized_keys($id, defer_pass($rows, $html, $featureOff), 'script', $isDeferred);
			break;
		case 'lazyload':
			check_lazyload_fixture($id, $html);
			$isLazy   = static fn(string $tag): bool => strpos($tag, 'data-lazy-src') !== false;
			$visible  = static fn(string $page): string => preg_replace('#<noscript\b.*?</noscript>#is', '', $page);
			$served   = lazyload_pass([], $html);
			$subjects = array_column(subject_tags($id, $visible($served), 'img'), 0);
			if (array_filter($subjects, static fn(string $key): bool => $key[0] === '#') !== []) {
				throw new RuntimeException("match $id: every Lazyload <img> needs an id (the served page repeats it in <noscript>)");
			}
			$base     = optimized_keys($id, $visible($served), 'img', $isLazy);
			$after    = optimized_keys($id, $visible(lazyload_pass($rows, $html)), 'img', $isLazy);
			break;
		case 'automatic_lazy_rendering':
			$baseHashes  = location_hashes($id, lazy_render_hashes([], $html));
			$afterHashes = location_hashes($id, lazy_render_hashes($rows, $html));
			$served      = lazy_render_serve(lazy_render_hashes([], $html), $baseHashes);
			$base        = array_map('strval', array_keys($baseHashes));
			$after       = array_map('strval', array_keys($afterHashes));
			$rekeyed     = array_map('strval', array_keys(array_filter(
				$afterHashes,
				static fn(string $hash, $key): bool => isset($baseHashes[$key]) && $baseHashes[$key] !== $hash,
				ARRAY_FILTER_USE_BOTH
			)));
			break;
		default:
			throw new RuntimeException("match $id: unknown feature {$case['feature']}");
	}
	$out['served'] = $served;
	if (isset($subjects)) {
		$out['subjects'] = $subjects;
	}
	$out['candidates'] = $base;
	$out['excluded']   = array_values(array_diff($base, $after));
	if (isset($featureOff)) {
		$out['featureOff'] = $featureOff;
	}
	if (isset($rekeyed)) {
		$out['hashed']  = $after;
		$out['rekeyed'] = $rekeyed;
	}
	return $out;
}

// ---------------------------------------------------------------------------

$input   = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$results = [];
foreach ($input['cases'] as $case) {
	$results[] = $case['kind'] === 'save' ? save_case($case) : match_case($case);
}
echo json_encode(
	[
		'env'     => [
			'php'    => PHP_VERSION,
			'pcre2'  => explode(' ', PCRE_VERSION)[0],
			'libxml' => LIBXML_DOTTED_VERSION,
		],
		'results' => $results,
	],
	JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
);
