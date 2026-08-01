/*
 * Builder Buddy - companion behaviour and staged house construction.
 *
 * Targets Minecraft Bedrock 1.21.0 with the stable script modules only
 * (@minecraft/server 1.11.0, @minecraft/server-ui 1.2.0), so no experimental
 * toggles are needed in the world settings.
 *
 * Everything that touches the world is wrapped in try/catch: a single bad
 * block state or an unloaded chunk must never stop a build half-finished.
 */

import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const BOT = "bb:builder_buddy";
const REMOTE = "bb:house_builder_remote";
const PREFIX = "§e<Builder Buddy>§r ";

/** Ticks a player must wait between builds. */
const BUILD_COOLDOWN = 2400; // 120 seconds
/** Blocks placed per runner pass, and ticks between passes. Tuned for phones. */
const OPS_PER_PASS = 30;
const PASS_INTERVAL = 3;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function say(target, message) {
  try {
    if (target && typeof target.sendMessage === "function") {
      target.sendMessage(PREFIX + message);
    } else {
      world.sendMessage(PREFIX + message);
    }
  } catch {
    /* player left mid-message */
  }
}

function beep(player, sound, pitch) {
  try {
    player.playSound(sound, { pitch: pitch ?? 1.0, volume: 0.8 });
  } catch {
    /* sound is cosmetic */
  }
}

// ---------------------------------------------------------------------------
// Block palette
//
// Block identifiers were flattened at different points in Bedrock's history,
// so every palette entry lists the candidates newest-first. The first id that
// resolves on this game version wins and is cached.
// ---------------------------------------------------------------------------

const PALETTE = {
  air: [["minecraft:air", {}]],
  dirt: [["minecraft:dirt", {}]],
  grass: [["minecraft:grass_block", {}], ["minecraft:grass", {}]],
  planks: [["minecraft:oak_planks", {}], ["minecraft:planks", { wood_type: "oak" }]],
  log: [
    ["minecraft:oak_log", { pillar_axis: "y" }],
    ["minecraft:log", { old_log_type: "oak", pillar_axis: "y" }]
  ],
  stairs: [["minecraft:oak_stairs", {}]],
  slab: [["minecraft:oak_slab", {}], ["minecraft:wooden_slab", { wood_type: "oak" }]],
  fence: [["minecraft:oak_fence", {}], ["minecraft:fence", { wood_type: "oak" }]],
  gate: [["minecraft:oak_fence_gate", {}], ["minecraft:fence_gate", {}]],
  door: [["minecraft:oak_door", {}], ["minecraft:wooden_door", {}]],
  stonebrick: [
    ["minecraft:stone_bricks", {}],
    ["minecraft:stonebrick", { stone_brick_type: "default" }]
  ],
  cobble: [["minecraft:cobblestone", {}]],
  glass: [["minecraft:glass", {}]],
  pane: [["minecraft:glass_pane", {}]],
  torch: [["minecraft:torch", {}]],
  lantern: [["minecraft:lantern", {}]],
  crafting: [["minecraft:crafting_table", {}]],
  furnace: [["minecraft:furnace", {}]],
  chest: [["minecraft:chest", {}]],
  bookshelf: [["minecraft:bookshelf", {}]],
  bed: [["minecraft:bed", {}]],
  carpet: [["minecraft:white_carpet", {}], ["minecraft:carpet", { color: "white" }]],
  farmland: [["minecraft:farmland", {}]],
  water: [["minecraft:water", {}]],
  wheat: [["minecraft:wheat", {}]],
  flowerpot: [["minecraft:flower_pot", {}]]
};

const permCache = new Map();

/** Resolve a palette alias (plus optional block states) to a BlockPermutation. */
function perm(alias, states) {
  const key = states ? alias + JSON.stringify(states) : alias;
  if (permCache.has(key)) return permCache.get(key);

  let resolved;
  for (const [id, base] of PALETTE[alias] ?? []) {
    try {
      resolved = BlockPermutation.resolve(id, { ...base, ...(states ?? {}) });
      break;
    } catch {
      // Wrong id or unsupported state on this version - try the next candidate.
    }
  }
  if (!resolved && states) {
    // States were the problem, not the block. Fall back to the plain block so
    // the house still gets built, just without the decorative orientation.
    resolved = perm(alias);
  }
  permCache.set(key, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Terrain classification
// ---------------------------------------------------------------------------

const CLEARABLE = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:short_grass",
  "minecraft:tallgrass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:double_plant",
  "minecraft:snow_layer",
  "minecraft:dead_bush",
  "minecraft:vine",
  "minecraft:red_flower",
  "minecraft:yellow_flower",
  "minecraft:pink_petals",
  "minecraft:sweet_berry_bush",
  "minecraft:bamboo",
  "minecraft:sugar_cane",
  "minecraft:torchflower",
  "minecraft:pitcher_plant"
]);

/** Vegetation and air - safe for the buddy to clear away. */
function isClearable(id) {
  if (CLEARABLE.has(id)) return true;
  return (
    id.endsWith("_leaves") ||
    id.endsWith("_sapling") ||
    id.endsWith("_flower") ||
    id.endsWith("_log") ||
    id.endsWith("_wood") ||
    id.endsWith("_mushroom")
  );
}

function isLiquid(id) {
  return id.includes("water") || id.includes("lava");
}

/** Markers of something already built here - never build on top of these. */
const STRUCTURE_HINTS = [
  "planks",
  "brick",
  "door",
  "chest",
  "furnace",
  "glass",
  "wool",
  "concrete",
  "stairs",
  "slab",
  "fence",
  "wall",
  "bed",
  "rail",
  "spawner",
  "obsidian",
  "bedrock",
  "portal",
  "barrel",
  "campfire",
  "lantern",
  "torch",
  "crafting",
  "anvil",
  "bookshelf",
  "chain",
  "banner",
  "sign"
];

function looksManMade(id) {
  for (const hint of STRUCTURE_HINTS) {
    if (id.includes(hint)) return true;
  }
  return false;
}

function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x, y, z });
  } catch {
    return undefined; // unloaded chunk or outside the world height
  }
}

function typeAt(dim, x, y, z) {
  const b = blockAt(dim, x, y, z);
  return b ? b.typeId : undefined;
}

// ---------------------------------------------------------------------------
// House plan
//
// Local coordinates: x/z run 0..14 across the fenced plot, y = 0 is the first
// air block above the levelled ground (so y = -1 is the floor you stand on).
// ---------------------------------------------------------------------------

const PW = 15; // plot width  (x)
const PD = 15; // plot depth  (z)
const HX0 = 3;
const HX1 = 11; // house walls in x
const HZ0 = 2;
const HZ1 = 10; // house walls in z
const DOOR_X = 7;
const MID_Y = 4; // upper floor
const ROOF_Y = 9; // first roof layer
const PATH_X = 7;

const GROUND_WINDOWS_X = [5, 9];
const SIDE_WINDOWS_Z = [4, 6, 8];

function isHouseWall(x, z) {
  const inside = x >= HX0 && x <= HX1 && z >= HZ0 && z <= HZ1;
  if (!inside) return false;
  return x === HX0 || x === HX1 || z === HZ0 || z === HZ1;
}

function isHouseCorner(x, z) {
  return (x === HX0 || x === HX1) && (z === HZ0 || z === HZ1);
}

function inFootprint(x, z) {
  return x >= HX0 && x <= HX1 && z >= HZ0 && z <= HZ1;
}

function inFarm(x, z) {
  return x >= 1 && x <= 5 && z >= 11 && z <= 13;
}

/** The 2x2 opening in the upper floor that the staircase comes up through. */
function isStairHole(x, z) {
  return (x === 4 || x === 5) && (z === 7 || z === 8);
}

/**
 * Build the whole construction plan.
 *
 * Returns an ordered list of stages; each op is [x, y, z, alias, states, mode]
 * where mode is "set" (default), "clear" (skip if already air) or "soft"
 * (only place into air/vegetation, used for levelling).
 */
function makePlan() {
  const stages = [];

  // -- 1. clear and level -------------------------------------------------
  {
    const ops = [];
    for (let x = 0; x < PW; x++) {
      for (let z = 0; z < PD; z++) {
        const nearHouse =
          x >= HX0 - 1 && x <= HX1 + 1 && z >= HZ0 - 1 && z <= HZ1 + 1;
        const top = nearHouse ? 15 : 4;
        for (let y = top; y >= 0; y--) ops.push([x, y, z, "air", undefined, "clear"]);
        for (let y = -1; y >= -3; y--) ops.push([x, y, z, "dirt", undefined, "soft"]);
      }
    }
    stages.push({
      name: "Clearing and levelling the ground",
      line: "I'll build the house here. Clearing the ground first!",
      anchor: [7, 12],
      ops
    });
  }

  // -- 2. foundation ------------------------------------------------------
  {
    const ops = [];
    for (let x = 0; x < PW; x++) {
      for (let z = 0; z < PD; z++) {
        let alias = "grass";
        if (inFootprint(x, z)) alias = "stonebrick";
        else if (
          (x >= HX0 - 1 && x <= HX1 + 1 && z >= HZ0 - 1 && z <= HZ1 + 1) ||
          (x === PATH_X && z >= HZ1 + 1)
        ) {
          alias = "cobble";
        }
        ops.push([x, -1, z, alias]);
      }
    }
    stages.push({
      name: "Laying the foundation",
      line: "Foundation going down - nice and level!",
      anchor: [7, 12],
      ops
    });
  }

  // -- 3. walls, floors and the staircase ---------------------------------
  {
    const ops = [];
    // Ground floor and upper floor walls.
    for (const base of [0, MID_Y + 1]) {
      for (let dy = 0; dy < 4; dy++) {
        const y = base + dy;
        for (let x = HX0; x <= HX1; x++) {
          for (let z = HZ0; z <= HZ1; z++) {
            if (!isHouseWall(x, z)) continue;
            ops.push([x, y, z, isHouseCorner(x, z) ? "log" : "planks"]);
          }
        }
      }
    }
    // Upper floor deck, then the stairwell opening.
    for (let x = HX0; x <= HX1; x++) {
      for (let z = HZ0; z <= HZ1; z++) {
        ops.push([x, MID_Y, z, "planks"]);
      }
    }
    for (let x = HX0; x <= HX1; x++) {
      for (let z = HZ0; z <= HZ1; z++) {
        if (isStairHole(x, z)) ops.push([x, MID_Y, z, "air"]);
      }
    }
    // Staircase: four steps rising north to south along x = 4.
    for (let step = 0; step < 4; step++) {
      ops.push([4, step, 4 + step, "stairs", { weirdo_direction: 2, upside_down_bit: false }]);
    }
    stages.push({
      name: "Raising the walls",
      line: "Walls are going up - two floors, just like you asked!",
      anchor: [2, 6],
      ops
    });
  }

  // -- 4. windows and doors -----------------------------------------------
  {
    const ops = [];
    const window = (x, y, z) => ops.push([x, y, z, "pane"]);

    for (const y of [1, 2]) {
      for (const x of GROUND_WINDOWS_X) {
        window(x, y, HZ1); // front
        window(x, y, HZ0); // back
      }
      window(DOOR_X, y, HZ0);
      for (const z of SIDE_WINDOWS_Z) {
        window(HX0, y, z);
        window(HX1, y, z);
      }
    }
    for (const y of [MID_Y + 2, MID_Y + 3]) {
      for (const x of [5, 7, 9]) {
        window(x, y, HZ1);
        window(x, y, HZ0);
      }
      for (const z of SIDE_WINDOWS_Z) {
        window(HX0, y, z);
        window(HX1, y, z);
      }
    }

    // Front door: clear the opening, then set both halves.
    ops.push([DOOR_X, 0, HZ1, "air"]);
    ops.push([DOOR_X, 1, HZ1, "air"]);
    ops.push([
      DOOR_X,
      0,
      HZ1,
      "door",
      { direction: 1, upper_block_bit: false, door_hinge_bit: false, open_bit: false }
    ]);
    ops.push([
      DOOR_X,
      1,
      HZ1,
      "door",
      { direction: 1, upper_block_bit: true, door_hinge_bit: false, open_bit: false }
    ]);

    stages.push({
      name: "Fitting windows and doors",
      line: "Glass in the windows and a front door for you!",
      anchor: [7, 11],
      ops
    });
  }

  // -- 5. roof ------------------------------------------------------------
  {
    const ops = [];
    for (let layer = 0; layer <= 4; layer++) {
      const y = ROOF_Y + layer;
      const x0 = HX0 - 1 + layer;
      const x1 = HX1 + 1 - layer;
      const z0 = HZ0 - 1 + layer;
      const z1 = HZ1 + 1 - layer;
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const edge = x === x0 || x === x1 || z === z0 || z === z1;
          if (!edge || layer === 4) {
            ops.push([x, y, z, "planks"]);
            continue;
          }
          // Stairs ascend towards the middle of the roof.
          let dir = 0;
          if (x === x0) dir = 0; // ascending east
          else if (x === x1) dir = 1; // ascending west
          else if (z === z0) dir = 2; // ascending south
          else dir = 3; // ascending north
          ops.push([x, y, z, "stairs", { weirdo_direction: dir, upside_down_bit: false }]);
        }
      }
    }
    stages.push({
      name: "Building the roof",
      line: "Roof time! Nearly weather-proof.",
      anchor: [12, 6],
      ops
    });
  }

  // -- 6. furniture -------------------------------------------------------
  {
    const ops = [];
    // Ground floor.
    ops.push([5, 0, 3, "crafting"]);
    ops.push([6, 0, 3, "furnace", { facing_direction: 3 }]);
    ops.push([9, 0, 3, "chest", { facing_direction: 3 }]);
    ops.push([10, 0, 3, "chest", { facing_direction: 3 }]);
    for (const z of [6, 7, 8]) ops.push([10, 0, z, "bookshelf"]);
    ops.push([7, 0, 6, "fence"]);
    ops.push([7, 1, 6, "carpet"]);
    ops.push([9, 0, 8, "flowerpot"]);

    // Upper floor bedroom.
    ops.push([9, MID_Y + 1, 5, "bed", { direction: 2, head_piece_bit: false, occupied_bit: false }]);
    ops.push([9, MID_Y + 1, 4, "bed", { direction: 2, head_piece_bit: true, occupied_bit: false }]);
    for (const x of [5, 6, 7]) ops.push([x, MID_Y + 1, 3, "bookshelf"]);
    ops.push([10, MID_Y + 1, 9, "chest", { facing_direction: 2 }]);
    ops.push([4, MID_Y + 1, 9, "crafting"]);

    stages.push({
      name: "Moving the furniture in",
      line: "Bed, chests, crafting table and a furnace - all in!",
      anchor: [7, 11],
      ops
    });
  }

  // -- 7. lighting --------------------------------------------------------
  {
    const ops = [];
    const wallTorch = (x, y, z, face) =>
      ops.push([x, y, z, "torch", { torch_facing_direction: face }]);

    for (const y of [2, MID_Y + 3]) {
      wallTorch(4, y, 3, "south");
      wallTorch(10, y, 3, "south");
      wallTorch(4, y, 9, "north");
      wallTorch(10, y, 9, "north");
    }
    ops.push([7, 3, 5, "lantern", { hanging: true }]);
    ops.push([7, MID_Y + 4, 7, "lantern", { hanging: true }]);

    // Porch lamps beside the door and lamps on the four plot corners.
    for (const x of [5, 9]) {
      ops.push([x, 0, HZ1 + 1, "fence"]);
      ops.push([x, 1, HZ1 + 1, "lantern", { hanging: false }]);
    }
    for (const [x, z] of [[0, 0], [PW - 1, 0], [0, PD - 1], [PW - 1, PD - 1]]) {
      ops.push([x, 1, z, "lantern", { hanging: false }]);
    }

    stages.push({
      name: "Putting the lights in",
      line: "Lanterns and torches on - no mobs spawning in here!",
      anchor: [7, 11],
      ops
    });
  }

  // -- 8. fence and small farm --------------------------------------------
  {
    const ops = [];
    for (let x = 0; x < PW; x++) {
      for (let z = 0; z < PD; z++) {
        const onRing = x === 0 || x === PW - 1 || z === 0 || z === PD - 1;
        if (!onRing) continue;
        if (x === PATH_X && z === PD - 1) {
          ops.push([x, 0, z, "gate", { direction: 0, in_wall_bit: false, open_bit: false }]);
        } else {
          ops.push([x, 0, z, "fence"]);
        }
      }
    }
    for (let x = 1; x <= 5; x++) {
      for (let z = 11; z <= 13; z++) {
        if (x === 3 && z === 12) {
          ops.push([x, -1, z, "water"]);
          ops.push([x, 0, z, "air"]);
        } else {
          ops.push([x, -1, z, "farmland", { moisturized_amount: 7 }]);
          ops.push([x, 0, z, "wheat", { growth: 7 }]);
        }
      }
    }
    stages.push({
      name: "Fencing the plot and planting the farm",
      line: "Fence up and wheat planted. Almost done!",
      anchor: [3, 10],
      ops
    });
  }

  return stages;
}

// ---------------------------------------------------------------------------
// Site validation
// ---------------------------------------------------------------------------

/** Find the first air block above solid ground in this column, or undefined. */
function surfaceY(dim, x, z, fromY) {
  let air = 0;
  for (let y = fromY + 8; y >= fromY - 12; y--) {
    const id = typeAt(dim, x, y, z);
    if (id === undefined) return undefined;
    if (isLiquid(id)) return undefined; // water or lava at the surface
    if (isClearable(id)) {
      air++;
      continue;
    }
    if (air === 0) continue; // still inside terrain, keep descending
    return y + 1;
  }
  return undefined;
}

/**
 * Check one candidate plot. Samples a coarse grid rather than all 225 columns
 * so the search stays cheap enough to run on a phone.
 */
function validateSite(dim, ox, oz, aroundY, players) {
  const cols = [0, 3, 6, 9, 12, 14];
  const heights = [];

  for (const lx of cols) {
    for (const lz of cols) {
      const y = surfaceY(dim, ox + lx, oz + lz, aroundY);
      if (y === undefined) return undefined;
      heights.push(y);
    }
  }

  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  if (hi - lo > 4) return undefined; // a mountainside or a ravine
  const oy = Math.round(heights.reduce((a, b) => a + b, 0) / heights.length);

  // Nothing man-made anywhere in the plot, and no solid rock in the yard.
  //
  // The scan starts *below* the surface on purpose. Looking only upwards finds
  // clear sky above somebody's roof and happily builds a second house on top
  // of it, so the two blocks the plot would rest on get checked as well.
  for (const lx of cols) {
    for (const lz of cols) {
      for (let dy = -2; dy <= 4; dy++) {
        const id = typeAt(dim, ox + lx, oy + dy, oz + lz);
        if (id === undefined) return undefined;
        if (isLiquid(id)) return undefined;
        if (looksManMade(id)) return undefined;
        if (dy > 0 && !isClearable(id)) return undefined;
      }
    }
  }

  // Open sky above the house itself - this is what rules out caves and
  // overhangs, where a house would end up buried in stone.
  const skyProbes = [
    [HX0, HZ0],
    [HX1, HZ0],
    [HX0, HZ1],
    [HX1, HZ1],
    [DOOR_X, 6]
  ];
  for (const [lx, lz] of skyProbes) {
    for (let dy = 1; dy <= 18; dy++) {
      const id = typeAt(dim, ox + lx, oy + dy, oz + lz);
      if (id === undefined) return undefined;
      if (!isClearable(id)) return undefined;
    }
  }

  // Never build on top of somebody.
  for (const p of players) {
    const l = p.location;
    if (
      l.x >= ox - 2 &&
      l.x <= ox + PW + 2 &&
      l.z >= oz - 2 &&
      l.z <= oz + PD + 2 &&
      l.y >= oy - 6 &&
      l.y <= oy + 18
    ) {
      return undefined;
    }
  }

  return oy;
}

// ---------------------------------------------------------------------------
// Build job runner
// ---------------------------------------------------------------------------

let job; // only one build at a time keeps the frame rate sane on mobile
const lastBuildTick = new Map();

function botState(bot) {
  return { x: bot.location.x, y: bot.location.y, z: bot.location.z };
}

function setPose(bot, pose) {
  try {
    bot.triggerEvent("bb:pose_" + pose + "_event");
  } catch {
    /* bot despawned */
  }
}

function setMode(bot, mode) {
  try {
    bot.triggerEvent("bb:mode_" + mode + "_event");
    for (const tag of ["bb_follow", "bb_stay", "bb_build"]) bot.removeTag(tag);
    bot.addTag("bb_" + mode);
  } catch {
    /* bot despawned */
  }
}

function moveBotTo(bot, dim, origin, anchor, oy) {
  const target = {
    x: origin.ox + anchor[0] + 0.5,
    y: oy,
    z: origin.oz + anchor[1] + 0.5
  };
  try {
    bot.teleport(target, {
      dimension: dim,
      facingLocation: { x: origin.ox + 7.5, y: oy + 2, z: origin.oz + 6.5 }
    });
  } catch {
    /* the buddy stays where it is; the build carries on regardless */
  }
}

function applyOp(dim, origin, oy, op) {
  const [lx, ly, lz, alias, states, mode] = op;
  const x = origin.ox + lx;
  const y = oy + ly;
  const z = origin.oz + lz;

  const block = blockAt(dim, x, y, z);
  if (!block) return;

  if (mode === "clear" && block.typeId === "minecraft:air") return;
  if (mode === "soft" && !isClearable(block.typeId) && !isLiquid(block.typeId)) return;

  const p = perm(alias, states);
  if (!p) return;
  try {
    block.setPermutation(p);
  } catch {
    /* protected or unloaded - skip this one block */
  }
}

function endJob(celebrate) {
  if (!job) return;
  const finished = job;
  job = undefined;

  try {
    system.clearRun(finished.handle);
  } catch {
    /* already cleared */
  }

  const bot = finished.bot;
  if (bot) {
    if (celebrate) {
      setPose(bot, "celebrate");
      system.runTimeout(() => {
        setPose(bot, "normal");
        setMode(bot, "follow");
      }, 100);
    } else {
      setPose(bot, "normal");
      setMode(bot, "follow");
    }
  }
}

function stepJob() {
  if (!job) return;

  // Starting a new stage: announce it and walk the buddy over to that section.
  if (job.opIndex === 0) {
    const stage = job.stages[job.stageIndex];
    say(job.player, stage.line);
    beep(job.player, "random.orb", 1.2);
    if (job.bot) {
      moveBotTo(job.bot, job.dim, job.origin, stage.anchor, job.oy);
      setPose(job.bot, "build");
    }
  }

  const stage = job.stages[job.stageIndex];
  let budget = OPS_PER_PASS;
  while (budget-- > 0 && job.opIndex < stage.ops.length) {
    applyOp(job.dim, job.origin, job.oy, stage.ops[job.opIndex++]);
  }

  if (job.opIndex < stage.ops.length) return;

  job.stageIndex++;
  job.opIndex = 0;

  if (job.stageIndex >= job.stages.length) {
    say(job.player, "House completed! Come and have a look inside.");
    beep(job.player, "random.levelup", 1.0);
    try {
      job.player.sendMessage(
        `§7Your house is at §fx ${job.origin.ox + 7}, y ${job.oy}, z ${job.origin.oz + 6}§7.`
      );
    } catch {
      /* player left */
    }
    endJob(true);
  }
}

function startBuild(player, bot, dim, ox, oy, oz) {
  job = {
    player,
    bot,
    dim,
    origin: { ox, oz },
    oy,
    stages: makePlan(),
    stageIndex: 0,
    opIndex: 0
  };
  lastBuildTick.set(player.id, system.currentTick);
  setMode(bot, "build");
  job.handle = system.runInterval(stepJob, PASS_INTERVAL);
}

// ---------------------------------------------------------------------------
// Build request (site search is spread across ticks)
// ---------------------------------------------------------------------------

const RING_OFFSETS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

function requestBuild(player) {
  if (job) {
    say(player, "I'm already building something! Use Cancel first.");
    return;
  }

  const last = lastBuildTick.get(player.id);
  if (last !== undefined && system.currentTick - last < BUILD_COOLDOWN) {
    const left = Math.ceil((BUILD_COOLDOWN - (system.currentTick - last)) / 20);
    say(player, `I need a rest - I can build again in ${left} seconds.`);
    return;
  }

  // Recall rather than refuse: "nothing happened" is the worst answer, and a
  // buddy that wandered out of range is not a reason to cancel the request.
  let bot = nearestBot(player, 24);
  if (!bot) {
    bot = nearestBot(player, 128);
    if (bot) {
      teleportToPlayer(bot, player);
      say(player, "Coming! Give me a second.");
    }
  }
  if (!bot) {
    bot = spawnBuddy(player);
    if (bot) say(player, "Reporting for duty!");
  }
  if (!bot) {
    say(player, "I can't get to you - make some space and try again.");
    return;
  }

  say(player, "Let me find a good spot...");
  setMode(bot, "stay");

  const dim = player.dimension;
  const players = world.getAllPlayers();
  const baseX = Math.floor(player.location.x);
  const baseY = Math.floor(player.location.y);
  const baseZ = Math.floor(player.location.z);

  const candidates = [];
  for (const dist of [10, 14, 18]) {
    for (const [dx, dz] of RING_OFFSETS) {
      candidates.push([baseX + dx * dist, baseZ + dz * dist]);
    }
  }

  let index = 0;
  const search = system.runInterval(() => {
    // One candidate per tick, so the search never stalls a frame.
    if (index >= candidates.length) {
      system.clearRun(search);
      say(player, "There's no safe, flat, open space around here. Try somewhere more open, away from water, caves and other buildings.");
      setMode(bot, "follow");
      return;
    }

    const [cx, cz] = candidates[index++];
    const ox = cx - Math.floor(PW / 2);
    const oz = cz - Math.floor(PD / 2);
    let oy;
    try {
      oy = validateSite(dim, ox, oz, baseY, players);
    } catch {
      oy = undefined;
    }
    if (oy === undefined) return;

    system.clearRun(search);
    startBuild(player, bot, dim, ox, oy, oz);
  }, 1);
}

function cancelBuild(player) {
  if (!job) {
    say(player, "I'm not building anything right now.");
    return;
  }
  say(player, "Build cancelled. Just say the word when you want to try again.");
  endJob(false);
}

// ---------------------------------------------------------------------------
// Companion helpers
// ---------------------------------------------------------------------------

function nearestBot(player, maxDistance) {
  try {
    const found = player.dimension.getEntities({
      type: BOT,
      location: player.location,
      maxDistance,
      closest: 1
    });
    return found[0];
  } catch {
    return undefined;
  }
}

function nearestPlayerTo(entity, maxDistance) {
  try {
    const found = entity.dimension.getPlayers({
      location: entity.location,
      maxDistance,
      closest: 1
    });
    return found[0];
  } catch {
    return undefined;
  }
}

/** Closest player anywhere, used when one has run far past the buddy's scan. */
function nearestPlayerAnywhere(entity) {
  let best;
  let bestDist = Infinity;
  for (const p of world.getAllPlayers()) {
    try {
      const sameDim = p.dimension.id === entity.dimension.id;
      const d = sameDim ? distance(entity.location, p.location) : Infinity - 1;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    } catch {
      /* player left */
    }
  }
  return best;
}

function resolvePlayer(event) {
  const src = event.sourceEntity;
  try {
    if (src && src.typeId === "minecraft:player") return src;
    if (src) {
      const near = nearestPlayerTo(src, 12);
      if (near) return near;
    }
  } catch {
    /* fall through to the world list */
  }
  const all = world.getAllPlayers();
  return all.length ? all[0] : undefined;
}

function spawnBuddy(player) {
  try {
    const l = player.location;
    const bot = player.dimension.spawnEntity(BOT, {
      x: l.x + 1.5,
      y: l.y,
      z: l.z + 1.5
    });
    return bot;
  } catch {
    return undefined;
  }
}

function teleportToPlayer(bot, player) {
  try {
    const l = player.location;
    bot.teleport(
      { x: l.x + 1.2, y: l.y, z: l.z + 1.2 },
      { dimension: player.dimension, facingLocation: l }
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Survival autonomy
//
// The buddy works while it follows you: chopping trees, mining exposed rock,
// crafting what it gathers, lighting the area up after dark, replanting and
// throwing up an emergency shelter at night.
//
// There is no pathfinding API on this version, so a task teleports the buddy
// one step to whatever it is working on and then hands control back to the
// follow AI. Tasks run one step per companion tick (every half second), which
// is what makes the work look deliberate instead of instant.
// ---------------------------------------------------------------------------

/** Shared pack, so supplies survive the buddy dying and being re-summoned. */
const supplies = {
  wood: 0,
  planks: 0,
  sticks: 0,
  cobble: 0,
  coal: 0,
  torches: 0,
  saplings: 0,
  seeds: 0,
  iron: 0,
  food: 0
};

const SUPPLY_ITEMS = {
  wood: "minecraft:oak_log",
  planks: "minecraft:oak_planks",
  sticks: "minecraft:stick",
  cobble: "minecraft:cobblestone",
  coal: "minecraft:coal",
  torches: "minecraft:torch",
  saplings: "minecraft:oak_sapling",
  seeds: "minecraft:wheat_seeds",
  iron: "minecraft:raw_iron",
  food: "minecraft:apple"
};

/** Materials worth picking up off the floor. Your gear is left well alone. */
const PICKUP = {
  "minecraft:oak_log": "wood",
  "minecraft:birch_log": "wood",
  "minecraft:spruce_log": "wood",
  "minecraft:jungle_log": "wood",
  "minecraft:acacia_log": "wood",
  "minecraft:dark_oak_log": "wood",
  "minecraft:oak_planks": "planks",
  "minecraft:stick": "sticks",
  "minecraft:cobblestone": "cobble",
  "minecraft:coal": "coal",
  "minecraft:torch": "torches",
  "minecraft:oak_sapling": "saplings",
  "minecraft:wheat_seeds": "seeds",
  "minecraft:raw_iron": "iron",
  "minecraft:apple": "food"
};

const MINEABLE = new Set([
  "minecraft:stone",
  "minecraft:andesite",
  "minecraft:diorite",
  "minecraft:granite",
  "minecraft:tuff",
  "minecraft:deepslate",
  "minecraft:cobbled_deepslate",
  "minecraft:coal_ore",
  "minecraft:deepslate_coal_ore",
  "minecraft:iron_ore",
  "minecraft:deepslate_iron_ore"
]);

const PLANTABLE_ON = new Set(["minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt"]);

const LIGHT_SOURCES = ["torch", "lantern", "glowstone", "campfire", "sea_lantern", "shroomlight"];

PALETTE.sapling = [
  ["minecraft:oak_sapling", {}],
  ["minecraft:sapling", { sapling_type: "oak" }]
];

/** Offsets around the buddy, nearest first, so surveys can stop early. */
const SURVEY_OFFSETS = (() => {
  const out = [];
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      for (let dy = -3; dy <= 4; dy++) out.push([dx, dy, dz]);
    }
  }
  out.sort(
    (a, b) =>
      a[0] * a[0] + a[1] * a[1] + a[2] * a[2] - (b[0] * b[0] + b[1] * b[1] + b[2] * b[2])
  );
  return out;
})();

const SURVEY_BUDGET = 260; // block reads per survey, hard capped for phones
const TASK_GAP = 60; // ticks of downtime between jobs

function isNight() {
  try {
    const t = world.getTimeOfDay();
    return t >= 13000 && t <= 23000;
  } catch {
    return undefined; // not available on this runtime
  }
}

function isLightSource(id) {
  for (const hint of LIGHT_SOURCES) {
    if (id.includes(hint)) return true;
  }
  return false;
}

/**
 * One pass over the surroundings that answers every question the task picker
 * needs, so idle scanning costs a single bounded sweep rather than one per
 * candidate job.
 */
function survey(bot) {
  const dim = bot.dimension;
  const bx = Math.floor(bot.location.x);
  const by = Math.floor(bot.location.y);
  const bz = Math.floor(bot.location.z);
  const found = { log: undefined, ore: undefined, plant: undefined, torch: undefined, lit: false };
  let reads = 0;

  for (const [dx, dy, dz] of SURVEY_OFFSETS) {
    if (reads >= SURVEY_BUDGET) break;
    const x = bx + dx;
    const y = by + dy;
    const z = bz + dz;
    const id = typeAt(dim, x, y, z);
    reads++;
    if (id === undefined) continue;

    // Checked before the man-made filter: torches are man-made, and knowing
    // the area is already lit is the whole point.
    if (isLightSource(id)) found.lit = true;
    if (looksManMade(id)) continue;

    if (!found.log && (id.endsWith("_log") || id.endsWith("_wood"))) found.log = [x, y, z];
    if (!found.ore && dy >= -1 && MINEABLE.has(id)) found.ore = [x, y, z];
    if (!found.plant && PLANTABLE_ON.has(id)) {
      if (typeAt(dim, x, y + 1, z) === "minecraft:air") found.plant = [x, y + 1, z];
      reads++;
    }
    if (!found.torch && dy >= -2 && dy <= 1 && !isClearable(id) && !isLiquid(id)) {
      if (typeAt(dim, x, y + 1, z) === "minecraft:air") found.torch = [x, y + 1, z];
      reads++;
    }
  }
  return found;
}

/** A trunk with leaves overhead is a tree; a bare log is probably your build. */
function looksLikeTree(dim, [x, y, z]) {
  for (let dy = 1; dy <= 6; dy++) {
    const id = typeAt(dim, x, y + dy, z);
    if (id === undefined) return false;
    if (id.endsWith("_leaves")) return true;
    if (!id.endsWith("_log") && !id.endsWith("_wood") && id !== "minecraft:air") return false;
  }
  return false;
}

/** Rock buried in more rock is a cliff face, not somebody's stone cottage. */
function looksLikeBedrockSeam(dim, [x, y, z]) {
  const neighbours = [
    [x + 1, y, z],
    [x - 1, y, z],
    [x, y, z + 1],
    [x, y, z - 1],
    [x, y - 1, z],
    [x, y + 1, z]
  ];
  let solid = 0;
  for (const [nx, ny, nz] of neighbours) {
    const id = typeAt(dim, nx, ny, nz);
    if (id === undefined) return false;
    if (looksManMade(id)) return false;
    if (MINEABLE.has(id) || id === "minecraft:dirt" || id === "minecraft:gravel") solid++;
  }
  return solid >= 3;
}

function yieldFor(id) {
  if (id.endsWith("_log") || id.endsWith("_wood")) return ["wood", 1];
  if (id.includes("coal_ore")) return ["coal", 2];
  if (id.includes("iron_ore")) return ["iron", 1];
  if (MINEABLE.has(id)) return ["cobble", 1];
  return undefined;
}

function breakBlock(bot, player, x, y, z) {
  const block = blockAt(bot.dimension, x, y, z);
  if (!block) return false;
  const id = block.typeId;
  if (looksManMade(id)) return false; // never touch anything you built
  const gain = yieldFor(id);
  if (!gain) return false;

  const air = perm("air");
  if (!air) return false;
  try {
    block.setPermutation(air);
  } catch {
    return false;
  }

  supplies[gain[0]] += gain[1];
  try {
    player.playSound(id.includes("_log") ? "dig.wood" : "dig.stone", {
      location: { x, y, z },
      volume: 0.7
    });
  } catch {
    /* sound is cosmetic */
  }
  return true;
}

/** Put the buddy next to a block it is about to work on. */
function stepBotTo(bot, dim, [x, y, z]) {
  const spots = [
    [x + 1, z],
    [x - 1, z],
    [x, z + 1],
    [x, z - 1]
  ];
  for (const [sx, sz] of spots) {
    for (const dy of [0, 1, -1]) {
      const feet = typeAt(dim, sx, y + dy, sz);
      const head = typeAt(dim, sx, y + dy + 1, sz);
      if (feet === undefined) continue;
      if (isClearable(feet) && head !== undefined && isClearable(head)) {
        try {
          bot.teleport(
            { x: sx + 0.5, y: y + dy, z: sz + 0.5 },
            { dimension: dim, facingLocation: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } }
          );
          return true;
        } catch {
          return false;
        }
      }
    }
  }
  return false;
}

function beginTask(bot, state, name, steps) {
  state.task = { name, steps, index: 0 };
  try {
    bot.triggerEvent("bb:work_start_event");
  } catch {
    /* bot despawned */
  }
  setPose(bot, "build");
}

function endTask(bot, state) {
  state.task = undefined;
  state.taskTick = system.currentTick;
  setPose(bot, "normal");
  try {
    bot.triggerEvent("bb:work_end_event");
  } catch {
    /* bot despawned */
  }
}

// -- individual jobs --------------------------------------------------------

function taskCollect(bot, player, state) {
  let items;
  try {
    items = bot.dimension.getEntities({
      type: "minecraft:item",
      location: bot.location,
      maxDistance: 6
    });
  } catch {
    return false;
  }
  if (!items.length) return false;

  let taken = 0;
  for (const drop of items) {
    try {
      const stack = drop.getComponent("minecraft:item")?.itemStack;
      if (!stack) continue;
      const slot = PICKUP[stack.typeId];
      if (!slot) continue; // leave anything that is not raw material
      supplies[slot] += stack.amount;
      taken += stack.amount;
      drop.remove();
    } catch {
      /* the drop vanished on its own */
    }
  }
  if (!taken) return false;

  beginTask(bot, state, "collect", [
    () => {
      say(player, `Picked up ${taken} bits and pieces for us.`);
      beep(player, "random.pop", 1.3);
    }
  ]);
  return true;
}

function taskChop(bot, player, state, target) {
  const dim = bot.dimension;
  const [tx, ty, tz] = target;
  const steps = [
    () => {
      stepBotTo(bot, dim, target);
      say(player, "Getting us some wood.");
    }
  ];
  for (let i = 0; i < 5; i++) {
    const y = ty + i;
    steps.push(() => breakBlock(bot, player, tx, y, tz));
  }
  steps.push(() => {
    // Replant so the buddy is not clear-felling the place.
    const ground = typeAt(dim, tx, ty - 1, tz);
    if (supplies.saplings > 0 && ground && PLANTABLE_ON.has(ground)) {
      const sapling = perm("sapling");
      const block = blockAt(dim, tx, ty, tz);
      if (sapling && block && block.typeId === "minecraft:air") {
        try {
          block.setPermutation(sapling);
          supplies.saplings--;
        } catch {
          /* not plantable after all */
        }
      }
    }
    if (supplies.wood >= 8) say(player, `That's ${supplies.wood} logs in the pack.`);
  });

  beginTask(bot, state, "chop", steps);
  return true;
}

function taskMine(bot, player, state, target) {
  const dim = bot.dimension;
  const [tx, ty, tz] = target;
  const steps = [
    () => {
      stepBotTo(bot, dim, target);
      say(player, "Mining some stone.");
    }
  ];
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]]) {
    steps.push(() => breakBlock(bot, player, tx + dx, ty + dy, tz + dz));
  }
  beginTask(bot, state, "mine", steps);
  return true;
}

function taskCraft(bot, player, state) {
  const made = [];

  if (supplies.wood >= 2) {
    const logs = Math.min(supplies.wood, 8);
    supplies.wood -= logs;
    supplies.planks += logs * 4;
    made.push(`${logs * 4} planks`);
  }
  if (supplies.planks >= 4 && supplies.sticks < 16) {
    supplies.planks -= 4;
    supplies.sticks += 8;
    made.push("8 sticks");
  }
  if (supplies.sticks >= 1 && supplies.coal >= 1 && supplies.torches < 32) {
    supplies.sticks -= 1;
    supplies.coal -= 1;
    supplies.torches += 4;
    made.push("4 torches");
  }
  if (!made.length) return false;

  beginTask(bot, state, "craft", [
    () => {
      say(player, `Crafted ${made.join(" and ")}.`);
      beep(player, "random.orb", 1.5);
    },
    () => {
      if (supplies.planks >= 64 && supplies.cobble >= 24) {
        say(player, "I've got enough materials for a whole house now - just say the word!");
      }
    }
  ]);
  return true;
}

function taskLight(bot, player, state, spot) {
  const torch = perm("torch", { torch_facing_direction: "top" });
  if (!torch) return false;
  const block = blockAt(bot.dimension, spot[0], spot[1], spot[2]);
  if (!block) return false;

  beginTask(bot, state, "light", [
    () => {
      try {
        block.setPermutation(torch);
        supplies.torches--;
        say(player, "Putting a torch here - keeps the mobs off.");
        beep(player, "random.pop", 1.1);
      } catch {
        /* something took the spot */
      }
    }
  ]);
  return true;
}

function taskPlant(bot, player, state, spot) {
  const sapling = perm("sapling");
  if (!sapling) return false;
  const block = blockAt(bot.dimension, spot[0], spot[1], spot[2]);
  if (!block) return false;

  beginTask(bot, state, "plant", [
    () => {
      try {
        block.setPermutation(sapling);
        supplies.saplings--;
        say(player, "Planted a sapling. It'll be a tree one day!");
      } catch {
        /* not plantable */
      }
    }
  ]);
  return true;
}

// -- emergency night shelter ------------------------------------------------

const SHELTER_COOLDOWN = 6000; // 5 minutes
let lastShelterTick = -99999;

/** A one-stage plan: 5x5 hut, door, torch and a crafting table. */
function makeShelterPlan() {
  const ops = [];
  for (let x = 0; x <= 4; x++) {
    for (let z = 0; z <= 4; z++) {
      ops.push([x, -1, z, "planks"]);
      ops.push([x, 3, z, "planks"]);
      const wall = x === 0 || x === 4 || z === 0 || z === 4;
      for (let y = 0; y <= 2; y++) {
        ops.push([x, y, z, wall ? "planks" : "air", undefined, wall ? "set" : "clear"]);
      }
    }
  }
  ops.push([2, 0, 4, "air"]);
  ops.push([2, 1, 4, "air"]);
  ops.push([
    2,
    0,
    4,
    "door",
    { direction: 1, upper_block_bit: false, door_hinge_bit: false, open_bit: false }
  ]);
  ops.push([
    2,
    1,
    4,
    "door",
    { direction: 1, upper_block_bit: true, door_hinge_bit: false, open_bit: false }
  ]);
  ops.push([1, 0, 1, "torch", { torch_facing_direction: "top" }]);
  ops.push([3, 0, 1, "crafting"]);

  return [
    {
      name: "Emergency shelter",
      line: "It's getting dark - throwing up a shelter, quick!",
      anchor: [2, 6],
      ops
    }
  ];
}

function shelterSiteOk(dim, ox, oy, oz) {
  for (let x = -1; x <= 5; x++) {
    for (let z = -1; z <= 5; z++) {
      for (let dy = -1; dy <= 4; dy++) {
        const id = typeAt(dim, ox + x, oy + dy, oz + z);
        if (id === undefined) return false;
        if (isLiquid(id)) return false;
        if (looksManMade(id)) return false;
        if (dy >= 0 && !isClearable(id)) return false;
        if (dy === -1 && isClearable(id)) return false; // needs solid ground
      }
    }
  }
  return true;
}

function tryShelter(bot, player) {
  if (job) return false;
  if (system.currentTick - lastShelterTick < SHELTER_COOLDOWN) return false;
  if (supplies.planks < 60) return false;

  const dim = player.dimension;
  const py = Math.floor(player.location.y);
  for (const [dx, dz] of RING_OFFSETS) {
    const ox = Math.floor(player.location.x) + dx * 4 - 2;
    const oz = Math.floor(player.location.z) + dz * 4 - 2;
    const oy = surfaceY(dim, ox + 2, oz + 2, py);
    if (oy === undefined) continue;
    if (!shelterSiteOk(dim, ox, oy, oz)) continue;

    supplies.planks -= 60;
    lastShelterTick = system.currentTick;
    job = {
      player,
      bot,
      dim,
      origin: { ox, oz },
      oy,
      stages: makeShelterPlan(),
      stageIndex: 0,
      opIndex: 0
    };
    setMode(bot, "build");
    job.handle = system.runInterval(stepJob, PASS_INTERVAL);
    return true;
  }
  return false;
}

// -- the picker -------------------------------------------------------------

function autonomyTick(bot, player, state) {
  // Run the current job one step at a time.
  if (state.task) {
    const task = state.task;
    try {
      task.steps[task.index++]();
    } catch {
      /* a step that fails just moves on to the next */
    }
    if (task.index >= task.steps.length) endTask(bot, state);
    return true;
  }

  if (job) return false; // a house is going up
  if (!bot.hasTag("bb_work")) return false; // work switched off
  if (bot.hasTag("bb_stay")) return false; // told to hold position
  if (system.currentTick - (state.taskTick ?? -9999) < TASK_GAP) return false;
  if (state.enemyTick && system.currentTick - state.enemyTick < 100) return false; // fighting

  if (distance(bot.location, player.location) > 20) return false;

  if (taskCollect(bot, player, state)) return true;

  const night = isNight();
  const found = survey(bot);

  // After dark, light comes first, then a roof over your head.
  if (night !== false && !found.lit && supplies.torches > 0 && found.torch) {
    return taskLight(bot, player, state, found.torch);
  }
  if (night === true && tryShelter(bot, player)) return true;

  if (found.log && looksLikeTree(bot.dimension, found.log)) {
    return taskChop(bot, player, state, found.log);
  }
  if (taskCraft(bot, player, state)) return true;
  if (found.ore && looksLikeBedrockSeam(bot.dimension, found.ore)) {
    return taskMine(bot, player, state, found.ore);
  }
  if (supplies.saplings > 1 && found.plant) {
    return taskPlant(bot, player, state, found.plant);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-tick companion logic
// ---------------------------------------------------------------------------

const DIMENSION_IDS = ["overworld", "nether", "the_end"];
const tracked = new Map(); // entity id -> { last, still, enemyTick, followTick }

function track(bot) {
  let s = tracked.get(bot.id);
  if (!s) {
    s = { last: botState(bot), still: 0, enemyTick: -9999, followTick: -9999 };
    tracked.set(bot.id, s);
  }
  return s;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function updateBot(bot) {
  // Health shown above the buddy's head.
  try {
    const hp = bot.getComponent("minecraft:health");
    if (hp) {
      const cur = Math.max(0, Math.ceil(hp.currentValue));
      const max = Math.ceil(hp.effectiveMax);
      bot.nameTag = `§bBuilder Buddy\n§c❤ §f${cur}§7/${max}`;
    }
  } catch {
    /* health component missing for a tick after spawn */
  }

  const state = track(bot);
  // Fall back to a world-wide search: a player who sprinted out of the 64
  // block scan is exactly the case the teleport-to-owner rule exists for.
  const player = nearestPlayerTo(bot, 64) ?? nearestPlayerAnywhere(bot);
  if (!player) return;

  // Warn about hostiles closing in.
  try {
    const hostiles = bot.dimension.getEntities({
      location: bot.location,
      maxDistance: 14,
      families: ["monster"],
      excludeFamilies: ["builder_buddy"]
    });
    if (hostiles.length && system.currentTick - state.enemyTick > 300) {
      state.enemyTick = system.currentTick;
      say(player, "Enemy nearby! Stay behind me.");
      beep(player, "note.bass", 0.8);
    }
  } catch {
    /* query options unsupported - alerts are optional */
  }

  // Work happens between follow steps; a task in progress owns the buddy's
  // position, so the follow and stuck logic below has to stand down.
  if (autonomyTick(bot, player, state)) {
    state.last = botState(bot);
    return;
  }

  if (bot.hasTag("bb_stay") || bot.hasTag("bb_build")) {
    state.last = botState(bot);
    return;
  }

  const away = distance(bot.location, player.location);
  const moved = distance(bot.location, state.last);
  state.last = botState(bot);

  if (away > 26 || bot.dimension.id !== player.dimension.id) {
    if (teleportToPlayer(bot, player)) {
      state.still = 0;
      if (system.currentTick - state.followTick > 200) {
        state.followTick = system.currentTick;
        say(player, "You got too far ahead - I'm right behind you!");
      }
    }
    return;
  }

  // Stuck: barely moving while still a long way from the player.
  if (moved < 0.25 && away > 5) state.still++;
  else state.still = 0;

  if (state.still >= 6) {
    state.still = 0;
    if (teleportToPlayer(bot, player)) {
      say(player, "I got stuck on something - I'm back!");
    }
  }
}

system.runInterval(() => {
  for (const id of DIMENSION_IDS) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch {
      continue;
    }
    let bots;
    try {
      bots = dim.getEntities({ type: BOT });
    } catch {
      continue;
    }
    for (const bot of bots) {
      try {
        updateBot(bot);
      } catch {
        /* one bad buddy must not stop the rest */
      }
    }
  }
}, 10);

// ---------------------------------------------------------------------------
// Control menu
// ---------------------------------------------------------------------------

function openMenu(player, attempt) {
  const tries = attempt ?? 0;
  const bot = nearestBot(player, 24);

  const form = new ActionFormData()
    .title("Builder Buddy")
    .body(
      bot
        ? "§7What would you like me to do?§r"
        : "§cNo Builder Buddy is nearby.§r\n§7Spawn one with the Builder Buddy Spawn Egg.§r"
    )
    .button("Follow Me")
    .button("Stay Here")
    .button("Defend Me")
    .button("Build House")
    .button("Cancel Building")
    .button(bot && bot.hasTag("bb_work") ? "Stop Working" : "Start Working")
    .button("Hand Over Supplies")
    .button("Status");

  form
    .show(player)
    .then((res) => {
      // On touch devices the form can be refused while the player is still
      // holding the screen; retry a few times before giving up.
      if (res.canceled) {
        if (res.cancelationReason === "UserBusy" && tries < 10) {
          system.runTimeout(() => openMenu(player, tries + 1), 10);
        }
        return;
      }
      switch (res.selection) {
        case 0:
          commandFollow(player);
          break;
        case 1:
          commandStay(player);
          break;
        case 2:
          commandDefend(player);
          break;
        case 3:
          requestBuild(player);
          break;
        case 4:
          cancelBuild(player);
          break;
        case 5:
          commandWork(player);
          break;
        case 6:
          commandGive(player);
          break;
        case 7:
          commandStatus(player);
          break;
        default:
          break;
      }
    })
    .catch(() => {
      say(player, "I couldn't open the menu - try /function builder_buddy_help instead.");
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function commandFollow(player) {
  const bot = nearestBot(player, 48);
  if (!bot) {
    say(player, "No Builder Buddy nearby!");
    return;
  }
  setMode(bot, "follow");
  say(player, "I'm following you!");
  beep(player, "random.orb", 1.4);
}

function commandStay(player) {
  const bot = nearestBot(player, 48);
  if (!bot) {
    say(player, "No Builder Buddy nearby!");
    return;
  }
  setMode(bot, "stay");
  say(player, "Staying right here until you need me.");
  beep(player, "random.orb", 0.9);
}

function commandDefend(player) {
  const bot = nearestBot(player, 48);
  if (!bot) {
    say(player, "No Builder Buddy nearby!");
    return;
  }
  setMode(bot, "stay");
  say(player, "Guarding this spot. Nothing gets past me!");
  beep(player, "mob.villager.yes", 1.0);
}

function commandSummon(player) {
  const existing = nearestBot(player, 24);
  if (existing) {
    teleportToPlayer(existing, player);
    setMode(existing, "follow");
    say(player, "Right here! I'm following you!");
    return;
  }
  const bot = spawnBuddy(player);
  if (bot) {
    say(player, "Reporting for duty! I'm following you!");
    beep(player, "random.levelup", 1.2);
  } else {
    say(player, "I couldn't spawn there - try somewhere with more room.");
  }
}

function commandWork(player) {
  const bot = nearestBot(player, 48);
  if (!bot) {
    say(player, "No Builder Buddy nearby!");
    return;
  }
  if (bot.hasTag("bb_work")) {
    bot.removeTag("bb_work");
    say(player, "Alright, I'll stop working and just stick with you.");
  } else {
    bot.addTag("bb_work");
    say(player, "Back to work! I'll gather and craft as we go.");
  }
  beep(player, "random.orb", 1.1);
}

function commandGive(player) {
  const carried = Object.entries(supplies).filter(([, amount]) => amount > 0);
  if (!carried.length) {
    say(player, "My pack is empty - give me a bit of time to gather something.");
    return;
  }

  let container;
  try {
    container = player.getComponent("minecraft:inventory")?.container;
  } catch {
    container = undefined;
  }

  const handed = [];
  for (const [slot, amount] of carried) {
    const itemId = SUPPLY_ITEMS[slot];
    if (!itemId) continue;
    let left = amount;
    while (left > 0) {
      const count = Math.min(left, 64);
      let stack;
      try {
        stack = new ItemStack(itemId, count);
      } catch {
        break; // unknown item on this version
      }
      let delivered = false;
      try {
        if (container) {
          container.addItem(stack);
          delivered = true;
        }
      } catch {
        delivered = false;
      }
      if (!delivered) {
        try {
          player.dimension.spawnItem(stack, player.location);
          delivered = true;
        } catch {
          /* nowhere to put it */
        }
      }
      if (!delivered) break;
      left -= count;
    }
    const given = amount - left;
    if (given > 0) {
      handed.push(`${given} ${slot}`);
      supplies[slot] -= given;
    }
  }

  if (!handed.length) {
    say(player, "Your pack looks full - make some room and ask me again.");
    return;
  }
  say(player, `Here you go: ${handed.join(", ")}.`);
  beep(player, "random.pop", 1.2);
}

function commandStatus(player) {
  const bot = nearestBot(player, 64);
  const lines = ["§b--- Builder Buddy status ---§r"];

  if (!bot) {
    lines.push("§cNo buddy nearby.§7 Use /function builder_buddy_summon.");
  } else {
    let mode = "following you";
    if (bot.hasTag("bb_build")) mode = "building";
    else if (bot.hasTag("bb_stay")) mode = "holding position";
    lines.push(`§7Mode: §f${mode}`);
    lines.push(`§7Work: §f${bot.hasTag("bb_work") ? "on" : "off"}`);
    try {
      const hp = bot.getComponent("minecraft:health");
      if (hp) lines.push(`§7Health: §f${Math.ceil(hp.currentValue)}/${Math.ceil(hp.effectiveMax)}`);
    } catch {
      /* no health this tick */
    }
  }

  lines.push(`§7Building right now: §f${job ? "yes" : "no"}`);
  const last = lastBuildTick.get(player.id);
  if (last !== undefined && system.currentTick - last < BUILD_COOLDOWN) {
    const left = Math.ceil((BUILD_COOLDOWN - (system.currentTick - last)) / 20);
    lines.push(`§7House cooldown: §f${left}s remaining`);
  } else {
    lines.push("§7House cooldown: §fready");
  }

  const carried = Object.entries(supplies)
    .filter(([, amount]) => amount > 0)
    .map(([slot, amount]) => `${amount} ${slot}`);
  lines.push(`§7Pack: §f${carried.length ? carried.join(", ") : "empty"}`);

  try {
    for (const line of lines) player.sendMessage(line);
  } catch {
    /* player left */
  }
}

function commandHelp(player) {
  const lines = [
    "§b--- Builder Buddy ---§r",
    "§7Spawn me with the §fBuilder Buddy Spawn Egg§7.",
    "§7Give me an §aemerald§7 to follow, a §6stick§7 to stay, a §bdiamond§7 to build.",
    "§7Sneak + tap me, or sneak + use the §fHouse Builder Remote§7, for the menu.",
    "§f/function builder_buddy_house§7 - build a house",
    "§f/function builder_buddy_cancel§7 - stop building",
    "§f/function builder_buddy_summon§7 - summon or recall me",
    "§f/function builder_buddy_follow§7 - follow you",
    "§f/function builder_buddy_stay§7 - hold position",
    "§f/function builder_buddy_defend§7 - guard this spot",
    "§f/function builder_buddy_menu§7 - open the control menu",
    "§f/function builder_buddy_work§7 - toggle gathering and crafting",
    "§f/function builder_buddy_supplies§7 - hand over what I've gathered",
    "§f/function builder_buddy_status§7 - what I'm doing and carrying"
  ];
  try {
    for (const line of lines) player.sendMessage(line);
  } catch {
    /* player left */
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

const SCRIPT_EVENTS = {
  "bb:build_house": requestBuild,
  "bb:cancel": cancelBuild,
  "bb:summon": commandSummon,
  "bb:follow": commandFollow,
  "bb:stay": commandStay,
  "bb:defend": commandDefend,
  "bb:help": commandHelp,
  "bb:work": commandWork,
  "bb:give": commandGive,
  "bb:status": commandStatus,
  "bb:menu": (player) => system.run(() => openMenu(player, 0))
};

try {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    const handler = SCRIPT_EVENTS[event.id];
    if (handler) {
      const player = resolvePlayer(event);
      if (player) handler(player);
      return;
    }

    // Chat lines fired by the entity's own interact events.
    if (event.id === "bb:mode_changed") {
      const player = resolvePlayer(event);
      if (!player) return;
      if (event.message === "stay") say(player, "Staying right here until you need me.");
      else say(player, "I'm following you!");
      return;
    }
    if (event.id === "bb:spawned") {
      const player = resolvePlayer(event);
      if (!player) return;
      say(player, "Hi! I'm your Builder Buddy. I'm following you!");
      say(player, "§7I'll gather and craft as we go. Use the §fHouse Builder Remote§7 for a house, or sneak-tap me for the menu.");
    }
  });
} catch {
  /* scriptevent unavailable - functions will simply do nothing */
}

// The House Builder Remote. itemUse fires when tapping air, itemUseOn when
// tapping a block; mobile players do both, so guard against a double trigger.
const lastRemoteTick = new Map();

function useRemote(player) {
  if (!player) return;
  const now = system.currentTick;
  if (now - (lastRemoteTick.get(player.id) ?? -99) < 5) return;
  lastRemoteTick.set(player.id, now);

  if (player.isSneaking) system.run(() => openMenu(player, 0));
  else requestBuild(player);
}

try {
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack && event.itemStack.typeId === REMOTE) useRemote(event.source);
  });
} catch {
  /* older runtime */
}

try {
  world.afterEvents.itemUseOn.subscribe((event) => {
    if (event.itemStack && event.itemStack.typeId === REMOTE) useRemote(event.source);
  });
} catch {
  /* itemUseOn is not present on every runtime - itemUse covers the common case */
}

// Direct interaction fallback. The entity's own interact component already
// handles emerald/stick/diamond and the sneak menu through queue_command; this
// covers the case where those queued commands do not fire, so sneak-tapping
// the buddy always opens the menu.
function handleInteract(event) {
  const player = event.player ?? event.source;
  const target = event.target ?? event.entity;
  if (!player || !target || target.typeId !== BOT) return;
  if (!player.isSneaking) return;
  const now = system.currentTick;
  if (now - (lastRemoteTick.get(player.id) ?? -99) < 10) return;
  lastRemoteTick.set(player.id, now);
  system.run(() => openMenu(player, 0));
}

for (const source of ["afterEvents", "beforeEvents"]) {
  try {
    world[source].playerInteractWithEntity.subscribe((event) => {
      // Before-events run in a read-only context, so bounce off a tick.
      system.run(() => handleInteract(event));
    });
    break; // one working subscription is enough
  } catch {
    /* not present on this runtime */
  }
}

// Swing animation whenever the buddy lands a hit.
try {
  world.afterEvents.entityHitEntity.subscribe((event) => {
    const bot = event.damagingEntity;
    if (!bot || bot.typeId !== BOT) return;
    if (bot.hasTag("bb_build")) return; // don't interrupt the building pose
    setPose(bot, "attack");
    system.runTimeout(() => {
      try {
        if (!bot.hasTag("bb_build")) setPose(bot, "normal");
      } catch {
        /* bot died mid-swing */
      }
    }, 12);
  });
} catch {
  /* older runtime */
}

// Death and automatic respawn.
try {
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!dead || dead.typeId !== BOT) return;

    const dim = dead.dimension;
    const loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z };
    tracked.delete(dead.id);

    if (job && job.bot && job.bot.id === dead.id) {
      say(job.player, "I went down before I finished the house!");
      endJob(false);
    }

    world.sendMessage(PREFIX + "Ouch! I'm down... give me 10 seconds and I'll be back.");

    system.runTimeout(() => {
      let target;
      try {
        const near = dim.getPlayers({ location: loc, maxDistance: 64, closest: 1 });
        target = near[0];
      } catch {
        target = world.getAllPlayers()[0];
      }
      if (target) {
        commandSummon(target);
        return;
      }
      try {
        dim.spawnEntity(BOT, loc);
      } catch {
        /* chunk unloaded - the player can re-summon with the function */
      }
    }, 200);
  });
} catch {
  /* older runtime */
}

// Greet whoever spawns a buddy from the egg.
try {
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (!entity || entity.typeId !== BOT) return;
    system.runTimeout(() => {
      try {
        entity.addTag("bb_follow");
        entity.addTag("bb_work"); // work is on out of the box
      } catch {
        /* despawned already */
      }
    }, 5);
  });
} catch {
  /* older runtime */
}
