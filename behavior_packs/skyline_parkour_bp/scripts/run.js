/*
 * Skyline Parkour - the run itself
 *
 * One tick loop drives every active run: fall detection, checkpoint pickup,
 * the finish line, and the HUD. Falling never kills you - you are put back on
 * your last checkpoint before you have fallen far enough to take damage.
 */

import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { bestFor, courseKey, submitTime } from "./records.js";
import {
  actionBar,
  distanceXZ,
  formatTicks,
  particle,
  placePlayer,
  safe,
  sound,
  standOn,
  title,
} from "./util.js";

/** playerId -> run state. Runs are in-memory only; the course itself is saved. */
const runs = new Map();

export function runOf(player) {
  return runs.get(player.id);
}

export function isRunning(player) {
  return runs.has(player.id);
}

/**
 * `course` is either a generated course or a hand-built one:
 *   { difficulty, jumps, dimensionId, heading, start, checkpoints, finish, custom }
 * Positions are block positions - the player is placed on top of them.
 */
export function startRun(player, course, options) {
  const useCheckpoints = options?.useCheckpoints !== false;
  const key = courseKey(course.difficulty ?? "custom", course.jumps ?? course.checkpoints.length);

  runs.set(player.id, {
    course,
    key,
    useCheckpoints,
    index: -1, // -1 = start pad, 0.. = index into course.checkpoints
    startTick: system.currentTick,
    resets: 0,
    best: bestFor(player, key),
  });

  placePlayer(player, standOn(course.start), course.heading);
  title(
    player,
    "§a§lGO!",
    `§7${course.difficulty ? `${course.difficulty} · ` : ""}${course.checkpoints.length} checkpoints`
  );
  sound(player, "random.orb");
}

export function stopRun(player, message) {
  const existed = runs.delete(player.id);
  if (existed && message) {
    actionBar(player, message);
    safe(() => player.sendMessage(message));
  }
  return existed;
}

export function restartRun(player) {
  const run = runs.get(player.id);
  if (!run) return false;
  startRun(player, run.course, { useCheckpoints: run.useCheckpoints });
  return true;
}

/** Where a fall sends you back to. */
export function respawnPoint(run) {
  const course = run.course;
  if (!run.useCheckpoints || run.index < 0) return standOn(course.start);
  return standOn(course.checkpoints[run.index] ?? course.start);
}

export function sendToCheckpoint(player) {
  const run = runs.get(player.id);
  if (!run) return false;
  placePlayer(player, respawnPoint(run), run.course.heading);
  return true;
}

/* ------------------------------------------------------------------ *
 * Tick loop
 * ------------------------------------------------------------------ */

export function tickRuns() {
  if (runs.size === 0) return;

  const present = new Set();
  for (const player of world.getAllPlayers()) {
    present.add(player.id);
    const run = runs.get(player.id);
    if (run) advance(player, run);
  }
  for (const id of [...runs.keys()]) {
    if (!present.has(id)) runs.delete(id);
  }
}

function advance(player, run) {
  const course = run.course;

  if (safe(() => player.dimension.id) !== course.dimensionId) {
    stopRun(player, "§7Run stopped - you left the course's dimension.");
    return;
  }

  const location = safe(() => player.location);
  if (!location) return;

  keepComfortable(player, run);

  // Fell off the course?
  const anchor = respawnPoint(run);
  if (location.y < anchor.y - CONFIG.run.fallGrace) {
    fall(player, run);
    return;
  }

  // Finish line has priority over a checkpoint standing right next to it.
  const finish = standOn(course.finish);
  if (near(location, finish, CONFIG.run.finishRadius)) {
    finishRun(player, run);
    return;
  }

  for (let index = run.index + 1; index < course.checkpoints.length; index++) {
    const point = standOn(course.checkpoints[index]);
    if (near(location, point, CONFIG.run.checkpointRadius)) {
      reachCheckpoint(player, run, index);
      break;
    }
  }

  updateHud(player, run);
}

function near(location, point, radius) {
  return distanceXZ(location, point) <= radius && Math.abs(location.y - point.y) <= 2.5;
}

function fall(player, run) {
  run.resets++;
  const restarting = !run.useCheckpoints || run.index < 0;
  placePlayer(player, respawnPoint(run), run.course.heading);

  if (!run.useCheckpoints) {
    run.startTick = system.currentTick;
    run.index = -1;
    actionBar(player, "§cFell! No checkpoints - timer reset.");
  } else {
    actionBar(
      player,
      restarting ? "§cFell! Back to the start." : `§cFell! Back to checkpoint §f${run.index + 1}`
    );
  }
  sound(player, "note.bass", 0.7);
}

function reachCheckpoint(player, run, index) {
  run.index = index;
  const total = run.course.checkpoints.length;
  actionBar(player, `§aCheckpoint §f${index + 1}§a/§f${total} §8· §e${formatTicks(elapsed(run))}`);
  sound(player, "random.levelup", 1.4);
  particle(
    safe(() => player.dimension),
    "minecraft:villager_happy",
    standOn(run.course.checkpoints[index])
  );
}

function finishRun(player, run) {
  const ticks = elapsed(run);
  const outcome = submitTime(player, run.key, ticks);
  runs.delete(player.id);

  const time = formatTicks(ticks);
  title(player, "§6§lFINISH", `§f${time}§7${run.resets ? ` · ${run.resets} falls` : " · flawless"}`);
  sound(player, "random.levelup");

  const dimension = safe(() => player.dimension);
  const centre = standOn(run.course.finish);
  for (const offset of [-1, 0, 1]) {
    particle(dimension, "minecraft:villager_happy", {
      x: centre.x + offset,
      y: centre.y + 1,
      z: centre.z + offset,
    });
  }
  safe(() => player.dimension.playSound("firework.large_blast", centre));

  const lines = [`§6[Parkour] §fFinished in §e${time}§f after §e${run.resets}§f falls.`];
  if (outcome.personalBest) {
    lines.push(
      outcome.previousPersonal === undefined
        ? "§aFirst time on this course - that is your personal best."
        : `§aNew personal best! Previous: §f${formatTicks(outcome.previousPersonal)}`
    );
  } else if (outcome.previousPersonal !== undefined) {
    lines.push(`§7Personal best stays §f${formatTicks(outcome.previousPersonal)}§7.`);
  }
  if (outcome.worldRecord && outcome.previousWorld !== undefined) {
    lines.push("§6World record for this course!");
  }
  safe(() => player.sendMessage(lines.join("\n")));
}

function elapsed(run) {
  return Math.max(0, system.currentTick - run.startTick);
}

/** Resistance so a landing never kills, saturation so hunger never blocks sprinting. */
function keepComfortable(player, run) {
  if (elapsed(run) % 40 !== 0) return;
  if (CONFIG.run.noFallDamage) {
    safe(() =>
      player.addEffect("resistance", 100, { amplifier: 4, showParticles: false })
    );
  }
  if (CONFIG.run.keepFed) {
    safe(() => player.addEffect("saturation", 100, { amplifier: 0, showParticles: false }));
  }
}

function updateHud(player, run) {
  const ticks = elapsed(run);
  if (ticks % CONFIG.run.hudEveryTicks !== 0) return;

  const total = run.course.checkpoints.length;
  const done = run.index + 1;
  const parts = [
    `§eTime §f${formatTicks(ticks)}`,
    `§aCP §f${done}§7/§f${total}`,
  ];
  if (run.best !== undefined) parts.push(`§bPB §f${formatTicks(run.best)}`);
  if (run.resets > 0) parts.push(`§cFalls §f${run.resets}`);
  actionBar(player, parts.join(" §8| "));
}
