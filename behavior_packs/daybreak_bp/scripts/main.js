/*
 * Daybreak - entry point.
 *
 * Target: Minecraft Bedrock 1.21.0 (Android / Pocket Edition).
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles).
 *
 * Three loops and nothing else:
 *
 *   fast  (10 ticks)  sun exposure and atmosphere, per player
 *   slow  (100 ticks) creatures, survivors, radio, objectives
 *   build (1 tick)    drains the structure queue, and returns immediately
 *                     when there is nothing queued
 *
 * Every subscription below is wrapped, so a build that is missing one event
 * loses that single feature instead of the whole add-on.
 */

import { system, world } from "@minecraft/server";
import { CONFIG, MSG, NS } from "./config.js";
import { BLUEPRINTS } from "./blueprints.js";
import { enqueue, queueLength, tickBuilder } from "./builder.js";
import {
  forgetEntity, monsterPopulation, onEntityDie, onEntityHurt, tickCreatures,
} from "./creatures.js";
import { onItemUseOn } from "./doors.js";
import { onItemCompleteUse, onItemUse } from "./items.js";
import {
  OBJECTIVES, announceObjective, briefing, giveStarterKit, resetPlayer,
  startScenario, tickObjectives,
} from "./progress.js";
import {
  forgetPlayer, noteWeather, resetExposure, stateOf, sunIntensity, tickPlayerSun,
} from "./sun.js";
import { clearAtmosphere, tickCycle, updateAtmosphere } from "./world_cycle.js";
import { broadcast, despawn, nearbyEntities, safe, tell, title } from "./util.js";

const VERSION = "1.0.0";

/* --------------------------------------------------------------- helpers */

/** Creative and spectator players are spectators of the apocalypse. */
function exemptPlayers() {
  const exempt = new Set();
  for (const mode of ["creative", "spectator"]) {
    for (const player of safe(() => world.getPlayers({ gameMode: mode }), [])) {
      exempt.add(player.id);
    }
  }
  return exempt;
}

function subscribe(target, handler, name) {
  try {
    target.subscribe(handler);
  } catch {
    console.warn(`[Daybreak] event unavailable on this build: ${name}`);
  }
}

/* ------------------------------------------------------------------ loops */

function fastLoop() {
  const players = world.getPlayers();
  if (players.length === 0) return;

  const intensity = sunIntensity();
  const exempt = intensity > 0 ? exemptPlayers() : undefined;

  for (const player of players) {
    const reading = safe(
      () => tickPlayerSun(player, intensity, exempt?.has(player.id) === true),
      undefined
    );
    updateAtmosphere(player, reading?.sky ?? 0);
  }
}

function slowLoop() {
  safe(() => tickCycle());
  safe(() => tickCreatures());
  for (const player of world.getPlayers()) safe(() => tickObjectives(player));
}

/* ------------------------------------------------------------- structures */

function originFor(entity, spec) {
  const location = entity ? entity.location : { x: 0, y: 64, z: 0 };
  const depth = spec.depth ?? 0;
  const y = Math.max(-56, Math.floor(location.y) - depth);
  return {
    x: Math.floor(location.x) + (spec.wide ? 10 : 6),
    y,
    z: Math.floor(location.z) + 6,
  };
}

function buildStructure(key, entity) {
  const spec = BLUEPRINTS[key];
  if (!spec) {
    if (entity) tell(entity, `${MSG.tag} §cUnknown structure "${key}".`);
    return;
  }
  if (queueLength() > 0) {
    if (entity) tell(entity, `${MSG.tag} §7Still building. Try again in a moment.`);
    return;
  }

  const dimension = entity ? entity.dimension : world.getDimension("overworld");
  const origin = originFor(entity, spec);
  const count = enqueue(dimension, spec.build(spec.depth ?? 0), origin, spec.label);

  const message =
    `${MSG.tag} §7Building §f${spec.label}§7 at §f${origin.x} ${origin.y} ${origin.z}§7 ` +
    `(${count} operations).`;
  if (entity) tell(entity, message);
  else broadcast(message);
}

function resetScenario(entity) {
  const players = world.getPlayers();
  let removed = 0;
  for (const player of players) {
    resetPlayer(player);
    clearAtmosphere(player.id);
    safe(() => player.runCommand("fog @s remove daybreak_mood"));
    safe(() => player.runCommand("fog @s remove daybreak_burn"));
    for (const monster of nearbyEntities(player.dimension, player.location, {
      families: ["daybreak_monster"],
      maxDistance: 128,
    })) {
      despawn(monster);
      forgetEntity(monster.id);
      removed += 1;
    }
  }
  broadcast(`${MSG.tag} §7Scenario reset. Removed §f${removed}§7 Daybreak creatures.`);
}

function statusReport(entity) {
  const lines = [
    `${MSG.tag} §fDaybreak v${VERSION}`,
    `§7Sun intensity: §f${Math.round(sunIntensity() * 100)}%`,
    `§7Loaded creatures: §f${monsterPopulation()}§7 / §f${CONFIG.creatures.globalCap}`,
    `§7Build queue: §f${queueLength()}§7 operations`,
  ];
  if (entity) {
    const state = stateOf(entity);
    lines.push(`§7Your exposure: §f${Math.round(state.exposure ?? 0)}%`);
    if (state.started && state.objective >= 0) {
      lines.push(`§7Objective §f${state.objective + 1}§7/§f${OBJECTIVES.length}`);
    }
    for (const line of lines) tell(entity, line);
  } else {
    for (const line of lines) broadcast(line);
  }
}

/* ------------------------------------------------------------ script events */

function onScriptEvent(event) {
  const id = event.id;
  const message = (event.message ?? "").trim();
  const entity = event.sourceEntity;

  if (id === `${NS}:start`) {
    const players = entity ? [entity] : world.getPlayers();
    for (const player of players) safe(() => startScenario(player, true));
    return;
  }
  if (id === `${NS}:give_items`) {
    const players = entity ? [entity] : world.getPlayers();
    for (const player of players) safe(() => giveStarterKit(player));
    return;
  }
  if (id === `${NS}:build`) {
    buildStructure(message || "facility", entity);
    return;
  }
  if (id === `${NS}:spawn_facility`) {
    buildStructure("facility", entity);
    return;
  }
  if (id === `${NS}:reset`) {
    resetScenario(entity);
    return;
  }
  if (id === `${NS}:status`) {
    statusReport(entity);
    return;
  }
  if (id === `${NS}:briefing`) {
    const players = entity ? [entity] : world.getPlayers();
    for (const player of players) {
      briefing(player);
      const state = stateOf(player);
      if (state.started) announceObjective(player, state);
    }
  }
}

/* ------------------------------------------------------------------- wire */

function boot() {
  system.runInterval(() => safe(fastLoop), CONFIG.stepTicks);
  system.runInterval(() => safe(slowLoop), CONFIG.slowTicks);
  system.runInterval(
    () => safe(() => tickBuilder((label, done, failed) => {
      broadcast(
        `${MSG.tag} §aFinished §f${label}§a.` +
        (failed > 0 ? ` §7(${done} placed, ${failed} skipped)` : "")
      );
    })),
    1
  );

  subscribe(world.afterEvents.entityDie, (event) => safe(() => onEntityDie(event)), "entityDie");
  subscribe(world.afterEvents.entityHurt, (event) => safe(() => onEntityHurt(event)), "entityHurt");
  subscribe(world.afterEvents.itemUse, (event) => safe(() => onItemUse(event)), "itemUse");
  subscribe(
    world.afterEvents.itemCompleteUse,
    (event) => safe(() => onItemCompleteUse(event)),
    "itemCompleteUse"
  );
  subscribe(world.afterEvents.itemUseOn, (event) => safe(() => onItemUseOn(event)), "itemUseOn");

  subscribe(world.afterEvents.playerSpawn, (event) => safe(() => {
    const player = event.player;
    resetExposure(player);
    clearAtmosphere(player.id);
    // Fog pushed by a previous session is still on this player's stack.
    safe(() => player.runCommand("fog @s remove daybreak_mood"));
    safe(() => player.runCommand("fog @s remove daybreak_burn"));
    if (!event.initialSpawn) return;
    title(player, "§6DAYBREAK", "§7Run /function daybreak_start", 8, 60, 20);
    tell(player, `${MSG.tag} §fDaybreak v${VERSION} loaded.`);
    tell(player, "§7Begin with §f/function daybreak_start§7 or the Daybreak Survival Starter.");
  }), "playerSpawn");

  subscribe(world.afterEvents.playerLeave, (event) => safe(() => {
    forgetPlayer(event.playerId);
    clearAtmosphere(event.playerId);
  }), "playerLeave");

  subscribe(world.afterEvents.weatherChange, (event) => safe(() => {
    const state = event.newWeather ?? (event.lightning ? "Thunder" : event.raining ? "Rain" : "Clear");
    noteWeather(String(state).toLowerCase());
  }), "weatherChange");

  try {
    system.afterEvents.scriptEventReceive.subscribe(
      (event) => safe(() => onScriptEvent(event)),
      { namespaces: [NS] }
    );
  } catch {
    subscribe(
      system.afterEvents.scriptEventReceive,
      (event) => safe(() => onScriptEvent(event)),
      "scriptEventReceive"
    );
  }

  console.warn(`[Daybreak] v${VERSION} online - the sun is hostile.`);
}

boot();
