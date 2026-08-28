/*
 * Secret Bunker - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Three things happen here:
 *   1. The Bunker Deployment Beacon excavates and builds a six-room facility
 *      underneath the player, with a ladder shaft up to a camouflaged hatch.
 *   2. A Level-3 Keycard drives the blast doors, the hatch and the keypads.
 *   3. The Motion Tracker (and any security camera) sweeps for hostiles.
 *
 * Everything cosmetic is wrapped: one unsupported sound id on one device must
 * never take the whole add-on down.
 */

import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

const ITEM = {
  BEACON: "bunker:deployment_beacon",
  KEYCARD: "bunker:keycard",
  TRACKER: "bunker:motion_tracker",
};

const B = {
  AIR: "minecraft:air",
  CONCRETE: "bunker:reinforced_concrete",
  PANEL: "bunker:concrete_panel",
  HAZARD: "bunker:hazard_stripe",
  STEEL: "bunker:steel_plating",
  GRATE: "bunker:steel_grate",
  FLOOR: "bunker:floor_tile",
  LIGHT: "bunker:ceiling_light",
  EMERGENCY: "bunker:emergency_light",
  GLASS: "bunker:reinforced_glass",
  VENT: "bunker:vent_panel",
  CONDUIT: "bunker:cable_conduit",
  SIGN: "bunker:radiation_sign",
  RACK: "bunker:server_rack",
  CONSOLE: "bunker:control_console",
  MONITOR: "bunker:wall_monitor",
  KEYPAD: "bunker:keypad",
  CAMERA: "bunker:security_camera",
  CRATE: "bunker:supply_crate",
  MEDICAL: "bunker:medical_cabinet",
  LOCKER: "bunker:storage_locker",
  GENERATOR: "bunker:generator",
  DOOR: "bunker:blast_door",
  VAULT: "bunker:vault_door",
  HATCH: "bunker:hatch",
};

const DOOR_BLOCKS = [B.DOOR, B.HATCH];

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const CONFIG = {
  // Facility footprint. rx runs west->east, rz north->south, ry bottom->top.
  width: 27,
  depth: 21,
  ceiling: 6, // interior air is ry 1..5, ceiling slab at ry 6
  shaftRx: 13, // the ladder shaft sits here in facility coordinates
  shaftRz: 4,
  depthBelowPlayer: 10, // blocks of rock between the hatch and the ceiling
  blocksPerTick: 700, // build throughput
  keypadRadiusXZ: 7, // how far a keypad reaches for doors
  keypadRadiusY: 4,
  doorGroupLimit: 32, // max blocks toggled as one door
  scanRadius: 32,
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function quiet(fn) {
  try {
    return fn();
  } catch (err) {
    return undefined;
  }
}

function playSound(player, id, pitch) {
  quiet(() => player.playSound(id, { pitch: pitch ?? 1 }));
}

function tell(player, message) {
  quiet(() => player.onScreenDisplay.setActionBar(message));
}

const permCache = new Map();

/** Resolve a permutation once and reuse it; never throw on a bad state. */
function perm(id, states) {
  const key = states ? id + JSON.stringify(states) : id;
  if (permCache.has(key)) return permCache.get(key);
  let resolved = states ? quiet(() => BlockPermutation.resolve(id, states)) : undefined;
  if (!resolved) resolved = quiet(() => BlockPermutation.resolve(id));
  permCache.set(key, resolved);
  return resolved;
}

function minHeightOf(dimension) {
  if (dimension.id === "minecraft:overworld") return -64;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Facility blueprint
 *
 * Facility coordinates are relative: (rx, ry, rz) with the north-west floor
 * corner at (0, 0, 0). plan() turns them into a flat list of block writes.
 * ------------------------------------------------------------------ */

const W = CONFIG.width;
const D = CONFIG.depth;
const CEIL = CONFIG.ceiling;

// Room boxes: [rx0, rz0, rx1, rz1] of the walkable interior.
const ROOMS = {
  command: [1, 1, 8, 7],
  entry: [10, 1, 16, 7],
  barracks: [18, 1, 25, 7],
  armory: [1, 13, 8, 19],
  medbay: [10, 13, 16, 19],
  power: [18, 13, 25, 19],
};

// Corridor runs east-west between the two room rows.
const CORRIDOR_Z0 = 9;
const CORRIDOR_Z1 = 11;
const WALL_N = 8; // wall between the north rooms and the corridor
const WALL_S = 12; // wall between the corridor and the south rooms

// Blast doors off the corridor: [rx, rz, corridorSide]
const DOORWAYS = [
  [4, WALL_N, 1],
  [13, WALL_N, 1],
  [21, WALL_N, 1],
  [4, WALL_S, -1],
  [13, WALL_S, -1],
  [21, WALL_S, -1],
];

class Blueprint {
  constructor() {
    this.ops = [];
    this.chests = [];
  }

  set(rx, ry, rz, id, states) {
    const p = perm(id, states);
    if (p) this.ops.push({ rx, ry, rz, p });
  }

  fill(rx0, ry0, rz0, rx1, ry1, rz1, id, states) {
    for (let rx = rx0; rx <= rx1; rx++) {
      for (let ry = ry0; ry <= ry1; ry++) {
        for (let rz = rz0; rz <= rz1; rz++) this.set(rx, ry, rz, id, states);
      }
    }
  }

  /** A wall-mounted block hugs the wall on the given side. */
  mount(rx, ry, rz, id, facing) {
    this.set(rx, ry, rz, id, { "minecraft:cardinal_direction": facing });
  }

  chest(rx, ry, rz, facing, loot) {
    this.set(rx, ry, rz, "minecraft:chest", { facing_direction: facing });
    this.chests.push({ rx, ry, rz, loot });
  }
}

function shell(bp) {
  // Excavate the whole box, then rebuild it as a sealed structure.
  bp.fill(0, 0, 0, W - 1, CEIL, D - 1, B.AIR);
  bp.fill(0, 0, 0, W - 1, 0, D - 1, B.FLOOR);
  bp.fill(0, CEIL, 0, W - 1, CEIL, D - 1, B.PANEL);

  for (let ry = 1; ry < CEIL; ry++) {
    bp.fill(0, ry, 0, W - 1, ry, 0, B.CONCRETE);
    bp.fill(0, ry, D - 1, W - 1, ry, D - 1, B.CONCRETE);
    bp.fill(0, ry, 0, 0, ry, D - 1, B.CONCRETE);
    bp.fill(W - 1, ry, 0, W - 1, ry, D - 1, B.CONCRETE);
    // hazard-striped corner columns
    for (const [cx, cz] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]]) {
      bp.set(cx, ry, cz, B.HAZARD);
    }
  }
}

function interiorWalls(bp) {
  bp.fill(1, 1, WALL_N, W - 2, CEIL - 1, WALL_N, B.PANEL);
  bp.fill(1, 1, WALL_S, W - 2, CEIL - 1, WALL_S, B.PANEL);
  for (const rx of [9, 17]) {
    bp.fill(rx, 1, 1, rx, CEIL - 1, 7, B.PANEL);
    bp.fill(rx, 1, 13, rx, CEIL - 1, 19, B.PANEL);
  }
}

function doorways(bp) {
  for (const [rx, rz, side] of DOORWAYS) {
    // 1 x 2 opening filled with blast door blocks, closed on deploy.
    for (let ry = 1; ry <= 2; ry++) {
      bp.set(rx, ry, rz, B.DOOR, {
        "minecraft:cardinal_direction": "north",
        "bunker:open": false,
      });
    }
    // lamp over the door and a keypad on the corridor side
    bp.set(rx, 3, rz, B.EMERGENCY);
    bp.mount(rx + 1, 2, rz + side, B.KEYPAD, side > 0 ? "north" : "south");
    // observation windows either side of the doorway
    bp.fill(rx - 3, 2, rz, rx - 2, 3, rz, B.GLASS);
    bp.fill(rx + 2, 2, rz, rx + 3, 3, rz, B.GLASS);
  }
}

function corridor(bp) {
  // guide stripe down the middle of the floor
  bp.fill(1, 0, 10, W - 2, 0, 10, B.HAZARD);
  // ceiling lights every four blocks
  for (let rx = 3; rx <= W - 3; rx += 4) bp.set(rx, CEIL, 10, B.LIGHT);
  // cable trays along the top of both corridor walls
  bp.fill(1, CEIL - 1, WALL_N, W - 2, CEIL - 1, WALL_N, B.CONDUIT);
  bp.fill(1, CEIL - 1, WALL_S, W - 2, CEIL - 1, WALL_S, B.CONDUIT);
  // cameras watching both ends
  bp.mount(2, 4, CORRIDOR_Z0, B.CAMERA, "north");
  bp.mount(W - 3, 4, CORRIDOR_Z1, B.CAMERA, "south");
  // vault doors capping each end of the hall
  for (let ry = 1; ry <= 2; ry++) {
    bp.set(0, ry, 10, B.VAULT, { "minecraft:cardinal_direction": "east" });
    bp.set(W - 1, ry, 10, B.VAULT, { "minecraft:cardinal_direction": "west" });
  }
  bp.mount(1, 3, 10, B.SIGN, "west");
  bp.mount(W - 2, 3, 10, B.SIGN, "east");
}

function entryRoom(bp) {
  const sx = CONFIG.shaftRx;
  const sz = CONFIG.shaftRz;
  // backing column for the ladder, then the ladder itself
  bp.fill(sx, 1, sz - 1, sx, CEIL - 1, sz - 1, B.CONCRETE);
  bp.set(sx, CEIL, sz, B.AIR); // pierce the ceiling for the shaft
  for (let ry = 1; ry <= CEIL; ry++) {
    bp.set(sx, ry, sz, "minecraft:ladder", { facing_direction: 3 });
  }
  // hazard-marked landing pad
  bp.fill(sx - 1, 0, sz - 1, sx + 1, 0, sz + 1, B.HAZARD);
  bp.set(sx, CEIL, sz - 2, B.LIGHT);
  bp.mount(sx - 2, 3, 1, B.SIGN, "north");
  bp.mount(sx + 2, 3, 1, B.MONITOR, "north");
  bp.mount(10, 1, 1, B.LOCKER, "north");
  bp.mount(11, 1, 1, B.LOCKER, "north");
  bp.mount(16, 4, WALL_N - 1, B.CAMERA, "south");
  bp.set(15, 1, 6, B.CRATE);
  bp.set(15, 2, 6, B.CRATE);
  bp.set(14, 1, 6, B.CRATE);
  bp.mount(12, 1, 1, B.LOCKER, "north");
  bp.fill(sx - 3, 0, sz + 2, sx + 3, 0, sz + 2, B.HAZARD);
}

function commandCentre(bp) {
  const [x0, z0, x1] = ROOMS.command;
  // console bank along the north wall with monitors above it
  for (let rx = x0 + 1; rx <= x1 - 1; rx++) {
    bp.mount(rx, 1, z0 + 1, B.CONSOLE, "north");
    bp.mount(rx, 3, z0, B.MONITOR, "north");
  }
  // server row down the west wall
  for (let rz = 4; rz <= 6; rz++) bp.mount(x0, 1, rz, B.RACK, "west");
  bp.set(3, CEIL, 4, B.LIGHT);
  bp.set(6, CEIL, 6, B.LIGHT);
  bp.mount(x1, 1, 6, B.CONSOLE, "east");
  bp.chest(x1 - 1, 1, 6, 2, [
    ["minecraft:redstone", 24],
    ["minecraft:compass", 1],
    ["minecraft:empty_map", 1],
    ["minecraft:clock", 1],
    ["minecraft:paper", 12],
  ]);
  bp.mount(5, 4, WALL_N - 1, B.CAMERA, "south");
}

function barracks(bp) {
  const [x0, z0, x1, z1] = ROOMS.barracks;
  // four cots with a locker between each pair
  for (const rx of [x0 + 1, x0 + 4]) {
    for (const rz of [z0 + 1, z0 + 4]) {
      bp.set(rx, 1, rz, "minecraft:white_wool");
      bp.set(rx, 1, rz + 1, "minecraft:white_wool");
      bp.set(rx + 1, 1, rz, B.STEEL);
      bp.mount(rx + 1, 2, rz, B.MONITOR, "north");
    }
  }
  for (let rz = z0 + 1; rz <= z1 - 1; rz += 3) bp.mount(x1, 1, rz, B.LOCKER, "east");
  bp.set(21, CEIL, 3, B.LIGHT);
  bp.set(24, CEIL, 6, B.LIGHT);
  bp.set(x1, 1, z1, B.CRATE);
  bp.set(x1, 2, z1, B.CRATE);
  bp.set(x1 - 1, 1, z1, B.CRATE);
  bp.chest(x0, 1, z1, 3, [
    ["minecraft:bread", 16],
    ["minecraft:cooked_beef", 8],
    ["minecraft:torch", 32],
  ]);
}

function armoury(bp) {
  const [x0, z0, x1, z1] = ROOMS.armory;
  bp.chest(x0 + 1, 1, z1, 2, [
    ["minecraft:iron_ingot", 16],
    ["minecraft:arrow", 32],
    ["minecraft:coal", 24],
    [ITEM.KEYCARD, 1],
  ]);
  bp.chest(x0 + 2, 1, z1, 2, [
    ["minecraft:oak_planks", 32],
    ["minecraft:iron_ingot", 8],
    ["minecraft:water_bucket", 1],
  ]);
  bp.set(x0 + 4, 1, z1, "minecraft:crafting_table");
  bp.set(x0 + 5, 1, z1, "minecraft:furnace");
  bp.set(x1, 1, z1 - 2, "minecraft:anvil");
  // crate stacks in the corner
  for (const [cx, cz] of [[x0, z0], [x0 + 1, z0], [x0, z0 + 1]]) {
    bp.set(cx, 1, cz, B.CRATE);
  }
  bp.set(x0, 2, z0, B.CRATE);
  for (let rz = z0 + 3; rz <= z0 + 4; rz++) bp.mount(x0, 1, rz, B.LOCKER, "west");
  bp.set(3, CEIL, 15, B.LIGHT);
  bp.set(6, CEIL, 18, B.LIGHT);
  bp.mount(4, 3, z0, B.SIGN, "north");
}

function medbay(bp) {
  const [x0, z0, x1, z1] = ROOMS.medbay;
  for (let rx = x0 + 1; rx <= x1 - 2; rx++) bp.mount(rx, 1, z1, B.MEDICAL, "south");
  // two treatment cots
  for (const rx of [x0 + 1, x0 + 4]) {
    bp.set(rx, 1, z0 + 1, "minecraft:white_wool");
    bp.set(rx, 1, z0 + 2, "minecraft:white_wool");
    bp.set(rx + 1, 1, z0 + 1, B.STEEL);
  }
  bp.set(x1, 1, z0 + 4, "minecraft:brewing_stand");
  bp.set(x1, 1, z0 + 5, "minecraft:cauldron");
  bp.chest(x1 - 1, 1, z0 + 5, 4, [
    ["minecraft:golden_apple", 3],
    ["minecraft:bread", 12],
    ["minecraft:milk_bucket", 1],
    ["minecraft:glass_bottle", 4],
  ]);
  bp.set(12, CEIL, 15, B.LIGHT);
  bp.set(15, CEIL, 18, B.LIGHT);
  bp.mount(x0 + 2, 3, z0, B.MONITOR, "north");
}

function powerRoom(bp) {
  const [x0, z0, x1, z1] = ROOMS.power;
  // generator bank down the east wall
  for (let rz = z0 + 1; rz <= z0 + 4; rz++) bp.mount(x1, 1, rz, B.GENERATOR, "east");
  // cable runs feeding back into the corridor wall
  for (let ry = 1; ry <= CEIL - 1; ry++) bp.set(x1 - 1, ry, z1, B.CONDUIT);
  bp.fill(x0 + 1, 0, z0 + 2, x0 + 4, 0, z0 + 4, B.GRATE);
  bp.set(x0 + 2, CEIL, z0 + 3, B.VENT);
  bp.set(x0 + 4, CEIL, z0 + 3, B.VENT);
  bp.set(20, CEIL, 15, B.LIGHT);
  bp.set(23, CEIL, 18, B.LIGHT);
  bp.mount(x0 + 1, 3, z0, B.SIGN, "north");
  bp.set(x0, 1, z1, B.CRATE);
  bp.mount(x0 + 3, 2, z1, B.MONITOR, "south");
  bp.set(x0 + 1, 3, z1 - 1, B.EMERGENCY);
}

/** Build the full block list plus the shaft that reaches the surface. */
function plan(dimension, px, py, pz) {
  const bp = new Blueprint();
  shell(bp);
  interiorWalls(bp);
  doorways(bp);
  corridor(bp);
  entryRoom(bp);
  commandCentre(bp);
  barracks(bp);
  armoury(bp);
  medbay(bp);
  powerRoom(bp);

  // Facility origin, chosen so the ladder shaft comes up under the player.
  const ox = px - CONFIG.shaftRx;
  const oz = pz - CONFIG.shaftRz;
  const ceilingY = py - CONFIG.depthBelowPlayer;
  let oy = ceilingY - CEIL;
  const floor = minHeightOf(dimension) + 1;
  if (oy < floor) oy = floor;

  const ops = bp.ops.map((op) => ({
    x: ox + op.rx,
    y: oy + op.ry,
    z: oz + op.rz,
    p: op.p,
  }));
  const chests = bp.chests.map((c) => ({
    x: ox + c.rx,
    y: oy + c.ry,
    z: oz + c.rz,
    loot: c.loot,
  }));

  // Vertical shaft: air from just under the hatch down to the ceiling slab,
  // with a ladder the whole way and a concrete lining around it.
  const airP = perm(B.AIR);
  const ladderP = perm("minecraft:ladder", { facing_direction: 3 });
  const linerP = perm(B.CONCRETE);
  const shaftTop = py - 2;
  const shaftBottom = oy + CEIL;
  for (let y = shaftBottom; y <= shaftTop; y++) {
    ops.push({ x: px, y, z: pz, p: airP });
    if (linerP) ops.push({ x: px, y, z: pz - 1, p: linerP });
    if (ladderP) ops.push({ x: px, y, z: pz, p: ladderP });
  }
  // Hatch replaces the block the player is standing on.
  const hatchP = perm(B.HATCH, { "bunker:open": false });
  if (hatchP) ops.push({ x: px, y: py - 1, z: pz, p: hatchP });

  return { ops, chests, oy, ox, oz };
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

const building = new Set();

const PHASES = [
  "Surveying bedrock...",
  "Excavating...",
  "Pouring reinforced concrete...",
  "Fitting blast doors...",
  "Running power and lighting...",
  "Stocking supplies...",
];

function stockChest(dimension, spot) {
  const block = quiet(() => dimension.getBlock({ x: spot.x, y: spot.y, z: spot.z }));
  if (!block) return;
  const inventory = quiet(() => block.getComponent("minecraft:inventory"));
  const container = inventory && inventory.container;
  if (!container) return;
  for (const [id, amount] of spot.loot) {
    quiet(() => container.addItem(new ItemStack(id, amount)));
  }
}

function deploy(player) {
  const id = player.id;
  if (building.has(id)) {
    tell(player, "§cDeployment already in progress.");
    return;
  }

  const dimension = player.dimension;
  const px = Math.floor(player.location.x);
  const py = Math.floor(player.location.y);
  const pz = Math.floor(player.location.z);

  const site = plan(dimension, px, py, pz);
  if (site.oy + CEIL >= py - 2) {
    quiet(() => player.sendMessage("§cNot enough rock below you - move to higher ground."));
    return;
  }

  building.add(id);
  quiet(() => player.sendMessage("§b[BUNKER]§r Deployment beacon armed. Stand by."));
  playSound(player, "beacon.activate");

  let index = 0;
  const total = site.ops.length;

  const step = () => {
    const end = Math.min(index + CONFIG.blocksPerTick, total);
    for (; index < end; index++) {
      const op = site.ops[index];
      const block = quiet(() => dimension.getBlock({ x: op.x, y: op.y, z: op.z }));
      if (block) quiet(() => block.setPermutation(op.p));
    }

    const progress = index / total;
    const phase = PHASES[Math.min(PHASES.length - 1, Math.floor(progress * PHASES.length))];
    tell(player, `§b${phase} §7${Math.floor(progress * 100)}%`);

    if (index < total) {
      system.runTimeout(step, 1);
      return;
    }

    for (const spot of site.chests) stockChest(dimension, spot);
    building.delete(id);

    quiet(() =>
      player.getComponent("minecraft:inventory").container.addItem(
        new ItemStack(ITEM.KEYCARD, 1)
      )
    );

    playSound(player, "random.levelup");
    tell(player, "§aFacility online.");
    quiet(() =>
      player.sendMessage(
        "§b[BUNKER]§r Facility online. The hatch is at your feet - use the " +
          "§eLevel-3 Keycard§r on it to open the shaft."
      )
    );
  };

  system.runTimeout(step, 1);
}

/* ------------------------------------------------------------------ *
 * Doors, hatches and keypads
 * ------------------------------------------------------------------ */

function isDoor(block) {
  return block && DOOR_BLOCKS.indexOf(block.typeId) !== -1;
}

function setOpen(block, open) {
  quiet(() => block.setPermutation(block.permutation.withState("bunker:open", open)));
}

/** Toggle every door block welded to this one (stacked or side by side). */
function toggleDoorGroup(player, start) {
  const open = !start.permutation.getState("bunker:open");
  const seen = new Set();
  const queue = [start];
  let count = 0;

  while (queue.length && count < CONFIG.doorGroupLimit) {
    const block = queue.shift();
    const key = `${block.x},${block.y},${block.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isDoor(block) || block.typeId !== start.typeId) continue;

    setOpen(block, open);
    count++;

    for (const [dx, dy, dz] of [
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      const next = quiet(() =>
        player.dimension.getBlock({ x: block.x + dx, y: block.y + dy, z: block.z + dz })
      );
      if (next && isDoor(next)) queue.push(next);
    }
  }

  playSound(player, open ? "random.door_open" : "random.door_close", 0.7);
  const label = start.typeId === B.HATCH ? "Hatch" : "Blast door";
  tell(player, open ? `§a${label} released` : `§c${label} sealed`);
  return count;
}

/** A keypad drives every door in the surrounding rooms at once. */
function useKeypad(player, keypad) {
  const dimension = player.dimension;
  const doors = [];
  const rxz = CONFIG.keypadRadiusXZ;
  const ry = CONFIG.keypadRadiusY;

  for (let dx = -rxz; dx <= rxz; dx++) {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dz = -rxz; dz <= rxz; dz++) {
        const block = quiet(() =>
          dimension.getBlock({ x: keypad.x + dx, y: keypad.y + dy, z: keypad.z + dz })
        );
        if (block && block.typeId === B.DOOR) doors.push(block);
      }
    }
  }

  if (!doors.length) {
    playSound(player, "note.bass", 0.6);
    tell(player, "§cNo blast doors linked to this keypad.");
    return;
  }

  // If anything is still sealed the keypad releases everything, otherwise it
  // drops the facility into lockdown.
  const anySealed = doors.some((d) => !d.permutation.getState("bunker:open"));
  for (const door of doors) setOpen(door, anySealed);

  playSound(player, "random.click", anySealed ? 1.4 : 0.8);
  playSound(player, anySealed ? "random.door_open" : "random.door_close", 0.7);
  tell(
    player,
    anySealed
      ? `§aAccess granted - ${doors.length} doors released`
      : `§cLOCKDOWN - ${doors.length} doors sealed`
  );
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

// atan2(dx, dz) measured from +Z (south) and turning towards +X (east).
const COMPASS = [
  "south", "south-east", "east", "north-east",
  "north", "north-west", "west", "south-west",
];

function bearing(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const angle = (Math.atan2(dx, dz) * 180) / Math.PI;
  const index = Math.round(((angle + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

function sweep(player, origin, radius, label) {
  const hostiles =
    quiet(() =>
      player.dimension.getEntities({
        location: origin,
        maxDistance: radius,
        families: ["monster"],
      })
    ) || [];

  if (!hostiles.length) {
    playSound(player, "random.orb", 1.6);
    tell(player, `§a${label}: no contacts within ${radius}m`);
    return;
  }

  let nearest = hostiles[0];
  let best = Infinity;
  for (const entity of hostiles) {
    const loc = entity.location;
    const d = Math.hypot(loc.x - origin.x, loc.y - origin.y, loc.z - origin.z);
    if (d < best) {
      best = d;
      nearest = entity;
    }
  }

  playSound(player, "random.orb", 0.8);
  tell(
    player,
    `§c${label}: ${hostiles.length} contact${hostiles.length === 1 ? "" : "s"} ` +
      `§7- nearest ${Math.round(best)}m ${bearing(origin, nearest.location)}`
  );
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

const lastAction = new Map();

/** Debounce: mobile fires itemUse and itemUseOn for the same tap. */
function throttled(player, key, ticks) {
  const now = system.currentTick;
  const id = `${player.id}:${key}`;
  const previous = lastAction.get(id) ?? -999;
  if (now - previous < ticks) return true;
  lastAction.set(id, now);
  return false;
}

/** Subscribe defensively: a missing event must not take the script down. */
function on(event, handler) {
  quiet(() => event.subscribe(handler));
}

on(world.afterEvents.itemUseOn, (event) => {
  const player = event.source;
  const item = event.itemStack;
  const block = event.block;
  if (!player || !item || !block) return;

  if (item.typeId === ITEM.BEACON) {
    if (throttled(player, "beacon", 40)) return;
    deploy(player);
    return;
  }

  if (item.typeId === ITEM.KEYCARD) {
    if (throttled(player, "keycard", 6)) return;
    if (isDoor(block)) {
      toggleDoorGroup(player, block);
    } else if (block.typeId === B.KEYPAD) {
      useKeypad(player, block);
    } else if (block.typeId === B.CAMERA) {
      sweep(player, block.center ? block.center() : block.location, 48, "Perimeter sweep");
    } else {
      playSound(player, "note.bass", 0.6);
      tell(player, "§7Keycard: no reader here.");
    }
    return;
  }

  if (item.typeId === ITEM.TRACKER) {
    if (throttled(player, "tracker", 6)) return;
    sweep(player, player.location, CONFIG.scanRadius, "Motion tracker");
  }
});

on(world.afterEvents.itemUse, (event) => {
  const player = event.source;
  const item = event.itemStack;
  if (!player || !item) return;

  if (item.typeId === ITEM.TRACKER) {
    if (throttled(player, "tracker", 6)) return;
    sweep(player, player.location, CONFIG.scanRadius, "Motion tracker");
  }
});
