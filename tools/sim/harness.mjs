/*
 * Luxury Tech House - offline validation harness.
 *
 * Runs the add-on's own modules under Node against a stubbed @minecraft/server
 * and checks what they actually produce, rather than trusting that a thousand
 * hand-written coordinates are right:
 *
 *   1. every emitted command parses, references a real block id, and stays
 *      inside Bedrock's 32768-block /fill limit;
 *   2. no command contains "undefined" or "NaN" - the usual symptom of a typo
 *      in a plan constant;
 *   3. the smart-lighting invariant holds: the build never places a lighting
 *      group's night or lockdown block inside that group's own volume, which
 *      is what would weld two fittings together on the first day/night swap;
 *   4. door openings do not overlap, and each door animates from fully shut to
 *      fully open across its frame range;
 *   5. buttons and hidden triggers sit at distinct positions and every action
 *      they name is one the estate can dispatch.
 *
 * Exits non-zero with a report if anything fails.
 */

import {
  BLOCK_LOG,
  COMMAND_LOG,
  KNOWN_BLOCKS,
  makePlayer,
  pump,
  setPlayers,
  setTimeOfDay,
  world,
} from "@minecraft/server";
import { Estate, furnishPlan } from "./scripts/systems.js";
import { B, ALT, PLAN, Y, TUNE, resolvePalette } from "./scripts/config.js";
import { describeEstate, tickingClaims } from "./scripts/plan.js";
import { emitBuild } from "./scripts/blueprint.js";
import { CommandQueue, Builder } from "./scripts/builder.js";
import { DoorSystem, maxFrame } from "./scripts/doors.js";

const problems = [];
const fail = (message) => problems.push(message);

/* ---- teach the fake engine which block ids exist ------------------------ */
for (const id of Object.values(B)) KNOWN_BLOCKS.add(id);
for (const list of Object.values(ALT)) for (const id of list) KNOWN_BLOCKS.add(id);

const swapped = resolvePalette((id) => KNOWN_BLOCKS.has(id));
if (swapped.length > 0) fail(`palette should resolve cleanly, got: ${swapped.join("; ")}`);

/* ---- run the build ------------------------------------------------------ */
const ORIGIN = { x: 1000, y: 64, z: -2000 };
const DIM = "minecraft:overworld";
const spec = describeEstate(ORIGIN, DIM);

const dimension = world.getDimension(DIM);
const queue = new CommandQueue(dimension, 16);
const builder = new Builder(ORIGIN, queue);
emitBuild(spec, builder);
const commands = queue.commands.slice();

if (commands.length === 0) fail("emitBuild produced no commands");

/* ---- 1 + 2: command shape ---------------------------------------------- */
const FILL_LIMIT = 32768;
let blocksTouched = 0;
const idsUsed = new Set();
const boxes = [];

for (const command of commands) {
  if (/undefined|NaN|null/.test(command)) {
    fail(`command contains a bad token: ${command}`);
    continue;
  }
  const parts = command.split(/\s+/);
  const verb = parts[0];
  if (verb !== "fill" && verb !== "setblock") {
    fail(`unexpected command verb: ${command}`);
    continue;
  }
  const numeric = verb === "fill" ? parts.slice(1, 7) : parts.slice(1, 4);
  for (const token of numeric) {
    if (!/^-?\d+$/.test(token)) {
      fail(`non-integer coordinate in: ${command}`);
    }
  }
  const id = verb === "fill" ? parts[7] : parts[4];
  if (!id || !KNOWN_BLOCKS.has(id)) fail(`unknown block id "${id}" in: ${command}`);
  idsUsed.add(id);

  if (verb === "fill") {
    const [x0, y0, z0, x1, y1, z1] = numeric.map(Number);
    const volume = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (volume > FILL_LIMIT) fail(`fill of ${volume} blocks exceeds the limit: ${command}`);
    if (volume <= 0) fail(`degenerate fill: ${command}`);
    blocksTouched += volume;
    boxes.push({ x0, y0, z0, x1, y1, z1, id, replace: command.includes(" replace ") });
  } else {
    const [x, y, z] = numeric.map(Number);
    blocksTouched += 1;
    boxes.push({ x0: x, y0: y, z0: z, x1: x, y1: y, z1: z, id, replace: false });
  }
}

/* ---- 3: smart-lighting invariant --------------------------------------- */
function intersects(a, v) {
  return (
    a.x0 <= v.x1 &&
    a.x1 >= v.x0 &&
    a.y0 <= v.y1 &&
    a.y1 >= v.y0 &&
    a.z0 <= v.z1 &&
    a.z1 >= v.z0
  );
}

for (const zone of spec.zones) {
  // Within one volume each (group, state) id must be unique, or the reverse
  // fill cannot tell two fittings apart.
  for (const other of spec.zones) {
    if (other === zone) continue;
    if (JSON.stringify(other.vol) !== JSON.stringify(zone.vol)) continue;
    for (const state of ["day", "night", "alarm"]) {
      for (const otherState of ["day", "night", "alarm"]) {
        if (zone[state] === other[otherState]) {
          fail(
            `lighting id clash in one volume: ${zone.id}.${state} and ` +
              `${other.id}.${otherState} are both ${zone[state]}`
          );
        }
      }
    }
  }

  const forbidden = new Set([zone.night, zone.alarm].filter((id) => id !== zone.day));
  for (const box of boxes) {
    if (box.replace) continue;
    if (!forbidden.has(box.id)) continue;
    if (!intersects(box, zone.vol)) continue;
    fail(
      `build places ${box.id} inside the "${zone.id}" lighting volume at ` +
        `${box.x0},${box.y0},${box.z0}..${box.x1},${box.y1},${box.z1}; ` +
        `that block is a switched state of that group and will be mangled on the first transition`
    );
  }
}

/* ---- 4: doors ----------------------------------------------------------- */
const doorCells = new Map();
for (const door of spec.doors) {
  if (door.width < 1 || door.height < 1) fail(`door ${door.id} has a bad size`);
  if (door.split && door.width % 2 !== 0) {
    fail(`door ${door.id} is split but ${door.width} wide - leaves must be equal`);
  }
  for (let i = 0; i < door.width; i++) {
    const x = door.axis === "x" ? door.x + i : door.x;
    const z = door.axis === "z" ? door.z + i : door.z;
    for (let y = door.y; y < door.y + door.height; y++) {
      const key = `${x},${y},${z}`;
      if (doorCells.has(key)) {
        fail(`doors ${doorCells.get(key)} and ${door.id} overlap at ${key}`);
      }
      doorCells.set(key, door.id);
    }
  }
  if (!KNOWN_BLOCKS.has(door.block)) fail(`door ${door.id} uses unknown block ${door.block}`);
  if (!KNOWN_BLOCKS.has(door.pane)) fail(`door ${door.id} uses unknown pane ${door.pane}`);
}

const doorSystem = new DoorSystem(spec, dimension);
for (const state of doorSystem.state.values()) {
  const door = state.door;
  const limit = maxFrame(door);
  if (limit < 1) fail(`door ${door.id} has no travel`);

  state.frame = 0;
  doorSystem.render(state);
  if (state.cols.some((c) => c !== 2)) fail(`door ${door.id} is not solid when shut`);

  state.frame = limit;
  doorSystem.render(state);
  if (state.cols.some((c) => c !== 0)) fail(`door ${door.id} is not clear when open`);

  // every intermediate frame must be monotonically more open than the last
  let previousSolid = Infinity;
  for (let frame = 0; frame <= limit; frame++) {
    state.frame = frame;
    state.cols = null;
    doorSystem.render(state);
    const solid = state.cols.reduce((n, c) => n + (c === 2 ? 1 : 0), 0);
    if (solid > previousSolid) {
      fail(`door ${door.id} frame ${frame} closes back up (${previousSolid} -> ${solid})`);
    }
    previousSolid = solid;
  }
}

/* the build must actually seal every opening with the door's own block */
for (const door of spec.doors) {
  const sealed = boxes.some(
    (box) =>
      box.id === door.block &&
      box.x0 <= door.x &&
      box.x1 >= door.x &&
      box.z0 <= door.z &&
      box.z1 >= door.z &&
      box.y0 <= door.y &&
      box.y1 >= door.y + door.height - 1
  );
  if (!sealed) fail(`door ${door.id} is never sealed with ${door.block} by the build`);
}

/* ---- 5: controls -------------------------------------------------------- */
const DISPATCHABLE = new Set([
  "lockdown_toggle",
  "lockdown_off",
  "lighting_cycle",
  "vault_toggle",
  "tunnel_toggle",
  "shelf_toggle",
  "helipad_toggle",
  "platform_toggle",
]);

const controlCells = new Map();
for (const control of [...spec.buttons, ...spec.triggers]) {
  const key = `${control.x},${control.y},${control.z}`;
  if (controlCells.has(key)) {
    fail(`two controls share ${key}: ${controlCells.get(key)} and ${control.action}`);
  }
  controlCells.set(key, control.action);
  if (!DISPATCHABLE.has(control.action) && !control.action.startsWith("lift:")) {
    fail(`control at ${key} names an unknown action: ${control.action}`);
  }
  if (control.action.startsWith("lift:")) {
    const [, liftId, relY] = control.action.split(":");
    const lift = spec.lifts.find((l) => l.id === liftId);
    if (!lift) fail(`control at ${key} calls unknown lift ${liftId}`);
    else if (!lift.stops.some((s) => s.y === ORIGIN.y + Number(relY))) {
      fail(`control at ${key} calls a stop the ${liftId} lift does not have`);
    }
  }
  if (control.action.startsWith("lift:") === false && !doorCells.has(key)) {
    // controls must not be buried inside a doorway
    continue;
  }
  if (doorCells.has(key)) fail(`control at ${key} sits inside door ${doorCells.get(key)}`);
}

/* every lift stop must have at least one call point */
for (const lift of spec.lifts) {
  for (const stop of lift.stops) {
    const action = `lift:${lift.id}:${stop.y - ORIGIN.y}`;
    if (!spec.buttons.some((btn) => btn.action === action)) {
      fail(`lift ${lift.id} stop ${stop.label} has no call button`);
    }
  }
}

/* lift cabs must sit inside their shafts, and every lift door must line up */
for (const lift of spec.lifts) {
  const shaft = lift.id === "main" ? PLAN.SHAFT : PLAN.SECURE;
  const rel = {
    x0: lift.cab.x0 - ORIGIN.x,
    x1: lift.cab.x1 - ORIGIN.x,
    z0: lift.cab.z0 - ORIGIN.z,
    z1: lift.cab.z1 - ORIGIN.z,
  };
  if (rel.x0 <= shaft.x0 || rel.x1 >= shaft.x1 || rel.z0 <= shaft.z0 || rel.z1 >= shaft.z1) {
    fail(`lift ${lift.id} cab is not strictly inside its shaft`);
  }
  for (const door of spec.doors.filter((d) => d.lift === lift.id)) {
    if (!lift.stops.some((s) => s.y === door.stopY)) {
      fail(`lift door ${door.id} names stop ${door.stopY}, which the lift does not serve`);
    }
  }
}

/* ---- 6: the estate must sit inside the ticking areas the builder claims --- */
const claims = tickingClaims(ORIGIN).map((claim) => ({
  name: claim.name,
  x0: Math.min(claim.from.x, claim.to.x),
  y0: Math.min(claim.from.y, claim.to.y),
  z0: Math.min(claim.from.z, claim.to.z),
  x1: Math.max(claim.from.x, claim.to.x),
  y1: Math.max(claim.from.y, claim.to.y),
  z1: Math.max(claim.from.z, claim.to.z),
}));
for (const claim of claims) {
  const chunks =
    Math.ceil((claim.x1 - claim.x0 + 1) / 16) * Math.ceil((claim.z1 - claim.z0 + 1) / 16);
  if (chunks > 100) fail(`ticking area ${claim.name} spans ${chunks} chunks, limit is 100`);
}
for (const box of boxes) {
  const covered = claims.some(
    (claim) =>
      box.x0 >= claim.x0 &&
      box.x1 <= claim.x1 &&
      box.y0 >= claim.y0 &&
      box.y1 <= claim.y1 &&
      box.z0 >= claim.z0 &&
      box.z1 <= claim.z1
  );
  if (!covered) {
    fail(
      `build reaches ${box.x0},${box.y0},${box.z0}..${box.x1},${box.y1},${box.z1} ` +
        `(${box.id}), outside every ticking area`
    );
    break;
  }
}

/* ---- 7: voxel replay ----------------------------------------------------
 * Replay every command into a dense grid and inspect the finished mansion.
 * A door that floats in mid-air, a button hung on nothing, or a teleport
 * target buried in stone all look perfectly fine as a command list and are
 * only visible once the blocks are actually stacked up.
 * ------------------------------------------------------------------------ */
const grid = (() => {
  const lo = {
    x: Math.min(...claims.map((c) => c.x0)),
    y: Math.min(...claims.map((c) => c.y0)),
    z: Math.min(...claims.map((c) => c.z0)),
  };
  const hi = {
    x: Math.max(...claims.map((c) => c.x1)),
    y: Math.max(...claims.map((c) => c.y1)),
    z: Math.max(...claims.map((c) => c.z1)),
  };
  const size = {
    x: hi.x - lo.x + 1,
    y: hi.y - lo.y + 1,
    z: hi.z - lo.z + 1,
  };
  const cells = new Int16Array(size.x * size.y * size.z);
  const ids = ["minecraft:air"];
  const index = new Map([["minecraft:air", 0]]);
  const intern = (id) => {
    let n = index.get(id);
    if (n === undefined) {
      n = ids.length;
      ids.push(id);
      index.set(id, n);
    }
    return n;
  };
  const offset = (x, y, z) =>
    ((x - lo.x) * size.y + (y - lo.y)) * size.z + (z - lo.z);
  const inside = (x, y, z) =>
    x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y && z >= lo.z && z <= hi.z;

  for (const box of boxes) {
    if (box.replace) continue;
    const value = intern(box.id);
    for (let x = box.x0; x <= box.x1; x++) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let z = box.z0; z <= box.z1; z++) {
          if (inside(x, y, z)) cells[offset(x, y, z)] = value;
        }
      }
    }
  }
  return {
    at: (x, y, z) => (inside(x, y, z) ? ids[cells[offset(x, y, z)]] : undefined),
  };
})();

const PASSABLE = new Set([
  "minecraft:air",
  "minecraft:water",
  B.BUTTON,
  B.BUTTON_RED,
]);
const isAir = (id) => id === undefined || PASSABLE.has(id);
const isSolid = (id) => id !== undefined && !PASSABLE.has(id);

for (const door of spec.doors) {
  const mid = door.y + Math.floor(door.height / 2);
  const centre = Math.floor(door.width / 2);

  // every cell of the reveal must hold the door's own panel when shut
  for (let i = 0; i < door.width; i++) {
    const x = door.axis === "x" ? door.x + i : door.x;
    const z = door.axis === "z" ? door.z + i : door.z;
    for (let y = door.y; y < door.y + door.height; y++) {
      const found = grid.at(x, y, z);
      if (found !== door.block) {
        fail(`door ${door.id}: ${x},${y},${z} holds ${found}, expected ${door.block}`);
      }
    }
  }

  // the opening has to be cut into something, or the "door" is a free wall
  const jambs =
    door.axis === "x"
      ? [
          [door.x - 1, mid, door.z],
          [door.x + door.width, mid, door.z],
        ]
      : [
          [door.x, mid, door.z - 1],
          [door.x, mid, door.z + door.width],
        ];
  for (const [x, y, z] of jambs) {
    if (!isSolid(grid.at(x, y, z))) {
      fail(`door ${door.id}: no jamb at ${x},${y},${z} - the opening is not in a wall`);
    }
  }

  // and you have to be able to walk through it once it slides open
  const throughs =
    door.axis === "x"
      ? [
          [door.x + centre, door.z - 1],
          [door.x + centre, door.z + 1],
        ]
      : [
          [door.x - 1, door.z + centre],
          [door.x + 1, door.z + centre],
        ];
  for (const [x, z] of throughs) {
    for (const y of [door.y, door.y + 1]) {
      if (!isAir(grid.at(x, y, z))) {
        fail(
          `door ${door.id}: ${x},${y},${z} is ${grid.at(x, y, z)}, blocking the way through`
        );
      }
    }
  }
}

const SUPPORT = {
  0: [0, 1, 0],
  1: [0, -1, 0],
  2: [0, 0, 1],
  3: [0, 0, -1],
  4: [1, 0, 0],
  5: [-1, 0, 0],
};
for (const btn of spec.buttons) {
  const found = grid.at(btn.x, btn.y, btn.z);
  if (found !== B.BUTTON && found !== B.BUTTON_RED) {
    fail(`button at ${btn.x},${btn.y},${btn.z} was overwritten by ${found}`);
    continue;
  }
  const facing = Number((btn.states ?? "").match(/facing_direction"?=(\d)/)?.[1] ?? 1);
  const [dx, dy, dz] = SUPPORT[facing] ?? SUPPORT[1];
  const support = grid.at(btn.x + dx, btn.y + dy, btn.z + dz);
  if (!isSolid(support)) {
    fail(
      `button at ${btn.x},${btn.y},${btn.z} (facing ${facing}) has nothing to hang on: ` +
        `${btn.x + dx},${btn.y + dy},${btn.z + dz} is ${support}`
    );
  }
  // and it must be reachable, not buried in the wall it is mounted to
  if (!isAir(grid.at(btn.x - dx, btn.y - dy, btn.z - dz))) {
    fail(`button at ${btn.x},${btn.y},${btn.z} faces into solid material`);
  }
}

for (const trigger of spec.triggers) {
  const found = grid.at(trigger.x, trigger.y, trigger.z);
  if (!isSolid(found)) {
    fail(`hidden trigger at ${trigger.x},${trigger.y},${trigger.z} is ${found}, not a block`);
  }
}

for (const target of spec.teleports) {
  if (!isSolid(grid.at(target.x, target.y - 1, target.z))) {
    fail(`teleport "${target.label}" has no floor under it`);
  }
  for (const dy of [0, 1]) {
    if (!isAir(grid.at(target.x, target.y + dy, target.z))) {
      fail(
        `teleport "${target.label}" is obstructed at ${target.x},${target.y + dy},${target.z} ` +
          `by ${grid.at(target.x, target.y + dy, target.z)}`
      );
    }
  }
}

/* the lift cabs need a clear shaft at every stop they serve */
for (const lift of spec.lifts) {
  for (const stop of lift.stops) {
    for (let x = lift.cab.x0; x <= lift.cab.x1; x++) {
      for (let z = lift.cab.z0; z <= lift.cab.z1; z++) {
        for (let y = stop.y; y < stop.y + lift.cabHeight; y++) {
          if (!isAir(grid.at(x, y, z))) {
            fail(
              `lift ${lift.id} cannot reach ${stop.label}: ${x},${y},${z} is ` +
                grid.at(x, y, z)
            );
          }
        }
      }
    }
  }
}

/* ---- 7b: post-build dressing --------------------------------------------
 * spawnEntity and container.setItem both fail quietly, so a stand spawned in
 * a wall or a chest address that is really a workbench would just look like
 * nothing happened. Check each target against the finished mansion instead.
 * ------------------------------------------------------------------------ */
const CONTAINERS = new Set([B.CHEST, B.BARREL, B.ENDER_CHEST]);
const dressing = furnishPlan(spec);

for (const stand of dressing.armourStands) {
  if (!isAir(grid.at(stand.location.x, stand.location.y, stand.location.z))) {
    fail(
      `armour stand at ${stand.location.x},${stand.location.y},${stand.location.z} ` +
        `would spawn inside ${grid.at(stand.location.x, stand.location.y, stand.location.z)}`
    );
  }
  if (!isSolid(grid.at(stand.support.x, stand.support.y, stand.support.z))) {
    fail(`armour stand at ${stand.location.x},${stand.location.y},${stand.location.z} has no plinth`);
  }
  if (stand.set.length !== 5) fail("armour stand sets must fill all five slots");
}

for (const entry of dressing.containers) {
  const found = grid.at(entry.location.x, entry.location.y, entry.location.z);
  if (!CONTAINERS.has(found)) {
    fail(
      `loot target ${entry.location.x},${entry.location.y},${entry.location.z} is ${found}, ` +
        "not a container"
    );
  }
}

for (const entry of dressing.fish) {
  const found = grid.at(entry.location.x, entry.location.y, entry.location.z);
  if (found !== "minecraft:water") {
    fail(
      `${entry.type} would spawn at ${entry.location.x},${entry.location.y},${entry.location.z} ` +
        `in ${found}, not water`
    );
  }
}

/* ---- 8: runtime replay ---------------------------------------------------
 * Drive the live systems the way a player would and check what they emit.
 * The static pass proves the mansion is built correctly; this proves the
 * smart home actually does something once it is.
 * ------------------------------------------------------------------------ */
const estate = new Estate(spec);
estate.attach();
pump(20);

function runtimeCommandsSince(mark) {
  return COMMAND_LOG.slice(mark);
}

function checkRuntimeCommands(label, list) {
  for (const command of list) {
    if (/undefined|NaN/.test(command)) {
      fail(`${label}: runtime command has a bad token: ${command}`);
      continue;
    }
    const parts = command.split(/\s+/);
    if (parts[0] === "fill") {
      const [x0, y0, z0, x1, y1, z1] = parts.slice(1, 7).map(Number);
      if ([x0, y0, z0, x1, y1, z1].some((n) => !Number.isFinite(n))) {
        fail(`${label}: non-numeric fill: ${command}`);
        continue;
      }
      const volume = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (volume > FILL_LIMIT) fail(`${label}: runtime fill of ${volume} blocks: ${command}`);
      if (!KNOWN_BLOCKS.has(parts[7])) fail(`${label}: unknown block ${parts[7]}: ${command}`);
      const replaceAt = parts.indexOf("replace");
      if (replaceAt > 0 && !KNOWN_BLOCKS.has(parts[replaceAt + 1])) {
        fail(`${label}: unknown replace filter in: ${command}`);
      }
    } else if (parts[0] !== "tickingarea" && parts[0] !== "setblock") {
      fail(`${label}: unexpected runtime command: ${command}`);
    }
  }
}

/* attach must have laid out both cabs and run one lighting pass */
let mark = 0;
checkRuntimeCommands("attach", runtimeCommandsSince(mark));
if (COMMAND_LOG.filter((c) => c.includes(" replace ")).length === 0) {
  fail("attach did not emit any lighting fills");
}
if (estate.lighting !== "day") fail(`attach settled on lighting "${estate.lighting}", expected day`);

/* a player walking up to the entrance must open it, and leaving must shut it */
const entrance = spec.doors.find((d) => d.id === "main_entrance");
const visitor = makePlayer(DIM, {
  x: entrance.centre.x,
  y: entrance.y,
  z: entrance.centre.z - 2,
});
setPlayers([visitor]);
mark = BLOCK_LOG.length;
pump(40);
const entranceState = estate.doors.get("main_entrance");
if (entranceState.frame !== maxFrame(entrance)) {
  fail(`entrance did not open on approach (frame ${entranceState.frame})`);
}
if (BLOCK_LOG.length === mark) fail("entrance opened without writing any blocks");

/* standing in the reveal must veto the close */
visitor.location = { x: entrance.centre.x, y: entrance.y, z: entrance.centre.z };
estate.doors.get("main_entrance").target = 0;
pump(12);
if (estate.doors.get("main_entrance").frame !== maxFrame(entrance)) {
  fail("entrance closed onto a player standing in the doorway");
}

visitor.location = { x: entrance.centre.x, y: entrance.y, z: entrance.centre.z - 40 };
pump(80);
if (estate.doors.get("main_entrance").frame !== 0) {
  fail(`entrance did not close after the player left (frame ${estate.doors.get("main_entrance").frame})`);
}

/* night falls */
visitor.location = { x: spec.centre.x, y: spec.centre.y, z: spec.centre.z };
setTimeOfDay(15000);
mark = COMMAND_LOG.length;
pump(TUNE.CLOCK_PERIOD + 40);
checkRuntimeCommands("night", runtimeCommandsSince(mark));
if (estate.lighting !== "night") fail(`night did not engage (lighting ${estate.lighting})`);

/* lockdown, then release */
mark = COMMAND_LOG.length;
estate.setLockdown(true);
pump(60);
checkRuntimeCommands("lockdown", runtimeCommandsSince(mark));
if (estate.lighting !== "alarm") fail("lockdown did not switch lighting to alarm");
for (const door of spec.doors.filter((d) => d.lockable)) {
  if (estate.doors.get(door.id).frame !== 0) fail(`lockdown left ${door.id} open`);
}
if (estate.alarmHandle === undefined) fail("lockdown did not arm the alarm");

estate.setLockdown(false);
pump(60);
if (estate.alarmHandle !== undefined) fail("release did not silence the alarm");
if (estate.lighting !== "night") fail(`release settled on ${estate.lighting}, expected night`);

/* lift travel */
const mainLift = estate.lifts.get("main");
const roofStop = mainLift.def.stops[mainLift.def.stops.length - 1];
mark = COMMAND_LOG.length;
estate.callLift("main", roofStop.y);
pump(200);
checkRuntimeCommands("lift", runtimeCommandsSince(mark));
if (mainLift.y !== roofStop.y) fail(`lift stopped at ${mainLift.y}, expected ${roofStop.y}`);
if (mainLift.moving) fail("lift never finished its trip");

/* concealed systems */
for (const [action, flag, expected] of [
  ["shelf_toggle", "shelf", true],
  ["tunnel_toggle", "tunnel", true],
  ["vault_toggle", "vault", true],
  ["helipad_toggle", "helipad", false],
  ["platform_toggle", "platform", false],
]) {
  mark = COMMAND_LOG.length;
  if (!estate.dispatch(action, visitor)) fail(`dispatch("${action}") refused`);
  pump(160);
  checkRuntimeCommands(action, runtimeCommandsSince(mark));
  if (estate.flags[flag] !== expected) {
    fail(`${action} left flags.${flag} = ${estate.flags[flag]}, expected ${expected}`);
  }
}
if (estate.doors.get("secret_shelf").frame !== maxFrame(estate.doors.get("secret_shelf").door)) {
  fail("the bookshelf wall never finished opening");
}

/* every button action the estate exposes must be one it can actually run */
for (const btn of spec.buttons) {
  if (estate.actionAt(btn.x, btn.y, btn.z) !== btn.action) {
    fail(`actionAt cannot find the control at ${btn.x},${btn.y},${btn.z}`);
  }
}
for (const trigger of spec.triggers) {
  if (estate.actionAt(trigger.x, trigger.y, trigger.z) !== trigger.action) {
    fail(`actionAt cannot find the trigger at ${trigger.x},${trigger.y},${trigger.z}`);
  }
}

/* the saved record must round-trip: a reloaded world rebuilds from it alone */
const saved = JSON.parse(JSON.stringify(estate.serialize()));
estate.detach();
const reloaded = new Estate(describeEstate({ x: saved.o[0], y: saved.o[1], z: saved.o[2] }, saved.d), saved);
if (reloaded.lockdown !== estate.lockdown) fail("lockdown did not survive a save/load round trip");
if (reloaded.flags.vault !== estate.flags.vault) fail("vault flag did not survive a round trip");
if (reloaded.lifts.get("main").y !== mainLift.y) fail("lift position did not survive a round trip");
reloaded.detach();
setPlayers([]);

/* ---- 9: entry points -----------------------------------------------------
 * Loaded dynamically, after KNOWN_BLOCKS is populated, so main.js resolves the
 * palette against the same fake engine everything else used. A syntax error or
 * a bad import in either module fails the build here rather than in game.
 * ------------------------------------------------------------------------ */
await import("./scripts/ui.js");
await import("./scripts/main.js");

/* ---- report ------------------------------------------------------------- */
const summary = {
  commands: commands.length,
  blocksTouched,
  distinctBlockIds: idsUsed.size,
  doors: spec.doors.length,
  autoDoors: spec.doors.filter((d) => d.auto).length,
  buttons: spec.buttons.length,
  triggers: spec.triggers.length,
  lightingZones: spec.zones.length,
  lifts: spec.lifts.length,
  teleports: spec.teleports.length,
  armourStands: dressing.armourStands.length,
  lootContainers: dressing.containers.length,
  fish: dressing.fish.length,
  runtimeCommands: COMMAND_LOG.length,
  runtimeBlockWrites: BLOCK_LOG.length,
  estimatedBuildSeconds: +(commands.length / TUNE.BUILD_RATE / 20).toFixed(1),
};

if (problems.length > 0) {
  console.error("FAILED\n" + problems.map((p) => `  - ${p}`).join("\n"));
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log("OK " + JSON.stringify(summary));
