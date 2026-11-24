/**
 * The headline of each way a panel's ask to the page can miss — one
 * declaring site for every tool's outcome view, so the same failure reads
 * the same on every page. Each tool keeps its own body (its retry verb and
 * what was left undone).
 */
import type { AskMiss } from './bounded-ask';

/** Per miss: the outcome's title. */
export const ASK_MISS_TITLES: Readonly<Record<AskMiss, string>> = {
  'no-receiver': "The page isn't listening",
  timeout: "The page didn't answer in time",
  'invalid-reply': "The page's answer was unreadable",
  failed: "Couldn't reach the page"
};
