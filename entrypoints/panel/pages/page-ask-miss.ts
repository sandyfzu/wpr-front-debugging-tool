/**
 * What the tool pages say when a read of the inspected page got no usable
 * answer, per miss — one table for every page that lists something the
 * page answers on demand (the RUCSS Tester's style inventory, the
 * Stylesheets page), so the same miss never reads two ways.
 */
import type { AskMiss } from '../../../lib/messaging/bounded-ask';

/** Why a read got no answer, and what to do, per miss. */
export const PAGE_ASK_MISS_COPY: Readonly<Record<AskMiss, string>> = {
  'no-receiver': 'The extension is not active on this page yet — reload it, then retry.',
  timeout: "The page didn't answer in time. Retry; reload the page if it keeps happening.",
  'invalid-reply': 'The page runs another version of the extension — reload it, then retry.',
  failed: 'Asking the page failed — reload it, then retry.'
};
