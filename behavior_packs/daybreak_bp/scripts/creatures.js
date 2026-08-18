/*
 * Daybreak - creature systems.
 *
 * Assimilation, the population ceiling, mimic chatter, brood spawning and
 * survivor behaviour all live here. Everything runs on the slow loop (once
 * every five seconds) and every query is bounded by a radius, so the cost of
 * this module does not grow with world size - only with how many players are
 * online.
 *
 * The population ceiling is deliberately aggressive. An infected world that
 * spreads without limit is exactly the thing that freezes a phone, so
 * conversions are refused once the ceiling is reached and anything that has
 * wandered far from every player is deleted rather than left ticking.
 */

import { world } from "@minecraft/server";
import {
  ASSIMILATION_VICTIMS, CONFIG, CONVERSION_TABLE, MIMIC_LINES, NS,
  SUPPLY_GIFTS, SURVIVOR_IDS,
} from "./config.js";
import { burnEntityInSun, sunIntensity } from "./sun.js";
import {
  addEffect, chance, despawn, distanceSquared, dragTowards, dropItem,
  nearbyEntities, particle, pick, playerSound, safe, spawn, weightedPick,
} from "./util.js";

const MONSTER_IDS = new Set([
  `${NS}:melted_survivor`,
  `${NS}:flesh_mass`,
  `${NS}:crawling_melt`,
  `${NS}:flesh_assimilator`,
  `${NS}:mimic_survivor`,
]);

const burnCounters = new Map(); // entity id -> consecutive sunlit slow ticks
let population = 0;

export function monsterPopulation() {
  return population;
}

export function hasHeadroom(extra = 1) {
  return population + extra <= CONFIG.creatures.globalCap;
}

/** Spawn a converted creature, respecting the population ceiling. */
export function assimilate(dimension, location, forced) {
  if (!hasHeadroom()) return undefined;
  const id = forced ?? weightedPick(CONVERSION_TABLE).id;
  particle(dimension, "minecraft:large_explosion", location);
  safe(() => dimension.playSound("mob.zombie.remedy", location, { volume: 0.8, pitch: 0.5 }));
  const born = spawn(dimension, id, location);
  if (born) population += 1;
  return born;
}

/* --------------------------------------------------------- world events */

export function onEntityDie(event) {
  const victim = event.deadEntity;
  const killer = event.damageSource?.damagingEntity;
  if (!victim || !killer) return;

  const killerId = safe(() => killer.typeId, "");
  if (!killerId || !killerId.startsWith(`${NS}:`)) return;
  if (!MONSTER_IDS.has(killerId)) return;

  const victimId = safe(() => victim.typeId, "");
  if (!ASSIMILATION_VICTIMS.has(victimId)) return;
  if (!chance(CONFIG.creatures.assimilateChance)) return;

  const dimension = safe(() => victim.dimension);
  const location = safe(() => victim.location);
  if (!dimension || !location) return;
  assimilate(dimension, location);
}

/** Melted Survivors do not just hit you - they haul you towards open sky. */
export function onEntityHurt(event) {
  const attacker = event.damageSource?.damagingEntity;
  const victim = event.hurtEntity;
  if (!attacker || !victim) return;
  const attackerId = safe(() => attacker.typeId, "");
  if (attackerId !== `${NS}:melted_survivor`) return;
  if (safe(() => victim.typeId, "") !== "minecraft:player") return;
  dragTowards(victim, attacker, CONFIG.creatures.dragStrength);
  safe(() => victim.dimension.playSound("mob.zombie.woodbreak", victim.location, {
    volume: 0.6, pitch: 0.5,
  }));
}

/* ------------------------------------------------------------- reactions */

/** Sunrise is coming: the monsters get bolder. */
export function agitateMonsters() {
  for (const player of world.getPlayers()) {
    const list = nearbyEntities(player.dimension, player.location, {
      families: ["daybreak_monster"],
      maxDistance: 48,
    });
    for (const monster of list) {
      addEffect(monster, "speed", 400, 0);
      particle(monster.dimension, "minecraft:basic_flame_particle", monster.location);
    }
  }
}

/** Sunrise is coming: the survivors run for cover. */
export function alertSurvivors() {
  for (const player of world.getPlayers()) {
    const list = nearbyEntities(player.dimension, player.location, {
      families: ["survivor"],
      maxDistance: 48,
    });
    for (const survivor of list) {
      safe(() => survivor.triggerEvent(`${NS}:panic`));
      addEffect(survivor, "speed", 600, 1);
    }
  }
}

export function calmSurvivors() {
  for (const player of world.getPlayers()) {
    const list = nearbyEntities(player.dimension, player.location, {
      families: ["survivor"],
      maxDistance: 48,
    });
    for (const survivor of list) safe(() => survivor.triggerEvent(`${NS}:calm`));
  }
}

/* ------------------------------------------------------------- slow loop */

function cullAndCount(players) {
  const monsters = new Map();
  for (const player of players) {
    for (const monster of nearbyEntities(player.dimension, player.location, {
      families: ["daybreak_monster"],
      maxDistance: CONFIG.creatures.perPlayerRadius,
    })) {
      monsters.set(monster.id, monster);
    }
  }

  const scored = [];
  for (const monster of monsters.values()) {
    let nearest = Infinity;
    for (const player of players) {
      if (player.dimension.id !== monster.dimension.id) continue;
      const distance = safe(() => distanceSquared(player.location, monster.location), Infinity);
      if (distance < nearest) nearest = distance;
    }
    scored.push({ monster, distance: nearest });
  }

  const cull = CONFIG.creatures.cullDistance * CONFIG.creatures.cullDistance;
  let alive = [];
  for (const entry of scored) {
    if (entry.distance > cull) despawn(entry.monster);
    else alive.push(entry);
  }

  // Still over budget? Drop the ones nobody is looking at first.
  if (alive.length > CONFIG.creatures.globalCap) {
    alive.sort((a, b) => b.distance - a.distance);
    const excess = alive.length - CONFIG.creatures.globalCap;
    for (let index = 0; index < excess; index++) despawn(alive[index].monster);
    alive = alive.slice(excess);
  }

  population = alive.length;
  return alive.map((entry) => entry.monster);
}

function tickMimics(player, survivors) {
  if (!chance(CONFIG.creatures.mimicSpeakChance)) return;
  const radius = CONFIG.creatures.mimicSpeakRadius;
  for (const entity of survivors) {
    if (safe(() => entity.typeId, "") !== `${NS}:mimic_survivor`) continue;
    const variant = safe(() => entity.getComponent("minecraft:variant")?.value, 0);
    if (variant) continue; // already dropped the act
    if (safe(() => distanceSquared(player.location, entity.location), 1e9) > radius * radius) {
      continue;
    }
    safe(() => player.sendMessage(`§8[§7?§8] §f"${pick(MIMIC_LINES)}"`));
    playerSound(player, "mob.villager.idle", 0.5, 0.85);
    return; // at most one line per player per pass
  }
}

function tickAssimilators(monsters) {
  for (const monster of monsters) {
    if (safe(() => monster.typeId, "") !== `${NS}:flesh_assimilator`) continue;
    if (!chance(CONFIG.creatures.assimilatorChance)) continue;
    if (!hasHeadroom()) return;

    const victims = nearbyEntities(monster.dimension, monster.location, {
      maxDistance: CONFIG.creatures.assimilatorRadius,
    });
    for (const victim of victims) {
      const id = safe(() => victim.typeId, "");
      if (!ASSIMILATION_VICTIMS.has(id)) continue;
      const dimension = victim.dimension;
      const location = victim.location;
      despawn(victim);
      assimilate(dimension, location);
      break;
    }
  }
}

function tickBrood(monsters) {
  for (const monster of monsters) {
    if (safe(() => monster.typeId, "") !== `${NS}:flesh_mass`) continue;
    if (!chance(CONFIG.creatures.massSpawnChance)) continue;
    if (!hasHeadroom()) return;

    const brood = nearbyEntities(monster.dimension, monster.location, {
      type: `${NS}:crawling_melt`,
      maxDistance: 14,
    });
    if (brood.length >= CONFIG.creatures.massBroodLimit) continue;
    assimilate(monster.dimension, monster.location, `${NS}:crawling_melt`);
  }
}

function tickSurvivors(player, survivors, intensity) {
  let checks = 0;
  for (const survivor of survivors) {
    if (!SURVIVOR_IDS.has(safe(() => survivor.typeId, ""))) continue;
    if (checks >= CONFIG.creatures.survivorChecksPerTick) break;
    checks += 1;
    burnEntityInSun(survivor, intensity, burnCounters);
  }

  for (const helper of nearbyEntities(player.dimension, player.location, {
    families: ["daybreak_rescued"],
    maxDistance: 16,
  })) {
    if (!chance(CONFIG.creatures.giftChance)) continue;
    dropItem(helper.dimension, pick(SUPPLY_GIFTS), helper.location);
    safe(() => player.sendMessage("§8[§aSURVIVOR§8] §7Here. Take it, I have more."));
    playerSound(player, "random.pop", 0.8, 1.1);
  }
}

export function tickCreatures() {
  const players = world.getPlayers();
  if (players.length === 0) {
    population = 0;
    return;
  }

  const monsters = cullAndCount(players);
  const intensity = sunIntensity();

  tickAssimilators(monsters);
  tickBrood(monsters);

  for (const player of players) {
    const survivors = nearbyEntities(player.dimension, player.location, {
      families: ["survivor"],
      maxDistance: 48,
    });
    tickMimics(player, survivors);
    tickSurvivors(player, survivors, intensity);
  }
}

export function forgetEntity(entityId) {
  burnCounters.delete(entityId);
}
