/**
 * Data-sharing consent (Firefox's built-in data-collection consent): two
 * tools send the inspected page's address to a server other than the
 * page's own, and Firefox lets the user allow that per add-on. The manifest
 * declares the one data type as optional (`browsingActivity`), so nothing
 * is granted at install; each tool asks at its first use and checks again
 * on every use (a grant can be revoked in the Add-ons Manager at any time).
 *
 * The browser API is injected ({@link DataConsentApi}): this module stays
 * pure, and Chromium (no such consent) never reaches it.
 */

/** The one data type the extension may send: the address of the inspected page. */
export const DATA_CONSENT_TYPE = 'browsingActivity';

/** The permissions object every check and request carries (Firefox's `data_collection` key). */
export const DATA_CONSENT_PERMISSIONS: DataCollectionPermissions = {
  data_collection: [DATA_CONSENT_TYPE]
};

/** The tools that send a page address off-device. */
export type DataConsentFeature = 'rucss' | 'pagespeed';

/** What the user is told about one tool's send. */
export interface DataConsentFeatureWords {
  /** The tool's name as the UI shows it. */
  readonly name: string;
  /** One sentence: what is sent, to whom, and why. */
  readonly sends: string;
}

/** Every tool that asks, with its words — the consent page and the tools read them from here. */
export const DATA_CONSENT_FEATURES: Readonly<Record<DataConsentFeature, DataConsentFeatureWords>> =
  {
    rucss: {
      name: 'RUCSS Tester',
      sends:
        "The RUCSS Tester sends the page's address to WP Rocket's RUCSS service (mega.wp-rocket.me), which builds the page's used CSS."
    },
    pagespeed: {
      name: 'PageSpeed Insights',
      sends:
        "PageSpeed Insights opens with the page's address (pagespeed.web.dev), so Google can analyze the page."
    }
  };

/**
 * Whether a value names one of the {@link DATA_CONSENT_FEATURES}.
 *
 * @param value The boundary value.
 */
export function isDataConsentFeature(value: unknown): value is DataConsentFeature {
  return typeof value === 'string' && Object.hasOwn(DATA_CONSENT_FEATURES, value);
}

/** Firefox's permissions object, reduced to the data-collection key this extension uses. */
export interface DataCollectionPermissions {
  readonly data_collection: readonly string[];
}

/** The slice of Firefox's `permissions` API the consent needs (injected; tests pass doubles). */
export interface DataConsentApi {
  /**
   * The extension's granted permissions; `data_collection` is absent where
   * the browser has no built-in data consent.
   */
  getAll(): Promise<{ readonly data_collection?: readonly string[] }>;
  /**
   * Ask the user (Firefox shows its prompt, or resolves `true` at once when
   * already granted). Must run inside a user-input handler, before any await.
   *
   * @returns Whether the permission is granted now.
   */
  request(permissions: DataCollectionPermissions): Promise<boolean>;
}

/**
 * Whether the extension may send a page address now. A browser without
 * built-in data consent (no `data_collection` in `getAll()` — the documented
 * feature check) has nothing to ask, so it counts as allowed.
 *
 * @param api The permissions API.
 * @returns `true` when granted (or nothing to grant); rejects when the API does.
 */
export async function hasDataConsent(api: Pick<DataConsentApi, 'getAll'>): Promise<boolean> {
  const granted = await api.getAll();
  return (
    granted.data_collection === undefined || granted.data_collection.includes(DATA_CONSENT_TYPE)
  );
}
