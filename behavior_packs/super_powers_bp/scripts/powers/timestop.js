/*
 * Time Stop
 *
 * Hostile mobs get slowness and weakness at amplifier 255, which pins them in
 * place and drops their hits to nothing. Projectiles are held by clearing
 * their velocity and putting them back where they were first seen, every
 * tick, so an arrow hangs in mid air instead of falling out of the sky.
 *
 * Players are never touched, so everyone can still move.
 */

import { CONFIG, SOUNDS } from "../config.js";
import { add, effect, isPlayer, particle, safe, sound, worldSound } from "../util.js";

const PROJECTILES = new Set([
  "minecraft:arrow",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:dragon_fireball",
  "minecraft:wither_skull",
  "minecraft:wither_skull_dangerous",
  "minecraft:shulker_bullet",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:ender_pearl",
  "minecraft:llama_spit",
  "minecraft:splash_potion",
  "minecraft:lingering_potion",
  "minecraft:thrown_trident",
]);

export const timestop = {
  key: "timestop",
  duration: CONFIG.timestop.duration,
  cooldown: CONFIG.timestop.cooldown,

  start(player, state) {
    const dimension = safe(() => player.dimension);
    if (!dimension) return false;

    state.data.pinned = new Map(); // entity id -> where it was caught
    worldSound(dimension, SOUNDS.timestop, player.location, 0.6);
    sound(player, SOUNDS.activate, 0.7);
    shockwave(dimension, player.location);
    freeze(player, state, 0);
    return true;
  },

  tick(player, state, elapsed, options) {
    freeze(player, state, elapsed, options);
    if (elapsed % 20 === 0) {
      shockwave(safe(() => player.dimension), player.location);
    }
  },

  stop(player) {
    sound(player, SOUNDS.expire, 0.6);
    worldSound(safe(() => player.dimension), "beacon.deactivate", player.location, 0.8);
  },
};

function freeze(player, state, elapsed, options) {
  const dimension = safe(() => player.dimension);
  if (!dimension) return;

  const nearby =
    safe(() =>
      dimension.getEntities({
        location: player.location,
        maxDistance: CONFIG.timestop.radius,
      })
    ) ?? [];

  const holdProjectiles = options?.freezeProjectiles !== false;

  for (const entity of nearby) {
    if (!entity || isPlayer(entity)) continue;
    const typeId = safe(() => entity.typeId);

    if (PROJECTILES.has(typeId)) {
      if (!holdProjectiles) continue;
      pin(entity, state);
      continue;
    }

    if (!isHostile(entity)) continue;

    // Refreshed on the same beat as everything else, so the freeze lifts by
    // itself the moment the power stops.
    if (elapsed % CONFIG.refreshEveryTicks === 0 || elapsed === 0) {
      effect(entity, "slowness", CONFIG.refreshEveryTicks * 3, 255);
      effect(entity, "weakness", CONFIG.refreshEveryTicks * 3, 255);
    }
    safe(() => entity.clearVelocity());

    if (elapsed % 10 === 0) {
      particle(
        dimension,
        "minecraft:electric_spark_particle",
        add(entity.location, { x: 0, y: 1, z: 0 })
      );
    }
  }
}

function pin(entity, state) {
  const id = safe(() => entity.id);
  if (!id) return;
  let at = state.data.pinned.get(id);
  if (!at) {
    at = { ...entity.location };
    state.data.pinned.set(id, at);
  }
  safe(() => entity.clearVelocity());
  safe(() => entity.teleport(at));
}

function isHostile(entity) {
  for (const family of CONFIG.timestop.families) {
    if (safe(() => entity.matches({ families: [family] })) === true) return true;
  }
  return false;
}

function shockwave(dimension, centre) {
  if (!dimension) return;
  const radius = 3;
  for (let step = 0; step < 12; step++) {
    const angle = (Math.PI * 2 * step) / 12;
    particle(dimension, "sp:time_ring", {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + 0.6,
      z: centre.z + Math.sin(angle) * radius,
    });
    particle(dimension, "minecraft:enchanting_table_particle", {
      x: centre.x + Math.cos(angle) * (radius - 1),
      y: centre.y + 1.2,
      z: centre.z + Math.sin(angle) * (radius - 1),
    });
  }
}
