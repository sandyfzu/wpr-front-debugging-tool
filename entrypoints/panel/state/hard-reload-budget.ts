/**
 * The contract-failure reload budget: at most ONE full panel reload per
 * streak of contract failures, remembered across the reload itself.
 *
 * Why it must outlive the document: a full reload builds a fresh store that
 * asks the same content script for the same cached data. When that data is
 * what failed the contract, an in-memory guard resets with every document
 * and the panel reloads forever. The budget therefore lives in the panel
 * document's session storage (it survives `location.reload()`, dies with the
 * DevTools window), and only a payload that validates re-arms it.
 */

/** The session-storage key holding the "reload already spent" marker. */
export const HARD_RELOAD_SPENT_KEY = 'wpr-fdt:contract-reload-spent';

/** The slice of the Web Storage API the budget needs. */
export type BudgetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The budget the data store consults before a contract-failure reload. */
export interface HardReloadBudget {
  /**
   * Claim the streak's single reload.
   *
   * @returns True when the reload may run (the claim is recorded first);
   *   false when this streak already reloaded, or when the memory is
   *   unavailable — never reloading is the loop-safe reading of "unknown".
   */
  claim(): boolean;
  /** A payload validated: the next contract failure may reload once again. */
  reset(): void;
}

/**
 * Build the budget over a storage accessor.
 *
 * @param storage Returns the backing storage; may throw (blocked storage,
 *   opaque origins) — every access is guarded.
 * @param onStorageError Told about a failed access (logging stays with the
 *   caller), with the operation's name and the cause.
 */
export function createHardReloadBudget(
  storage: () => BudgetStorage,
  onStorageError: (operation: 'claim' | 'reset', cause: unknown) => void
): HardReloadBudget {
  return {
    claim() {
      try {
        const store = storage();
        if (store.getItem(HARD_RELOAD_SPENT_KEY) !== null) return false;
        store.setItem(HARD_RELOAD_SPENT_KEY, '1');
        // Read back: a storage that accepts writes but keeps nothing (a
        // quota-zero or shimmed store) cannot remember the claim across the
        // reload — reloading on it would be the very loop this prevents.
        return store.getItem(HARD_RELOAD_SPENT_KEY) !== null;
      } catch (cause) {
        onStorageError('claim', cause);
        return false;
      }
    },
    reset() {
      try {
        storage().removeItem(HARD_RELOAD_SPENT_KEY);
      } catch (cause) {
        onStorageError('reset', cause);
      }
    }
  };
}
