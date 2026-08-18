/*
 * Daybreak - the scenario and its progression.
 *
 * The objective list is the spine of the survival experience: it tells a new
 * player what to do next without a single tutorial screen, and each check is
 * cheap enough to run once every five seconds for the *current* objective
 * only.
 */

import { world } from "@minecraft/server";
import { ACCESS_CARDS, MSG, NS } from "./config.js";
import { HOOD, SUIT_PIECES, resetExposure, stateOf, sunIntensity } from "./sun.js";
import {
  ARMOUR_SLOTS, bestCardLevel, broadcast, carriesAny, give, nearbyEntities,
  playerSound, safe, tell, title, wornId,
} from "./util.js";

const STARTER_KIT = [
  [`${NS}:flashlight`, 1],
  [`${NS}:battery`, 3],
  [`${NS}:canned_food`, 4],
  [`${NS}:emergency_water`, 3],
  [`${NS}:medical_kit`, 2],
  [`${NS}:emergency_flare`, 3],
  [`${NS}:sun_hood`, 1],
  [`${NS}:uv_detector`, 1],
  [`${NS}:radio`, 1],
  [`${NS}:research_document`, 1],
  ["minecraft:torch", 24],
  ["minecraft:iron_pickaxe", 1],
  ["minecraft:iron_shovel", 1],
];

const SUPPLY_IDS = [
  `${NS}:canned_food`, `${NS}:emergency_water`, `${NS}:medical_kit`,
  `${NS}:battery`, `${NS}:scrap_plating`, `${NS}:flashlight`,
];

function wearingSuitPieces(player) {
  let count = 0;
  let hood = false;
  for (const slot of ARMOUR_SLOTS) {
    const id = wornId(player, slot);
    if (!id) continue;
    if (SUIT_PIECES.has(id)) count += 1;
    else if (id === HOOD) hood = true;
  }
  return { count, hood };
}

function markerNear(player, marker, distance) {
  return nearbyEntities(player.dimension, player.location, {
    type: `${NS}:${marker}`,
    maxDistance: distance,
  }).length > 0;
}

export const OBJECTIVES = [
  {
    text: "Get under a solid roof before the sun finds you.",
    done: "You are covered. That is the whole game now.",
    check: (ctx) => ctx.intensity > 0.3 && ctx.sky <= 0.15,
  },
  {
    text: "Search the ruins for supplies.",
    done: "Supplies secured.",
    check: (ctx) => carriesAny(ctx.player, SUPPLY_IDS),
  },
  {
    text: "Travel while the sun is down.",
    done: "Night is your road. Use all of it.",
    check: (ctx) => ctx.intensity <= 0.02 && ctx.sky > 0.5,
  },
  {
    text: "Find an abandoned research site.",
    done: "Site located. Something down there still has power.",
    check: (ctx) => markerNear(ctx.player, "alarm_marker", 30),
  },
  {
    text: "Take an access card off the site.",
    done: "Clearance acquired.",
    check: (ctx) => bestCardLevel(ctx.player, ACCESS_CARDS) > 0,
  },
  {
    text: "Find protective equipment.",
    done: "Protection online. It buys minutes, not immunity.",
    check: (ctx) => {
      const worn = wearingSuitPieces(ctx.player);
      return worn.count > 0 || worn.hood;
    },
  },
  {
    text: "Rescue a survivor. Feed them, and they will follow.",
    done: "They are with you now. Keep them out of the light.",
    check: (ctx) =>
      nearbyEntities(ctx.player.dimension, ctx.player.location, {
        families: ["daybreak_rescued"],
        maxDistance: 24,
      }).length > 0,
  },
  {
    text: "Establish a permanent bunker the light cannot reach.",
    done: "Bunker established.",
    check: (ctx) => ctx.player.location.y < 45 && ctx.sky <= 0.02,
  },
  {
    text: "Push into a contaminated zone.",
    done: "You are inside a Daybreak zone. Do not linger.",
    check: (ctx) => markerNear(ctx.player, "contamination_marker", 24),
  },
  {
    text: "Wear the complete suit and stand in open daylight.",
    done: "You walked under it and came back. Nobody else has.",
    check: (ctx) => wearingSuitPieces(ctx.player).count === 4
      && ctx.sky > 0.5 && ctx.intensity > 0.6,
  },
];

export function giveStarterKit(player) {
  for (const [id, amount] of STARTER_KIT) give(player, id, amount);
  playerSound(player, "random.levelup", 0.8, 1.2);
}

export function briefing(player) {
  tell(player, `${MSG.tag} §cEMERGENCY BROADCAST §8— §fTHE SUN IS NO LONGER SAFE.`);
  tell(player, "§7Anything alive under open sky comes apart. A solid roof stops it.");
  tell(player, "§7Glass does not. Cloud and rain slow it. Only night is safe.");
  tell(player, "§7Travel at dark. Sleep under stone. Rescue who you can.");
}

export function startScenario(player, setTime) {
  const state = stateOf(player);
  state.started = true;
  state.objective = 0;
  resetExposure(player);

  if (setTime) {
    safe(() => world.setTimeOfDay(22000));
    safe(() => player.dimension.runCommand("time set 22000"));
    safe(() => player.dimension.runCommand("weather clear"));
  }

  title(player, "§6DAYBREAK", "§7When Day Breaks", 6, 60, 20);
  briefing(player);
  giveStarterKit(player);
  announceObjective(player, state);
  playerSound(player, "beacon.activate", 1, 0.6);
}

export function announceObjective(player, state) {
  const objective = OBJECTIVES[state.objective];
  if (!objective) return;
  tell(player, `§8[§eOBJECTIVE ${state.objective + 1}/${OBJECTIVES.length}§8] §f${objective.text}`);
}

/** Runs on the slow loop for players who have started the scenario. */
export function tickObjectives(player) {
  const state = stateOf(player);
  if (!state.started || state.objective < 0) return;
  const objective = OBJECTIVES[state.objective];
  if (!objective) return;

  const ctx = {
    player,
    state,
    sky: state.lastSky ?? 0,
    intensity: sunIntensity(),
  };

  let passed = false;
  try {
    passed = objective.check(ctx) === true;
  } catch {
    passed = false;
  }
  if (!passed) return;

  title(player, "§aOBJECTIVE COMPLETE", `§7${objective.done}`, 4, 45, 12);
  playerSound(player, "random.levelup", 0.7, 1.4);
  state.objective += 1;

  if (state.objective >= OBJECTIVES.length) {
    state.objective = -1;
    broadcast(`${MSG.tag} §a${player.name} has survived everything the sun has.`);
    return;
  }
  announceObjective(player, state);
}

export function resetPlayer(player) {
  const state = stateOf(player);
  state.started = false;
  state.objective = -1;
  resetExposure(player);
}
