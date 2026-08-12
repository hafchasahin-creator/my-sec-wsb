/*
 * Dangerous Fungi - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Android / Pocket Edition, build 1.21.0.26)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles needed)
 *
 * Mobile budget
 * -------------
 * The aura system never scans a whole region in one tick. A player's
 * surroundings are swept once per second, but the sweep is sliced across the
 * twenty ticks of that second, so the per-tick cost is a few dozen getBlock
 * calls per player and nothing else. Particles, entity queries and spreading
 * all run against hard global budgets that cannot grow with world size.
 *
 * Everything cosmetic is wrapped: one unsupported particle or sound id on one
 * device degrades that single effect instead of taking the add-on down.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
  BlockPermutation,
} from "@minecraft/server";

import { SPECIES, BY_ID, EQUIPMENT, DANGER_NAMES, DANGER_BLOCK, VERSION } from "./fungi_data.js";

/* ------------------------------------------------------------------ *
 * Tuning - everything a player might want to change lives here.
 * ------------------------------------------------------------------ */

const CONFIG = {
  // Aura sweep.
  cycleTicks: 20, // one full sweep per second
  scanRadius: 6, // must be >= the largest species range
  scanDown: 3, // blocks below the player's feet
  scanUp: 2, // blocks above the player's feet
  maxHits: 24, // stop collecting once this many growths are found

  // Cosmetics.
  particleBudget: 6, // particle emissions per cycle, whole server
  contactRange: 1.7, // "standing in it" distance

  // Protection. The full set is strong but deliberately short of immunity:
  // at 0.65 a Level III aura still lands a reduced hit rather than nothing at
  // all, while short effects fall under the 20-tick floor and are prevented
  // outright. Level V is capped harder still.
  fullSetReduction: 0.65, // complete hazard set
  maskReduction: 0.12, // spore mask alone
  pieceReduction: { head: 0.18, chest: 0.18, legs: 0.14, feet: 0.14 },
  maxPartialReduction: 0.5, // a partial kit must stay worse than the full set
  catastrophicCap: 0.4, // no gear fully stops a Level V species
  minDamage: 0.25, // below this a hit is dropped entirely

  // Infection (Parasite Bloom / Mycelium-X).
  infectionTicks: 1200, // 60s
  infectionPulse: 100, // reapply every 5s
  infectionMaxStacks: 3,

  // Spreading.
  spreadIntervalTicks: 200, // one attempt per 10s, server-wide
  spreadPerPass: 1, // never more than one new block per pass
  spreadSearchTries: 6,

  // Entity damage from the few species that hurt mobs too.
  mobQueryBudget: 2, // getEntities calls per cycle, whole server

  // Emergency cleanup.
  cleanupRadius: 12,
  cleanupVertical: 6,
  cleanupPerTick: 320,
};

const MAX_SPECIES_RANGE = SPECIES.reduce((m, s) => Math.max(m, s.range), 0);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Run a cosmetic call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function floorVec(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

function tellRaw(player, text) {
  safe(() => player.sendMessage(text));
}

function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

const DANGER_COLOUR = { 1: "§a", 2: "§e", 3: "§6", 4: "§c", 5: "§d" };

/* ------------------------------------------------------------------ *
 * Scan offsets
 *
 * Built once at load and sorted nearest-first, so the slice that runs each
 * tick is a cheap array walk and the closest growths are always found first
 * even when the per-cycle hit cap kicks in.
 * ------------------------------------------------------------------ */

const OFFSETS = (() => {
  const list = [];
  const r = CONFIG.scanRadius;
  const limit = (r + 0.5) * (r + 0.5);
  for (let dy = -CONFIG.scanDown; dy <= CONFIG.scanUp; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= limit) list.push({ x: dx, y: dy, z: dz, d: Math.sqrt(d2) });
      }
    }
  }
  list.sort((a, b) => a.d - b.d);
  return list;
})();

const SLICE = Math.ceil(OFFSETS.length / CONFIG.cycleTicks);

/* ------------------------------------------------------------------ *
 * Runtime state
 * ------------------------------------------------------------------ */

const scanState = new Map(); // player id -> sweep cursor + hits
const infection = new Map(); // player id -> { ticks, stacks }
let cleanupQueue = null; // { player, positions, index, removed }
let cycle = 0;
let spreadEnabled = true;

// Per-cycle cosmetic budgets, refilled at the top of every tick loop. These
// are what stop a large fungal patch from turning into a particle storm.
let particleBudget = CONFIG.particleBudget;
let mobQueryBudget = CONFIG.mobQueryBudget;

const SPREAD_PROPERTY = "fungi:spread_enabled";

function loadSpreadSetting() {
  const stored = safe(() => world.getDynamicProperty(SPREAD_PROPERTY));
  if (typeof stored === "boolean") spreadEnabled = stored;
}

function saveSpreadSetting() {
  safe(() => world.setDynamicProperty(SPREAD_PROPERTY, spreadEnabled));
}

/* ------------------------------------------------------------------ *
 * Protective equipment
 * ------------------------------------------------------------------ */

function wornIds(player) {
  const equippable = safe(() => player.getComponent("minecraft:equippable"));
  if (!equippable) return {};
  const read = (slot) => safe(() => equippable.getEquipment(slot)?.typeId);
  return {
    head: read(EquipmentSlot.Head),
    chest: read(EquipmentSlot.Chest),
    legs: read(EquipmentSlot.Legs),
    feet: read(EquipmentSlot.Feet),
  };
}

/**
 * Fraction of a fungal effect the player's gear removes, 0..1.
 * The complete hazard set is strong but never total, and against a Level V
 * species it is capped harder still.
 */
function protectionOf(player, danger) {
  const worn = wornIds(player);
  let reduction;

  const fullSet =
    worn.head === EQUIPMENT.head &&
    worn.chest === EQUIPMENT.chest &&
    worn.legs === EQUIPMENT.legs &&
    worn.feet === EQUIPMENT.feet;

  if (fullSet) {
    reduction = CONFIG.fullSetReduction;
  } else {
    let total = 0;
    if (worn.head === EQUIPMENT.head) total += CONFIG.pieceReduction.head;
    else if (worn.head === EQUIPMENT.mask) total += CONFIG.maskReduction;
    if (worn.chest === EQUIPMENT.chest) total += CONFIG.pieceReduction.chest;
    if (worn.legs === EQUIPMENT.legs) total += CONFIG.pieceReduction.legs;
    if (worn.feet === EQUIPMENT.feet) total += CONFIG.pieceReduction.feet;
    reduction = Math.min(CONFIG.maxPartialReduction, total);
  }

  if (danger >= 5) reduction = Math.min(reduction, CONFIG.catastrophicCap);
  return reduction;
}

/* ------------------------------------------------------------------ *
 * Applying a species' aura
 * ------------------------------------------------------------------ */

function applyEffects(player, species, reduction) {
  for (const effect of species.effects) {
    const ticks = Math.floor(effect.ticks * (1 - reduction));
    if (ticks < 20) continue; // fully filtered out by the gear
    let amplifier = effect.amp;
    if (reduction >= 0.5 && amplifier > 0) amplifier -= 1;
    safe(() =>
      player.addEffect(effect.id, ticks, {
        amplifier,
        showParticles: false, // mobile: the block's own particles are enough
      })
    );
  }
}

function applyDamage(player, amount, cause) {
  if (amount < CONFIG.minDamage) return;
  const done = safe(() =>
    player.applyDamage(amount, { cause: cause ?? EntityDamageCause.magic })
  );
  if (done === undefined) safe(() => player.applyDamage(amount));
}

function infect(player, stacks) {
  const current = infection.get(player.id) ?? { ticks: 0, stacks: 0 };
  current.ticks = CONFIG.infectionTicks;
  current.stacks = Math.min(CONFIG.infectionMaxStacks, Math.max(current.stacks, stacks));
  infection.set(player.id, current);
}

/**
 * Resolve one cycle's worth of hits for a single player.
 *
 * `hits` holds every fungus position found within the scan radius. Each
 * species acts once per cycle from its nearest instance, so a dense patch of
 * twenty Bloodcaps costs exactly as much as one.
 */
function resolveAura(player, hits, sweeps) {
  if (hits.length === 0) return null;

  const nearest = new Map(); // species key -> { species, distance, pos }
  for (const hit of hits) {
    const existing = nearest.get(hit.species.key);
    if (!existing || hit.distance < existing.distance) {
      nearest.set(hit.species.key, hit);
    }
  }

  let worst = null;
  let contaminated = false;
  let particlesLeft = particleBudget;
  let mobQueriesLeft = mobQueryBudget;

  for (const hit of nearest.values()) {
    const species = hit.species;
    if (hit.distance > species.range) continue;
    // Pulsing species (Shockshroom) act on every Nth completed sweep, counted
    // per player so the interval stays a true N seconds.
    if (species.pulse > 1 && sweeps % species.pulse !== 0) continue;

    if (!worst || species.danger > worst.species.danger) worst = hit;
    if (species.contaminates) contaminated = true;

    const reduction = protectionOf(player, species.danger);

    applyEffects(player, species, reduction);

    let damage = species.damage;
    if (hit.distance <= CONFIG.contactRange) damage += species.contact;
    if (damage > 0) {
      applyDamage(
        player,
        damage * (1 - reduction),
        species.ignites ? EntityDamageCause.fire : EntityDamageCause.magic
      );
    }

    if (species.ignites && hit.distance <= species.range && reduction < 0.7) {
      safe(() => player.setOnFire(3, true));
    }

    if (species.infects) infect(player, species.danger >= 5 ? 2 : 1);

    // Cosmetics, strictly rationed.
    if (particlesLeft > 0) {
      particlesLeft -= 1;
      safe(() =>
        player.dimension.spawnParticle(species.particle, {
          x: hit.pos.x + 0.5,
          y: hit.pos.y + 0.6,
          z: hit.pos.z + 0.5,
        })
      );
    }

    // The few species that also bite mobs.
    if (species.hurts_mobs && mobQueriesLeft > 0) {
      mobQueriesLeft -= 1;
      const victims = safe(() =>
        player.dimension.getEntities({
          location: { x: hit.pos.x + 0.5, y: hit.pos.y + 0.5, z: hit.pos.z + 0.5 },
          maxDistance: species.range,
          excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:player"],
        })
      );
      for (const victim of victims ?? []) {
        safe(() => victim.applyDamage(species.contact, { cause: EntityDamageCause.contact }));
      }
    }
  }

  particleBudget = particlesLeft;
  mobQueryBudget = mobQueriesLeft;

  return worst ? { hit: worst, contaminated } : null;
}

/* ------------------------------------------------------------------ *
 * Warning line
 * ------------------------------------------------------------------ */

function warn(player, summary) {
  const species = summary.hit.species;
  const colour = DANGER_COLOUR[species.danger] ?? "§f";
  const level = DANGER_NAMES[String(species.danger)].split(" - ")[0];
  let line = `§8[ ${colour}☣ §f${species.name} §8| ${colour}${level} §8]`;
  if (summary.contaminated) line += " §2CONTAMINATED AREA";
  const status = infection.get(player.id);
  if (status && status.ticks > 0) {
    line += ` §5INFECTED §7(${Math.ceil(status.ticks / 20)}s)`;
  }
  actionBar(player, line);
}

/* ------------------------------------------------------------------ *
 * The sliced sweep
 * ------------------------------------------------------------------ */

function sweepTick() {
  const players = world.getAllPlayers();

  for (const player of players) {
    let state = scanState.get(player.id);
    if (!state) {
      state = { cursor: 0, hits: [], base: null, last: [], sweeps: 0 };
      scanState.set(player.id, state);
    }

    if (state.cursor === 0) {
      state.base = floorVec(player.location);
      state.hits = [];
    }

    const base = state.base;
    const dimension = player.dimension;
    const end = Math.min(OFFSETS.length, state.cursor + SLICE);

    for (let i = state.cursor; i < end; i++) {
      if (state.hits.length >= CONFIG.maxHits) break;
      const offset = OFFSETS[i];
      const pos = {
        x: base.x + offset.x,
        y: base.y + offset.y,
        z: base.z + offset.z,
      };
      let block;
      try {
        block = dimension.getBlock(pos);
      } catch {
        continue; // unloaded chunk - nothing to do
      }
      if (!block) continue;
      const typeId = block.typeId;
      if (typeId === "minecraft:air") continue;
      const species = BY_ID[typeId];
      if (species) state.hits.push({ species, pos, distance: offset.d });
    }

    state.cursor = end;

    if (state.cursor >= OFFSETS.length) {
      state.cursor = 0;
      state.sweeps += 1;
      state.last = state.hits;
      const summary = resolveAura(player, state.hits, state.sweeps);
      if (summary) warn(player, summary);
    }
  }

  // Drop state for players who left.
  if (cycle % 60 === 0 && scanState.size > players.length) {
    const live = new Set(players.map((p) => p.id));
    for (const id of [...scanState.keys()]) if (!live.has(id)) scanState.delete(id);
    for (const id of [...infection.keys()]) if (!live.has(id)) infection.delete(id);
  }
}

/* ------------------------------------------------------------------ *
 * Infection tick
 * ------------------------------------------------------------------ */

function infectionTick() {
  if (infection.size === 0) return;
  for (const player of world.getAllPlayers()) {
    const status = infection.get(player.id);
    if (!status) continue;
    status.ticks -= CONFIG.cycleTicks;
    if (status.ticks <= 0) {
      infection.delete(player.id);
      actionBar(player, "§a☣ Infection cleared.");
      continue;
    }
    if (status.ticks % CONFIG.infectionPulse < CONFIG.cycleTicks) {
      const reduction = protectionOf(player, 4);
      const ticks = Math.floor(120 * (1 - reduction));
      if (ticks >= 20) {
        safe(() =>
          player.addEffect("weakness", ticks, {
            amplifier: status.stacks - 1,
            showParticles: false,
          })
        );
        safe(() => player.addEffect("nausea", Math.floor(ticks / 2), { showParticles: false }));
      }
      applyDamage(player, status.stacks * (1 - reduction), EntityDamageCause.magic);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Controlled spreading
 *
 * Deliberately conservative:
 *   - one attempt per ten seconds for the entire world, never per block
 *   - only growths a player is standing near are ever considered, so unloaded
 *     and unvisited chunks can never grow anything
 *   - a density check refuses to add to an already-crowded patch
 *   - the new block must be air sitting on solid ground within two blocks
 * The worst case is one new fungus every ten seconds, next to a player who is
 * watching it happen, and /function fungi_spread_off stops even that.
 * ------------------------------------------------------------------ */

function countNearby(dimension, pos, typeId, radius) {
  let found = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        let block;
        try {
          block = dimension.getBlock({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz });
        } catch {
          continue;
        }
        if (block && block.typeId === typeId) found += 1;
      }
    }
  }
  return found;
}

function spreadTick() {
  if (!spreadEnabled) return;

  // Gather spreadable growths from the last completed sweep of each player.
  const candidates = [];
  for (const player of world.getAllPlayers()) {
    const state = scanState.get(player.id);
    if (!state) continue;
    for (const hit of state.last ?? []) {
      if (hit.species.spreads) candidates.push({ hit, dimension: player.dimension });
    }
  }
  if (candidates.length === 0) return;

  let placed = 0;
  for (let attempt = 0; attempt < CONFIG.spreadPerPass; attempt++) {
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    const species = choice.hit.species;
    const rules = species.spreads;
    if (Math.random() > rules.chance) return;

    const source = choice.hit.pos;
    const dimension = choice.dimension;

    if (countNearby(dimension, source, species.id, rules.radius) >= rules.max_nearby) {
      return; // patch is already at its cap
    }

    for (let tries = 0; tries < CONFIG.spreadSearchTries; tries++) {
      const dx = Math.floor(Math.random() * (rules.radius * 2 + 1)) - rules.radius;
      const dz = Math.floor(Math.random() * (rules.radius * 2 + 1)) - rules.radius;
      const dy = Math.floor(Math.random() * 3) - 1;
      if (dx === 0 && dz === 0 && dy === 0) continue;

      const target = { x: source.x + dx, y: source.y + dy, z: source.z + dz };
      let block, below;
      try {
        block = dimension.getBlock(target);
        below = dimension.getBlock({ x: target.x, y: target.y - 1, z: target.z });
      } catch {
        continue;
      }
      if (!block || !below) continue;
      if (block.typeId !== "minecraft:air") continue;
      if (below.typeId === "minecraft:air" || BY_ID[below.typeId]) continue;

      const done = safe(() => block.setType(species.id));
      if (done === undefined) {
        safe(() => dimension.setBlockType(target, species.id));
      }
      placed += 1;
      break;
    }
  }
  return placed;
}

/* ------------------------------------------------------------------ *
 * Fungal Scanner
 * ------------------------------------------------------------------ */

function scanAround(player) {
  const base = floorVec(player.location);
  const dimension = player.dimension;
  const nearest = new Map();

  for (const offset of OFFSETS) {
    const pos = { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
    let block;
    try {
      block = dimension.getBlock(pos);
    } catch {
      continue;
    }
    if (!block) continue;
    const species = BY_ID[block.typeId];
    if (!species) continue;
    if (!nearest.has(species.key)) {
      nearest.set(species.key, { species, distance: offset.d, pos });
      if (nearest.size >= 6) break; // readout only shows a handful anyway
    }
  }
  return [...nearest.values()].sort((a, b) => b.species.danger - a.species.danger);
}

function runScanner(player) {
  const found = scanAround(player);

  if (found.length === 0) {
    actionBar(player, "§7FUNGAL ANALYSIS §8| §aNo growth within 6 blocks");
    tellRaw(player, "§2§lFUNGAL ANALYSIS§r §8-------------------");
    tellRaw(player, "§7Status: §aCLEAR §8(nothing within 6 blocks)");
    safe(() => player.playSound("random.orb", { pitch: 1.6, volume: 0.4 }));
    return;
  }

  tellRaw(player, "§2§lFUNGAL ANALYSIS§r §8-------------------");
  for (const hit of found) {
    const species = hit.species;
    const colour = DANGER_COLOUR[species.danger] ?? "§f";
    const active = hit.distance <= species.range;
    tellRaw(player, `§7Species: §f${species.name}`);
    tellRaw(player, `§7Danger:  ${colour}${DANGER_NAMES[String(species.danger)]}`);
    tellRaw(player, `§7Range:   §f${species.range} blocks §8(you are ${hit.distance.toFixed(1)} away)`);
    tellRaw(player, `§7Status:  ${active ? "§cACTIVE - you are inside the aura" : "§aDORMANT - out of range"}`);
    tellRaw(player, `§8${species.habitat}`);
    tellRaw(player, "§8-------------------");
  }

  const worst = found[0];
  const colour = DANGER_COLOUR[worst.species.danger] ?? "§f";
  actionBar(
    player,
    `§7ANALYSIS §8| §f${worst.species.name} §8| ${colour}${DANGER_NAMES[String(worst.species.danger)].split(" - ")[0]} §8| §f${worst.distance.toFixed(1)}m`
  );
  safe(() => player.playSound("random.orb", { pitch: 0.8, volume: 0.5 }));
}

/* ------------------------------------------------------------------ *
 * Emergency cleanup - sliced so it cannot stall a phone
 * ------------------------------------------------------------------ */

function startCleanup(player) {
  if (cleanupQueue) {
    tellRaw(player, "§e[Fungi] §7A cleanup is already running.");
    return;
  }
  const base = floorVec(player.location);
  const positions = [];
  const r = CONFIG.cleanupRadius;
  const v = CONFIG.cleanupVertical;
  for (let dy = -v; dy <= v; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        positions.push({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
      }
    }
  }
  cleanupQueue = { player, positions, index: 0, removed: 0, dimension: player.dimension };
  tellRaw(player, `§e[Fungi] §7Sweeping ${positions.length} blocks...`);
}

function cleanupTick() {
  if (!cleanupQueue) return;
  const job = cleanupQueue;
  const end = Math.min(job.positions.length, job.index + CONFIG.cleanupPerTick);

  for (let i = job.index; i < end; i++) {
    let block;
    try {
      block = job.dimension.getBlock(job.positions[i]);
    } catch {
      continue;
    }
    if (!block) continue;
    if (!BY_ID[block.typeId]) continue;
    const done = safe(() => block.setType("minecraft:air"));
    if (done === undefined) safe(() => job.dimension.setBlockType(job.positions[i], "minecraft:air"));
    job.removed += 1;
  }

  job.index = end;
  if (job.index >= job.positions.length) {
    infection.delete(job.player.id);
    tellRaw(job.player, `§a[Fungi] §7Cleanup complete - removed §f${job.removed}§7 growths.`);
    cleanupQueue = null;
  }
}

/* ------------------------------------------------------------------ *
 * Testing field
 * ------------------------------------------------------------------ */

function buildTestArea(player) {
  const base = floorVec(player.location);
  const dimension = player.dimension;
  const columns = 5;
  const spacing = 9;
  let built = 0;

  SPECIES.forEach((species, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = base.x - 18 + col * spacing;
    const z = base.z - 13 + row * spacing;

    const pedestal = DANGER_BLOCK[String(species.danger)] ?? "minecraft:stone";
    const place = (pos, id) => {
      let block;
      try {
        block = dimension.getBlock(pos);
      } catch {
        return false;
      }
      if (!block) return false;
      const done = safe(() => block.setType(id));
      if (done === undefined) safe(() => dimension.setBlockType(pos, id));
      return true;
    };

    place({ x, y: base.y, z }, pedestal);
    if (place({ x, y: base.y + 1, z }, species.id)) built += 1;

    // A labelled sign in front of each exhibit. Sign text needs the sign
    // component, which not every build exposes - fall back to the coloured
    // pedestal alone if it is missing.
    const signPos = { x, y: base.y, z: z + 2 };
    let signBlock;
    try {
      signBlock = dimension.getBlock(signPos);
    } catch {
      signBlock = undefined;
    }
    if (signBlock) {
      const placed = safe(() =>
        signBlock.setPermutation(
          BlockPermutation.resolve("minecraft:standing_sign", { ground_sign_direction: 0 })
        )
      );
      if (placed === undefined) safe(() => signBlock.setType("minecraft:standing_sign"));
      safe(() => {
        const sign = dimension.getBlock(signPos).getComponent("minecraft:sign");
        const level = DANGER_NAMES[String(species.danger)].split(" - ")[0];
        sign.setText(`${species.name}\n${level}\nRange ${species.range}\n${species.danger}/5`);
      });
    }
  });

  tellRaw(player, `§a[Fungi] §7Testing field ready - §f${built}§7 species on labelled pedestals.`);
  tellRaw(player, "§7Pedestal colour = danger: §agreen I §egold II §6copper III §credstone IV §5obsidian V");
  tellRaw(player, "§7Hold the Fungal Scanner and use it beside any exhibit.");
}

/* ------------------------------------------------------------------ *
 * Script events (driven by the .mcfunction files)
 * ------------------------------------------------------------------ */

system.afterEvents.scriptEventReceive.subscribe((event) => {
  const player =
    event.sourceEntity && event.sourceEntity.typeId === "minecraft:player"
      ? event.sourceEntity
      : world.getAllPlayers()[0];
  if (!player) return;

  switch (event.id) {
    case "fungi:spread_on":
      spreadEnabled = true;
      saveSpreadSetting();
      tellRaw(player, "§a[Fungi] §7Spreading §aENABLED§7 - at most one new growth every 10 seconds, near players only.");
      break;

    case "fungi:spread_off":
      spreadEnabled = false;
      saveSpreadSetting();
      tellRaw(player, "§a[Fungi] §7Spreading §cDISABLED§7 - no fungus will grow on its own.");
      break;

    case "fungi:cure":
      infection.delete(player.id);
      tellRaw(player, "§a[Fungi] §7Infection and contamination status cleared.");
      break;

    case "fungi:cleanup":
      startCleanup(player);
      break;

    case "fungi:test_area":
      buildTestArea(player);
      break;

    case "fungi:status": {
      const nearby = scanState.get(player.id)?.last?.length ?? 0;
      tellRaw(player, `§2§lDANGEROUS FUNGI§r §7v${VERSION}`);
      tellRaw(player, `§7Species registered: §f${SPECIES.length}`);
      tellRaw(player, `§7Spreading: ${spreadEnabled ? "§aON" : "§cOFF"}`);
      tellRaw(player, `§7Growths in your last sweep: §f${nearby}`);
      tellRaw(player, `§7Infected: ${infection.has(player.id) ? "§cYES" : "§aNO"}`);
      tellRaw(player, `§7Scan budget: §f${OFFSETS.length}§7 positions per second, §f${SLICE}§7 per tick.`);
      break;
    }
  }
});

/* ------------------------------------------------------------------ *
 * Item and block events
 * ------------------------------------------------------------------ */

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const item = event.itemStack;
  if (!player || !item) return;

  if (item.typeId === EQUIPMENT.scanner) {
    runScanner(player);
    return;
  }

  // Milk cures the fictional infection, the same way it clears effects.
  if (item.typeId === "minecraft:milk_bucket" && infection.has(player.id)) {
    infection.delete(player.id);
    actionBar(player, "§a☣ Infection purged.");
  }
});

/**
 * Breaking a fungus disturbs it: Sporeburst detonates its cloud, and every
 * species gives a short puff so harvesting always reads as risky.
 */
function onBroken(brokenId, dimension, location, player) {
  const species = BY_ID[brokenId];
  if (!species) return;

  safe(() =>
    dimension.spawnParticle(species.particle, {
      x: location.x + 0.5,
      y: location.y + 0.6,
      z: location.z + 0.5,
    })
  );

  if (!player) return;
  // A disturbed growth hits harder than simply standing beside one, so the
  // harvester gets slightly less benefit from their gear than usual.
  const reduction = Math.max(0, protectionOf(player, species.danger) - 0.1);
  applyEffects(player, species, reduction);
  if (species.key === "sporeburst") {
    safe(() => player.playSound("mob.slime.big", { pitch: 1.4, volume: 0.6 }));
    actionBar(player, "§e☣ Sporeburst cloud released!");
  }
}

function subscribeBreak() {
  const events = world.afterEvents;
  const handler = (event) => {
    const brokenId =
      event.brokenBlockPermutation?.type?.id ??
      event.brokenBlockPermutation?.typeId ??
      undefined;
    if (!brokenId) return;
    const dimension = event.dimension ?? event.player?.dimension;
    const location = event.block?.location;
    if (!dimension || !location) return;
    onBroken(brokenId, dimension, location, event.player);
  };

  // The event was renamed across script API versions; bind whichever exists.
  if (events.playerBreakBlock) {
    events.playerBreakBlock.subscribe(handler);
  } else if (events.blockBreak) {
    events.blockBreak.subscribe(handler);
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn || !event.player) return;
  tellRaw(
    event.player,
    `§2[Dangerous Fungi] §7v${VERSION} loaded - §f${SPECIES.length}§7 species active. §8/function fungi_help`
  );
});

system.run(() => {
  loadSpreadSetting();
  safe(subscribeBreak);
});

system.runInterval(() => {
  cycle += 1;
  particleBudget = CONFIG.particleBudget;
  mobQueryBudget = CONFIG.mobQueryBudget;
  cleanupTick();
  sweepTick();
}, 1);

system.runInterval(infectionTick, CONFIG.cycleTicks);
system.runInterval(spreadTick, CONFIG.spreadIntervalTicks);
