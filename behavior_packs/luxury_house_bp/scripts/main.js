/*
 * Luxury Estate - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Using the Luxury Villa Deed lays out a three-storey marble villa in front of
 * the player: furnished rooms, a stairwell, a balcony, a rooftop pool, a
 * driveway, gardens and a back garden pool.
 *
 * The build is described once as a list of *ops* in local villa coordinates,
 * then applied a few hundred blocks per tick so a phone never stalls. Every
 * block id is resolved through a candidate list, so an id that a particular
 * build spells differently degrades to the next best block instead of taking
 * the whole add-on down.
 */

import { world, system, BlockPermutation } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const ITEMS = {
  DEED: "luxury:villa_deed",
  PERMIT: "luxury:wrecking_permit",
};

const CONFIG = {
  // How many blocks to place per tick. Lower it if a very old phone stutters.
  blocksPerTick: 300,
  // Distance between the player and the front wall of the villa.
  frontGap: 5,
  // Ground works. Turn these off to drop the villa onto the terrain as-is.
  clearSite: true,
  flattenGround: true,
  // Optional sections of the estate.
  buildGarden: true,
  buildDriveway: true,
  buildBackPool: true,
  buildRoofPool: true,
  furnish: true,
  // Set true to consume the deed once the villa is finished.
  consumeDeed: false,
  // Chat feedback.
  announceProgress: true,
};

/* Villa footprint (local u = across, v = depth, y = height above the player). */
const W = 22; // u: 0 .. 21
const D = 18; // v: 0 .. 17
const CENTER_U = 10; // u that lines up with the player

/* The whole lot, villa plus grounds. */
const LOT = { u1: -4, u2: W + 3, v1: -7, v2: D + 9 };

/* Height levels, relative to the player's feet. */
const LVL = {
  bedrock: -3, // lowest filled layer
  ground: -1, // lawn / ground-floor slab
  floor1: 0, // ground-floor standing height
  mid: 5, // slab between floor 1 and floor 2
  floor2: 6, // first-floor standing height
  roofSlab: 11, // slab between floor 2 and the roof deck
  deck: 12, // roof-deck standing height
  parapet: 13,
  kioskRoof: 15,
  sky: 16, // top of the cleared volume
};

/* ------------------------------------------------------------------ *
 * Block resolution
 * ------------------------------------------------------------------ */

const permutationCache = new Map();

/**
 * Resolve one block id, optionally with block states. Returns undefined if
 * this build of the game does not know the id at all.
 */
function permutation(id, states) {
  const key = states ? `${id}|${JSON.stringify(states)}` : id;
  if (permutationCache.has(key)) return permutationCache.get(key);

  let resolved;
  try {
    resolved = BlockPermutation.resolve(id, states);
  } catch (error) {
    // Unknown state for this version - fall back to the default permutation.
    try {
      resolved = BlockPermutation.resolve(id);
    } catch (inner) {
      resolved = undefined;
    }
  }
  permutationCache.set(key, resolved);
  return resolved;
}

/**
 * First candidate that resolves. Candidates are ids or {id, states} objects,
 * ordered best-first.
 */
function pick(candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    const resolved =
      typeof candidate === "string"
        ? permutation(candidate)
        : permutation(candidate.id, candidate.states);
    if (resolved) return resolved;
  }
  return undefined;
}

/* Custom blocks from this add-on. */
const MARBLE = () => pick("luxury:marble");
const ONYX = () => pick("luxury:onyx_marble");
const GILDED = () => pick("luxury:gilded_marble");
const CRYSTAL = () => pick("luxury:crystal_glass");
const LAMP = () => pick("luxury:gold_lamp");
const RUG = () => pick("luxury:royal_rug");

/* Vanilla blocks, each with fallbacks for older/newer id spellings. */
const AIR = () => pick("minecraft:air");
const WATER = () => pick("minecraft:water");
const DIRT = () => pick("minecraft:dirt");
const GRASS = () => pick(["minecraft:grass_block", "minecraft:grass"]);
const HEDGE = () =>
  pick(["minecraft:azalea_leaves", "minecraft:oak_leaves", "minecraft:leaves"]);
const BLOSSOM = () =>
  pick([
    "minecraft:flowering_azalea_leaves",
    "minecraft:azalea_leaves",
    "minecraft:oak_leaves",
    "minecraft:leaves",
  ]);
const TRUNK = () => pick(["minecraft:oak_log", "minecraft:log"]);
const QUARTZ = () => pick("minecraft:quartz_block");
const SLAB = () =>
  pick([
    "minecraft:quartz_slab",
    { id: "minecraft:stone_block_slab", states: { stone_slab_type: "quartz" } },
  ]);
const BOOKSHELF = () => pick("minecraft:bookshelf");
const SEA_LANTERN = () => pick(["minecraft:sea_lantern", "minecraft:glowstone"]);
const END_ROD = () => pick(["minecraft:end_rod", "minecraft:torch"]);
const CHAIN = () => pick(["minecraft:chain", "minecraft:iron_bars"]);
const SCREEN = () => pick(["minecraft:black_concrete", "minecraft:coal_block"]);
const GOLD_BLOCK = () => pick("minecraft:gold_block");
const IRON_BLOCK = () => pick("minecraft:iron_block");
const CAMPFIRE = () =>
  pick([
    { id: "minecraft:campfire", states: { extinguished: false } },
    "minecraft:campfire",
    "minecraft:glowstone",
  ]);
const CAULDRON = () => pick("minecraft:cauldron");
const CRAFTING = () => pick("minecraft:crafting_table");
const BARREL = () => pick("minecraft:barrel");
const CAKE = () => pick(["minecraft:cake", "minecraft:quartz_slab"]);
const LECTERN = () => pick(["minecraft:lectern", "minecraft:bookshelf"]);
const ENCHANTER = () => pick(["minecraft:enchanting_table", "minecraft:bookshelf"]);
const JUKEBOX = () => pick(["minecraft:jukebox", "minecraft:note_block"]);
const FLOWER_RED = () => pick(["minecraft:poppy", "minecraft:red_flower"]);
const FLOWER_GOLD = () => pick(["minecraft:dandelion", "minecraft:yellow_flower"]);

/* Blocks that need a facing, expressed in *world* cardinals. */
const CARDINAL_TO_FACING = { north: 2, south: 3, west: 4, east: 5 };
const CARDINAL_TO_STAIR = { east: 0, west: 1, south: 2, north: 3 };
const CARDINAL_TO_DOOR = { east: 0, south: 1, west: 2, north: 3 };
const CARDINAL_TO_BED = { south: 0, west: 1, north: 2, east: 3 };

function stairs(cardinal, upsideDown = false) {
  return pick([
    {
      id: "minecraft:quartz_stairs",
      states: {
        weirdo_direction: CARDINAL_TO_STAIR[cardinal] ?? 0,
        upside_down_bit: upsideDown,
      },
    },
    "minecraft:quartz_stairs",
    "minecraft:quartz_block",
  ]);
}

function facingBlock(id, cardinal, fallback) {
  return pick([
    {
      id,
      states: { facing_direction: CARDINAL_TO_FACING[cardinal] ?? 3 },
    },
    {
      id,
      states: { "minecraft:cardinal_direction": cardinal },
    },
    id,
    ...(fallback ? [fallback] : []),
  ]);
}

function door(cardinal, upper, hinge) {
  return pick([
    {
      id: "minecraft:dark_oak_door",
      states: {
        direction: CARDINAL_TO_DOOR[cardinal] ?? 0,
        upper_block_bit: upper,
        door_hinge_bit: hinge,
        open_bit: false,
      },
    },
    "minecraft:dark_oak_door",
    "minecraft:air",
  ]);
}

function bed(cardinal, head) {
  return pick([
    {
      id: "minecraft:bed",
      states: {
        direction: CARDINAL_TO_BED[cardinal] ?? 0,
        head_piece_bit: head,
        occupied_bit: false,
      },
    },
    "minecraft:bed",
    "minecraft:white_wool",
  ]);
}

function lantern(hanging) {
  return pick([
    { id: "minecraft:lantern", states: { hanging } },
    "minecraft:lantern",
    "minecraft:sea_lantern",
  ]);
}

/* ------------------------------------------------------------------ *
 * Sites: mapping local villa coordinates onto the world
 * ------------------------------------------------------------------ */

const CARDINALS = [
  { name: "south", x: 0, z: 1 },
  { name: "west", x: -1, z: 0 },
  { name: "north", x: 0, z: -1 },
  { name: "east", x: 1, z: 0 },
];

/** Nearest cardinal to the player's yaw. Yaw 0 faces south (+Z). */
function facingFromYaw(yaw) {
  const normalized = ((yaw % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 90) % 4];
}

/**
 * A site fixes where local (u, y, v) lands in the world. `forward` points from
 * the player into the lot, `right` is the player's right hand.
 */
function siteForPlayer(player) {
  const forward = facingFromYaw(player.getRotation().y);
  const right = { name: null, x: -forward.z, z: forward.x };
  right.name = CARDINALS.find((c) => c.x === right.x && c.z === right.z).name;
  return {
    dimension: player.dimension,
    origin: {
      x: Math.floor(player.location.x),
      y: Math.floor(player.location.y),
      z: Math.floor(player.location.z),
    },
    forward,
    right,
    centerU: CENTER_U,
    frontGap: CONFIG.frontGap,
  };
}

/** A site whose local axes are the world axes, used for demolition. */
function axisAlignedSite(dimension, origin) {
  return {
    dimension,
    origin,
    forward: { name: "south", x: 0, z: 1 },
    right: { name: "east", x: 1, z: 0 },
    centerU: 0,
    frontGap: 0,
  };
}

function toWorld(site, u, y, v) {
  const su = u - site.centerU;
  const sv = v + site.frontGap;
  return {
    x: site.origin.x + site.right.x * su + site.forward.x * sv,
    y: site.origin.y + y,
    z: site.origin.z + site.right.z * su + site.forward.z * sv,
  };
}

/** Turn a local direction into a world cardinal name. */
function cardinal(site, du, dv) {
  const x = site.right.x * du + site.forward.x * dv;
  const z = site.right.z * du + site.forward.z * dv;
  return CARDINALS.find((c) => c.x === Math.sign(x) && c.z === Math.sign(z))?.name;
}

/* ------------------------------------------------------------------ *
 * Ops: rectangular volumes queued for placement
 * ------------------------------------------------------------------ */

class Plan {
  constructor(site) {
    this.site = site;
    this.ops = [];
    this.total = 0;
  }

  /** Local direction helpers, resolved against this plan's orientation. */
  dir(du, dv) {
    return cardinal(this.site, du, dv);
  }

  fill(u1, y1, v1, u2, y2, v2, block, filter) {
    if (!block) return; // unknown id on this build - skip quietly
    const op = {
      u1: Math.min(u1, u2),
      u2: Math.max(u1, u2),
      y1: Math.min(y1, y2),
      y2: Math.max(y1, y2),
      v1: Math.min(v1, v2),
      v2: Math.max(v1, v2),
      block,
      filter,
    };
    op.uSpan = op.u2 - op.u1 + 1;
    op.ySpan = op.y2 - op.y1 + 1;
    op.vSpan = op.v2 - op.v1 + 1;
    op.count = op.uSpan * op.ySpan * op.vSpan;
    this.total += op.count;
    this.ops.push(op);
  }

  set(u, y, v, block) {
    this.fill(u, y, v, u, y, v, block);
  }

  clear(u1, y1, v1, u2, y2, v2) {
    this.fill(u1, y1, v1, u2, y2, v2, AIR());
  }

  /** Four walls of a box, no floor and no ceiling. */
  walls(u1, y1, v1, u2, y2, v2, block) {
    this.fill(u1, y1, v1, u2, y2, v1, block);
    this.fill(u1, y1, v2, u2, y2, v2, block);
    this.fill(u1, y1, v1, u1, y2, v2, block);
    this.fill(u2, y1, v1, u2, y2, v2, block);
  }

  /** A single-layer ring, used for cornices, rims and parapet caps. */
  ring(u1, y, v1, u2, v2, block) {
    this.walls(u1, y, v1, u2, y, v2, block);
  }

  column(u, y1, v, y2, block) {
    this.fill(u, y1, v, u, y2, v, block);
  }
}

/* ------------------------------------------------------------------ *
 * The villa blueprint
 * ------------------------------------------------------------------ */

function designVilla(plan) {
  site(plan);
  groundFloorShell(plan);
  groundFloorRooms(plan);
  midSlab(plan);
  upperFloorShell(plan);
  upperFloorRooms(plan);
  roofDeck(plan);
  // After both slabs exist, so the stairwell can cut its openings through them.
  staircases(plan);
  balconyAndPortico(plan);
  if (CONFIG.buildDriveway) driveway(plan);
  if (CONFIG.buildGarden) gardens(plan);
  if (CONFIG.buildBackPool) backGardenPool(plan);
  if (CONFIG.furnish) {
    furnishGroundFloor(plan);
    furnishUpperFloor(plan);
    furnishRoof(plan);
  }
}

/* --- Site preparation ------------------------------------------------ */

function site(plan) {
  if (CONFIG.clearSite) {
    plan.clear(LOT.u1, LVL.floor1, LOT.v1, LOT.u2, LVL.sky, LOT.v2);
  }
  if (CONFIG.flattenGround) {
    plan.fill(LOT.u1, LVL.bedrock, LOT.v1, LOT.u2, LVL.ground - 1, LOT.v2, DIRT());
    plan.fill(LOT.u1, LVL.ground, LOT.v1, LOT.u2, LVL.ground, LOT.v2, GRASS());
  }

  // Plinth: the villa sits on a marble slab one block proud of its walls.
  plan.fill(-1, LVL.bedrock, -1, W, LVL.ground, D, MARBLE());
  plan.ring(-1, LVL.ground, -1, W, D, ONYX());

  // Ground-floor slab.
  plan.fill(0, LVL.ground, 0, W - 1, LVL.ground, D - 1, MARBLE());
}

/* --- Ground floor ---------------------------------------------------- */

function groundFloorShell(plan) {
  const y1 = LVL.floor1;
  const y2 = LVL.mid - 1;

  plan.walls(0, y1, 0, W - 1, y2, D - 1, MARBLE());

  // Onyx corner piers.
  for (const u of [0, W - 1]) {
    for (const v of [0, D - 1]) {
      plan.column(u, y1, v, y2, ONYX());
    }
  }

  // Windows: tall crystal panels on both flanks and the back.
  for (const u of [0, W - 1]) {
    plan.fill(u, y1 + 1, 2, u, y1 + 3, 6, CRYSTAL());
    plan.fill(u, y1 + 1, 11, u, y1 + 3, 15, CRYSTAL());
  }
  plan.fill(2, y1 + 1, D - 1, 8, y1 + 3, D - 1, CRYSTAL());
  plan.fill(13, y1 + 1, D - 1, 19, y1 + 3, D - 1, CRYSTAL());
  plan.fill(2, y1 + 1, 0, 7, y1 + 3, 0, CRYSTAL());
  plan.fill(14, y1 + 1, 0, 19, y1 + 3, 0, CRYSTAL());

  // Grand entrance: gilded surround, three-high opening, double doors.
  plan.column(9, y1, 0, y1 + 3, GILDED());
  plan.column(12, y1, 0, y1 + 3, GILDED());
  plan.fill(9, y1 + 3, 0, 12, y1 + 3, 0, GILDED());
  plan.clear(10, y1, 0, 11, y1 + 2, 0);
  const outward = plan.dir(0, -1); // the way the front door faces
  plan.set(10, y1, 0, door(outward, false, false));
  plan.set(10, y1 + 1, 0, door(outward, true, false));
  plan.set(11, y1, 0, door(outward, false, true));
  plan.set(11, y1 + 1, 0, door(outward, true, true));
  plan.set(8, y1 + 2, 0, LAMP());
  plan.set(13, y1 + 2, 0, LAMP());
}

function groundFloorRooms(plan) {
  const y1 = LVL.floor1;
  const y2 = LVL.mid - 1;

  // Two spine walls make a four-wide central hall.
  plan.fill(8, y1, 1, 8, y2, D - 2, MARBLE());
  plan.fill(13, y1, 1, 13, y2, D - 2, MARBLE());
  // Cross walls split each wing into a front and a back room.
  plan.fill(1, y1, 9, 7, y2, 9, MARBLE());
  plan.fill(14, y1, 9, 20, y2, 9, MARBLE());

  // Doorways off the hall, with gilded lintels.
  for (const [u, v] of [
    [8, 4],
    [13, 4],
    [8, 12],
    [13, 12],
  ]) {
    plan.clear(u, y1, v, u, y1 + 2, v + 1);
    plan.fill(u, y1 + 3, v, u, y1 + 3, v + 1, GILDED());
  }
  // Internal doorways between each wing's two rooms.
  for (const u of [4, 16]) {
    plan.clear(u, y1, 9, u + 1, y1 + 2, 9);
    plan.fill(u, y1 + 3, 9, u + 1, y1 + 3, 9, GILDED());
  }
}

/* --- Between the floors ---------------------------------------------- */

function midSlab(plan) {
  plan.fill(0, LVL.mid, 0, W - 1, LVL.mid, D - 1, MARBLE());
  // Cornice: a gilded lip running right around the building.
  plan.ring(-1, LVL.mid, -1, W, D, GILDED());
}

/* --- Upper floor ----------------------------------------------------- */

function upperFloorShell(plan) {
  const y1 = LVL.floor2;
  const y2 = LVL.roofSlab - 1;

  plan.walls(0, y1, 0, W - 1, y2, D - 1, MARBLE());
  for (const u of [0, W - 1]) {
    for (const v of [0, D - 1]) {
      plan.column(u, y1, v, y2, ONYX());
    }
  }

  // Floor-to-ceiling glazing upstairs.
  for (const u of [0, W - 1]) {
    plan.fill(u, y1 + 1, 2, u, y1 + 3, 7, CRYSTAL());
    plan.fill(u, y1 + 1, 11, u, y1 + 3, 15, CRYSTAL());
  }
  plan.fill(2, y1 + 1, D - 1, 8, y1 + 3, D - 1, CRYSTAL());
  plan.fill(13, y1 + 1, D - 1, 19, y1 + 3, D - 1, CRYSTAL());
  plan.fill(2, y1 + 1, 0, 8, y1 + 3, 0, CRYSTAL());
  plan.fill(13, y1 + 1, 0, 19, y1 + 3, 0, CRYSTAL());

  // Balcony doorway out of the upstairs hall.
  plan.clear(10, y1, 0, 11, y1 + 2, 0);
  plan.column(9, y1, 0, y1 + 3, GILDED());
  plan.column(12, y1, 0, y1 + 3, GILDED());
  plan.fill(9, y1 + 3, 0, 12, y1 + 3, 0, GILDED());
}

function upperFloorRooms(plan) {
  const y1 = LVL.floor2;
  const y2 = LVL.roofSlab - 1;

  // Narrower spine upstairs: a two-wide landing over the stairwell.
  plan.fill(9, y1, 1, 9, y2, D - 2, MARBLE());
  plan.fill(12, y1, 1, 12, y2, D - 2, MARBLE());
  plan.fill(1, y1, 9, 8, y2, 9, MARBLE());
  plan.fill(13, y1, 9, 20, y2, 9, MARBLE());

  for (const [u, v] of [
    [9, 4],
    [12, 4],
    [9, 12],
    [12, 12],
  ]) {
    plan.clear(u, y1, v, u, y1 + 2, v + 1);
    plan.fill(u, y1 + 3, v, u, y1 + 3, v + 1, GILDED());
  }
  for (const u of [4, 16]) {
    plan.clear(u, y1, 9, u + 1, y1 + 2, 9);
    plan.fill(u, y1 + 3, 9, u + 1, y1 + 3, 9, GILDED());
  }
}

/* --- Stairwell -------------------------------------------------------- */

function staircases(plan) {
  const up = plan.dir(0, 1); // climbs away from the entrance
  const down = plan.dir(0, -1);

  // Great hall, ground floor to first floor: climbs from v = 11 to v = 16.
  // Two blocks of headroom per step is exactly what a player needs, and
  // keeping it at two also keeps the opening in the slab as small as possible.
  for (let step = 0; step <= 5; step += 1) {
    const v = 11 + step;
    const y = LVL.floor1 + step;
    plan.fill(10, y, v, 11, y, v, stairs(up));
    plan.clear(10, y + 1, v, 11, y + 2, v);
  }

  // Roof stair, first floor to the deck. It sits in the back corner of the
  // dressing room rather than above the hall run: two runs stacked in the same
  // shaft would leave no headroom and no way to step off at floor two.
  // It climbs toward the front so the top step lands on solid roof.
  for (let step = 0; step <= 5; step += 1) {
    const v = 15 - step;
    const y = LVL.floor2 + step;
    plan.fill(18, y, v, 19, y, v, stairs(down));
    plan.clear(18, y + 1, v, 19, y + 2, v);
  }

  // Landing lights.
  plan.set(9, LVL.floor1 + 3, 14, LAMP());
  plan.set(17, LVL.floor2 + 3, 14, LAMP());
}

/* --- Roof ------------------------------------------------------------- */

function roofDeck(plan) {
  plan.fill(0, LVL.roofSlab, 0, W - 1, LVL.roofSlab, D - 1, MARBLE());
  plan.ring(-1, LVL.roofSlab, -1, W, D, GILDED());

  // Parapet with a gilded cap.
  plan.walls(0, LVL.deck, 0, W - 1, LVL.deck, D - 1, MARBLE());
  plan.ring(0, LVL.parapet, 0, W - 1, D - 1, GILDED());
  // Crystal infill panels so the deck still has a view.
  for (const u of [0, W - 1]) {
    plan.fill(u, LVL.deck, 3, u, LVL.deck, 7, CRYSTAL());
    plan.fill(u, LVL.deck, 11, u, LVL.deck, 15, CRYSTAL());
  }
  plan.fill(3, LVL.deck, 0, 8, LVL.deck, 0, CRYSTAL());
  plan.fill(13, LVL.deck, 0, 18, LVL.deck, 0, CRYSTAL());

  if (CONFIG.buildRoofPool) {
    // Plunge pool, flush with the deck. The rim has to exist at deck level as
    // well as under the water, or the pool simply drains across the roof.
    plan.fill(1, LVL.roofSlab, 2, 8, LVL.roofSlab, 10, GILDED());
    plan.ring(1, LVL.deck, 2, 8, 10, GILDED());
    plan.fill(2, LVL.deck, 3, 7, LVL.deck, 9, WATER());
    for (const [u, v] of [
      [1, 2],
      [8, 2],
      [1, 10],
      [8, 10],
    ]) {
      plan.set(u, LVL.deck, v, LAMP());
    }
  }

  // Stair kiosk over the roof-stair opening, which the run cuts through the
  // slab at u 18..19, v 10..12.
  plan.walls(17, LVL.deck, 8, 20, LVL.deck + 2, 13, MARBLE());
  plan.clear(18, LVL.deck, 8, 19, LVL.deck + 1, 8);
  plan.fill(17, LVL.kioskRoof, 8, 20, LVL.kioskRoof, 13, GILDED());
  plan.set(17, LVL.deck + 2, 8, LAMP());
  plan.set(20, LVL.deck + 2, 8, LAMP());
}

/* --- Balcony, portico and approach ------------------------------------ */

function balconyAndPortico(plan) {
  // Balcony deck cantilevered over the entrance.
  plan.fill(6, LVL.mid, -3, 15, LVL.mid, -1, MARBLE());
  plan.ring(6, LVL.mid, -3, 15, -1, GILDED());
  // Balustrade: gilded rail with crystal panels.
  plan.walls(6, LVL.floor2, -3, 15, LVL.floor2, -1, GILDED());
  plan.fill(7, LVL.floor2, -3, 14, LVL.floor2, -3, CRYSTAL());
  plan.clear(10, LVL.floor2, -1, 11, LVL.floor2, -1);
  plan.set(6, LVL.floor2 + 1, -3, LAMP());
  plan.set(15, LVL.floor2 + 1, -3, LAMP());

  // Portico columns carrying the balcony.
  for (const [u, v] of [
    [6, -3],
    [15, -3],
    [6, -1],
    [15, -1],
  ]) {
    plan.column(u, LVL.floor1, v, LVL.mid - 1, ONYX());
    plan.set(u, LVL.mid - 1, v, GILDED());
  }

  // Front terrace and steps down to the drive.
  plan.fill(4, LVL.ground, -5, 17, LVL.ground, -1, MARBLE());
  plan.ring(4, LVL.ground, -5, 17, -1, GILDED());
  plan.fill(8, LVL.ground, -6, 13, LVL.ground, -6, ONYX());
}

function driveway(plan) {
  // Onyx drive with a gilded centre line, running out from the terrace.
  plan.fill(8, LVL.ground, LOT.v1, 13, LVL.ground, -6, ONYX());
  plan.fill(10, LVL.ground, LOT.v1, 11, LVL.ground, -6, GILDED());

  // Lamp posts along both kerbs.
  for (let v = -7; v <= -2; v += 3) {
    for (const u of [6, 15]) {
      plan.column(u, LVL.floor1, v, LVL.floor1 + 1, ONYX());
      plan.set(u, LVL.floor1 + 2, v, LAMP());
    }
  }
}

function gardens(plan) {
  // Estate wall with lamp piers.
  plan.ring(LOT.u1, LVL.floor1, LOT.v1, LOT.u2, LOT.v2, ONYX());
  for (let u = LOT.u1; u <= LOT.u2; u += 6) {
    for (const v of [LOT.v1, LOT.v2]) {
      plan.column(u, LVL.floor1, v, LVL.floor1 + 1, ONYX());
      plan.set(u, LVL.floor1 + 2, v, LAMP());
    }
  }
  for (let v = LOT.v1; v <= LOT.v2; v += 6) {
    for (const u of [LOT.u1, LOT.u2]) {
      plan.column(u, LVL.floor1, v, LVL.floor1 + 1, ONYX());
      plan.set(u, LVL.floor1 + 2, v, LAMP());
    }
  }
  // Gateway on the drive.
  plan.clear(9, LVL.floor1, LOT.v1, 12, LVL.floor1 + 2, LOT.v1);
  plan.column(8, LVL.floor1, LOT.v1, LVL.floor1 + 2, GILDED());
  plan.column(13, LVL.floor1, LOT.v1, LVL.floor1 + 2, GILDED());
  plan.set(8, LVL.floor1 + 3, LOT.v1, LAMP());
  plan.set(13, LVL.floor1 + 3, LOT.v1, LAMP());

  // Hedges flanking the drive and the flanks of the villa.
  plan.fill(5, LVL.floor1, -7, 5, LVL.floor1, -2, HEDGE());
  plan.fill(16, LVL.floor1, -7, 16, LVL.floor1, -2, HEDGE());
  plan.fill(-2, LVL.floor1, 1, -2, LVL.floor1, D - 2, HEDGE());
  plan.fill(W + 1, LVL.floor1, 1, W + 1, LVL.floor1, D - 2, HEDGE());

  // Flower beds either side of the terrace.
  for (const u of [2, 19]) {
    plan.fill(u, LVL.floor1, -4, u, LVL.floor1, -3, FLOWER_RED());
    plan.fill(u, LVL.floor1, -2, u, LVL.floor1, -2, FLOWER_GOLD());
  }

  // Four ornamental trees at the corners of the lot.
  for (const [u, v] of [
    [LOT.u1 + 3, LOT.v1 + 3],
    [LOT.u2 - 3, LOT.v1 + 3],
    [LOT.u1 + 3, LOT.v2 - 3],
    [LOT.u2 - 3, LOT.v2 - 3],
  ]) {
    tree(plan, u, v);
  }
}

function tree(plan, u, v) {
  plan.column(u, LVL.floor1, v, LVL.floor1 + 4, TRUNK());
  plan.fill(u - 2, LVL.floor1 + 3, v - 2, u + 2, LVL.floor1 + 4, v + 2, HEDGE());
  plan.fill(u - 1, LVL.floor1 + 5, v - 1, u + 1, LVL.floor1 + 5, v + 1, BLOSSOM());
  plan.column(u, LVL.floor1 + 3, v, LVL.floor1 + 4, TRUNK());
}

function backGardenPool(plan) {
  const v1 = D + 2;
  const v2 = D + 7;

  // Basin, two blocks deep, with a gilded coping.
  plan.fill(4, LVL.bedrock, v1 - 1, 17, LVL.ground, v2 + 1, MARBLE());
  plan.ring(4, LVL.ground, v1 - 1, 17, v2 + 1, GILDED());
  plan.fill(5, LVL.bedrock, v1, 16, LVL.bedrock, v2, CRYSTAL()); // lit basin floor
  plan.fill(5, LVL.bedrock + 1, v1, 16, LVL.ground, v2, WATER()); // two blocks deep
  // Underwater lighting set into the basin floor.
  for (const u of [6, 10, 15]) {
    plan.set(u, LVL.bedrock, v1 + 2, SEA_LANTERN());
    plan.set(u, LVL.bedrock, v2 - 1, SEA_LANTERN());
  }

  // Diving board and sun loungers.
  plan.fill(10, LVL.floor1, v1 - 2, 11, LVL.floor1, v1 - 1, GILDED());
  const face = plan.dir(0, -1);
  for (const u of [2, 19]) {
    plan.set(u, LVL.floor1, v1 + 1, stairs(face));
    plan.set(u, LVL.floor1, v1 + 2, SLAB());
    plan.set(u, LVL.floor1 + 1, v1, LAMP());
  }
  // Poolside paving.
  plan.fill(2, LVL.ground, v1 - 2, 19, LVL.ground, v1 - 2, MARBLE());
  plan.fill(2, LVL.ground, v2 + 2, 19, LVL.ground, v2 + 2, MARBLE());
}

/* --- Furniture -------------------------------------------------------- */

function furnishGroundFloor(plan) {
  const y = LVL.floor1;
  const floor = LVL.ground;
  const ceiling = LVL.mid;

  /* Living room: u 1..7, v 1..8 */
  plan.fill(2, floor, 2, 6, floor, 7, RUG());
  const backward = plan.dir(0, -1);
  const rightward = plan.dir(1, 0);
  const leftward = plan.dir(-1, 0);
  for (let u = 2; u <= 6; u += 1) plan.set(u, y, 2, stairs(backward)); // sofa
  plan.set(2, y, 3, stairs(rightward));
  plan.set(6, y, 3, stairs(leftward));
  plan.fill(3, y, 5, 5, y, 5, SLAB()); // coffee table
  // Fireplace in the flank wall.
  plan.fill(1, y, 6, 1, y + 2, 7, GILDED());
  plan.set(1, y, 7, CAMPFIRE());
  plan.set(1, y + 3, 7, ONYX());
  // Chandelier.
  plan.set(4, ceiling - 1, 4, CHAIN());
  plan.set(4, ceiling - 2, 4, LAMP());

  /* Kitchen and dining: u 14..20, v 1..8 */
  plan.fill(15, y, 1, 20, y, 1, QUARTZ()); // counter run
  plan.set(16, y, 1, facingBlock("minecraft:furnace", plan.dir(0, 1)));
  plan.set(17, y, 1, facingBlock("minecraft:smoker", plan.dir(0, 1), "minecraft:furnace"));
  plan.set(
    18,
    y,
    1,
    facingBlock("minecraft:blast_furnace", plan.dir(0, 1), "minecraft:furnace")
  );
  plan.set(19, y, 1, CAULDRON());
  plan.set(20, y, 1, CRAFTING());
  plan.fill(20, y, 2, 20, y, 4, BARREL());
  // Island with stools.
  plan.fill(16, y, 4, 18, y, 4, QUARTZ());
  plan.fill(16, y + 1, 4, 18, y + 1, 4, SLAB());
  plan.set(16, y, 5, stairs(backward));
  plan.set(18, y, 5, stairs(backward));
  // Dining table.
  plan.fill(15, y, 7, 19, y, 7, SLAB());
  plan.set(17, y + 1, 7, CAKE());
  for (let u = 15; u <= 19; u += 2) {
    plan.set(u, y, 6, stairs(plan.dir(0, 1)));
    plan.set(u, y, 8, stairs(backward));
  }
  plan.set(17, ceiling - 1, 4, CHAIN());
  plan.set(17, ceiling - 2, 4, LAMP());

  /* Home cinema: u 1..7, v 10..16 */
  plan.fill(2, floor, 11, 6, floor, 15, RUG());
  plan.fill(2, y, 16, 6, y + 2, 16, SCREEN());
  plan.set(1, y, 16, JUKEBOX());
  for (let v = 12; v <= 14; v += 2) {
    for (let u = 2; u <= 6; u += 2) {
      plan.set(u, y, v, stairs(plan.dir(0, 1)));
    }
  }
  plan.set(4, ceiling - 1, 13, LAMP());

  /* Spa and bathroom: u 14..20, v 10..16 */
  plan.fill(15, floor, 11, 19, floor, 15, MARBLE());
  plan.ring(15, floor, 11, 19, 15, GILDED());
  plan.clear(16, floor, 12, 18, floor, 14);
  plan.fill(16, floor - 1, 12, 18, floor - 1, 14, CRYSTAL());
  plan.fill(16, floor, 12, 18, floor, 14, WATER()); // sunken bath
  plan.set(20, y, 11, CAULDRON());
  plan.set(20, y, 15, CAULDRON());
  plan.set(17, ceiling - 1, 13, LAMP());
  plan.set(14, y + 1, 13, SEA_LANTERN());

  /* Grand hall: u 9..12, v 1..16 */
  plan.fill(9, floor, 1, 12, floor, 10, RUG());
  plan.ring(9, floor, 1, 12, 10, MARBLE());
  for (const [u, v] of [
    [9, 3],
    [12, 3],
    [9, 8],
    [12, 8],
  ]) {
    plan.column(u, y, v, y + 3, ONYX());
    plan.set(u, y + 4, v, GILDED());
  }
  plan.set(10, ceiling - 1, 5, CHAIN());
  plan.set(11, ceiling - 1, 5, CHAIN());
  plan.set(10, ceiling - 2, 5, LAMP());
  plan.set(11, ceiling - 2, 5, LAMP());
}

function furnishUpperFloor(plan) {
  const y = LVL.floor2;
  const floor = LVL.mid;
  const ceiling = LVL.roofSlab;
  const backward = plan.dir(0, -1);
  const forward = plan.dir(0, 1);

  /* Master suite: u 1..8, v 1..8 */
  plan.fill(2, floor, 2, 7, floor, 7, RUG());
  plan.set(3, y, 2, bed(forward, false));
  plan.set(3, y, 3, bed(forward, true));
  plan.set(4, y, 2, bed(forward, false));
  plan.set(4, y, 3, bed(forward, true));
  plan.fill(2, y, 2, 2, y, 3, SLAB()); // bedside tables
  plan.fill(5, y, 2, 5, y, 3, SLAB());
  plan.set(2, y + 1, 2, lantern(false));
  plan.set(5, y + 1, 3, lantern(false));
  plan.fill(1, y, 6, 1, y + 1, 8, BOOKSHELF());
  plan.set(7, y, 7, facingBlock("minecraft:chest", backward));
  plan.set(6, y, 7, facingBlock("minecraft:chest", backward));
  plan.set(4, ceiling - 1, 5, LAMP());

  /* Guest room: u 13..20, v 1..8 */
  plan.fill(14, floor, 2, 19, floor, 7, RUG());
  plan.set(17, y, 2, bed(forward, false));
  plan.set(17, y, 3, bed(forward, true));
  plan.set(16, y, 2, SLAB());
  plan.set(18, y, 2, SLAB());
  plan.set(16, y + 1, 2, lantern(false));
  plan.set(20, y, 7, facingBlock("minecraft:chest", backward));
  plan.fill(20, y, 4, 20, y + 1, 5, BOOKSHELF());
  plan.set(17, ceiling - 1, 5, LAMP());

  /* Library and study: u 1..8, v 10..16 */
  plan.fill(2, floor, 11, 7, floor, 15, RUG());
  plan.fill(1, y, 11, 1, y + 2, 15, BOOKSHELF());
  plan.fill(2, y, 16, 7, y + 2, 16, BOOKSHELF());
  plan.set(4, y, 13, ENCHANTER());
  plan.set(3, y, 13, LECTERN());
  plan.set(5, y, 13, stairs(plan.dir(-1, 0)));
  plan.set(4, ceiling - 1, 13, LAMP());

  /* Dressing room and gym: u 13..20, v 10..16 */
  plan.fill(14, floor, 11, 19, floor, 15, RUG());
  plan.fill(20, y, 11, 20, y, 15, facingBlock("minecraft:chest", plan.dir(-1, 0)));
  plan.fill(14, y, 16, 16, y, 16, IRON_BLOCK());
  plan.set(15, y + 1, 16, GOLD_BLOCK());
  // The desk stays clear of u 18..19, which is the roof stair's run.
  plan.fill(14, y, 12, 15, y, 12, SLAB());
  plan.set(15, y, 13, stairs(forward));
  plan.set(16, ceiling - 1, 13, LAMP());

  /* Landing: u 10..11, v 1..10 */
  plan.fill(10, floor, 1, 11, floor, 10, RUG());
  plan.set(10, ceiling - 1, 4, CHAIN());
  plan.set(11, ceiling - 1, 4, CHAIN());
  plan.set(10, ceiling - 2, 4, LAMP());
  plan.set(11, ceiling - 2, 4, LAMP());
}

function furnishRoof(plan) {
  const deck = LVL.deck;
  const slab = LVL.roofSlab;
  const backward = plan.dir(0, -1);

  // Lounge deck opposite the pool. It stops at v = 7 so it never runs into
  // the stair kiosk, which starts at v = 8.
  plan.fill(13, slab, 3, 19, slab, 7, RUG());
  for (const v of [4, 6]) {
    for (let u = 14; u <= 18; u += 2) {
      plan.set(u, deck, v, stairs(backward));
    }
  }
  plan.fill(15, deck, 5, 17, deck, 5, SLAB()); // low table
  plan.set(16, deck + 1, 5, END_ROD());

  // Pergola over the lounge.
  for (const [u, v] of [
    [13, 3],
    [19, 3],
    [13, 7],
    [19, 7],
  ]) {
    plan.column(u, deck, v, deck + 2, GILDED());
  }
  plan.fill(13, deck + 3, 3, 19, deck + 3, 3, GILDED());
  plan.fill(13, deck + 3, 7, 19, deck + 3, 7, GILDED());
  plan.fill(13, deck + 3, 3, 13, deck + 3, 7, GILDED());
  plan.fill(19, deck + 3, 3, 19, deck + 3, 7, GILDED());
  plan.set(16, deck + 3, 5, CHAIN());
  plan.set(16, deck + 2, 5, LAMP());

  // Corner lights along the parapet.
  for (const [u, v] of [
    [1, 1],
    [W - 2, 1],
    [1, D - 2],
    [W - 2, D - 2],
  ]) {
    plan.set(u, deck, v, LAMP());
  }
}

/* ------------------------------------------------------------------ *
 * Running a plan
 * ------------------------------------------------------------------ */

const AIR_ID = "minecraft:air";

function runPlan(plan, player, label, onDone) {
  const { site: target } = plan;
  const dimension = target.dimension;
  let opIndex = 0;
  let cursor = 0;
  let placed = 0;
  let skipped = 0;

  const step = () => {
    let budget = CONFIG.blocksPerTick;

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

      if (op.filter && !op.filter(u, y, v)) continue;

      const position = toWorld(target, u, y, v);
      try {
        const block = dimension.getBlock(position);
        if (!block) {
          skipped += 1;
          continue;
        }
        // Clearing already-empty space is by far the most common op; skipping
        // it keeps the whole build inside its per-tick budget.
        if (op.block.type.id === AIR_ID && block.isAir) continue;
        block.setPermutation(op.block);
        placed += 1;
      } catch (error) {
        skipped += 1; // unloaded chunk, world border, protected block
      }
    }

    if (opIndex < plan.ops.length) {
      if (CONFIG.announceProgress) {
        const done = Math.min(99, Math.floor((placed / Math.max(1, plan.total)) * 100));
        safe(() =>
          player.onScreenDisplay.setActionBar(`§6${label}§r ${done}% - ${placed} blocks`)
        );
      }
      system.run(step);
      return;
    }

    onDone({ placed, skipped });
  };

  system.run(step);
}

/** Run a cosmetic or optional call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    fn();
  } catch (error) {
    /* ignored on purpose */
  }
}

/* ------------------------------------------------------------------ *
 * Remembering where each player put their villa
 * ------------------------------------------------------------------ */

const siteMemory = new Map(); // fallback when dynamic properties are unavailable

function boundsOfLot(target) {
  const corners = [
    toWorld(target, LOT.u1, 0, LOT.v1),
    toWorld(target, LOT.u2, 0, LOT.v1),
    toWorld(target, LOT.u1, 0, LOT.v2),
    toWorld(target, LOT.u2, 0, LOT.v2),
  ];
  return {
    dimensionId: target.dimension.id,
    min: {
      x: Math.min(...corners.map((c) => c.x)),
      y: target.origin.y + LVL.bedrock,
      z: Math.min(...corners.map((c) => c.z)),
    },
    max: {
      x: Math.max(...corners.map((c) => c.x)),
      y: target.origin.y + LVL.sky,
      z: Math.max(...corners.map((c) => c.z)),
    },
    groundY: target.origin.y + LVL.ground,
  };
}

function rememberSite(player, bounds) {
  siteMemory.set(player.id, bounds);
  safe(() =>
    world.setDynamicProperty(`luxury:site:${player.id}`, JSON.stringify(bounds))
  );
}

function recallSite(player) {
  if (siteMemory.has(player.id)) return siteMemory.get(player.id);
  let stored;
  safe(() => {
    stored = world.getDynamicProperty(`luxury:site:${player.id}`);
  });
  if (typeof stored !== "string") return undefined;
  try {
    return JSON.parse(stored);
  } catch (error) {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const building = new Set(); // players with a build already in flight

function buildVilla(player) {
  if (building.has(player.id)) {
    player.sendMessage("§e[Luxury Estate]§r Your last villa is still going up.");
    return;
  }

  const target = siteForPlayer(player);
  const plan = new Plan(target);
  designVilla(plan);

  const bounds = boundsOfLot(target);
  rememberSite(player, bounds);

  building.add(player.id);
  player.sendMessage(
    `§6[Luxury Estate]§r Laying out the villa - ${plan.total.toLocaleString?.() ?? plan.total} cells to work through.`
  );
  safe(() => player.playSound("random.levelup"));

  runPlan(plan, player, "Building villa", ({ placed, skipped }) => {
    building.delete(player.id);
    player.sendMessage(
      `§6[Luxury Estate]§r Villa complete - ${placed} blocks placed` +
        (skipped ? `, ${skipped} skipped (out of range).` : ".")
    );
    safe(() => player.onScreenDisplay.setActionBar("§6Welcome home."));
    safe(() => player.playSound("random.toast"));

    if (CONFIG.consumeDeed) consumeHeldItem(player, ITEMS.DEED);
  });
}

function demolish(player) {
  if (building.has(player.id)) {
    player.sendMessage("§e[Luxury Estate]§r Wait for the current build to finish.");
    return;
  }

  const bounds = recallSite(player);
  if (!bounds) {
    player.sendMessage(
      "§c[Luxury Estate]§r No villa on record for you. Place one with a deed first."
    );
    return;
  }
  if (bounds.dimensionId !== player.dimension.id) {
    player.sendMessage(
      `§c[Luxury Estate]§r Your villa is in §f${bounds.dimensionId}§c, not here.`
    );
    return;
  }

  const target = axisAlignedSite(player.dimension, {
    x: bounds.min.x,
    y: bounds.groundY,
    z: bounds.min.z,
  });
  const plan = new Plan(target);
  const uSpan = bounds.max.x - bounds.min.x;
  const vSpan = bounds.max.z - bounds.min.z;
  const top = bounds.max.y - bounds.groundY;

  plan.fill(0, 1, 0, uSpan, top, vSpan, AIR());
  if (CONFIG.flattenGround) {
    plan.fill(0, 0, 0, uSpan, 0, vSpan, GRASS());
    plan.fill(0, -2, 0, uSpan, -1, vSpan, DIRT());
  }

  building.add(player.id);
  player.sendMessage("§6[Luxury Estate]§r Clearing the estate...");
  runPlan(plan, player, "Clearing estate", ({ placed }) => {
    building.delete(player.id);
    siteMemory.delete(player.id);
    safe(() => world.setDynamicProperty(`luxury:site:${player.id}`, undefined));
    player.sendMessage(`§6[Luxury Estate]§r Lot cleared - ${placed} blocks removed.`);
  });
}

function consumeHeldItem(player, itemId) {
  safe(() => {
    const equipment = player.getComponent("minecraft:inventory");
    const container = equipment?.container;
    if (!container) return;
    const slot = player.selectedSlotIndex ?? player.selectedSlot;
    const stack = container.getItem(slot);
    if (stack?.typeId === itemId) container.setItem(slot, undefined);
  });
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const itemId = event.itemStack?.typeId;
  if (!player || !itemId) return;

  if (itemId === ITEMS.DEED) {
    try {
      buildVilla(player);
    } catch (error) {
      player.sendMessage(`§c[Luxury Estate]§r Build failed: ${error}`);
    }
  } else if (itemId === ITEMS.PERMIT) {
    try {
      demolish(player);
    } catch (error) {
      player.sendMessage(`§c[Luxury Estate]§r Demolition failed: ${error}`);
    }
  }
});

world.afterEvents.worldInitialize?.subscribe(() => {
  system.run(() => {
    safe(() =>
      world.sendMessage(
        "§6[Luxury Estate]§r v1.0.0 loaded - hold the Luxury Villa Deed and tap Use."
      )
    );
  });
});

// Late-joining players get the same hint, so a dedicated server still tells you
// whether the behaviour pack is actually running.
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§6[Luxury Estate]§r v1.0.0 loaded - craft a Luxury Villa Deed, then tap Use."
    )
  );
});
