/*
 * Skyline Parkour - the actions behind the menu
 *
 * Nothing in here touches the UI, so it can be driven equally well from the
 * Parkour Compass menu, from /scriptevent, or from chat.
 */

import { system } from "@minecraft/server";
import { CONFIG, DIFFICULTIES, ITEMS } from "./config.js";
import {
  buildCourse,
  clearBlocks,
  countObstructions,
  forgetCourse,
  liftPlan,
  loadCourse,
  planCourse,
  saveCourse,
} from "./course.js";
import { sendToCheckpoint, startRun, stopRun } from "./run.js";
import {
  blockAt,
  clamp,
  giveItem,
  hasItem,
  headingFromView,
  packPosList,
  placePlayer,
  randomSeed,
  safe,
  say,
  sound,
  standOn,
  unpackPosList,
} from "./util.js";

const MARKERS_PROPERTY = "skypk:markers";
const MAX_MARKERS = 32;

/** playerId -> tick a marker was last placed, so a block tap is never read as
 *  "open the marker menu" as well. */
const markerTicks = new Map();

export function lastMarkerTick(player) {
  return markerTicks.get(player.id) ?? -1;
}

/* ------------------------------------------------------------------ *
 * Generated courses
 * ------------------------------------------------------------------ */

function originFor(player, height) {
  const here = blockAt(safe(() => player.location) ?? { x: 0, y: 64, z: 0 });
  return {
    x: here.x,
    y: clamp(
      here.y + height,
      CONFIG.course.minBuildY,
      CONFIG.course.maxBuildY - CONFIG.course.riseLimit - 8
    ),
    z: here.z,
  };
}

/**
 * Plan a course above the player, then build and start it.
 * If the planned course would hit anything at all it is lifted and retried,
 * and if it still does not fit nothing is placed.
 */
export function createAndStart(player, options) {
  const dimension = safe(() => player.dimension);
  if (!dimension) return;

  const difficulty = DIFFICULTIES[options.difficulty] ? options.difficulty : "normal";
  const jumps = clamp(
    Math.round(options.jumps ?? CONFIG.course.defaultJumps),
    CONFIG.course.minJumps,
    CONFIG.course.maxJumps
  );
  const height = clamp(
    Math.round(options.height ?? CONFIG.course.defaultSkyHeight),
    CONFIG.course.minSkyHeight,
    CONFIG.course.maxSkyHeight
  );
  const seed = options.seed ? options.seed >>> 0 : randomSeed();
  const heading = headingFromView(player);

  const base = planCourse({
    origin: originFor(player, height),
    heading,
    difficulty,
    jumps,
    seed,
  });

  let plan = null;
  for (let attempt = 0; attempt <= CONFIG.course.liftAttempts; attempt++) {
    const lift = attempt * 12;
    if (base.start.y + lift + CONFIG.course.riseLimit > CONFIG.course.maxBuildY) break;
    const candidate = attempt === 0 ? base : liftPlan(base, lift);
    if (countObstructions(dimension, candidate) <= CONFIG.course.blockedTolerance) {
      plan = candidate;
      break;
    }
  }

  if (!plan) {
    say(
      player,
      "§c[Parkour] §fNo clear sky for a course here. Move somewhere more open, " +
        "or raise the height in the menu, then try again."
    );
    return;
  }

  stopRun(player);
  say(player, "§7[Parkour] Building your course...");

  const begin = () => {
    buildCourse(dimension, plan, () => {
      saveCourse(player, plan, dimension.id);
      startRun(
        player,
        {
          difficulty,
          jumps,
          dimensionId: dimension.id,
          heading: plan.heading,
          start: plan.start,
          checkpoints: plan.checkpoints,
          finish: plan.finish,
        },
        { useCheckpoints: options.useCheckpoints !== false }
      );
      say(
        player,
        `§6[Parkour] §f${DIFFICULTIES[difficulty].label} · §e${jumps}§f jumps · ` +
          `§e${plan.checkpoints.length}§f checkpoints · seed §e${plan.seed}`
      );
    });
  };

  const previous = loadCourse(player);
  if (options.clearOld !== false && previous && previous.dimensionId === dimension.id) {
    clearBlocks(dimension, previous.blocks, begin);
  } else {
    begin();
  }
}

/** Rebuild the saved course from its seed and run it again. */
export function replaySaved(player) {
  const dimension = safe(() => player.dimension);
  const saved = loadCourse(player);
  if (!saved) {
    say(player, "§7[Parkour] No saved course yet - start a new one from the menu.");
    return;
  }
  if (!dimension || saved.dimensionId !== dimension.id) {
    say(player, "§7[Parkour] Your saved course is in another dimension. Go back there first.");
    return;
  }

  const plan = planCourse({
    origin: saved.start,
    heading: saved.heading,
    difficulty: saved.difficulty,
    jumps: saved.jumps,
    seed: saved.seed,
  });

  stopRun(player);
  say(player, "§7[Parkour] Repairing and restarting the course...");
  buildCourse(dimension, plan, () => {
    saveCourse(player, plan, dimension.id);
    startRun(
      player,
      {
        difficulty: saved.difficulty,
        jumps: saved.jumps,
        dimensionId: dimension.id,
        heading: plan.heading,
        start: plan.start,
        checkpoints: plan.checkpoints,
        finish: plan.finish,
      },
      { useCheckpoints: true }
    );
  });
}

export function clearSaved(player) {
  const dimension = safe(() => player.dimension);
  const saved = loadCourse(player);
  if (!saved || !dimension) {
    say(player, "§7[Parkour] Nothing to clear.");
    return;
  }
  if (saved.dimensionId !== dimension.id) {
    say(player, "§7[Parkour] That course is in another dimension. Go back there to clear it.");
    return;
  }

  stopRun(player);
  say(player, `§7[Parkour] Removing ${saved.blocks.length} blocks...`);
  clearBlocks(dimension, saved.blocks, () => {
    forgetCourse(player);
    say(player, "§a[Parkour] Course cleared.");
  });
}

export function goToCheckpoint(player) {
  if (sendToCheckpoint(player)) return;
  const saved = loadCourse(player);
  if (saved && safe(() => player.dimension.id) === saved.dimensionId) {
    placePlayer(player, standOn(saved.start), saved.heading);
    say(player, "§7[Parkour] Sent you to the start pad.");
    return;
  }
  say(player, "§7[Parkour] No run in progress.");
}

export function abandonRun(player) {
  if (!stopRun(player, "§7[Parkour] Run stopped.")) {
    say(player, "§7[Parkour] No run in progress.");
  }
}

/* ------------------------------------------------------------------ *
 * Hand-built courses (Checkpoint Marker)
 * ------------------------------------------------------------------ */

export function markers(player) {
  return unpackPosList(safe(() => player.getDynamicProperty(MARKERS_PROPERTY)) ?? "");
}

function writeMarkers(player, list) {
  safe(() => player.setDynamicProperty(MARKERS_PROPERTY, packPosList(list)));
}

export function addMarker(player, block) {
  const list = markers(player);
  if (list.length >= MAX_MARKERS) {
    say(player, `§c[Parkour] Marker limit reached (${MAX_MARKERS}).`);
    return;
  }
  const pos = { x: block.location.x, y: block.location.y, z: block.location.z };
  list.push(pos);
  writeMarkers(player, list);
  markerTicks.set(player.id, system.currentTick);

  const role = list.length === 1 ? "start" : "checkpoint / finish";
  say(player, `§a[Parkour] Marker §f${list.length}§a set (${role}).`);
  sound(player, "random.orb", 1.6);
}

export function clearMarkers(player) {
  writeMarkers(player, []);
  markerTicks.set(player.id, system.currentTick);
  say(player, "§7[Parkour] All markers cleared.");
}

/** Markers become start -> checkpoints -> finish, in the order you tapped them. */
export function startCustomRun(player) {
  const list = markers(player);
  if (list.length < 2) {
    say(
      player,
      "§c[Parkour] Set at least 2 markers first: tap the start block, then more blocks " +
        "along your course. The last one is the finish."
    );
    return;
  }
  const dimension = safe(() => player.dimension);
  if (!dimension) return;

  startRun(
    player,
    {
      difficulty: undefined,
      jumps: list.length - 1,
      dimensionId: dimension.id,
      heading: headingFromView(player),
      start: list[0],
      checkpoints: list.slice(1, list.length - 1),
      finish: list[list.length - 1],
      custom: true,
    },
    { useCheckpoints: true }
  );
}

/* ------------------------------------------------------------------ *
 * Leap Charm
 * ------------------------------------------------------------------ */

export function leap(player) {
  const cooling = safe(() => player.getItemCooldown?.(CONFIG.leap.cooldownCategory)) ?? 0;
  if (cooling > 0) return;

  const view = safe(() => player.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
  if (!launch(player, view)) return;

  safe(() => player.startItemCooldown(CONFIG.leap.cooldownCategory, CONFIG.leap.cooldownTicks));
  // A leap outside a run should not be able to kill you on landing.
  safe(() => player.addEffect("resistance", 80, { amplifier: 4, showParticles: false }));
  sound(player, "mob.bat.takeoff", 1.4);
  safe(() => player.dimension.spawnParticle("minecraft:villager_happy", player.location));
}

/** applyKnockback changed shape between script API versions; support both. */
function launch(player, view) {
  const { horizontal, vertical } = CONFIG.leap;
  try {
    player.applyKnockback(view.x, view.z, horizontal, vertical);
    return true;
  } catch {
    try {
      player.applyKnockback({ x: view.x * horizontal, z: view.z * horizontal }, vertical);
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Kit
 * ------------------------------------------------------------------ */

export function giveKit(player, full) {
  if (!hasItem(player, ITEMS.COMPASS)) giveItem(player, ITEMS.COMPASS);
  if (full) {
    if (!hasItem(player, ITEMS.MARKER)) giveItem(player, ITEMS.MARKER);
    if (!hasItem(player, ITEMS.CHARM)) giveItem(player, ITEMS.CHARM);
  }
}
