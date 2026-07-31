/*
 * Invisibility
 *
 * The effect itself is vanilla. What makes it feel like a power is the second
 * part: hostile mobs that have already locked on to you are made to forget,
 * on a slow beat, so walking away actually works. Hitting something drops you
 * out of stealth - that is handled in main.js, where the damage event is.
 */

import { CONFIG, SOUNDS } from "../config.js";
import { add, effect, particle, safe, sound } from "../util.js";

export const invisibility = {
  key: "invisibility",
  duration: CONFIG.invisibility.duration,
  cooldown: CONFIG.invisibility.cooldown,

  start(player) {
    sound(player, SOUNDS.invisibility, 0.8);
    apply(player);
    return true;
  },

  tick(player, state, elapsed, options) {
    if (elapsed % CONFIG.refreshEveryTicks === 0) apply(player);

    if (
      options?.breakMobTargets !== false &&
      elapsed % CONFIG.invisibility.forgetEveryTicks === 0
    ) {
      forgetMe(player);
    }

    if (elapsed % CONFIG.invisibility.shimmerEveryTicks !== 0) return;
    const dimension = safe(() => player.dimension);
    particle(
      dimension,
      "minecraft:enchanting_table_particle",
      add(player.location, { x: 0, y: 1, z: 0 })
    );
  },

  stop(player) {
    sound(player, SOUNDS.expire, 0.9);
  },
};

function apply(player) {
  const ticks = CONFIG.refreshEveryTicks * 3;
  effect(player, "invisibility", ticks, 0);
}

/** Ask every nearby hostile to drop its target if that target is this player. */
function forgetMe(player) {
  const dimension = safe(() => player.dimension);
  if (!dimension) return;

  const monsters =
    safe(() =>
      dimension.getEntities({
        location: player.location,
        maxDistance: 24,
        families: ["monster"],
      })
    ) ?? [];

  for (const monster of monsters) {
    // setTarget is not present on every build; where it is missing the power
    // degrades to plain vanilla invisibility rather than breaking.
    safe(() => {
      if (monster.target?.id === player.id) monster.setTarget?.(undefined);
    });
  }
}
