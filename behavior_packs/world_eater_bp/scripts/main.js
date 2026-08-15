/*
 * WORLD EATER - destruction, growth, combat and death systems.
 *
 * Design notes (these are the reason it stays playable on a phone):
 *
 *  - All terrain destruction goes through one global work queue. Jobs are
 *    lazy generators, so a "destroy a 10 block sphere" ability costs a few
 *    bytes to enqueue instead of allocating thousands of coordinates.
 *  - The queue drains at most BLOCK_BUDGET blocks per tick, counting
 *    *attempts*, not successes. A pass over already-empty air costs the same
 *    bounded amount as a pass through solid stone, so a huge crater can never
 *    spike a frame.
 *  - The per-tick drain returns immediately when the queue is empty, so the
 *    common case is a single length check per tick.
 *  - Everything else (abilities, growth, name tags, stuck checks) runs on a
 *    slow scheduler, not every tick.
 *  - Entity scans are limited to dimensions that actually contain a player,
 *    happen every RESCAN_TICKS, and are capped. Ability-time scans are capped
 *    per call.
 *  - Particles and scheduled explosions have their own global per-tick caps.
 */

import {
  world,
  system,
  BlockPermutation,
  ItemStack,
} from "@minecraft/server";

const ID = "we:world_eater";
const CORE_ITEM = "we:world_core";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Two budgets, because the two halves of the work cost very different amounts.
// Reading a block is cheap; replacing one costs neighbour updates and a
// lighting recalculation, which is what actually drops frames on a phone. So
// we allow a generous number of lookups (this lets the queue race through the
// crater it has already dug) but a hard, much smaller cap on real edits.
const BLOCK_BUDGET = 120;       // block lookups attempted per tick
const REMOVE_BUDGET = 40;       // blocks actually turned to air per tick
const MAX_JOBS = 10;            // queued destruction jobs before we stop adding
const SOFT_JOBS = 6;            // above this, passive chewing pauses
const PARTICLE_BUDGET = 10;     // spawnParticle calls per tick
const MAX_PENDING_BOOMS = 14;   // scheduled explosions in flight, globally
const MAX_ACTIVE = 4;           // eaters that get ability/AI processing
const SCHED_TICKS = 20;         // scheduler period
const RESCAN_TICKS = 200;       // full entity rescan period
const AWAKE_RANGE = 96;         // no player this close -> the eater idles
const VICTIM_CAP = 12;          // entities affected by one ability
const DEATH_HP = 40;            // stage 4 hp that triggers the death cinematic

const STAGES = [
  null,
  {
    name: "Hungry",
    next: 400,
    radius: 3,
    chew: 2,
    cooldown: 100,
    abilities: ["devour", "shockwave"],
  },
  {
    name: "Devourer",
    next: 1400,
    radius: 5,
    chew: 3,
    cooldown: 80,
    abilities: ["devour", "shockwave", "ground_split"],
  },
  {
    name: "Catastrophe",
    next: 3200,
    radius: 7,
    chew: 4,
    cooldown: 60,
    abilities: ["devour", "shockwave", "ground_split", "meteor_rain", "world_quake"],
  },
  {
    name: "World Eater",
    next: Number.MAX_SAFE_INTEGER,
    radius: 10,
    chew: 5,
    cooldown: 45,
    abilities: [
      "devour",
      "shockwave",
      "ground_split",
      "meteor_rain",
      "world_quake",
      "death_beam",
      "rage",
    ],
  },
];

// Blocks the World Eater will never touch. Explosions respect blast
// resistance on their own, so this list only has to cover direct removal.
const PROTECTED = new Set([
  "minecraft:bedrock",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:barrier",
  "minecraft:jigsaw",
  "minecraft:deny",
  "minecraft:allow",
  "minecraft:border_block",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:end_gateway",
  "minecraft:portal",
  "minecraft:nether_portal",
  "minecraft:moving_block",
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:lava",
  "minecraft:flowing_lava",
]);

function isProtected(id) {
  if (PROTECTED.has(id)) return true;
  // light_block_0..15, and anything that is obviously a command/structure tool
  if (id.startsWith("minecraft:light_block")) return true;
  if (id.indexOf("command_block") !== -1) return true;
  if (id.indexOf("structure_") !== -1) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Small defensive helpers. Signatures shifted across Bedrock script releases,
// so anything version-sensitive is probed once and cached.
// ---------------------------------------------------------------------------

let AIR = undefined;
try {
  AIR = BlockPermutation.resolve("minecraft:air");
} catch (e) {
  AIR = undefined;
}

function alive(entity) {
  try {
    if (!entity) return false;
    const v = entity.isValid;
    return typeof v === "function" ? entity.isValid() : v !== false;
  } catch (e) {
    return false;
  }
}

function playSound(dim, id, loc, volume, pitch) {
  const opts = { volume: volume === undefined ? 1 : volume };
  if (pitch !== undefined) opts.pitch = pitch;
  try {
    dim.playSound(id, loc, opts);
    return;
  } catch (e) { /* fall through */ }
  try {
    world.playSound(id, loc, opts);
  } catch (e) { /* no audio, not fatal */ }
}

function knock(target, dx, dz, horizontal, vertical) {
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len;
  const nz = dz / len;
  try {
    target.applyKnockback(nx, nz, horizontal, vertical);
    return;
  } catch (e) { /* newer signature below */ }
  try {
    target.applyKnockback({ x: nx * horizontal, z: nz * horizontal }, vertical);
  } catch (e) { /* immovable entity, ignore */ }
}

function hurt(target, amount) {
  try {
    target.applyDamage(amount);
  } catch (e) { /* ignore */ }
}

function healthOf(entity) {
  try {
    const hp = entity.getComponent("minecraft:health");
    if (!hp) return undefined;
    const current = hp.currentValue;
    const max = hp.effectiveMax !== undefined ? hp.effectiveMax : hp.defaultValue;
    return { comp: hp, current, max };
  } catch (e) {
    return undefined;
  }
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function heightBounds(dim) {
  try {
    const range = dim.heightRange;
    if (range && typeof range.min === "number") {
      return { min: range.min + 5, max: range.max - 1 };
    }
  } catch (e) { /* older runtimes: fall back to per-dimension constants */ }
  const id = dim.id || "";
  if (id.indexOf("nether") !== -1) return { min: 1, max: 126 };
  if (id.indexOf("end") !== -1) return { min: 1, max: 254 };
  return { min: -59, max: 318 };
}

// ---------------------------------------------------------------------------
// Per-tick global budgets
// ---------------------------------------------------------------------------

let particlesThisTick = 0;
let pendingBooms = 0;

function fx(dim, effect, loc) {
  if (particlesThisTick >= PARTICLE_BUDGET) return;
  particlesThisTick++;
  try {
    dim.spawnParticle(effect, loc);
  } catch (e) { /* out of range or unloaded, ignore */ }
}

function boom(dim, loc, radius, delay) {
  if (pendingBooms >= MAX_PENDING_BOOMS) return;
  pendingBooms++;
  system.runTimeout(() => {
    pendingBooms--;
    try {
      dim.createExplosion(loc, radius, {
        breaksBlocks: true,
        causesFire: false,
        allowUnderwater: false,
      });
    } catch (e) { /* unloaded chunk, ignore */ }
  }, Math.max(1, delay));
}

// ---------------------------------------------------------------------------
// The destruction queue
// ---------------------------------------------------------------------------

/** @type {Array<{dim: any, gen: Iterator<any>, owner: string, fx: number}>} */
const queue = [];

function enqueue(dim, gen, owner, fxChance) {
  if (queue.length >= MAX_JOBS) return false;
  queue.push({ dim, gen, owner, fx: fxChance === undefined ? 0.02 : fxChance });
  return true;
}

function dropJobsOf(ownerId) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].owner === ownerId) queue.splice(i, 1);
  }
}

/** Removes one block. Returns true only if something solid was actually eaten. */
function eatBlock(dim, x, y, z) {
  let block;
  try {
    block = dim.getBlock({ x, y, z });
  } catch (e) {
    return false; // unloaded chunk or outside the world
  }
  if (!block) return false;
  try {
    if (block.isAir) return false;
  } catch (e) { /* fall through to the typeId check */ }
  let id;
  try {
    id = block.typeId;
  } catch (e) {
    return false;
  }
  if (id === "minecraft:air" || isProtected(id)) return false;
  try {
    if (AIR) block.setPermutation(AIR);
    else block.setType("minecraft:air");
  } catch (e) {
    return false;
  }
  return true;
}

function drain() {
  if (queue.length === 0) return;

  let lookups = BLOCK_BUDGET;
  let removals = REMOVE_BUDGET;
  while (lookups > 0 && removals > 0 && queue.length > 0) {
    const job = queue[0];
    const step = job.gen.next();
    if (step.done) {
      queue.shift();
      continue;
    }
    lookups--;
    const p = step.value;
    if (eatBlock(job.dim, p.x, p.y, p.z)) {
      removals--;
      const state = eaters.get(job.owner);
      if (state) state.consumed++;
      if (Math.random() < job.fx) {
        fx(job.dim, "we:devour_burst", { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Coordinate generators - one lazy stream of blocks per ability
// ---------------------------------------------------------------------------

function* sphereBlocks(cx, cy, cz, radius, bounds) {
  const r = Math.ceil(radius);
  const rSq = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    const y = Math.floor(cy) + dy;
    if (y < bounds.min || y > bounds.max) continue;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dy * dy + dz * dz > rSq) continue;
        yield { x: Math.floor(cx) + dx, y, z: Math.floor(cz) + dz };
      }
    }
  }
}

function* slabBlocks(cx, cy, cz, radius, below, above, bounds) {
  const r = Math.ceil(radius);
  const rSq = radius * radius;
  for (let dy = -below; dy <= above; dy++) {
    const y = Math.floor(cy) + dy;
    if (y < bounds.min || y > bounds.max) continue;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > rSq) continue;
        yield { x: Math.floor(cx) + dx, y, z: Math.floor(cz) + dz };
      }
    }
  }
}

/** Widening cone in front of the mouth. */
function* coneBlocks(origin, dir, length, maxRadius, bounds) {
  for (let t = 1; t <= length; t++) {
    const cx = origin.x + dir.x * t;
    const cy = origin.y + dir.y * t;
    const cz = origin.z + dir.z * t;
    const radius = 1 + (maxRadius - 1) * (t / length);
    const r = Math.ceil(radius);
    const rSq = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < bounds.min || y > bounds.max) continue;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > rSq) continue;
          yield { x: Math.floor(cx) + dx, y, z: Math.floor(cz) + dz };
        }
      }
    }
  }
}

/** A trench torn along the ground in the direction of travel. */
function* trenchBlocks(origin, dir, length, halfWidth, depth, bounds) {
  const px = -dir.z;
  const pz = dir.x;
  for (let t = 0; t < length; t++) {
    const cx = origin.x + dir.x * t;
    const cz = origin.z + dir.z * t;
    const wobble = Math.sin(t * 0.6) * halfWidth * 0.4;
    for (let w = -halfWidth; w <= halfWidth; w++) {
      const x = Math.floor(cx + px * (w + wobble));
      const z = Math.floor(cz + pz * (w + wobble));
      const deep = depth - Math.abs(w);
      for (let dy = -deep; dy <= 2; dy++) {
        const y = Math.floor(origin.y) + dy;
        if (y < bounds.min || y > bounds.max) continue;
        yield { x, y, z };
      }
    }
  }
}

/** A bored tube along a ray - the death beam's path. */
function* beamBlocks(origin, dir, length, radius, bounds) {
  const r = Math.ceil(radius);
  const rSq = radius * radius;
  for (let t = 1; t <= length; t++) {
    const cx = Math.floor(origin.x + dir.x * t);
    const cy = Math.floor(origin.y + dir.y * t);
    const cz = Math.floor(origin.z + dir.z * t);
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < bounds.min || y > bounds.max) continue;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > rSq) continue;
          yield { x: cx + dx, y, z: cz + dz };
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Eater registry
// ---------------------------------------------------------------------------

/** id -> state */
const eaters = new Map();

/**
 * Reads the stage back off the entity. Component group membership survives a
 * save, so on reload we must NOT re-trigger the stage event - the stage groups
 * re-apply minecraft:health, which would heal the boss to full every time the
 * world was reloaded.
 */
function currentStage(entity) {
  try {
    const variant = entity.getComponent("minecraft:variant");
    if (variant && typeof variant.value === "number") {
      const value = variant.value;
      if (value >= 1 && value <= 4) return value;
    }
  } catch (e) { /* fall back to 0 and let the scheduler set the stage */ }
  return 0;
}

function stateFor(entity) {
  let state = eaters.get(entity.id);
  if (state) {
    state.entity = entity;
    return state;
  }
  let consumed = 0;
  try {
    const stored = entity.getDynamicProperty("we:consumed");
    if (typeof stored === "number") consumed = stored;
  } catch (e) { /* dynamic properties unavailable, run in memory only */ }
  state = {
    entity,
    consumed,
    stage: currentStage(entity),
    cooldown: 20 + Math.floor(Math.random() * 40),
    rageUntil: 0,
    dying: false,
    label: "",
    lastPos: undefined,
    stuck: 0,
  };
  eaters.set(entity.id, state);
  return state;
}

function forget(id) {
  dropJobsOf(id);
  eaters.delete(id);
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

function applyStage(state, stage, announce) {
  const entity = state.entity;
  state.stage = stage;
  try {
    entity.triggerEvent("we:stage_" + stage);
  } catch (e) { /* ignore */ }
  if (announce) {
    const info = STAGES[stage];
    try {
      world.sendMessage(
        "§4[World Eater] §cIt has grown. §4Stage " + stage + ": §c" + info.name
      );
    } catch (e) { /* ignore */ }
    try {
      playSound(entity.dimension, "we.grow", entity.location, 1, 0.8);
    } catch (e) { /* ignore */ }
  }
}

function checkGrowth(state) {
  // STAGES[n].next is the running total needed to leave stage n.
  let target = 1;
  if (state.consumed >= STAGES[1].next) target = 2;
  if (state.consumed >= STAGES[2].next) target = 3;
  if (state.consumed >= STAGES[3].next) target = 4;

  if (target !== state.stage) {
    applyStage(state, target, state.stage !== 0);
  }
}

function updateLabel(state) {
  const info = STAGES[state.stage] || STAGES[1];
  const raging = state.rageUntil > system.currentTick;
  const label =
    "§4World Eater §8| §cStage " +
    state.stage +
    ": " +
    info.name +
    (raging ? " §6[RAGE]" : "") +
    " §8| §7Consumed: §f" +
    state.consumed;
  if (label === state.label) return;
  state.label = label;
  try {
    state.entity.nameTag = label;
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

function nearbyVictims(entity, range) {
  let list = [];
  try {
    list = entity.dimension.getEntities({
      location: entity.location,
      maxDistance: range,
      excludeTypes: [ID, "minecraft:item", "minecraft:xp_orb"],
    });
  } catch (e) {
    return [];
  }
  if (list.length > VICTIM_CAP) list.length = VICTIM_CAP;
  return list;
}

function shove(entity, targets, horizontal, vertical, damage) {
  const origin = entity.location;
  for (const target of targets) {
    if (!alive(target)) continue;
    let loc;
    try {
      loc = target.location;
    } catch (e) {
      continue;
    }
    knock(target, loc.x - origin.x, loc.z - origin.z, horizontal, vertical);
    if (damage > 0) hurt(target, damage);
  }
}

function mouthOrigin(entity, stage) {
  const loc = entity.location;
  const scale = 1 + stage * 0.5;
  let dir = { x: 0, y: 0, z: 1 };
  try {
    dir = entity.getViewDirection();
  } catch (e) { /* keep the default */ }
  return {
    origin: { x: loc.x + dir.x * scale, y: loc.y + 1.2 * scale, z: loc.z + dir.z * scale },
    dir,
  };
}

const ABILITIES = {
  devour(entity, state, info, radius) {
    const dim = entity.dimension;
    const bounds = heightBounds(dim);
    const { origin, dir } = mouthOrigin(entity, state.stage);
    enqueue(
      dim,
      coneBlocks(origin, dir, Math.round(radius * 1.6), radius * 0.9, bounds),
      entity.id,
      0.03
    );
    fx(dim, "we:maw_ember", origin);
    playSound(dim, "we.devour", entity.location, 1, 0.7);
    shove(entity, nearbyVictims(entity, radius + 4), 1.6, 0.5, 2);
  },

  shockwave(entity, state, info, radius) {
    const dim = entity.dimension;
    const bounds = heightBounds(dim);
    const loc = entity.location;
    enqueue(
      dim,
      slabBlocks(loc.x, loc.y, loc.z, radius * 1.3, 3, 2, bounds),
      entity.id,
      0.02
    );
    fx(dim, "we:shockwave", { x: loc.x, y: loc.y + 0.4, z: loc.z });
    fx(dim, "we:quake_dust", loc);
    playSound(dim, "we.quake", loc, 1, 0.8);
    shove(entity, nearbyVictims(entity, radius * 1.6), 2.6, 0.9, 3);
  },

  ground_split(entity, state, info, radius) {
    const dim = entity.dimension;
    const bounds = heightBounds(dim);
    const { dir } = mouthOrigin(entity, state.stage);
    const loc = entity.location;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const forward = { x: dir.x / flat, y: 0, z: dir.z / flat };
    enqueue(
      dim,
      trenchBlocks(
        { x: loc.x, y: loc.y, z: loc.z },
        forward,
        Math.round(radius * 3.5),
        Math.max(1, Math.round(radius * 0.45)),
        Math.max(3, Math.round(radius * 0.9)),
        bounds
      ),
      entity.id,
      0.015
    );
    for (let i = 0; i < 3; i++) {
      const t = 3 + i * radius;
      fx(dim, "we:quake_dust", {
        x: loc.x + forward.x * t,
        y: loc.y,
        z: loc.z + forward.z * t,
      });
    }
    playSound(dim, "we.quake", loc, 1, 0.6);
  },

  meteor_rain(entity, state, info, radius) {
    const dim = entity.dimension;
    const targets = nearbyVictims(entity, 34);
    const picks = targets.length > 0 ? targets.slice(0, 3) : [entity];
    let delay = 6;
    for (const target of picks) {
      let base;
      try {
        base = target.location;
      } catch (e) {
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const spot = {
          x: base.x + (Math.random() - 0.5) * 10,
          y: base.y + 1,
          z: base.z + (Math.random() - 0.5) * 10,
        };
        fx(dim, "we:maw_ember", { x: spot.x, y: spot.y + 6, z: spot.z });
        boom(dim, spot, 2.6, delay);
        delay += 7;
      }
    }
    playSound(dim, "we.roar", entity.location, 1, 0.7);
  },

  death_beam(entity, state, info, radius) {
    const dim = entity.dimension;
    const bounds = heightBounds(dim);
    const { origin, dir } = mouthOrigin(entity, state.stage);
    const length = 30;
    enqueue(dim, beamBlocks(origin, dir, length, 1.6, bounds), entity.id, 0.05);
    for (let t = 2; t <= length; t += 4) {
      fx(dim, "we:beam", {
        x: origin.x + dir.x * t,
        y: origin.y + dir.y * t,
        z: origin.z + dir.z * t,
      });
    }
    playSound(dim, "we.beam", entity.location, 1, 0.6);

    // Anything roughly along the ray takes a hit and gets thrown.
    for (const target of nearbyVictims(entity, length)) {
      let loc;
      try {
        loc = target.location;
      } catch (e) {
        continue;
      }
      const vx = loc.x - origin.x;
      const vy = loc.y - origin.y;
      const vz = loc.z - origin.z;
      const len = Math.hypot(vx, vy, vz) || 1;
      const dot = (vx * dir.x + vy * dir.y + vz * dir.z) / len;
      if (dot > 0.9) {
        hurt(target, 8);
        knock(target, dir.x, dir.z, 3.2, 0.8);
      }
    }
  },

  world_quake(entity, state, info, radius) {
    const dim = entity.dimension;
    const bounds = heightBounds(dim);
    const loc = entity.location;
    let delay = 4;
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const d = radius * (0.4 + Math.random() * 0.8);
      const spot = {
        x: loc.x + Math.cos(angle) * d,
        y: loc.y,
        z: loc.z + Math.sin(angle) * d,
      };
      boom(dim, spot, 2.4, delay);
      fx(dim, "we:quake_dust", spot);
      delay += 5;
    }
    enqueue(
      dim,
      slabBlocks(loc.x, loc.y, loc.z, radius, 4, 0, bounds),
      entity.id,
      0.02
    );
    playSound(dim, "we.quake", loc, 1, 0.5);
    shove(entity, nearbyVictims(entity, radius * 1.8), 1.4, 1.4, 2);
  },

  rage(entity, state, info, radius) {
    state.rageUntil = system.currentTick + 220;
    const dim = entity.dimension;
    const loc = entity.location;
    fx(dim, "we:death_burst", { x: loc.x, y: loc.y + 2, z: loc.z });
    fx(dim, "we:shockwave", loc);
    playSound(dim, "we.roar", loc, 1, 0.5);
    try {
      world.sendMessage("§4[World Eater] §cIt enters a RAGE.");
    } catch (e) { /* ignore */ }
    shove(entity, nearbyVictims(entity, 14), 2.4, 1.2, 0);
  },
};

// ---------------------------------------------------------------------------
// Death cinematic
// ---------------------------------------------------------------------------

function beginDeath(state) {
  if (state.dying) return;
  state.dying = true;
  const entity = state.entity;
  const dim = entity.dimension;
  const loc = { x: entity.location.x, y: entity.location.y, z: entity.location.z };

  dropJobsOf(entity.id);
  try {
    entity.triggerEvent("we:begin_death");
  } catch (e) { /* ignore */ }

  // Keep it alive through the cinematic; the dying group also makes it immune.
  const hp = healthOf(entity);
  if (hp) {
    try {
      hp.comp.setCurrentValue(Math.min(hp.max || 200, 200));
    } catch (e) { /* ignore */ }
  }

  try {
    world.sendMessage("§4[World Eater] §cThe World Eater is collapsing...");
  } catch (e) { /* ignore */ }
  playSound(dim, "we.roar", loc, 1, 0.5);

  // 1-3: it stops, shakes (animation), and pours particles.
  for (let t = 6; t <= 80; t += 8) {
    system.runTimeout(() => {
      const here = alive(entity) ? entity.location : loc;
      fx(dim, "we:corruption", { x: here.x, y: here.y + 2, z: here.z });
      if (t % 24 === 6) fx(dim, "we:death_burst", { x: here.x, y: here.y + 1, z: here.z });
    }, t);
  }

  // 4: controlled explosions in a ring - dramatic, but deliberately small.
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    boom(
      dim,
      { x: loc.x + Math.cos(angle) * 4, y: loc.y + 1, z: loc.z + Math.sin(angle) * 4 },
      2.5,
      24 + i * 11
    );
  }

  // 5: the final roar.
  system.runTimeout(() => {
    playSound(dim, "we.death", alive(entity) ? entity.location : loc, 1, 0.5);
    playSound(dim, "we.quake", loc, 1, 0.4);
  }, 92);

  // 6-7: collapse into particles, then die for real so the loot table runs.
  system.runTimeout(() => {
    const here = alive(entity) ? entity.location : loc;
    for (let i = 0; i < 3; i++) {
      fx(dim, "we:death_burst", { x: here.x, y: here.y + 1 + i, z: here.z });
    }
    fx(dim, "we:quake_dust", here);

    if (alive(entity)) {
      // Drop the invulnerability in the same tick we kill it, so the model
      // never pops back to its normal pose for a frame.
      try {
        entity.triggerEvent("we:end_death");
      } catch (e) { /* ignore */ }
      try {
        entity.kill();
      } catch (e) {
        try {
          entity.triggerEvent("we:despawn");
        } catch (e2) { /* ignore */ }
        spawnCore(dim, here);
      }
    } else {
      spawnCore(dim, here);
    }
    forget(entity.id);
    try {
      world.sendMessage("§4[World Eater] §6The World Eater is dead. A World Core remains.");
    } catch (e) { /* ignore */ }
  }, 112);
}

/**
 * Fallback drop. The normal path is entity.kill(), which runs the loot table
 * in loot_tables/entities/world_eater.json. This only runs if kill() failed
 * and we had to despawn the entity instead, so the trophy is never lost.
 */
function spawnCore(dim, loc) {
  try {
    dim.spawnItem(new ItemStack(CORE_ITEM, 1), loc);
  } catch (e) {
    console.warn("[World Eater] could not drop the World Core: " + e);
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function playerNear(entity) {
  let players = [];
  try {
    players = world.getAllPlayers();
  } catch (e) {
    return false;
  }
  const loc = entity.location;
  const dimId = entity.dimension.id;
  for (const player of players) {
    try {
      if (player.dimension.id !== dimId) continue;
      if (dist2(player.location, loc) <= AWAKE_RANGE * AWAKE_RANGE) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}

function unstick(state) {
  const entity = state.entity;
  let loc;
  try {
    loc = entity.location;
  } catch (e) {
    return;
  }
  if (state.lastPos && dist2(state.lastPos, loc) < 0.6) {
    state.stuck++;
  } else {
    state.stuck = 0;
  }
  state.lastPos = { x: loc.x, y: loc.y, z: loc.z };
  if (state.stuck < 3) return;

  // It has not moved for ~3 scheduler passes. Give it a hop toward its target
  // and chew the ground under it so it can climb out of its own crater.
  state.stuck = 0;
  let target;
  try {
    target = entity.target;
  } catch (e) { /* ignore */ }
  let dx = Math.random() - 0.5;
  let dz = Math.random() - 0.5;
  if (target && alive(target)) {
    try {
      dx = target.location.x - loc.x;
      dz = target.location.z - loc.z;
    } catch (e) { /* keep the random nudge */ }
  }
  knock(entity, dx, dz, 1.1, 0.55);
}

function processEater(state) {
  const entity = state.entity;
  if (state.dying) return;

  const info = STAGES[state.stage] || STAGES[1];
  const raging = state.rageUntil > system.currentTick;
  const radius = info.radius * (raging ? 1.6 : 1);

  // Stage 4 dies on a schedule, not instantly - this is the cinematic hook.
  const hp = healthOf(entity);
  if (hp && state.stage === 4 && hp.current <= DEATH_HP) {
    beginDeath(state);
    return;
  }

  updateLabel(state);
  unstick(state);

  // Passive chewing: it is always eating the ground it stands on.
  if (queue.length < SOFT_JOBS) {
    const loc = entity.location;
    const bounds = heightBounds(entity.dimension);
    enqueue(
      entity.dimension,
      slabBlocks(loc.x, loc.y, loc.z, radius * 0.55, 2, 2, bounds),
      entity.id,
      0.01
    );
  }

  // Abilities.
  state.cooldown -= SCHED_TICKS;
  if (state.cooldown > 0) return;
  if (queue.length >= MAX_JOBS) return;

  const cooldown = info.cooldown * (raging ? 0.55 : 1);
  state.cooldown = Math.round(cooldown * (0.75 + Math.random() * 0.6));

  const choices = info.abilities;
  let pick = choices[Math.floor(Math.random() * choices.length)];
  if (pick === "rage" && raging) pick = "devour";
  const ability = ABILITIES[pick];
  if (!ability) return;
  try {
    ability(entity, state, info, radius);
  } catch (e) {
    console.warn("[World Eater] ability " + pick + " failed: " + e);
  }
}

function scheduler() {
  if (eaters.size === 0) return;

  let processed = 0;
  for (const [id, state] of eaters) {
    if (!alive(state.entity)) {
      forget(id);
      continue;
    }
    // Testing hook from functions/we/grow.mcfunction.
    try {
      if (state.entity.hasTag("we_force_grow")) {
        state.entity.removeTag("we_force_grow");
        state.consumed += 400;
      }
    } catch (e) { /* ignore */ }

    if (state.stage === 0) applyStage(state, 1, false);
    checkGrowth(state);

    try {
      state.entity.setDynamicProperty("we:consumed", state.consumed);
    } catch (e) { /* ignore */ }

    if (processed >= MAX_ACTIVE) continue;
    if (!state.dying && !playerNear(state.entity)) continue;
    processed++;
    try {
      processEater(state);
    } catch (e) {
      console.warn("[World Eater] scheduler error: " + e);
    }
  }
}

function rescan() {
  let players = [];
  try {
    players = world.getAllPlayers();
  } catch (e) {
    return;
  }
  const seen = new Set();
  for (const player of players) {
    let dim;
    try {
      dim = player.dimension;
    } catch (e) {
      continue;
    }
    if (seen.has(dim.id)) continue;
    seen.add(dim.id);
    let found = [];
    try {
      found = dim.getEntities({ type: ID });
    } catch (e) {
      continue;
    }
    for (const entity of found) {
      if (!eaters.has(entity.id)) stateFor(entity);
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function register(entity) {
  try {
    if (!entity || entity.typeId !== ID) return;
  } catch (e) {
    return;
  }
  const state = stateFor(entity);
  system.run(() => {
    if (!alive(state.entity)) return;
    // Only a genuinely fresh entity gets the stage event fired at it; one that
    // was just loaded from disk already carries its stage component group.
    if (state.stage === 0) applyStage(state, 1, false);
    checkGrowth(state);
    updateLabel(state);
  });
}

world.afterEvents.entitySpawn.subscribe((ev) => register(ev.entity));

if (world.afterEvents.entityLoad) {
  world.afterEvents.entityLoad.subscribe((ev) => register(ev.entity));
}

world.afterEvents.entityHurt.subscribe(
  (ev) => {
    const entity = ev.hurtEntity;
    if (!alive(entity)) return;
    const state = eaters.get(entity.id);
    if (!state || state.dying) return;
    if (state.stage !== 4) return;
    const hp = healthOf(entity);
    if (hp && hp.current <= DEATH_HP) beginDeath(state);
  },
  { entityTypes: [ID] }
);

world.afterEvents.entityDie.subscribe(
  (ev) => {
    const entity = ev.deadEntity;
    try {
      if (entity && entity.typeId === ID) forget(entity.id);
    } catch (e) { /* ignore */ }
  },
  { entityTypes: [ID] }
);

if (world.afterEvents.entityHitEntity) {
  world.afterEvents.entityHitEntity.subscribe(
    (ev) => {
      const entity = ev.damagingEntity;
      const victim = ev.hitEntity;
      if (!alive(entity) || !alive(victim)) return;
      const state = eaters.get(entity.id);
      if (!state || state.dying) return;
      // A hit from something this big sends you flying.
      const stage = state.stage || 1;
      try {
        const from = entity.location;
        const to = victim.location;
        knock(victim, to.x - from.x, to.z - from.z, 1.8 + stage * 0.9, 0.55 + stage * 0.22);
      } catch (e) { /* ignore */ }
    },
    { entityTypes: [ID] }
  );
}

system.runInterval(() => {
  particlesThisTick = 0;
  drain();
}, 1);

system.runInterval(scheduler, SCHED_TICKS);
system.runInterval(rescan, RESCAN_TICKS);

console.warn("[World Eater] systems online");
