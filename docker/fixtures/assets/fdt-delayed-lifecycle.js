/**
 * Fixture: `?fdt-delay=1` — delayed script with a benign, observable completion marker.
 *
 * Runs second in the delay queue (see fdt-fixtures.php enqueue order) and never throws:
 * - `window.fdtDelayExecutedAt = <timestamp>` is set as soon as Delay JS runs this script,
 *   the flip suites use as the "queue executed" evidence along with WP Rocket's own
 *   `data-rocket-status` attribute on the script element;
 * - the executing `<script>` element is also tagged `data-fdt-delay="executed"` so
 *   suites can target a stable node without depending on WP Rocket's internal naming.
 */
window.fdtDelayExecutedAt = Date.now();
window.fdtDelayQueueRan = true;
if (document.currentScript) {
  document.currentScript.setAttribute('data-fdt-delay', 'executed');
}
