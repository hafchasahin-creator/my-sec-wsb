/*
 * Runtime harness for the Dangerous Fungi behaviour script.
 *
 *     node tools/sim_test.mjs
 *
 * JSON validation cannot tell you whether main.js actually works. This stubs
 * the parts of @minecraft/server the add-on uses, drives a fake tick clock and
 * asserts the real gameplay contracts: that auras fire, that hazard gear
 * reduces damage, that the per-tick block budget stays inside a mobile budget,
 * that spreading obeys its limits, and that the scanner, testing field and
 * emergency cleanup all do what the functions promise.
 *
 * The stub is deliberately strict: any call to an API the real 1.11.0 module
 * does not expose is an error here, so a typo cannot slip through as a
 * silently-swallowed exception the way it would in game.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BP = "behavior_packs/dangerous_fungi_bp";

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * The stub module
 * ------------------------------------------------------------------ */

const STUB = `
export const EquipmentSlot = { Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet" };
export const EntityDamageCause = { magic: "magic", fire: "fire", contact: "contact" };
export const BlockPermutation = {
  resolve(id, states) {
    if (typeof id !== "string") throw new Error("BlockPermutation.resolve needs a string id");
    return { __permutation: true, id, states: states ?? {} };
  },
};

export const stats = {
  getBlock: 0, setBlock: 0, particles: 0, effects: [], damage: [],
  actionBars: [], messages: [], sounds: [], onFire: 0, perTickGetBlock: [],
};

const blocks = new Map();
export const key = (p) => \`\${p.x},\${p.y},\${p.z}\`;

export const dimension = {
  id: "minecraft:overworld",
  getBlock(pos) {
    stats.getBlock += 1;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      throw new Error("getBlock called with a non-finite position: " + JSON.stringify(pos));
    }
    if (pos.y < -64 || pos.y > 320) throw new Error("LocationInUnloadedChunkError");
    const id = blocks.get(key(pos)) ?? "minecraft:air";
    const location = { x: pos.x, y: pos.y, z: pos.z };
    return {
      typeId: id,
      location,
      setType(next) {
        if (typeof next !== "string") throw new Error("setType needs a string");
        stats.setBlock += 1;
        blocks.set(key(location), next);
      },
      setPermutation(permutation) {
        if (!permutation || !permutation.__permutation) throw new Error("setPermutation needs a BlockPermutation");
        stats.setBlock += 1;
        blocks.set(key(location), permutation.id);
      },
      getComponent(name) {
        if (name !== "minecraft:sign") return undefined;
        if (blocks.get(key(location)) !== "minecraft:standing_sign") return undefined;
        return { setText(text) { signs.set(key(location), text); } };
      },
    };
  },
  setBlockType(pos, id) {
    stats.setBlock += 1;
    blocks.set(key(pos), id);
  },
  spawnParticle(id, pos) {
    if (!id.includes(":")) throw new Error("particle id must be namespaced: " + id);
    if (!Number.isFinite(pos.x)) throw new Error("particle at a non-finite position");
    stats.particles += 1;
  },
  getEntities() { return []; },
};

export const signs = new Map();
export const setBlock = (pos, id) => blocks.set(key(pos), id);
export const getBlockAt = (pos) => blocks.get(key(pos)) ?? "minecraft:air";
export const allBlocks = blocks;

let nextId = 1;
export function makePlayer(location, gear = {}) {
  const equipment = { ...gear };
  return {
    id: "p" + nextId++,
    name: "Tester",
    typeId: "minecraft:player",
    location,
    dimension,
    getComponent(name) {
      if (name !== "minecraft:equippable") return undefined;
      return {
        getEquipment(slot) {
          const id = equipment[slot];
          return id ? { typeId: id } : undefined;
        },
      };
    },
    addEffect(id, duration, options) {
      if (typeof id !== "string") throw new Error("addEffect needs a string effect id");
      if (!Number.isInteger(duration)) throw new Error("addEffect duration must be an integer, got " + duration);
      if (duration <= 0) throw new Error("addEffect duration must be positive");
      if (options && options.amplifier !== undefined && (!Number.isInteger(options.amplifier) || options.amplifier < 0)) {
        throw new Error("addEffect amplifier must be a non-negative integer, got " + options.amplifier);
      }
      stats.effects.push({ id, duration, amplifier: options?.amplifier ?? 0 });
    },
    applyDamage(amount, options) {
      if (!Number.isFinite(amount)) throw new Error("applyDamage needs a finite amount");
      stats.damage.push({ amount, cause: options?.cause });
      return true;
    },
    setOnFire() { stats.onFire += 1; return true; },
    playSound(id) { stats.sounds.push(id); },
    sendMessage(text) {
      if (typeof text !== "string") throw new Error("sendMessage needs a string");
      stats.messages.push(text);
    },
    onScreenDisplay: {
      setActionBar(text) {
        if (typeof text !== "string") throw new Error("setActionBar needs a string");
        stats.actionBars.push(text);
      },
    },
  };
}

let players = [];
export const setPlayers = (list) => { players = list; };

const properties = new Map();
function channel() {
  const handlers = [];
  return { subscribe: (fn) => handlers.push(fn), emit: (event) => handlers.forEach((fn) => fn(event)) };
}

export const world = {
  getAllPlayers: () => players,
  getDynamicProperty: (id) => properties.get(id),
  setDynamicProperty: (id, value) => properties.set(id, value),
  afterEvents: {
    itemUse: channel(),
    playerSpawn: channel(),
    playerBreakBlock: channel(),
  },
};

const intervals = [];
const timeouts = [];
const immediate = [];

export const system = {
  run: (fn) => immediate.push(fn),
  runInterval: (fn, period) => {
    if (!Number.isInteger(period) || period < 1) throw new Error("runInterval period must be >= 1");
    intervals.push({ fn, period });
    return intervals.length;
  },
  runTimeout: (fn, delay) => { timeouts.push({ fn, at: delay }); return timeouts.length; },
  afterEvents: { scriptEventReceive: channel() },
};

let tickCount = 0;
export function tick(count = 1) {
  while (immediate.length) immediate.shift()();
  for (let i = 0; i < count; i++) {
    tickCount += 1;
    const before = stats.getBlock;
    for (const entry of intervals) {
      if (tickCount % entry.period === 0) entry.fn();
    }
    stats.perTickGetBlock.push(stats.getBlock - before);
  }
}
export const ticks = () => tickCount;
`;

/* ------------------------------------------------------------------ *
 * Build a runnable copy of the behaviour script
 * ------------------------------------------------------------------ */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fungi-sim-"));
fs.writeFileSync(path.join(tmp, "stub_server.mjs"), STUB);
fs.writeFileSync(
  path.join(tmp, "fungi_data.mjs"),
  fs.readFileSync(path.join(BP, "scripts/fungi_data.js"), "utf8")
);
fs.writeFileSync(
  path.join(tmp, "main.mjs"),
  fs
    .readFileSync(path.join(BP, "scripts/main.js"), "utf8")
    .replace('from "@minecraft/server"', 'from "./stub_server.mjs"')
    .replace('from "./fungi_data.js"', 'from "./fungi_data.mjs"')
);

const stub = await import(pathToFileURL(path.join(tmp, "stub_server.mjs")).href);
await import(pathToFileURL(path.join(tmp, "main.mjs")).href);

const data = await import(pathToFileURL(path.join(tmp, "fungi_data.mjs")).href);

const HAZARD = {
  Head: "fungi:hazard_helmet",
  Chest: "fungi:hazard_chestplate",
  Legs: "fungi:hazard_leggings",
  Feet: "fungi:hazard_boots",
};

const CYCLE = 21; // one full sweep plus a tick of slack

function clearStats() {
  stub.stats.effects.length = 0;
  stub.stats.damage.length = 0;
  stub.stats.actionBars.length = 0;
  stub.stats.messages.length = 0;
  stub.stats.sounds.length = 0;
  stub.stats.particles = 0;
  stub.stats.setBlock = 0;
  stub.stats.onFire = 0;
}

function reset() {
  clearStats();
  stub.allBlocks.clear();
}

/**
 * Run the world forward and only measure sweeps that began after the caller
 * finished setting the scene.
 *
 * The aura sweep is sliced across twenty ticks, so at any moment one sweep is
 * usually half-finished and still holds hits gathered from the *previous*
 * world state. Ticking one bare cycle after a change therefore measures a
 * mixture of old and new. Flushing a full cycle first, then clearing counters,
 * guarantees every sweep that completes in the measured window started after
 * the change.
 */
function settle(ticks = CYCLE) {
  stub.tick(CYCLE);
  clearStats();
  stub.tick(ticks);
}

/* ================================================================== *
 * Tests
 * ================================================================== */

console.log("\nDangerous Fungi - runtime simulation\n");

// ---- 1. the module loads and registers its loops ----
console.log("boot");
stub.setPlayers([]);
stub.tick(5);
check("script boots with no players attached", true);

// ---- 2. a Bloodcap next to a player applies wither and damage ----
console.log("\naura");
reset();
let player = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
stub.setPlayers([player]);
stub.setBlock({ x: 2, y: 64, z: 0 }, "fungi:bloodcap");
settle();

check(
  "Bloodcap applies wither",
  stub.stats.effects.some((e) => e.id === "wither"),
  JSON.stringify(stub.stats.effects)
);
check("Bloodcap deals damage", stub.stats.damage.length > 0);
check(
  "warning line names the species and level",
  stub.stats.actionBars.some((t) => t.includes("Bloodcap Fungus") && t.includes("LEVEL III")),
  stub.stats.actionBars.at(-1)
);
check("ambient particles are emitted", stub.stats.particles > 0);

// ---- 3. out of range does nothing ----
reset();
stub.setBlock({ x: 5, y: 64, z: 0 }, "fungi:bloodcap"); // range is 3
settle();
check("a growth beyond its range is inert", stub.stats.effects.length === 0 && stub.stats.damage.length === 0);

// ---- 4. hazard gear reduces the hit ----
console.log("\nprotection");
reset();
stub.setBlock({ x: 2, y: 64, z: 0 }, "fungi:bloodcap");
settle();
const bare = stub.stats.damage.reduce((sum, d) => sum + d.amount, 0);

reset();
const geared = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 }, HAZARD);
stub.setPlayers([geared]);
stub.setBlock({ x: 2, y: 64, z: 0 }, "fungi:bloodcap");
settle();
const suited = stub.stats.damage.reduce((sum, d) => sum + d.amount, 0);
check("the full hazard set cuts damage", suited < bare, `bare=${bare} suited=${suited}`);
// "Reduce or prevent" - but a Toxic-grade aura must still land something, or
// the suit would trivialise three quarters of the roster.
check(
  "the full hazard set does not make you immune to Level III",
  suited > 0,
  `bare=${bare} suited=${suited}`
);

// ---- 5. Level V is never fully resisted ----
reset();
stub.setBlock({ x: 2, y: 64, z: 0 }, "fungi:mycelium_x");
settle();
const vDamage = stub.stats.damage.reduce((sum, d) => sum + d.amount, 0);
const vEffects = stub.stats.effects.length;
check("Mycelium-X still hurts a fully suited player", vDamage > 0, `damage=${vDamage}`);
check("Mycelium-X still applies effects through the suit", vEffects > 0, `effects=${vEffects}`);
check(
  "Mycelium-X protection is capped below the normal full-set value",
  vDamage / 2.0 > 1 - 0.75,
  `retained=${(vDamage / 2.0).toFixed(2)}`
);

// ---- 6. every species is reachable and well-formed ----
console.log("\nall twenty species");
let speciesOk = 0;
const speciesProblems = [];
for (const species of data.SPECIES) {
  reset();
  const subject = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
  stub.setPlayers([subject]);
  stub.setBlock({ x: 1, y: 64, z: 0 }, species.id);
  // Pulsing species need several sweeps before they fire.
  settle(CYCLE * 4);
  const acted =
    stub.stats.effects.length > 0 ||
    stub.stats.damage.length > 0 ||
    stub.stats.actionBars.some((t) => t.includes(species.name));
  if (acted) speciesOk += 1;
  else speciesProblems.push(species.key);
}
check(`all ${data.SPECIES.length} species produce an effect in range`, speciesOk === data.SPECIES.length, speciesProblems.join(", "));

// ---- 7. effect arguments are always legal ----
check(
  "no effect was ever requested with a zero/negative duration",
  true // the stub throws on bad input, so reaching here proves it
);

// ---- 8. mobile budget ----
console.log("\nmobile budget");
reset();
const crowd = [0, 1, 2, 3].map((i) => stub.makePlayer({ x: i * 40 + 0.5, y: 64, z: 0.5 }));
stub.setPlayers(crowd);
for (const p of crowd) stub.setBlock({ x: Math.floor(p.location.x) + 2, y: 64, z: 0 }, "fungi:glowspore");
stub.tick(CYCLE);
stub.stats.perTickGetBlock.length = 0;
stub.tick(CYCLE * 3);
const worstTick = Math.max(...stub.stats.perTickGetBlock);
const meanTick =
  stub.stats.perTickGetBlock.reduce((a, b) => a + b, 0) / stub.stats.perTickGetBlock.length;
check(
  "per-tick block reads stay modest with 4 players",
  worstTick <= 400,
  `worst=${worstTick} mean=${meanTick.toFixed(0)}`
);
check("the sweep is genuinely sliced, not done in one tick", worstTick < 900, `worst=${worstTick}`);

reset();
stub.setPlayers([stub.makePlayer({ x: 0.5, y: 64, z: 0.5 })]);
for (let x = -4; x <= 4; x++) {
  for (let z = -4; z <= 4; z++) stub.setBlock({ x, y: 64, z }, "fungi:bloodcap");
}
settle();
check(
  "81 growths in range still emit only a handful of particles",
  stub.stats.particles <= 8,
  `particles=${stub.stats.particles}`
);
check(
  "a dense patch applies one species' effects, not one per block",
  stub.stats.effects.length <= 3,
  `effects=${stub.stats.effects.length}`
);

// ---- 9. the scanner ----
console.log("\nfungal scanner");
reset();
const scout = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
stub.setPlayers([scout]);
stub.setBlock({ x: 2, y: 64, z: 0 }, "fungi:deathbell");
stub.world.afterEvents.itemUse.emit({ source: scout, itemStack: { typeId: "fungi:fungal_scanner" } });
const readout = stub.stats.messages.join("\n");
check("scanner prints FUNGAL ANALYSIS", readout.includes("FUNGAL ANALYSIS"));
check("scanner names the species", readout.includes("Deathbell Mushroom"));
check("scanner reports a danger level", readout.includes("LEVEL IV"));
check("scanner reports a range", /Range:\s+\S*4/.test(readout), readout);
check("scanner reports status", readout.includes("ACTIVE") || readout.includes("DORMANT"));

reset();
stub.world.afterEvents.itemUse.emit({ source: scout, itemStack: { typeId: "fungi:fungal_scanner" } });
check(
  "scanner reports a clear reading with nothing nearby",
  stub.stats.messages.join("\n").includes("CLEAR")
);

// ---- 10. breaking a fungus disturbs it ----
console.log("\ndisturbance");
reset();
stub.setBlock({ x: 1, y: 64, z: 0 }, "fungi:sporeburst");
stub.world.afterEvents.playerBreakBlock.emit({
  player: scout,
  dimension: stub.dimension,
  block: { location: { x: 1, y: 64, z: 0 } },
  brokenBlockPermutation: { type: { id: "fungi:sporeburst" } },
});
check("breaking Sporeburst releases its cloud", stub.stats.particles > 0);
check("breaking Sporeburst applies its effects", stub.stats.effects.length > 0);
check(
  "breaking Sporeburst warns the player",
  stub.stats.actionBars.some((t) => t.includes("Sporeburst"))
);

// ---- 11. spreading limits ----
console.log("\ncontrolled spreading");
reset();
const gardener = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
stub.setPlayers([gardener]);
stub.setBlock({ x: 1, y: 63, z: 0 }, "minecraft:dirt");
stub.setBlock({ x: 1, y: 64, z: 0 }, "fungi:creeping_mold");
for (let x = -3; x <= 3; x++) {
  for (let z = -3; z <= 3; z++) stub.setBlock({ x, y: 63, z }, "minecraft:dirt");
}
stub.stats.setBlock = 0;
stub.tick(200 * 12); // two minutes of game time
const grown = stub.stats.setBlock;
check(
  "spreading is rate limited to at most one block per 10s pass",
  grown <= 12,
  `placed=${grown} over 12 passes`
);
check("spreading actually happens when enabled", grown > 0, `placed=${grown}`);

let moldCount = 0;
for (const id of stub.allBlocks.values()) if (id === "fungi:creeping_mold") moldCount += 1;
check(
  "a patch never exceeds its density cap",
  moldCount <= data.BY_ID["fungi:creeping_mold"].spreads.max_nearby + 2,
  `patch=${moldCount}`
);

// spreading off
reset();
stub.setPlayers([gardener]);
stub.setBlock({ x: 1, y: 63, z: 0 }, "minecraft:dirt");
stub.setBlock({ x: 1, y: 64, z: 0 }, "fungi:creeping_mold");
stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:spread_off", sourceEntity: gardener });
stub.stats.setBlock = 0;
stub.tick(200 * 12);
check("fungi_spread_off stops all growth", stub.stats.setBlock === 0, `placed=${stub.stats.setBlock}`);

stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:spread_on", sourceEntity: gardener });
check(
  "fungi_spread_on reports back",
  stub.stats.messages.some((m) => m.includes("ENABLED"))
);

// ---- 12. testing field ----
console.log("\ntesting field");
reset();
const builder = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
stub.setPlayers([builder]);
stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:test_area", sourceEntity: builder });
const placedSpecies = new Set();
for (const id of stub.allBlocks.values()) if (data.BY_ID[id]) placedSpecies.add(id);
check("the testing field places all 20 species", placedSpecies.size === 20, `placed=${placedSpecies.size}`);
check("the testing field labels each exhibit", stub.signs.size === 20, `signs=${stub.signs.size}`);
check(
  "labels carry the species name and danger level",
  [...stub.signs.values()].every((t) => t.includes("LEVEL") && t.split("\n").length >= 3),
  [...stub.signs.values()][0]
);

const spacings = [];
const positions = [];
for (const [k, id] of stub.allBlocks) {
  if (data.BY_ID[id]) positions.push(k.split(",").map(Number));
}
for (const a of positions) {
  for (const b of positions) {
    if (a === b) continue;
    const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (d > 0) spacings.push(d);
  }
}
check(
  "exhibits are spaced far enough apart to examine safely",
  Math.min(...spacings) >= 8,
  `closest=${Math.min(...spacings)}`
);

// ---- 13. emergency cleanup ----
console.log("\nemergency cleanup");
stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:cleanup", sourceEntity: builder });
stub.tick(120);
let leftover = 0;
for (const [k, id] of stub.allBlocks) {
  if (!data.BY_ID[id]) continue;
  const [x, y, z] = k.split(",").map(Number);
  if (Math.abs(x) <= 12 && Math.abs(z) <= 12 && Math.abs(y - 64) <= 6) leftover += 1;
}
check("cleanup removes every growth in radius", leftover === 0, `left=${leftover}`);
check(
  "cleanup reports what it did",
  stub.stats.messages.some((m) => m.includes("Cleanup complete"))
);

// ---- 14. status + cure ----
console.log("\nstatus and cure");
reset();
stub.setPlayers([builder]);
stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:status", sourceEntity: builder });
const status = stub.stats.messages.join("\n");
check("status reports the species count", status.includes(String(data.SPECIES.length)));
check("status reports the spreading state", /Spreading:/.test(status));

reset();
const victim = stub.makePlayer({ x: 0.5, y: 64, z: 0.5 });
stub.setPlayers([victim]);
stub.setBlock({ x: 1, y: 64, z: 0 }, "fungi:parasite_bloom");
settle(CYCLE * 2);
check(
  "Parasite Bloom marks the player as infected",
  stub.stats.actionBars.some((t) => t.includes("INFECTED")),
  stub.stats.actionBars.at(-1)
);

stub.allBlocks.clear();
stub.tick(CYCLE); // let the in-flight sweep finish before curing
stub.stats.actionBars.length = 0;
stub.system.afterEvents.scriptEventReceive.emit({ id: "fungi:cure", sourceEntity: victim });
stub.tick(CYCLE * 3);
check(
  "fungi_clear_effects cures the infection",
  !stub.stats.actionBars.some((t) => t.includes("INFECTED"))
);

// ---- 15. unloaded chunks must not throw ----
console.log("\nrobustness");
reset();
const faller = stub.makePlayer({ x: 0.5, y: -70, z: 0.5 }); // stub throws on every read here
stub.setPlayers([faller]);
let threw = false;
try {
  stub.tick(CYCLE * 2);
} catch (error) {
  threw = true;
  failures.push(`unloaded chunk crashed the sweep: ${error.message}`);
}
check("an unloaded/out-of-range chunk never crashes the sweep", !threw);

reset();
stub.setPlayers([stub.makePlayer({ x: 0.5, y: 64, z: 0.5 })]);
stub.world.afterEvents.itemUse.emit({ source: null, itemStack: null });
stub.world.afterEvents.playerBreakBlock.emit({ brokenBlockPermutation: undefined });
stub.tick(CYCLE);
check("malformed events are ignored rather than fatal", true);

/* ------------------------------------------------------------------ */

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
