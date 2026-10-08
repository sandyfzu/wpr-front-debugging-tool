/**
 * The shared extension messenger. Every surface imports this module to
 * produce one listener registration per context (`@webext-core/messaging`
 * allows a single listener per channel per JS context).
 */

import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ProtocolMap } from './protocol';

const messenger = defineExtensionMessaging<ProtocolMap>();

/** Typed receive half of the protocol map (see `./protocol` for row docs). */
export const onMessage = messenger.onMessage;
/** Typed send half of the protocol map (see `./protocol` for row docs). */
export const sendMessage = messenger.sendMessage;
