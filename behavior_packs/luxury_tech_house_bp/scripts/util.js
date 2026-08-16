/*
 * Luxury Tech House - shared helpers.
 *
 * Everything cosmetic in this add-on is wrapped: one unsupported sound id or
 * one block sitting in an unloaded chunk must never be able to take the whole
 * smart-home system down mid-animation.
 */

import { world, system, BlockPermutation } from "@minecraft/server";

/** Run a call for its side effect and swallow any platform specific failure. */
export function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** True when the engine on this device knows about a block id. */
export function blockExists(id) {
  return safe(() => {
    BlockPermutation.resolve(id);
    return true;
  }, false);
}

const permutationCache = new Map();

/** Cached BlockPermutation lookup - doors re-resolve the same few ids a lot. */
export function permutation(id) {
  let found = permutationCache.get(id);
  if (found === undefined) {
    found = safe(() => BlockPermutation.resolve(id), null);
    permutationCache.set(id, found);
  }
  return found;
}

export function vec(x, y, z) {
  return { x, y, z };
}

export function add(a, x, y, z) {
  return { x: a.x + x, y: a.y + y, z: a.z + z };
}

export function floorVec(v) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

/** Squared horizontal distance - avoids a sqrt in the per-tick door sweep. */
export function flatDist2(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Play a sound for every player within range of a world position. */
export function soundAt(dimensionId, location, soundId, options = {}) {
  const { volume = 0.6, pitch = 1, range = 24 } = options;
  const range2 = range * range;
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== dimensionId) continue;
    if (dist2(player.location, location) > range2) continue;
    safe(() => player.playSound(soundId, { volume, pitch, location }));
  }
}

/** Broadcast a title/subtitle to everyone near a world position. */
export function titleNear(dimensionId, location, title, subtitle, range = 140) {
  const range2 = range * range;
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== dimensionId) continue;
    if (dist2(player.location, location) > range2) continue;
    safe(
      () =>
        player.onScreenDisplay.setTitle(title, {
          subtitle,
          fadeInDuration: 5,
          stayDuration: 45,
          fadeOutDuration: 10,
        }),
      safe(() => player.onScreenDisplay.setTitle(title))
    );
  }
}

export function actionBarNear(dimensionId, location, text, range = 140) {
  const range2 = range * range;
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== dimensionId) continue;
    if (dist2(player.location, location) > range2) continue;
    safe(() => player.onScreenDisplay.setActionBar(text));
  }
}

/** Set one block by id. Returns false when the chunk is not loaded. */
export function setBlock(dimension, x, y, z, id) {
  const perm = permutation(id);
  if (!perm) return false;
  return safe(() => {
    const block = dimension.getBlock({ x, y, z });
    if (!block) return false;
    block.setPermutation(perm);
    return true;
  }, false);
}

/** Every player in a dimension that is inside an axis aligned box. */
export function playersInBox(dimensionId, box, pad = 0) {
  const found = [];
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== dimensionId) continue;
    const p = player.location;
    if (
      p.x >= box.x0 - pad &&
      p.x <= box.x1 + 1 + pad &&
      p.y >= box.y0 - pad &&
      p.y <= box.y1 + 1 + pad &&
      p.z >= box.z0 - pad &&
      p.z <= box.z1 + 1 + pad
    ) {
      found.push(player);
    }
  }
  return found;
}

/** Bedrock time of day, with a fallback for engines missing getTimeOfDay. */
export function timeOfDay() {
  const direct = safe(() => world.getTimeOfDay(), undefined);
  if (typeof direct === "number") return ((direct % 24000) + 24000) % 24000;
  const absolute = safe(() => world.getAbsoluteTime(), 0);
  return ((absolute % 24000) + 24000) % 24000;
}

/** Minecraft night runs from dusk at 13000 to dawn at 23000. */
export function isNight() {
  const t = timeOfDay();
  return t >= 13000 && t < 23000;
}

/**
 * Run a callback on the next tick. Used to hop out of before-events, where
 * the API is read only, before touching the world.
 */
export function defer(fn) {
  safe(() => system.run(() => safe(fn)));
}

export function say(player, message) {
  safe(() => player.sendMessage(message));
}
