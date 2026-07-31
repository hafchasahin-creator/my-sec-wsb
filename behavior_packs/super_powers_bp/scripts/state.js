/*
 * Super Powers - per-player state
 *
 * Active powers live in memory (they are all short lived); the selected power
 * and the settings live on the player as dynamic properties, so they survive
 * a rejoin. Everything is keyed by player id, which is what makes the add-on
 * multiplayer-safe: two players never share a cooldown or a beam.
 */

import { system } from "@minecraft/server";
import { CONFIG, POWER_BY_KEY, POWERS } from "./config.js";
import { safe } from "./util.js";

const SELECTED_PROPERTY = "sp_selected";
const SETTINGS_PROPERTY = "sp_settings";

/** playerId -> { key, endTick, data } for the power currently running. */
const active = new Map();
/** playerId -> { key: readyAtTick } */
const cooldowns = new Map();

export function activeOf(player) {
  return active.get(player.id);
}

export function isActive(player, key) {
  const state = active.get(player.id);
  return !!state && (key === undefined || state.key === key);
}

export function setActive(player, key, durationTicks, data) {
  const state = {
    key,
    startTick: system.currentTick,
    endTick: system.currentTick + durationTicks,
    duration: durationTicks,
    data: data ?? {},
  };
  active.set(player.id, state);
  return state;
}

export function clearActive(player) {
  active.delete(player.id);
}

/** Every player id with something running, so the tick loop can be cheap. */
export function activeIds() {
  return [...active.keys()];
}

export function dropPlayer(playerId) {
  active.delete(playerId);
  cooldowns.delete(playerId);
}

/* ------------------------------------------------------------------ *
 * Cooldowns
 * ------------------------------------------------------------------ */

export function cooldownLeft(player, key) {
  const forPlayer = cooldowns.get(player.id);
  if (!forPlayer) return 0;
  return Math.max(0, (forPlayer[key] ?? 0) - system.currentTick);
}

export function startCooldown(player, key, ticks) {
  const forPlayer = cooldowns.get(player.id) ?? {};
  forPlayer[key] = system.currentTick + ticks;
  cooldowns.set(player.id, forPlayer);
  // The item's own cooldown component draws the sweep over the icon; the map
  // above is what the action bar counts down.
  safe(() => player.startItemCooldown(`sp_${key}`, ticks));
}

/* ------------------------------------------------------------------ *
 * Selection and settings, stored on the player
 * ------------------------------------------------------------------ */

export function selectedKey(player) {
  const stored = safe(() => player.getDynamicProperty(SELECTED_PROPERTY));
  return POWER_BY_KEY[stored] ? stored : POWERS[0].key;
}

export function selectPower(player, key) {
  if (!POWER_BY_KEY[key]) return false;
  safe(() => player.setDynamicProperty(SELECTED_PROPERTY, key));
  return true;
}

const DEFAULT_SETTINGS = {
  laserBreaksBlocks: CONFIG.laser.breaksBlocks,
  timestopProjectiles: CONFIG.timestop.freezeProjectiles,
  speedNoFall: CONFIG.speed.negateFallDamage,
  invisibilityBreaksTargets: CONFIG.invisibility.breakMobTargets,
  hud: true,
};

export function settings(player) {
  const raw = safe(() => player.getDynamicProperty(SETTINGS_PROPERTY));
  if (typeof raw !== "string") return { ...DEFAULT_SETTINGS };
  const parsed = safe(() => JSON.parse(raw));
  return parsed && typeof parsed === "object"
    ? { ...DEFAULT_SETTINGS, ...parsed }
    : { ...DEFAULT_SETTINGS };
}

export function saveSettings(player, values) {
  const merged = { ...settings(player), ...values };
  safe(() => player.setDynamicProperty(SETTINGS_PROPERTY, JSON.stringify(merged)));
  return merged;
}
