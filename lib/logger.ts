/**
 * Project-wide console logger: one stable flag (`[WPR FDT]`) plus a caller
 * tag, so logs stay greppable across surfaces and never leak page content —
 * passing strings you didn't author is the caller's validation problem.
 */

/** One tagged, leveled logger bound to a namespace. */
export interface Logger {
  /** Dev-only diagnostics; silenced in production builds. */
  debug(message: string, ...details: unknown[]): void;
  /** Operational facts that must survive production (e.g. processing timings). */
  info(message: string, ...details: unknown[]): void;
  /** Recoverable degradations. */
  warn(message: string, ...details: unknown[]): void;
  /** Failures with context; never sensitive data. */
  error(message: string, ...details: unknown[]): void;
}

/** Runtime module mode from the bundler; `production` builds gate `debug`. */
const isProduction = import.meta.env.MODE === 'production';

/**
 * Create a namespaced logger.
 *
 * @param tag Caller tag rendered after the shared prefix (e.g. `'detection'`).
 */
export function createLogger(tag: string): Logger {
  const prefix = tag.length > 0 ? `[WPR FDT] [${tag}]` : '[WPR FDT]';
  const write = (
    method: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    details: unknown[]
  ): void => {
    console[method](`${prefix} ${message}`, ...details);
  };
  return {
    debug: (message, ...details) => {
      if (isProduction) return;
      write('debug', message, details);
    },
    info: (message, ...details) => {
      write('info', message, details);
    },
    warn: (message, ...details) => {
      write('warn', message, details);
    },
    error: (message, ...details) => {
      write('error', message, details);
    }
  };
}
