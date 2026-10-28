/**
 * One on-page surface's life under the on-page UI gate, as a small state
 * machine: a surface boots once both its page is ready (the moment its own
 * boot logic would run) and the gate's first value is known.
 *
 * - `waiting` → `running` (`start('boot')`) when the first known value is on;
 * - `waiting` → `stopped` when it is off — the boot is spent: a later
 *   gate-on resumes, it never replays boot-only work (e.g. a reload restore);
 * - `running` → `stopped` (`stop()`) on a gate-off write: the surface
 *   unmounts while the page runs;
 * - `stopped` → `running` (`start('resume')`) on a gate-on write: the
 *   surface comes back per its own settings.
 *
 * The phase changes before a hook runs, so a hook (or anything it triggers)
 * reads the new truth through {@link GatedSurface.running}. A throwing hook
 * is logged; the phase stays where the gate says.
 */
import type { Logger } from '../logger';
import { followPageUiGate, type PageUiGateFollowerDeps } from './gate-follower';

/** Why a surface starts: its first boot, or a gate-on after a stop. */
export type GatedSurfaceStart = 'boot' | 'resume';

/** Where a surface stands. */
export type GatedSurfacePhase = 'waiting' | 'running' | 'stopped';

/** The surface's own work. */
export interface GatedSurfaceHooks {
  /** Mount / resume the surface (its normal boot logic). */
  start(cause: GatedSurfaceStart): void;
  /** Unmount the surface and stop its page work (observers, timers). */
  stop(): void;
}

/** The machine's inputs and reads. */
export interface GatedSurface {
  /** The page reached the surface's boot moment (idempotent). */
  pageReady(): void;
  /** A known gate value (the boot read or a write). */
  gate(enabled: boolean): void;
  /** Whether the surface may show now. */
  running(): boolean;
  phase(): GatedSurfacePhase;
}

/**
 * Create a surface's machine.
 *
 * @param hooks The surface's start/stop.
 * @param log Where a throwing hook is reported.
 * @returns The machine, `waiting`.
 */
export function createGatedSurface(
  hooks: GatedSurfaceHooks,
  log: Pick<Logger, 'error'>
): GatedSurface {
  let phase: GatedSurfacePhase = 'waiting';
  let ready = false;
  let enabled: boolean | null = null;

  const run = (what: string, hook: () => void): void => {
    try {
      hook();
    } catch (cause) {
      log.error(`The on-page surface's ${what} failed`, cause);
    }
  };

  const settle = (): void => {
    if (phase === 'waiting') {
      if (!ready || enabled === null) return;
      phase = enabled ? 'running' : 'stopped';
      if (enabled) {
        run('start', () => {
          hooks.start('boot');
        });
      }
      return;
    }
    if (phase === 'running' && enabled === false) {
      phase = 'stopped';
      run('stop', () => {
        hooks.stop();
      });
    } else if (phase === 'stopped' && enabled === true) {
      phase = 'running';
      run('start', () => {
        hooks.start('resume');
      });
    }
  };

  return {
    pageReady() {
      ready = true;
      settle();
    },
    gate(next) {
      enabled = next;
      settle();
    },
    running: () => phase === 'running',
    phase: () => phase
  };
}

/**
 * Create a surface's machine and feed it the gate (the follower's arm-first
 * watch + boot read) — the one call every gated surface makes. The caller
 * still reports {@link GatedSurface.pageReady} at its boot moment.
 *
 * @param deps The gate source and the host's lifecycle.
 * @param hooks The surface's start/stop.
 * @returns The machine.
 */
export function followGatedSurface(
  deps: PageUiGateFollowerDeps,
  hooks: GatedSurfaceHooks
): GatedSurface {
  const surface = createGatedSurface(hooks, deps.log);
  followPageUiGate(deps, (enabled) => {
    surface.gate(enabled);
  });
  return surface;
}
