/**
 * The simulation's list sources: the kept latest exclusion lists (Delay
 * JS's, and Defer JS's read from the same document) while valid, else the
 * simulated version's bundled lists with the miss named.
 * It reads only the kept record — the network is never asked while a page
 * loads (the background refreshes the record on its own schedule).
 */
import type { Logger } from '../logger';
import type { SimulationDeferLists } from '../messaging/exclusion-simulation';
import type { LatestListCopy, LatestListRecord } from '../storage/latest-exclusion-list';
import type { DeferJsLists } from '../wp-rocket-simulation/defer-js-forward';
import type { LatestListMiss } from '../wp-rocket-simulation/spec';
import type { SimulationListChoice, SimulationSources } from './simulation-sources';

/**
 * How long (ms) a kept copy is trusted after its fetch: past it, every
 * refresh since has missed, and a list that old may predate the simulated
 * version's own bundled one. The copy stays kept (a later success replaces it).
 */
export const LATEST_LIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

/**
 * The list a document is simulated with. WP Rocket's endpoint serves one
 * list for every plugin version, so a kept copy at most
 * {@link LATEST_LIST_MAX_AGE_MS} old wins for every version; an older one,
 * or one dated after `now` (the clock ran ahead at fetch, then corrected —
 * its age is untrustworthy), runs the bundled rows named `expired`; without one, the version's bundled
 * rows run, named by the last refresh's miss (`never-fetched` when no
 * refresh failed yet).
 *
 * @param record The kept record.
 * @param bundledRows The simulated version's bundled rows.
 * @param now The current time (epoch ms).
 */
export function chooseSimulationList(
  record: LatestListRecord,
  bundledRows: readonly string[],
  now: number
): SimulationListChoice {
  const kept = trustedCopy(record, now);
  return 'miss' in kept
    ? { listRows: bundledRows, listSource: 'bundled', listMiss: kept.miss }
    : { listRows: kept.copy.rows, listSource: 'latest', listFetchedAt: kept.copy.fetchedAt };
}

/**
 * The kept copy a document may use, or the miss naming why not (see
 * {@link chooseSimulationList} for the rule).
 *
 * @param record The kept record.
 * @param now The current time (epoch ms).
 */
function trustedCopy(
  record: LatestListRecord,
  now: number
): { readonly copy: LatestListCopy } | { readonly miss: LatestListMiss } {
  const { copy } = record;
  if (copy === undefined) return { miss: record.lastMiss ?? 'never-fetched' };
  if (copy.fetchedAt > now || now - copy.fetchedAt > LATEST_LIST_MAX_AGE_MS) {
    return { miss: 'expired' };
  }
  return { copy };
}

/**
 * The Defer JS lists a document is simulated with: the trusted kept copy's
 * (same rule as {@link chooseSimulationList}) when that document's Defer JS
 * lists were usable, else the version's bundled lists named by the
 * copy's miss — or by the copy's own Defer JS miss.
 *
 * @param record The kept record.
 * @param bundled The simulated version's bundled Defer JS lists.
 * @param now The current time (epoch ms).
 */
export function chooseDeferLists(
  record: LatestListRecord,
  bundled: DeferJsLists,
  now: number
): SimulationDeferLists {
  const kept = trustedCopy(record, now);
  if ('miss' in kept) return { ...bundled, listSource: 'bundled', listMiss: kept.miss };
  const { defer, deferMiss, fetchedAt } = kept.copy;
  return defer === undefined
    ? { ...bundled, listSource: 'bundled', listMiss: deferMiss ?? 'unreadable' }
    : { ...defer, listSource: 'latest', listFetchedAt: fetchedAt };
}

/**
 * A list source over the kept record. Never rejects: a failed read runs
 * the bundled rows with the miss `unreadable` (logged).
 *
 * @param read The kept record (a memory read once loaded).
 * @param now The clock (epoch ms), for the copy's age.
 * @param log Where a failed read is reported.
 */
export function createLatestListSource(
  read: () => Promise<LatestListRecord>,
  now: () => number,
  log: Pick<Logger, 'warn'>
): SimulationSources['list'] {
  return async (_version, bundledRows) => {
    try {
      return chooseSimulationList(await read(), bundledRows, now());
    } catch (cause) {
      log.warn('Kept latest exclusion list unreadable — the bundled list runs', cause);
      return { listRows: bundledRows, listSource: 'bundled', listMiss: 'unreadable' };
    }
  };
}

/**
 * A Defer JS lists source over the kept record. Never rejects: a failed
 * read runs the bundled lists with the miss `unreadable` (logged).
 *
 * @param read The kept record (a memory read once loaded).
 * @param now The clock (epoch ms), for the copy's age.
 * @param log Where a failed read is reported.
 */
export function createLatestDeferListsSource(
  read: () => Promise<LatestListRecord>,
  now: () => number,
  log: Pick<Logger, 'warn'>
): SimulationSources['deferLists'] {
  return async (_version, bundled) => {
    try {
      return chooseDeferLists(await read(), bundled, now());
    } catch (cause) {
      log.warn('Kept latest exclusion list unreadable — the bundled Defer JS lists run', cause);
      return { ...bundled, listSource: 'bundled', listMiss: 'unreadable' };
    }
  };
}
