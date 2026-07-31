/*
 * Aurora Visuals - fog driver
 *
 * The resource pack ships the fog definitions; this picks which one each
 * player should be seeing and pushes it with the /fog command. Fog is only
 * re-pushed when the answer actually changes, so a player standing still
 * costs one comparison every two seconds and nothing else.
 */

import { world } from "@minecraft/server";
import { safe } from "./util.js";

/** The tag /fog uses to identify our push, so we only ever remove our own. */
export const FOG_TAG = "aurora";

export const PRESETS = ["vivid", "soft", "off"];

/** Minecraft daytime, in ticks: 0 is sunrise, 6000 noon, 18000 midnight. */
const BANDS = [
  { name: "dawn", from: 22800, to: 24000 },
  { name: "dawn", from: 0, to: 1200 },
  { name: "day", from: 1200, to: 10800 },
  { name: "dusk", from: 10800, to: 13200 },
  { name: "night", from: 13200, to: 22800 },
];

/** playerId -> the fog id we last pushed, so nothing is pushed twice. */
const applied = new Map();

export function forget(playerId) {
  applied.delete(playerId);
}

export function timeOfDay() {
  const direct = safe(() => world.getTimeOfDay());
  if (typeof direct === "number") return ((direct % 24000) + 24000) % 24000;
  const absolute = safe(() => world.getAbsoluteTime());
  if (typeof absolute === "number") return ((absolute % 24000) + 24000) % 24000;
  return 6000; // no clock available: treat it as midday
}

export function bandFor(time) {
  for (const band of BANDS) {
    if (time >= band.from && time < band.to) return band.name;
  }
  return "day";
}

/**
 * Every fog this pack can ask for, written out rather than built from pieces,
 * so the build tool can check each one against the files in the resource pack.
 */
export const FOGS = {
  vivid: {
    dawn: "aurora:dawn_vivid",
    day: "aurora:day_vivid",
    dusk: "aurora:dusk_vivid",
    night: "aurora:night_vivid",
  },
  soft: {
    dawn: "aurora:dawn_soft",
    day: "aurora:day_soft",
    dusk: "aurora:dusk_soft",
    night: "aurora:night_soft",
  },
  nether: "aurora:nether",
  end: "aurora:end",
};

/** Which fog definition this player should be looking through right now. */
export function fogFor(player, preset) {
  if (preset === "off") return undefined;

  const dimension = safe(() => player.dimension.id) ?? "minecraft:overworld";
  if (dimension === "minecraft:nether") return FOGS.nether;
  if (dimension === "minecraft:the_end") return FOGS.end;

  const set = FOGS[preset === "soft" ? "soft" : "vivid"];
  return set[bandFor(timeOfDay())] ?? set.day;
}

/**
 * Push the right fog, if it is not already the one being shown.
 * Returns the fog id now in force, or undefined when the preset is off.
 */
export function apply(player, preset) {
  const wanted = fogFor(player, preset);
  if (applied.get(player.id) === wanted) return wanted;
  applied.set(player.id, wanted);

  // Remove ours first. This fails harmlessly when there is nothing pushed,
  // which is why the rejection is swallowed.
  safe(() => player.runCommandAsync(`fog @s remove ${FOG_TAG}`).catch(() => {}));
  if (wanted) {
    safe(() => player.runCommandAsync(`fog @s push ${wanted} ${FOG_TAG}`).catch(() => {}));
  }
  return wanted;
}

/** Drop our fog entirely - used when someone picks the "off" preset. */
export function clear(player) {
  applied.set(player.id, undefined);
  safe(() => player.runCommandAsync(`fog @s remove ${FOG_TAG}`).catch(() => {}));
}
