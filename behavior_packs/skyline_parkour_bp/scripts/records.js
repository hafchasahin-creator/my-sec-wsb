/*
 * Skyline Parkour - times and records
 *
 * Personal bests live on the player, world records on the world, both as JSON
 * in a dynamic property. Everything is guarded: a corrupt or missing property
 * just means "no record yet" rather than a broken run.
 */

import { world } from "@minecraft/server";
import { safe } from "./util.js";

const WORLD_KEY = "skypk:records";
const PLAYER_KEY = "skypk:best";
const MAX_ENTRIES = 60;

/** Records are kept per difficulty and length, so 20 hard != 40 hard. */
export function courseKey(difficulty, jumps) {
  return `${difficulty}:${jumps}`;
}

function readMap(holder, key) {
  const raw = safe(() => holder.getDynamicProperty(key));
  if (typeof raw !== "string") return {};
  const parsed = safe(() => JSON.parse(raw));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function writeMap(holder, key, map) {
  const keys = Object.keys(map);
  while (keys.length > MAX_ENTRIES) {
    delete map[keys.shift()];
  }
  safe(() => holder.setDynamicProperty(key, JSON.stringify(map)));
}

export function worldRecords() {
  return readMap(world, WORLD_KEY);
}

export function personalBests(player) {
  return readMap(player, PLAYER_KEY);
}

/**
 * Store a finish time.
 * Returns which records it beat and what the previous times were.
 */
export function submitTime(player, key, ticks) {
  const bests = personalBests(player);
  const previousPersonal = typeof bests[key] === "number" ? bests[key] : undefined;
  const personalBest = previousPersonal === undefined || ticks < previousPersonal;
  if (personalBest) {
    bests[key] = ticks;
    writeMap(player, PLAYER_KEY, bests);
  }

  const records = worldRecords();
  const previous = records[key];
  const previousWorld = previous && typeof previous.t === "number" ? previous.t : undefined;
  const worldRecord = previousWorld === undefined || ticks < previousWorld;
  if (worldRecord) {
    records[key] = { t: ticks, n: safe(() => player.name) ?? "player" };
    writeMap(world, WORLD_KEY, records);
  }

  return { personalBest, worldRecord, previousPersonal, previousWorld };
}

export function bestFor(player, key) {
  const bests = personalBests(player);
  return typeof bests[key] === "number" ? bests[key] : undefined;
}

export function clearRecords(player) {
  safe(() => player.setDynamicProperty(PLAYER_KEY, undefined));
}
