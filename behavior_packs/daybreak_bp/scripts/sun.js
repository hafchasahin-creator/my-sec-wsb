/*
 * Daybreak - the deadly sun.
 *
 * The whole add-on hangs off one question: is there enough solid matter
 * between this player and the sky? `skyExposure` answers it by walking the
 * block column above the player's head, stopping at the first thing that
 * blocks light and multiplying through anything that merely filters it. Glass
 * filters. It does not stop.
 *
 * Cost control:
 *   - nothing runs at all while the sun is down,
 *   - the column walk stops at the first solid block, so anyone underground
 *     costs one or two block reads,
 *   - the walk is capped at 128 blocks,
 *   - a standing-still player reuses the previous result for a few steps,
 *   - block classification is memoised per block type.
 */

import { world } from "@minecraft/server";
import { CONFIG, MSG, NS } from "./config.js";
import {
  actionBar, addEffect, ARMOUR_SLOTS, broadcast, clamp, despawn, particle,
  playerSound, popFog, pushFog, safe, shake, spawn, title, wearDown, wornId,
} from "./util.js";

const SUIT_PIECES = new Set([
  `${NS}:suit_helmet`,
  `${NS}:suit_chestplate`,
  `${NS}:suit_leggings`,
  `${NS}:suit_boots`,
]);

const HOOD = `${NS}:sun_hood`;

/* ---------------------------------------------------------- block filters */

// Fraction of anomalous light a block type lets through.
const FILTER_RULES = [
  [/tinted_glass/, 0.12],
  [/glass_pane|glass_block|stained_glass_pane/, 0.55],
  [/glass/, 0.45],
  [/leaves/, 0.35],
  [/blue_ice|packed_ice/, 0.3],
  [/\bice\b|frosted_ice/, 0.5],
  [/water|bubble_column/, 0.55],
  [/slime|honey/, 0.6],
  [/iron_bars|chain|scaffolding|web|cobweb|fence|wall\b/, 0.85],
  [/light_block|barrier|structure_void|invisible_bedrock/, 1.0],
];

// Things that are technically not air but obviously do not roof anything.
const NEVER_BLOCKS = /torch|flower|sapling|grass|fern|vine|rail|button|lever|carpet|snow_layer|sign|banner|redstone_wire|tripwire|pressure_plate|ladder|lantern|candle|mushroom|coral|kelp|seagrass|string|item_frame|pointed_dripstone|azalea|moss_carpet|amethyst_cluster|bud/;

const filterCache = new Map();

function classify(block) {
  const id = block.typeId;
  const cached = filterCache.get(id);
  if (cached !== undefined) return cached;

  let value = 0; // 0 = blocks everything, 1 = passes everything
  const bare = id.replace("minecraft:", "");

  let matched = false;
  for (const [pattern, fraction] of FILTER_RULES) {
    if (pattern.test(bare)) {
      value = fraction;
      matched = true;
      break;
    }
  }

  if (!matched) {
    // `isSolid` has been both a property and a method across API versions.
    const solid = typeof block.isSolid === "function"
      ? safe(() => block.isSolid())
      : block.isSolid;
    if (solid === true) value = 0;
    else if (solid === false) value = 1;
    else value = NEVER_BLOCKS.test(bare) ? 1 : 0; // unknown API: assume a roof
  }

  filterCache.set(id, value);
  return value;
}

/**
 * How much of the sky reaches this column: 1 = wide open, 0 = fully covered.
 * `limit` caps how far up we are willing to look.
 */
export function skyExposure(dimension, location, limit = CONFIG.sun.scanHeight) {
  if (dimension.id !== "minecraft:overworld") return 0;

  const x = Math.floor(location.x);
  const z = Math.floor(location.z);
  const start = Math.floor(location.y) + 1;
  const top = Math.min(start + limit, CONFIG.sun.worldTop);

  let factor = 1;
  for (let y = start; y <= top; y++) {
    const block = safe(() => dimension.getBlock({ x, y, z }));
    if (!block) return factor; // outside the loaded world - treat as open sky
    if (block.isAir) continue;

    const pass = classify(block);
    if (pass >= 1) continue;
    if (pass <= 0) return 0;

    factor *= pass;
    if (factor < 0.06) return 0;
  }
  return factor;
}

/* ------------------------------------------------------------- sun output */

/** 0 at night, 1 at noon, with soft ramps at dawn and dusk. */
export function sunIntensity() {
  const time = safe(() => world.getTimeOfDay(), 0) ?? 0;
  const { nightStart, dayStart } = CONFIG.cycle;

  if (time >= dayStart) return 0.15 + 0.65 * ((time - dayStart) / (24000 - dayStart));
  if (time < 1000) return 0.8 + 0.2 * (time / 1000);
  if (time < 11000) return 1;
  if (time < 12200) return 1 - 0.65 * ((time - 11000) / 1200);
  if (time < nightStart) return 0.35 * (1 - (time - 12200) / (nightStart - 12200));
  return 0;
}

let trackedWeather = "clear";

export function noteWeather(name) {
  trackedWeather = name;
}

export function weatherFactor(dimension) {
  const raw = safe(() => String(dimension.getWeather()).toLowerCase(), undefined);
  const state = raw ?? trackedWeather;
  if (state.includes("thunder")) return CONFIG.sun.weather.thunder;
  if (state.includes("rain")) return CONFIG.sun.weather.rain;
  return CONFIG.sun.weather.clear;
}

/* ---------------------------------------------------------- player state */

const states = new Map();

export function stateOf(player) {
  let state = states.get(player.id);
  if (!state) {
    state = {
      exposure: 0,
      tier: -1,
      burning: false,
      cacheKey: "",
      cacheValue: 0,
      cacheAge: 99,
      lastSky: 0,
      step: 0,
      objective: -1,
      started: false,
    };
    states.set(player.id, state);
  }
  return state;
}

export function forgetPlayer(playerId) {
  states.delete(playerId);
}

export function resetExposure(player) {
  const state = stateOf(player);
  state.exposure = 0;
  state.tier = -1;
  if (state.burning) {
    popFog(player, "daybreak_burn");
    state.burning = false;
  }
}

/* -------------------------------------------------------------- exposure */

/** Multiplier left after protective gear - lower is safer. */
function protectionFactor(player) {
  let factor = 1;
  let pieces = 0;

  for (const slot of ARMOUR_SLOTS) {
    const id = wornId(player, slot);
    if (!id) continue;
    if (SUIT_PIECES.has(id)) {
      pieces += 1;
      factor *= CONFIG.sun.protection.suitPiece;
    } else if (id === HOOD) {
      factor *= CONFIG.sun.protection.hood;
    }
  }
  if (pieces === 4) factor *= CONFIG.sun.protection.fullSetBonus;
  return factor;
}

function wearProtection(player) {
  for (const slot of ARMOUR_SLOTS) {
    const id = wornId(player, slot);
    if (!id) continue;
    if (SUIT_PIECES.has(id)) wearDown(player, slot, CONFIG.sun.protection.suitWear);
    else if (id === HOOD) wearDown(player, slot, CONFIG.sun.protection.hoodWear);
  }
}

function meterBar(value) {
  const filled = clamp(Math.round(value / 10), 0, 10);
  return `§8[${"§c█".repeat(filled)}${"§7█".repeat(10 - filled)}§8]`;
}

function applyTier(player, state, tier) {
  const spec = CONFIG.sun.tiers[tier];
  if (!spec) return;
  title(player, `${spec.colour}${spec.title}`, tier === 2 ? "§7Get under cover. Now." : "",
        2, 25, 8);
  playerSound(player, tier === 2 ? "random.fizz" : "note.bass", 0.9, tier === 2 ? 0.6 : 0.7);
}

function transform(player, state) {
  const location = player.location;
  const dimension = player.dimension;

  title(player, MSG.transform, MSG.transformSub, 2, 45, 12);
  particle(dimension, "minecraft:large_explosion", location);
  safe(() => dimension.playSound("mob.zombie.death", location, { pitch: 0.4 }));
  broadcast(`${MSG.tag} ${MSG.died.replace("%s", player.name)}`);

  const husk = spawn(dimension, `${NS}:melted_survivor`, location);
  if (husk) safe(() => (husk.nameTag = player.name));

  state.exposure = 0;
  state.tier = -1;
  if (state.burning) {
    popFog(player, "daybreak_burn");
    state.burning = false;
  }
  const killed = safe(() => {
    player.kill();
    return true;
  }, false);
  if (!killed) safe(() => player.applyDamage(1000));
}

/**
 * One exposure step for one player. Returns the sky factor so the caller can
 * reuse it (the detector and the atmosphere system both want it).
 */
export function tickPlayerSun(player, intensity, exempt) {
  const state = stateOf(player);
  state.step += 1;

  let sky = 0;
  if (intensity > 0 && !exempt) {
    const key = `${Math.floor(player.location.x)},${Math.floor(player.location.y)},${Math.floor(player.location.z)}`;
    if (key === state.cacheKey && state.cacheAge < CONFIG.sun.cacheSteps) {
      sky = state.cacheValue;
      state.cacheAge += 1;
    } else {
      sky = skyExposure(player.dimension, safe(() => player.getHeadLocation(), player.location));
      state.cacheKey = key;
      state.cacheValue = sky;
      state.cacheAge = 0;
    }
  }

  state.lastSky = sky;
  const weather = sky > 0 ? weatherFactor(player.dimension) : 1;
  const raw = intensity * weather * sky;
  const effective = raw * protectionFactor(player);

  if (effective > 0.02) {
    state.exposure = clamp(state.exposure + CONFIG.sun.risePerStep * effective, 0, 100);
    if (state.step % CONFIG.sun.effectEveryStep === 0) wearProtection(player);
  } else if (state.exposure > 0) {
    const before = state.exposure;
    state.exposure = clamp(state.exposure - CONFIG.sun.fallPerStep, 0, 100);
    if (before > 12 && state.exposure <= 12) actionBar(player, MSG.shelterFound);
  }

  // Tier bookkeeping - messages only fire when the tier actually changes.
  let tier = -1;
  for (let index = CONFIG.sun.tiers.length - 1; index >= 0; index--) {
    if (state.exposure >= CONFIG.sun.tiers[index].at) {
      tier = index;
      break;
    }
  }
  if (tier > state.tier) applyTier(player, state, tier);
  state.tier = tier;

  if (tier >= 0) {
    const spec = CONFIG.sun.tiers[tier];
    actionBar(
      player,
      `${spec.colour}${spec.title} ${meterBar(state.exposure)} §f${Math.round(state.exposure)}%`
    );
  }

  const refresh = state.step % CONFIG.sun.effectEveryStep === 0;
  if (tier >= 1 && refresh) {
    addEffect(player, "weakness", 70, tier >= 2 ? 1 : 0);
    addEffect(player, "slowness", 70, tier >= 2 ? 1 : 0);
    addEffect(player, "nausea", 90, 0);
  }
  if (tier >= 2) {
    if (refresh) {
      safe(() => player.setOnFire(2, false));
      shake(player, 0.12, 0.6);
      particle(player.dimension, "minecraft:basic_flame_particle",
               safe(() => player.getHeadLocation(), player.location));
    }
    if (!state.burning) {
      pushFog(player, `${NS}:critical_burn`, "daybreak_burn");
      state.burning = true;
    }
  } else if (state.burning) {
    popFog(player, "daybreak_burn");
    state.burning = false;
  }

  if (state.exposure >= 100) transform(player, state);

  return { sky, raw, intensity, weather, exposure: state.exposure };
}

/* --------------------------------------------------- creatures in the sun */

/**
 * Survivors and ordinary living things burn too. Called from the slow loop for
 * a small, capped number of entities so this never turns into a per-mob raycast
 * festival on a phone.
 */
export function burnEntityInSun(entity, intensity, counters) {
  if (intensity < 0.35) return false;
  const exposed = skyExposure(entity.dimension, entity.location, 48);
  if (exposed * intensity < 0.3) {
    counters.delete(entity.id);
    return false;
  }

  const ticks = (counters.get(entity.id) ?? 0) + 1;
  counters.set(entity.id, ticks);
  particle(entity.dimension, "minecraft:basic_flame_particle", entity.location);

  if (ticks < CONFIG.creatures.survivorBurnSteps) return false;

  counters.delete(entity.id);
  const dimension = entity.dimension;
  const location = entity.location;
  particle(dimension, "minecraft:large_explosion", location);
  safe(() => dimension.playSound("mob.zombie.death", location, { pitch: 0.5 }));
  despawn(entity);
  spawn(dimension, `${NS}:melted_survivor`, location);
  return true;
}

export { SUIT_PIECES, HOOD };
