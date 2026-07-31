/*
 * Teleportation
 *
 * Instant: there is nothing to tick. The work is all in picking a landing
 * spot that will not drop you inside a wall or into the void - if no safe
 * spot is found the power refuses and costs no cooldown.
 */

import { CONFIG, SOUNDS } from "../config.js";
import {
  actionBar,
  add,
  groundBelow,
  hasHeadroom,
  headLocation,
  normalize,
  particle,
  safe,
  scale,
  sound,
  viewDirection,
  worldSound,
} from "../util.js";

export const teleport = {
  key: "teleport",
  duration: 0,
  cooldown: CONFIG.teleport.cooldown,

  start(player) {
    const dimension = safe(() => player.dimension);
    if (!dimension) return false;

    const destination = pickDestination(player, dimension);
    if (!destination) {
      actionBar(player, "§cNowhere safe to land - aim somewhere open.");
      sound(player, SOUNDS.deny, 0.7);
      return false;
    }

    const from = player.location;
    burst(dimension, add(from, { x: 0, y: 1, z: 0 }));
    worldSound(dimension, SOUNDS.teleport, from, 0.9);

    safe(() => player.teleport(destination, { keepVelocity: false }));

    burst(dimension, add(destination, { x: 0, y: 1, z: 0 }));
    worldSound(dimension, SOUNDS.teleport, destination, 1.3);
    return true;
  },

  tick() {},
  stop() {},
};

/**
 * Where the player is looking, dropped onto the first solid ground, with
 * head-room checked. Falls back to walking the ray backwards, so aiming at a
 * wall lands you in front of it rather than inside it.
 */
function pickDestination(player, dimension) {
  const origin = headLocation(player);
  const direction = normalize(viewDirection(player));
  const max = CONFIG.teleport.maxDistance;

  const blockHit = safe(() =>
    player.getBlockFromViewDirection({
      maxDistance: max,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    })
  );

  const candidates = [];
  if (blockHit?.block) {
    const block = blockHit.block.location;
    candidates.push({ x: block.x + 0.5, y: block.y + 1, z: block.z + 0.5 });
  }
  // Points along the ray, nearest the aim first, then progressively closer.
  for (let along = max; along >= 3; along -= 3) {
    candidates.push(add(origin, scale(direction, along)));
  }

  for (const candidate of candidates) {
    const grounded =
      hasHeadroom(dimension, candidate, CONFIG.teleport.headroom) &&
      groundBelow(dimension, candidate, 2)
        ? { x: Math.floor(candidate.x) + 0.5, y: candidate.y, z: Math.floor(candidate.z) + 0.5 }
        : groundBelow(dimension, candidate, CONFIG.teleport.groundSearch);
    if (!grounded) continue;
    if (!hasHeadroom(dimension, grounded, CONFIG.teleport.headroom)) continue;
    return grounded;
  }
  return undefined;
}

function burst(dimension, at) {
  particle(dimension, "sp:teleport_ring", at);
  for (const offset of [
    { x: 0, y: 0, z: 0 },
    { x: 0.6, y: 0.4, z: 0 },
    { x: -0.6, y: 0.4, z: 0 },
    { x: 0, y: 0.8, z: 0.6 },
    { x: 0, y: 0.8, z: -0.6 },
  ]) {
    particle(dimension, "minecraft:totem_particle", add(at, offset));
  }
}
