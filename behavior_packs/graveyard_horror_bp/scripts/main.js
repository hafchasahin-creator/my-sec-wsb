/*
 * Graveyard Horror - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Consecrate a graveyard with the ledger. After dark, anywhere near it, the
 * fog closes in and a wraith comes looking for you.
 *
 * The wraith's one rule is the whole mod: it never moves while you can see it.
 * Look away, even for a moment, and it is closer. Grave Lanterns are the only
 * thing that holds it off.
 */

import {
  world,
  system,
  ItemStack,
  BlockPermutation,
  EntityDamageCause,
} from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const WRAITH = "grave:wraith";
const LEDGER = "grave:gravekeepers_ledger";
const TOMBSTONE = "grave:tombstone";
const LANTERN = "grave:grave_lantern";

const CONFIG = {
  wraithTicks: 3, // how often the stalker thinks
  hauntTicks: 40, // how often the atmosphere ticks

  stalker: {
    // Seeing it means: inside this cone, within this range, nothing in the way.
    observeCone: 0.55, // cosine of the half-angle, ~56 degrees
    observeRange: 64,
    approach: 1.7, // blocks per think, while unobserved
    retreat: 2.4, // blocks per think, while backing off
    strikeRange: 2.4,
    strikeDamage: 6,
    strikeCooldown: 160, // 8s between strikes
    blindSeconds: 4,
    retreatTo: 15, // where it reappears after a strike
    despawnRange: 90,
  },

  ward: {
    radius: 10, // a lantern this close stops it approaching
    burnRadius: 5, // this close and it is destroyed outright
  },

  haunt: {
    radius: 44, // how far a graveyard's influence reaches
    nightStart: 13000,
    nightEnd: 23000,
    maxWraiths: 2, // per player
    spawnMin: 20,
    spawnMax: 30,
    spawnChance: 0.35, // per haunt tick, when under the cap
    fog: "grave:haunted",
    fogLayer: "graveyard_haunt",
  },

  build: {
    blocksPerTick: 250,
    frontGap: 4,
  },

  loot: [
    ["minecraft:bone", 3],
    ["minecraft:rotten_flesh", 2],
    ["minecraft:gold_nugget", 4],
    ["minecraft:emerald", 1],
    ["minecraft:soul_sand", 2],
    ["minecraft:cobweb", 2],
  ],
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function safe(fn) {
  try {
    fn();
  } catch (error) {
    /* ignored on purpose */
  }
}

function attempt(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function spawnParticle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function playSound(dimension, id, location) {
  safe(() => dimension.playSound(id, location));
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function isAlive(entity) {
  if (!entity) return false;
  return attempt(() => {
    if (typeof entity.isValid === "function") return entity.isValid();
    if (typeof entity.isValid === "boolean") return entity.isValid;
    return entity.location !== undefined;
  }, false);
}

function isSolid(dimension, location) {
  return attempt(() => {
    const block = dimension.getBlock(location);
    if (!block) return false;
    return !block.isAir && !block.isLiquid;
  }, false);
}

/** Top of the ground at or below `location`, so nothing floats or sinks. */
function footing(dimension, location, scan = 8) {
  const startY = Math.floor(location.y) + 3;
  for (let step = 0; step <= scan + 3; step += 1) {
    const y = startY - step;
    if (isSolid(dimension, { x: location.x, y, z: location.z })) return y + 1;
  }
  return location.y;
}

function isNight(dimension) {
  const time = attempt(() => world.getTimeOfDay(), 15000);
  return time >= CONFIG.haunt.nightStart && time <= CONFIG.haunt.nightEnd;
}

/* ------------------------------------------------------------------ *
 * Registries: graveyards, and the lanterns that ward them
 * ------------------------------------------------------------------ */

function readList(key) {
  const raw = attempt(() => world.getDynamicProperty(key));
  if (typeof raw !== "string") return [];
  return attempt(() => JSON.parse(raw), []) ?? [];
}

function writeList(key, list) {
  safe(() => world.setDynamicProperty(key, JSON.stringify(list.slice(-64))));
}

const ANCHORS = "grave:anchors";
const LANTERNS = "grave:lanterns";

function addAnchor(dimensionId, location) {
  const anchors = readList(ANCHORS);
  anchors.push({
    d: dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  });
  writeList(ANCHORS, anchors);
}

/** The graveyard whose influence a player is standing in, if any. */
function anchorNear(player) {
  for (const anchor of readList(ANCHORS)) {
    if (anchor.d !== player.dimension.id) continue;
    if (distance(anchor, player.location) <= CONFIG.haunt.radius) return anchor;
  }
  return undefined;
}

function addLantern(dimensionId, location) {
  const lanterns = readList(LANTERNS);
  const entry = {
    d: dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
  if (lanterns.some((l) => l.d === entry.d && l.x === entry.x && l.y === entry.y && l.z === entry.z)) {
    return;
  }
  lanterns.push(entry);
  writeList(LANTERNS, lanterns);
}

function removeLantern(dimensionId, location) {
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);
  writeList(
    LANTERNS,
    readList(LANTERNS).filter(
      (l) => !(l.d === dimensionId && l.x === x && l.y === y && l.z === z)
    )
  );
}

/** Distance to the nearest ward, or Infinity. */
function wardDistance(dimensionId, location) {
  let best = Infinity;
  for (const lantern of readList(LANTERNS)) {
    if (lantern.d !== dimensionId) continue;
    const away = distance(lantern, location);
    if (away < best) best = away;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Seeing
 * ------------------------------------------------------------------ */

/** Is anything solid between these two points? Sampled, not exact. */
function lineOfSight(dimension, from, to) {
  const span = distance(from, to);
  const steps = Math.min(48, Math.ceil(span));
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const point = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    };
    if (isSolid(dimension, point)) return false;
  }
  return true;
}

/**
 * The rule the whole mod hangs on: is this player looking at the wraith?
 * Inside the view cone, in range, and with nothing solid in between.
 */
function isObserved(player, wraith) {
  const cfg = CONFIG.stalker;
  const eye = attempt(() => player.getHeadLocation(), offset(player.location, 0, 1.6, 0));
  const target = bodyLocation(wraith);
  const span = distance(eye, target);
  if (span > cfg.observeRange) return false;

  const view = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const to = normalize({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const facing = to.x * view.x + to.y * view.y + to.z * view.z;
  if (facing < cfg.observeCone) return false;

  return lineOfSight(player.dimension, eye, target);
}

/* ------------------------------------------------------------------ *
 * The wraith
 * ------------------------------------------------------------------ */

const wraithState = new Map(); // id -> { animation, lastStrike, seenTicks }

function stateOf(wraith) {
  let value = wraithState.get(wraith.id);
  if (!value) {
    value = { animation: "drift", lastStrike: -9999, seenTicks: 0 };
    wraithState.set(wraith.id, value);
  }
  return value;
}

function setAnimation(wraith, name) {
  const state = stateOf(wraith);
  if (state.animation === name) return;
  state.animation = name;
  safe(() => wraith.triggerEvent(`grave:set_${name}`));
}

function vanish(wraith, reason) {
  const dimension = wraith.dimension;
  const where = bodyLocation(wraith);
  for (let index = 0; index < 8; index += 1) {
    spawnParticle(dimension, "minecraft:basic_smoke_particle", offset(where, 0, index * 0.25, 0));
  }
  playSound(dimension, "mob.ghast.moan", where);
  wraithState.delete(wraith.id);
  safe(() => (typeof wraith.remove === "function" ? wraith.remove() : wraith.kill()));
  void reason;
}

/** Move the wraith toward (or away from) a point, keeping its feet on ground. */
function drift(wraith, goal, speed) {
  const here = wraith.location;
  const span = distance(here, goal);
  let destination = goal;
  if (span > speed) {
    const scale = speed / span;
    destination = {
      x: here.x + (goal.x - here.x) * scale,
      y: here.y + (goal.y - here.y) * scale,
      z: here.z + (goal.z - here.z) * scale,
    };
  }
  destination = { ...destination, y: footing(wraith.dimension, destination) };
  safe(() =>
    wraith.teleport(destination, {
      dimension: wraith.dimension,
      keepVelocity: false,
    })
  );
}

/** Face the player without moving - it may always look at you. */
function stare(wraith, player) {
  safe(() =>
    wraith.teleport(wraith.location, {
      dimension: wraith.dimension,
      facingLocation: bodyLocation(player),
      keepVelocity: false,
    })
  );
}

function strike(wraith, player) {
  const state = stateOf(wraith);
  const cfg = CONFIG.stalker;
  if (system.currentTick - state.lastStrike < cfg.strikeCooldown) return;
  state.lastStrike = system.currentTick;

  const dimension = wraith.dimension;
  setAnimation(wraith, "lunge");
  playSound(dimension, "mob.ghast.scream", player.location);
  spawnParticle(dimension, "minecraft:basic_smoke_particle", bodyLocation(player));

  safe(() =>
    player.applyDamage(cfg.strikeDamage, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: wraith,
    })
  );
  safe(() => player.addEffect("blindness", cfg.blindSeconds * 20, { showParticles: false }));
  safe(() => player.addEffect("slowness", cfg.blindSeconds * 20, { amplifier: 1 }));
  safe(() => player.onScreenDisplay.setActionBar("§8It touched you."));

  // Then it is simply gone, and standing somewhere else.
  system.runTimeout(() => {
    if (!isAlive(wraith) || !isAlive(player)) return;
    const away = normalize({
      x: wraith.location.x - player.location.x,
      y: 0,
      z: wraith.location.z - player.location.z,
    });
    const point = {
      x: player.location.x + away.x * cfg.retreatTo,
      y: player.location.y,
      z: player.location.z + away.z * cfg.retreatTo,
    };
    safe(() =>
      wraith.teleport(
        { ...point, y: footing(wraith.dimension, point) },
        { dimension: wraith.dimension, facingLocation: bodyLocation(player) }
      )
    );
    setAnimation(wraith, "drift");
  }, 12);
}

function updateWraith(wraith, players) {
  const cfg = CONFIG.stalker;

  // Daylight, and it is over.
  if (!isNight(wraith.dimension)) {
    vanish(wraith, "dawn");
    return;
  }

  // A lantern too close destroys it; merely near, and it will not approach.
  const ward = wardDistance(wraith.dimension.id, wraith.location);
  if (ward <= CONFIG.ward.burnRadius) {
    playSound(wraith.dimension, "random.fizz", wraith.location);
    vanish(wraith, "warded");
    return;
  }

  let quarry;
  let best = cfg.despawnRange;
  for (const player of players) {
    if (player.dimension.id !== wraith.dimension.id) continue;
    const away = distance(player.location, wraith.location);
    if (away < best) {
      best = away;
      quarry = player;
    }
  }
  if (!quarry) {
    vanish(wraith, "nobody left");
    return;
  }

  const state = stateOf(wraith);
  const watched = isObserved(quarry, wraith);

  if (watched) {
    // The rule: while you can see it, it does not move. It only looks back.
    state.seenTicks += CONFIG.wraithTicks;
    setAnimation(wraith, "stare");
    stare(wraith, quarry);
    if (state.seenTicks % 120 === 0) {
      playSound(wraith.dimension, "mob.ghast.moan", wraith.location);
    }
    return;
  }

  state.seenTicks = 0;
  setAnimation(wraith, "drift");

  // Held off by a ward: it circles at the edge of the light instead.
  if (ward <= CONFIG.ward.radius) {
    const away = normalize({
      x: wraith.location.x - quarry.location.x,
      y: 0,
      z: wraith.location.z - quarry.location.z,
    });
    drift(
      wraith,
      offset(wraith.location, away.x * cfg.retreat, 0, away.z * cfg.retreat),
      cfg.retreat
    );
    return;
  }

  // Just after a strike it keeps its distance until the cooldown passes,
  // rather than hovering at your shoulder unable to touch you.
  const recoiling = system.currentTick - state.lastStrike < cfg.strikeCooldown;
  if (recoiling) {
    if (best < cfg.retreatTo * 0.7) {
      const away = normalize({
        x: wraith.location.x - quarry.location.x,
        y: 0,
        z: wraith.location.z - quarry.location.z,
      });
      drift(
        wraith,
        offset(wraith.location, away.x * cfg.retreat, 0, away.z * cfg.retreat),
        cfg.retreat
      );
    }
    return;
  }

  if (best <= cfg.strikeRange) {
    strike(wraith, quarry);
    return;
  }

  drift(wraith, { ...quarry.location, y: quarry.location.y }, cfg.approach);

  // Footsteps, and breathing, and nothing there when you turn around.
  if (best < 12 && Math.random() < 0.25) {
    playSound(wraith.dimension, "mob.zombie.step", wraith.location);
  }
  if (best < 6) {
    safe(() => quarry.onScreenDisplay.setActionBar("§8You are not alone."));
  }
}

/* ------------------------------------------------------------------ *
 * Spawning and the atmosphere
 * ------------------------------------------------------------------ */

function wraithsNear(player, range = 96) {
  return attempt(
    () =>
      player.dimension.getEntities({
        type: WRAITH,
        location: player.location,
        maxDistance: range,
      }),
    []
  );
}

/** Put one somewhere behind the player, on the ground, out of sight. */
function spawnStalker(player) {
  const cfg = CONFIG.haunt;
  const view = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });

  for (let tries = 0; tries < 6; tries += 1) {
    const angle = Math.random() * Math.PI * 2;
    const range = cfg.spawnMin + Math.random() * (cfg.spawnMax - cfg.spawnMin);
    const dx = Math.cos(angle) * range;
    const dz = Math.sin(angle) * range;

    // Behind, or at least off to the side: it should never appear in view.
    const facing = normalize({ x: dx, y: 0, z: dz });
    if (facing.x * view.x + facing.z * view.z > 0.1) continue;

    const spot = offset(player.location, dx, 0, dz);
    spot.y = footing(player.dimension, spot);
    if (wardDistance(player.dimension.id, spot) <= CONFIG.ward.radius) continue;

    const wraith = attempt(() => player.dimension.spawnEntity(WRAITH, spot));
    if (wraith) {
      playSound(player.dimension, "ambient.cave", player.location);
      return wraith;
    }
  }
  return undefined;
}

const AMBIENCE = [
  "ambient.cave",
  "mob.ghast.moan",
  "mob.zombie.say",
  "mob.skeleton.step",
  "mob.wither.ambient",
];

const fogged = new Set();

function pushFog(player) {
  if (fogged.has(player.id)) return;
  fogged.add(player.id);
  safe(() =>
    player.runCommand(`fog @s push "${CONFIG.haunt.fog}" ${CONFIG.haunt.fogLayer}`)
  );
}

function popFog(player) {
  if (!fogged.has(player.id)) return;
  fogged.delete(player.id);
  safe(() => player.runCommand(`fog @s remove ${CONFIG.haunt.fogLayer}`));
}

function hauntPlayer(player) {
  const dimension = player.dimension;

  // A wandering sound, from somewhere you cannot see.
  if (Math.random() < 0.5) {
    const angle = Math.random() * Math.PI * 2;
    const range = 6 + Math.random() * 12;
    const where = offset(player.location, Math.cos(angle) * range, 0, Math.sin(angle) * range);
    playSound(dimension, AMBIENCE[Math.floor(Math.random() * AMBIENCE.length)], where);
  }

  // Cold motes drifting up off the ground.
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const range = Math.random() * 10;
    const where = offset(
      player.location,
      Math.cos(angle) * range,
      Math.random() * 2 - 0.5,
      Math.sin(angle) * range
    );
    spawnParticle(dimension, "minecraft:basic_smoke_particle", where);
  }
}

/* ------------------------------------------------------------------ *
 * Building a graveyard
 * ------------------------------------------------------------------ */

const permutationCache = new Map();

function permutation(id, states) {
  const key = states ? `${id}|${JSON.stringify(states)}` : id;
  if (permutationCache.has(key)) return permutationCache.get(key);
  // With states first, then without: an unknown state on one build should cost
  // the rotation, not the block.
  let resolved = attempt(() => BlockPermutation.resolve(id, states));
  if (!resolved) resolved = attempt(() => BlockPermutation.resolve(id));
  permutationCache.set(key, resolved);
  return resolved;
}

function pick(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
    const resolved =
      typeof candidate === "string"
        ? permutation(candidate)
        : permutation(candidate.id, candidate.states);
    if (resolved) return resolved;
  }
  return undefined;
}

const GRAVE_SOIL = () => pick("grave:grave_soil");
const CRYPT = () => pick("grave:crypt_stone");
const GRAVE_LANTERN = () => pick(LANTERN);
const AIR = () => pick("minecraft:air");
const PATH = () => pick(["minecraft:gravel", "minecraft:coarse_dirt", "minecraft:dirt"]);
const GRASS = () => pick(["minecraft:grass_block", "minecraft:grass"]);
const FENCE = () => pick(["minecraft:dark_oak_fence", "minecraft:fence"]);
const LOG = () => pick(["minecraft:dark_oak_log", "minecraft:oak_log", "minecraft:log"]);
const WEB = () => pick("minecraft:cobweb");
const CHEST = () => pick("minecraft:chest");
const SKULL = () => pick(["minecraft:bone_block", "minecraft:bone_block"]);

function tombstoneFacing(cardinal) {
  return pick([
    { id: TOMBSTONE, states: { "minecraft:cardinal_direction": cardinal } },
    TOMBSTONE,
  ]);
}

class Plan {
  constructor(dimension, origin, forward, right) {
    this.dimension = dimension;
    this.origin = origin;
    this.forward = forward;
    this.right = right;
    this.ops = [];
    this.total = 0;
  }

  world(u, y, v) {
    return {
      x: this.origin.x + this.right.x * u + this.forward.x * v,
      y: this.origin.y + y,
      z: this.origin.z + this.right.z * u + this.forward.z * v,
    };
  }

  fill(u1, y1, v1, u2, y2, v2, block) {
    if (!block) return;
    const op = {
      u1: Math.min(u1, u2), u2: Math.max(u1, u2),
      y1: Math.min(y1, y2), y2: Math.max(y1, y2),
      v1: Math.min(v1, v2), v2: Math.max(v1, v2),
      block,
    };
    op.uSpan = op.u2 - op.u1 + 1;
    op.ySpan = op.y2 - op.y1 + 1;
    op.count = op.uSpan * op.ySpan * (op.v2 - op.v1 + 1);
    this.total += op.count;
    this.ops.push(op);
  }

  set(u, y, v, block) {
    this.fill(u, y, v, u, y, v, block);
  }

  walls(u1, y1, v1, u2, y2, v2, block) {
    this.fill(u1, y1, v1, u2, y2, v1, block);
    this.fill(u1, y1, v2, u2, y2, v2, block);
    this.fill(u1, y1, v1, u1, y2, v2, block);
    this.fill(u2, y1, v1, u2, y2, v2, block);
  }
}

/** The graveyard itself: plot, graves, crypt, dead trees, wards. */
function designGraveyard(plan, cardinalFacing) {
  const HALF = 12;
  const soil = GRAVE_SOIL();

  // Clear the air and flatten the plot.
  plan.fill(-HALF, 1, -HALF, HALF, 8, HALF, AIR());
  plan.fill(-HALF, -1, -HALF, HALF, -1, HALF, GRASS());
  plan.fill(-HALF, -2, -HALF, HALF, -2, HALF, pick("minecraft:dirt"));

  // Perimeter fence with a gap for the gate.
  plan.walls(-HALF, 0, -HALF, HALF, 0, HALF, FENCE());
  plan.fill(-1, 0, -HALF, 1, 0, -HALF, AIR());

  // The path in, and the wards flanking it.
  plan.fill(-1, -1, -HALF, 1, -1, HALF - 4, PATH());
  for (const v of [-HALF + 1, 0, HALF - 5]) {
    plan.set(-2, 0, v, GRAVE_LANTERN());
    plan.set(2, 0, v, GRAVE_LANTERN());
  }

  // Two blocks of graves either side of the path, each mound with a stone.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const u = side * (4 + column * 3);
        const v = -HALF + 3 + row * 4;
        plan.fill(u - 1, -1, v, u + 1, -1, v + 1, soil);
        plan.set(u, 0, v - 1, tombstoneFacing(cardinalFacing));
        if ((row + column) % 3 === 0) plan.set(u + 1, 0, v + 1, WEB());
      }
    }
  }

  // The crypt at the back, with something worth taking inside.
  const cv = HALF - 4;
  plan.fill(-4, -1, cv - 3, 4, -1, cv + 3, CRYPT());
  plan.walls(-4, 0, cv - 3, 4, 4, cv + 3, CRYPT());
  plan.fill(-4, 5, cv - 3, 4, 5, cv + 3, CRYPT());
  plan.fill(-3, 0, cv - 2, 3, 4, cv + 2, AIR());
  plan.fill(-1, 0, cv - 3, 1, 2, cv - 3, AIR()); // doorway
  plan.set(-3, 1, cv - 2, WEB());
  plan.set(3, 1, cv + 2, WEB());
  plan.set(-2, 0, cv + 2, SKULL());
  plan.set(2, 0, cv + 2, SKULL());
  plan.set(0, 0, cv + 2, CHEST());
  plan.set(-3, 0, cv - 2, GRAVE_LANTERN());
  plan.set(3, 0, cv - 2, GRAVE_LANTERN());

  // Dead trees in the corners.
  for (const [u, v] of [
    [-HALF + 2, -HALF + 2],
    [HALF - 2, -HALF + 2],
    [-HALF + 2, HALF - 2],
    [HALF - 2, HALF - 2],
  ]) {
    plan.fill(u, 0, v, u, 4, v, LOG());
    plan.set(u + 1, 4, v, LOG());
    plan.set(u, 4, v + 1, LOG());
    plan.set(u, 5, v, WEB());
  }
}

let building = false;

function buildGraveyard(player) {
  if (building) {
    player.sendMessage("§8[Graveyard]§7 One consecration at a time.");
    return;
  }

  const view = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const cardinals = [
    { name: "south", x: 0, z: 1 },
    { name: "west", x: -1, z: 0 },
    { name: "north", x: 0, z: -1 },
    { name: "east", x: 1, z: 0 },
  ];
  const forward =
    Math.abs(view.x) > Math.abs(view.z)
      ? view.x > 0
        ? cardinals[3]
        : cardinals[1]
      : view.z > 0
        ? cardinals[0]
        : cardinals[2];
  const right = { x: -forward.z, z: forward.x };

  const origin = {
    x: Math.floor(player.location.x) + forward.x * (CONFIG.build.frontGap + 12),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z) + forward.z * (CONFIG.build.frontGap + 12),
  };

  const plan = new Plan(player.dimension, origin, forward, right);
  designGraveyard(plan, forward.name);

  building = true;
  player.sendMessage("§8[Graveyard]§7 Consecrating ground...");
  playSound(player.dimension, "mob.wither.ambient", player.location);

  let opIndex = 0;
  let cursor = 0;
  let placed = 0;

  const step = () => {
    let budget = CONFIG.build.blocksPerTick;
    while (budget > 0 && opIndex < plan.ops.length) {
      const op = plan.ops[opIndex];
      if (cursor >= op.count) {
        opIndex += 1;
        cursor = 0;
        continue;
      }
      const u = op.u1 + (cursor % op.uSpan);
      const y = op.y1 + (Math.floor(cursor / op.uSpan) % op.ySpan);
      const v = op.v1 + Math.floor(cursor / (op.uSpan * op.ySpan));
      cursor += 1;
      budget -= 1;

      const position = plan.world(u, y, v);
      try {
        const block = plan.dimension.getBlock(position);
        if (!block) continue;
        if (op.block.type.id === "minecraft:air" && block.isAir) continue;
        block.setPermutation(op.block);
        placed += 1;
        if (op.block.type.id === LANTERN) addLantern(plan.dimension.id, position);
      } catch (error) {
        /* unloaded or protected - skip it */
      }
    }

    if (opIndex < plan.ops.length) {
      system.run(step);
      return;
    }

    building = false;
    fillCrypt(plan);
    addAnchor(plan.dimension.id, plan.world(0, 0, 0));
    player.sendMessage(
      `§8[Graveyard]§7 Consecrated - ${placed} blocks. §8Do not be here after dark.`
    );
    playSound(player.dimension, "ambient.cave", player.location);
  };

  system.run(step);
}

function fillCrypt(plan) {
  const position = plan.world(0, 0, 12 - 4 + 2);
  safe(() => {
    const block = plan.dimension.getBlock(position);
    const container = block?.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (const [id, count] of CONFIG.loot) {
      safe(() => container.addItem(new ItemStack(id, count)));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Loops
 * ------------------------------------------------------------------ */

system.runInterval(() => {
  const players = attempt(() => world.getAllPlayers(), []);
  const seen = new Set();

  for (const player of players) {
    for (const wraith of wraithsNear(player)) {
      if (seen.has(wraith.id)) continue;
      seen.add(wraith.id);
      try {
        updateWraith(wraith, players);
      } catch (error) {
        console.warn(`[Graveyard Horror] wraith update failed: ${error}`);
      }
    }
  }
}, CONFIG.wraithTicks);

system.runInterval(() => {
  for (const player of attempt(() => world.getAllPlayers(), [])) {
    const anchor = anchorNear(player);
    const night = isNight(player.dimension);

    if (!anchor || !night) {
      popFog(player);
      continue;
    }

    pushFog(player);
    hauntPlayer(player);

    const present = wraithsNear(player, 64).length;
    if (present < CONFIG.haunt.maxWraiths && Math.random() < CONFIG.haunt.spawnChance) {
      spawnStalker(player);
    }
  }
}, CONFIG.hauntTicks);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack?.typeId !== LEDGER || !event.source) return;
  try {
    buildGraveyard(event.source);
  } catch (error) {
    event.source.sendMessage(`§c[Graveyard]§r Consecration failed: ${error}`);
  }
});

/** Disturbing a grave is how you meet what is buried under it. */
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const broken = event.brokenBlockPermutation?.type?.id;
  const player = event.player;
  const dimension = event.dimension ?? player?.dimension;
  if (!broken || !player || !dimension) return;

  if (broken === LANTERN) {
    removeLantern(dimension.id, event.block.location);
    playSound(dimension, "random.fizz", event.block.location);
    if (isNight(dimension)) {
      safe(() => player.onScreenDisplay.setActionBar("§8The light goes out."));
    }
    return;
  }

  if (broken !== TOMBSTONE) return;

  const where = event.block.location;
  playSound(dimension, "mob.wither.hurt", where);
  spawnParticle(dimension, "minecraft:basic_smoke_particle", offset(where, 0, 1, 0));

  if (Math.random() < 0.55) {
    // Something was under it.
    const behind = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
    const spot = offset(player.location, -behind.x * 3, 0, -behind.z * 3);
    spot.y = footing(dimension, spot);
    const wraith = attempt(() => dimension.spawnEntity(WRAITH, spot));
    if (wraith) {
      playSound(dimension, "mob.ghast.scream", player.location);
      player.sendMessage("§8[Graveyard]§7 You should not have moved that.");
    }
    return;
  }

  // Grave goods.
  const [id, count] = CONFIG.loot[Math.floor(Math.random() * CONFIG.loot.length)];
  safe(() => dimension.spawnItem(new ItemStack(id, count), offset(where, 0, 0.5, 0)));
  player.sendMessage("§8[Graveyard]§7 Grave goods.");
});

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  const placed = event.block?.permutation?.type?.id ?? event.block?.typeId;
  if (placed !== LANTERN) return;
  addLantern(event.dimension?.id ?? event.player.dimension.id, event.block.location);
  safe(() => event.player.onScreenDisplay.setActionBar("§bThe ward is lit."));
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§8[Graveyard Horror]§7 v1.0.0 loaded - craft a Gravekeeper's Ledger, or /function graveyard_help."
    )
  );
});
