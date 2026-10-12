/**
 * MAIN-world registration of the simulated-device page identity: once the
 * tab's document requests carry the simulated phone identity (the session
 * DNR rule is live), site code inside the frame reads the same identity from
 * `navigator.userAgent`. Registered at document start in every frame, and
 * completely inert otherwise — nothing is defined until a valid state says
 * the simulation is on.
 *
 * The profile is bundled in on purpose (one device, per the design): the
 * identity's UA string travels with the code, never over the bridge — the
 * messages only carry the two-boolean state, whose payloads the driver
 * validates at this boundary (the page's world is untrusted input on both
 * message directions).
 *
 * Page safety (the same guard shape the undefined-references capture runs):
 * a failure starting here logs and stops — it must never surface in the page
 * as our own uncaught error.
 */
import { URL_PATTERNS } from '../lib/wp-rocket/constants';
import { createLogger } from '../lib/logger';
import { DEVICE_SIMULATION_PROFILE } from '../lib/device-simulation/profiles';
import { startUaIdentity } from '../lib/device-simulation/identity';
import { uaIdentityMessenger } from '../lib/messaging/window-bridge';

const log = createLogger('ua-identity');

export default defineContentScript({
  matches: [...URL_PATTERNS],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  main() {
    try {
      startUaIdentity({
        simulatedUserAgent: DEVICE_SIMULATION_PROFILE.userAgent,
        navigatorLike: window.navigator,
        bridge: {
          // The ask carries no payload; the answer is the relay's cached
          // state, narrowed at the driver's boundary before use.
          askRelay: (): Promise<unknown> => uaIdentityMessenger.sendMessage('uaIdentityRequest'),
          // The typed acknowledgement settles the relay's announcement send.
          onRelayAnnouncement: (handler) =>
            uaIdentityMessenger.onMessage('uaIdentityUpdate', ({ data }) => {
              handler(data);
              return true;
            })
        }
      });
    } catch (cause) {
      log.error('The page-world identity could not start', cause);
    }
  }
});
