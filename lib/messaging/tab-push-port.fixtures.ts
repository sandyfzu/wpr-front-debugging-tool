/**
 * Test double for one runtime port end, shared by the push relay's client
 * and background tests: records what our side posts and whether it
 * disconnected, lets the far side deliver messages or close, and exposes
 * the live listener counts so leaks are assertable.
 */
import type { LooseMessageSender } from './sender';
import type { PortEvent, TabPushPort } from './tab-pushes';

/** A port double (see the module header). */
export interface PortDouble extends TabPushPort {
  readonly name: string;
  readonly sender?: LooseMessageSender;
  /** Everything our side posted, in order. */
  readonly posted: unknown[];
  /** How many times our side called `disconnect`. */
  readonly disconnects: number;
  /** The far side sends `message` (runs our `onMessage` listeners). */
  deliver(message: unknown): void;
  /** The far side closes (runs our `onDisconnect` listeners, as the runtime does). */
  closeFromFarSide(): void;
  /** Live listener counts (0/0 once our side let go). */
  listenerCounts(): { message: number; disconnect: number };
  /** Make the next `postMessage` calls throw (a port already closed). */
  failPosts(): void;
}

/** A listener set behind the {@link PortEvent} slice. */
function eventDouble<Listener>(): PortEvent<Listener> & { readonly listeners: Set<Listener> } {
  const listeners = new Set<Listener>();
  return {
    listeners,
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    }
  };
}

/**
 * Build one port double.
 *
 * @param init The port's name and sender (as the runtime reports them).
 */
export function portDouble(init: { name?: string; sender?: LooseMessageSender } = {}): PortDouble {
  const onMessage = eventDouble<(message: unknown) => void>();
  const onDisconnect = eventDouble<() => void>();
  const posted: unknown[] = [];
  let disconnects = 0;
  let postsFail = false;
  return {
    name: init.name ?? 'tab-pushes',
    ...(init.sender === undefined ? {} : { sender: init.sender }),
    posted,
    get disconnects() {
      return disconnects;
    },
    onMessage,
    onDisconnect,
    postMessage: (message) => {
      if (postsFail) throw new Error('Attempt to postMessage on disconnected port');
      posted.push(message);
    },
    disconnect: () => {
      disconnects += 1;
    },
    deliver: (message) => {
      for (const listener of [...onMessage.listeners]) listener(message);
    },
    closeFromFarSide: () => {
      for (const listener of [...onDisconnect.listeners]) listener();
    },
    listenerCounts: () => ({
      message: onMessage.listeners.size,
      disconnect: onDisconnect.listeners.size
    }),
    failPosts: () => {
      postsFail = true;
    }
  };
}
