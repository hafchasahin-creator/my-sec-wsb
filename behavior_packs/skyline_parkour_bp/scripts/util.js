/*
 * Skyline Parkour - small helpers
 *
 * Everything cosmetic (sounds, particles, titles) is wrapped so a device or
 * build that lacks one id degrades that single effect instead of taking the
 * whole add-on down.
 */

import { ItemStack } from "@minecraft/server";

export function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function say(player, text) {
  safe(() => player.sendMessage(text));
}

export function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

export function title(player, text, subtitle) {
  const options = {
    fadeInDuration: 5,
    stayDuration: 30,
    fadeOutDuration: 10,
  };
  if (subtitle !== undefined) options.subtitle = subtitle;
  // These calls return nothing, so only an exception can tell us the option
  // shape is not supported on this build - hence try/catch rather than safe().
  try {
    player.onScreenDisplay.setTitle(text, options);
  } catch {
    safe(() => player.onScreenDisplay.setTitle(text));
  }
}

export function sound(player, id, pitch) {
  safe(() =>
    player.playSound(id, { location: player.location, pitch: pitch ?? 1 })
  );
}

export function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

/* ------------------------------------------------------------------ *
 * Positions
 * ------------------------------------------------------------------ */

export function blockAt(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

/** Standing position on top of a block: centred, one block up. */
export function standOn(blockPos) {
  return { x: blockPos.x + 0.5, y: blockPos.y + 1, z: blockPos.z + 0.5 };
}

export function packPos(pos) {
  return `${pos.x},${pos.y},${pos.z}`;
}

export function unpackPos(text) {
  const [x, y, z] = text.split(",").map(Number);
  return { x, y, z };
}

export function packPosList(list) {
  return list.map(packPos).join(";");
}

export function unpackPosList(text) {
  if (!text) return [];
  return text
    .split(";")
    .filter((part) => part.length > 0)
    .map(unpackPos);
}

export function distanceXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Nearest cardinal direction the player is looking. */
export function headingFromView(player) {
  const view = safe(() => player.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
  if (Math.abs(view.x) > Math.abs(view.z)) {
    return { x: view.x >= 0 ? 1 : -1, z: 0 };
  }
  return { x: 0, z: view.z >= 0 ? 1 : -1 };
}

export function turn(heading, clockwise) {
  return clockwise
    ? { x: -heading.z, z: heading.x }
    : { x: heading.z, z: -heading.x };
}

/** Yaw that looks along `heading`, so runs always start facing the course. */
export function yawFor(heading) {
  if (heading.z === 1) return 0;
  if (heading.x === -1) return 90;
  if (heading.z === -1) return 180;
  return -90;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** 20 ticks per second, shown as m:ss.t (tenths). */
export function formatTicks(ticks) {
  const totalTenths = Math.round((ticks * 50) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;
  return `${minutes}:${paddedSeconds}.${tenths}`;
}

/* ------------------------------------------------------------------ *
 * Movement and inventory
 * ------------------------------------------------------------------ */

/**
 * Teleport without carrying momentum or fall distance across, which is what
 * makes checkpoint resets survivable on a sky course.
 */
export function placePlayer(player, location, heading) {
  safe(() => player.clearVelocity());
  const options = { keepVelocity: false };
  if (heading) options.rotation = { x: 0, y: yawFor(heading) };
  try {
    player.teleport(location, options);
  } catch {
    safe(() => player.teleport(location));
  }
  safe(() => player.clearVelocity());
}

export function inventoryOf(player) {
  return safe(() => player.getComponent("minecraft:inventory")?.container);
}

export function hasItem(player, typeId) {
  const container = inventoryOf(player);
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    if (safe(() => container.getItem(slot)?.typeId) === typeId) return true;
  }
  return false;
}

export function giveItem(player, typeId, amount) {
  return safe(() => {
    const container = inventoryOf(player);
    if (!container) return false;
    container.addItem(new ItemStack(typeId, amount ?? 1));
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Random
 * ------------------------------------------------------------------ */

/** mulberry32: same seed, same course, on every device. */
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(rng, entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.w ?? 1), 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.w ?? 1;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffff) + 1;
}
