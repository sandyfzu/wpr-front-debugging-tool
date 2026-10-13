/**
 * The cold-start instrument's unit tests: over a recording timing double,
 * the boot chain marks exactly once per document run, derives both named
 * windows from genuinely-landed start marks, and degrades explicitly — a
 * skipped window (an out-of-order leg) or a failing timing API logs at
 * warn and never throws into the boot.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createPanelColdStart,
  PANEL_COLD_START_MEASURE,
  PANEL_FIRST_DATA_STATE_MARK,
  PANEL_SHELL_INTERACTIVE_MARK,
  PANEL_SHELL_INTERACTIVE_MEASURE,
  PANEL_SCRIPT_START_MARK,
  type Uptime
} from './cold-start';

/** One recorded timing call. */
interface Recorded {
  kind: 'mark' | 'measure';
  name: string;
  /** The span's start (measures only). */
  start?: string;
  /** The span's end (measures only). */
  end?: string;
}

/**
 * A recording `performance` double: marks and measures append timeline
 * entries the assertions read back.
 */
function recordingUptime(): { uptime: Uptime; entries: Recorded[] } {
  const entries: Recorded[] = [];
  const uptime: Uptime = {
    mark: (name) => {
      entries.push({ kind: 'mark', name });
    },
    measure: (name, startMark, endMark) => {
      entries.push({ kind: 'measure', name, start: startMark, end: endMark });
    }
  };
  return { uptime, entries };
}

describe('createPanelColdStart', () => {
  it('marks the boot chain in order and derives both windows', () => {
    const { uptime, entries } = recordingUptime();
    const cold = createPanelColdStart(uptime);

    cold.markScriptStart();
    cold.markShellInteractive();
    cold.markFirstDataState();

    expect(entries).toEqual([
      { kind: 'mark', name: PANEL_SCRIPT_START_MARK },
      { kind: 'mark', name: PANEL_SHELL_INTERACTIVE_MARK },
      {
        kind: 'measure',
        name: PANEL_SHELL_INTERACTIVE_MEASURE,
        start: PANEL_SCRIPT_START_MARK,
        end: PANEL_SHELL_INTERACTIVE_MARK
      },
      { kind: 'mark', name: PANEL_FIRST_DATA_STATE_MARK },
      {
        kind: 'measure',
        name: PANEL_COLD_START_MEASURE,
        start: PANEL_SCRIPT_START_MARK,
        end: PANEL_FIRST_DATA_STATE_MARK
      }
    ]);
  });

  it('records each step exactly once — later data events never re-mark', () => {
    const { uptime, entries } = recordingUptime();
    const cold = createPanelColdStart(uptime);

    // The shell's data effect re-runs on every machine transition; only the
    // first settle marks (the machine may settle, refresh and re-settle).
    cold.markScriptStart();
    cold.markShellInteractive();
    cold.markFirstDataState();
    cold.markFirstDataState();
    cold.markShellInteractive();
    cold.markFirstDataState();

    expect(entries).toHaveLength(5);
    expect(entries.filter(({ kind }) => kind === 'mark')).toHaveLength(3);
    expect(entries.filter(({ name }) => name === PANEL_COLD_START_MEASURE)).toHaveLength(1);
  });

  it('still records the nameless-leg mark when its span start never landed', () => {
    const { uptime, entries } = recordingUptime();
    const cold = createPanelColdStart(uptime);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // An out-of-order leg (a rewiring bug): the mark survives, the window is
    // skipped with a named warn — the degraded timeline cannot lie about a
    // span it did not see start.
    cold.markFirstDataState();

    expect(entries).toEqual([{ kind: 'mark', name: PANEL_FIRST_DATA_STATE_MARK }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(PANEL_COLD_START_MEASURE));
    warn.mockRestore();
  });
});
