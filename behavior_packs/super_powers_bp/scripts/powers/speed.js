/*
 * Super Speed
 *
 * Speed and jump boost are re-applied on a slow beat rather than added once
 * for the full duration: the power then ends simply by stopping the refresh,
 * with no dependency on an effect-removal API.
 */

import { CONFIG, SOUNDS } from "../config.js";
import { add, effect, particle, safe, scale, sound, viewDirection } from "../util.js";

export const speed = {
  key: "speed",
  duration: CONFIG.speed.duration,
  cooldown: CONFIG.speed.cooldown,

  start(player) {
    sound(player, SOUNDS.speed, 1.4);
    apply(player);
    return true;
  },

  tick(player, state, elapsed) {
    if (elapsed % CONFIG.refreshEveryTicks === 0) apply(player);
    if (elapsed % CONFIG.speed.trailEveryTicks !== 0) return;

    // The trail is laid down behind the player, so it reads as a streak
    // rather than a cloud around the feet.
    const dimension = safe(() => player.dimension);
    const behind = scale(viewDirection(player), -0.8);
    const at = add(player.location, { x: behind.x, y: 0.3, z: behind.z });
    particle(dimension, "sp:speed_trail", at);
    particle(dimension, "minecraft:basic_smoke_particle", at);
  },

  stop(player) {
    sound(player, SOUNDS.expire, 1.2);
  },
};

function apply(player) {
  const ticks = CONFIG.refreshEveryTicks * 3;
  effect(player, "speed", ticks, CONFIG.speed.speedAmplifier);
  effect(player, "jump_boost", ticks, CONFIG.speed.jumpAmplifier);
}
