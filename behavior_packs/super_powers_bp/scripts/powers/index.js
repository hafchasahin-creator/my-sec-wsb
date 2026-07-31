/*
 * Super Powers - the registry
 *
 * Every power is the same shape:
 *   key       matches the entry in config.js
 *   duration  ticks it runs for, 0 for an instant power
 *   cooldown  ticks before it can be used again
 *   start(player, state)         -> false to abort and refund the cooldown
 *   tick(player, state, elapsed, options)
 *   stop(player, state)
 */

import { flight } from "./flight.js";
import { invisibility } from "./invisibility.js";
import { laser } from "./laser.js";
import { speed } from "./speed.js";
import { teleport } from "./teleport.js";
import { timestop } from "./timestop.js";

export const POWER_IMPLEMENTATIONS = {
  speed,
  flight,
  laser,
  invisibility,
  teleport,
  timestop,
};

export function implementationFor(key) {
  return POWER_IMPLEMENTATIONS[key];
}
