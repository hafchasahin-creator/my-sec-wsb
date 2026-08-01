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

import { world, system, BlockPermutation } from "@minecraft/server";
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

  const bot = nearestBot(player, 24);
  if (!bot) {
    say(player, "No Builder Buddy nearby! Spawn one with the spawn egg first.");
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
    .button("Cancel Building");

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
    "§f/function builder_buddy_menu§7 - open the control menu"
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
      if (player) say(player, "Hi! I'm your Builder Buddy. I'm following you!");
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
      } catch {
        /* despawned already */
      }
    }, 5);
  });
} catch {
  /* older runtime */
}
