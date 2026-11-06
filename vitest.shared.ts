/**
 * Shared vitest runtime pieces for the root and bench configs (and the test
 * files that need them) — declared once so the runners and tests cannot drift:
 * happy-dom runs fully offline (parsed URLs are data, not network requests;
 * the fixture corpus is offline), and its expected "disabled load" console
 * noise is filtered from the gate signal instead of failing it.
 */

/** happy-dom environment settings: all resource loading disabled. */
export const HAPPY_DOM_SETTINGS = {
  disableCSSFileLoading: true,
  disableJavaScriptFileLoading: true,
  disableIframePageLoading: true,
  // Disabled (non-iframe) loads report success instead of erroring.
  handleDisabledFileLoadingAsSuccess: true
} as const;

/**
 * Filter happy-dom's own console reports for disabled loads — expected
 * offline noise, never gate signal.
 *
 * @param log The console line.
 * @param type The console stream it came from.
 * @returns `false` to drop the line, `undefined` to keep default handling.
 */
export function filterDisabledLoadNoise(log: string, type: string): boolean | undefined {
  if (
    type === 'stderr' &&
    /Iframe page loading is disabled|CSS file loading is disabled/.test(log)
  ) {
    return false;
  }
  return undefined;
}

/**
 * How the hostile-input tests prove linear time without a wall-clock ceiling
 * (which flakes on slow CI runners with coverage): the same input shape is
 * timed at `bytes` and `factor × bytes` in one run, so machine speed cancels
 * out. Linear scans grow ~`factor`×, quadratic ones ~`factor²`× (16×), so
 * `maxRatio` sits between with room for noise. Best of `runs` damps GC and
 * scheduling spikes; `floorMs` keeps sub-millisecond baselines (timer and
 * cache noise) from inflating the ratio; `backstopMs` bounds any single run
 * absolutely, which also stops a quadratic baseline before its slower
 * run takes minutes. It is checked after a run returns (never preempts one)
 * and is not a scaling signal — `maxRatio` is. Sized for CI: a shared 2-vCPU
 * runner with v8 coverage is ~10× slower than a dev machine, and 4 MiB runs
 * took ~4 s there against a former 5 s backstop.
 */
export const LINEAR_SCALING = {
  bytes: 1024 * 1024,
  factor: 4,
  runs: 3,
  maxRatio: 10,
  floorMs: 1,
  backstopMs: 15_000
} as const;

/**
 * Per-test timeout (ms) for a test that calls {@link linearScaling} — pass it
 * as the test's timeout argument. vitest's 5 s default is shorter than a
 * passing measurement on a slow CI runner with coverage: `runs` rounds of two
 * timed runs, each allowed up to `backstopMs`, plus a margin for the untimed
 * input builds and the test's own assertions. Derived from the policy so the
 * two cannot drift.
 */
export const LINEAR_SCALING_TIMEOUT_MS =
  LINEAR_SCALING.runs * 2 * LINEAR_SCALING.backstopMs + 5_000;

/** The knobs of {@link linearScaling}; defaults to {@link LINEAR_SCALING}. */
export type LinearScalingPolicy = { readonly [K in keyof typeof LINEAR_SCALING]: number };

/** What {@link linearScaling} measured. */
export interface LinearScaling<R> {
  /** Why the run is not linear, or `undefined` when it is. */
  readonly violation: string | undefined;
  /** Best time (ms) at `bytes`, then at `factor × bytes`. */
  readonly smallMs: number;
  readonly largeMs: number;
  /** The last output on the large input, for correctness assertions. */
  readonly output: R | undefined;
}

/**
 * Time `run` on `build(bytes)` and `build(factor × bytes)`, best of
 * `runs` each (interleaved, so both sizes see the same machine state).
 *
 * @param build Builds the input of about the given size (untimed).
 * @param run The work under test.
 * @param policy The scaling policy.
 * @returns The measurement, with a readable `violation` when the time
 *   grows faster than `maxRatio` or a run exceeds `backstopMs`.
 */
export function linearScaling<T, R>(
  build: (bytes: number) => T,
  run: (input: T) => R,
  policy: LinearScalingPolicy = LINEAR_SCALING
): LinearScaling<R> {
  const inputs = [build(policy.bytes), build(policy.bytes * policy.factor)] as const;
  const best = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  let output: R | undefined;
  for (let round = 0; round < policy.runs; round++) {
    for (const [index, input] of inputs.entries()) {
      const started = performance.now();
      const result = run(input);
      const ms = performance.now() - started;
      best[index] = Math.min(best[index] ?? ms, ms);
      if (index === 1) output = result;
      if (ms > policy.backstopMs) {
        const violation = `one run took ${ms.toFixed(0)} ms (backstop ${String(policy.backstopMs)} ms)`;
        return { violation, smallMs: best[0] ?? ms, largeMs: best[1] ?? ms, output };
      }
    }
  }
  const [smallMs = 0, largeMs = 0] = best;
  const ratio = largeMs / Math.max(smallMs, policy.floorMs);
  const violation =
    ratio > policy.maxRatio
      ? `${String(policy.factor)}× the input took ${ratio.toFixed(1)}× the time ` +
        `(${smallMs.toFixed(1)} → ${largeMs.toFixed(1)} ms; limit ${String(policy.maxRatio)}×)`
      : undefined;
  return { violation, smallMs, largeMs, output };
}
