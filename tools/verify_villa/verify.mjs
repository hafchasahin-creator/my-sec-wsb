/*
 * Build the villa against a stand-in for the Bedrock scripting API and assert
 * the things that are invisible in a JSON diff: that water cannot escape its
 * basins, that every staircase has headroom and lands somewhere solid, that
 * the shell has no holes, and that every room can actually be walked to.
 *
 * Usage:  node tools/verify_villa/verify.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "../../behavior_packs/luxury_house_bp/scripts/main.js");
const mockPath = resolve(here, "mock_server.mjs");

// main.js imports "@minecraft/server" by name. Rather than plant a node_modules
// tree in the repo, point a throwaway copy of it at the mock instead.
const stage = mkdtempSync(join(tmpdir(), "luxury-verify-"));
const stagedScript = join(stage, "main.mjs");
writeFileSync(
  stagedScript,
  readFileSync(scriptPath, "utf8").replace(
    /from "@minecraft\/server"/,
    `from ${JSON.stringify(pathToFileURL(mockPath).href)}`
  )
);

const { handlers, tickQueue } = await import(pathToFileURL(mockPath).href);
await import(pathToFileURL(stagedScript).href);

/* ------------------------------------------------------------------ *
 * A world made of a Map
 * ------------------------------------------------------------------ */

const store = new Map();
const cellKey = (p) => `${p.x},${p.y},${p.z}`;
const idAt = (x, y, z) => store.get(`${x},${y},${z}`) ?? "minecraft:air";

const dimension = {
  id: "minecraft:overworld",
  getBlock(p) {
    if (p.y < -64 || p.y > 320) return undefined;
    return {
      get isAir() {
        return (store.get(cellKey(p)) ?? "minecraft:air") === "minecraft:air";
      },
      setPermutation(permutation) {
        store.set(cellKey(p), permutation.type.id);
      },
    };
  },
};

const messages = [];
const player = {
  id: "verify",
  dimension,
  location: { x: 0.5, y: 64, z: 0.5 },
  getRotation: () => ({ x: 0, y: 0 }), // facing south (+Z)
  sendMessage: (m) => messages.push(m),
  onScreenDisplay: { setActionBar: () => {} },
  playSound: () => {},
  getComponent: () => undefined,
  selectedSlot: 0,
};

function drain() {
  let ticks = 0;
  while (tickQueue.length) {
    for (const fn of tickQueue.splice(0)) fn();
    if (++ticks > 5000) throw new Error("build never finished");
  }
  return ticks;
}

const use = handlers.itemUse[0];
use({ source: player, itemStack: { typeId: "luxury:villa_deed" } });
const ticks = drain();

/* Player stands at (0,64,0) facing south, so local (u, y, v) maps like this. */
const W = (u, y, v) => idAt(10 - u, 64 + y, v + 5);

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
}

// 1. Water next to open air on its own level would flow across the build.
const leaks = [];
for (const [key, id] of store) {
  if (id !== "minecraft:water") continue;
  const [x, y, z] = key.split(",").map(Number);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (idAt(x + dx, y, z + dz) === "minecraft:air") leaks.push(key);
  }
  if (idAt(x, y - 1, z) === "minecraft:air") leaks.push(`under ${key}`);
}
check("water is fully contained", leaks.length === 0, `${leaks.length} leaking cells, e.g. ${leaks.slice(0, 3)}`);

// 2. The front doors exist, both halves.
check(
  "front doors placed",
  W(10, 0, 0).includes("door") && W(11, 1, 0).includes("door"),
  `${W(10, 0, 0)} / ${W(11, 1, 0)}`
);

// 3./4. Both stair runs: real stair blocks, two blocks of headroom each.
const steps = [];
for (let s = 0; s <= 5; s += 1) {
  steps.push([10, 0 + s, 11 + s], [11, 0 + s, 11 + s]); // great hall run
  steps.push([18, 6 + s, 15 - s], [19, 6 + s, 15 - s]); // roof run
}
const notStairs = steps.filter(([u, y, v]) => W(u, y, v) !== "minecraft:quartz_stairs");
check("every stair block is placed", notStairs.length === 0, `${notStairs.length} missing`);
const noHeadroom = steps.filter(([u, y, v]) =>
  [1, 2].some((d) => W(u, y + d, v) !== "minecraft:air")
);
check("every stair has two blocks of headroom", noHeadroom.length === 0,
  `blocked at ${noHeadroom.slice(0, 3).map((c) => c.join("/"))}`);

// 5. You can step off the roof stair onto solid roof, not into the shaft.
check("roof stair lands on solid roof",
  W(18, 11, 9) !== "minecraft:air" && W(19, 11, 9) !== "minecraft:air");
check("roof kiosk doorway is open",
  W(18, 12, 8) === "minecraft:air" && W(19, 13, 8) === "minecraft:air");

// 6. No holes in the outer shell at head height, doorway aside.
const gaps = [];
for (let u = 0; u < 22; u += 1) {
  for (const v of [0, 17]) {
    const isDoorway = v === 0 && (u === 10 || u === 11);
    if (W(u, 2, v) === "minecraft:air" && !isDoorway) gaps.push(`${u},${v}`);
  }
}
for (let v = 0; v < 18; v += 1) {
  for (const u of [0, 21]) if (W(u, 2, v) === "minecraft:air") gaps.push(`${u},${v}`);
}
check("ground floor shell is sealed", gaps.length === 0, `${gaps.length} gaps, e.g. ${gaps.slice(0, 5)}`);

// 7. Every room is walkable from the front door / the top of the stairs.
function reachable(start, yMin, yMax) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const [u, y, v] = queue.pop();
    const key = `${u},${y},${v}`;
    if (seen.has(key)) continue;
    if (u < 0 || u > 21 || v < 0 || v > 17 || y < yMin || y > yMax) continue;
    if (W(u, y, v) !== "minecraft:air") continue;
    seen.add(key);
    for (const [du, dy, dv] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      queue.push([u + du, y + dy, v + dv]);
    }
  }
  return seen;
}

const downstairs = reachable([10, 0, 1], 0, 4);
for (const [name, cell] of Object.entries({
  "living room": [4, 0, 4], kitchen: [17, 0, 3], "home cinema": [4, 0, 13],
  spa: [17, 0, 12], "grand hall": [10, 0, 8],
  // One above the first step: the space a player stands in to start climbing.
  "foot of the stairs": [10, 1, 11],
})) check(`${name} is reachable from the front door`, downstairs.has(cell.join(",")));

const upstairs = reachable([10, 6, 15], 6, 10);
for (const [name, cell] of Object.entries({
  "master suite": [4, 6, 4], "guest bedroom": [17, 6, 4], library: [6, 6, 14],
  "dressing room": [17, 6, 14], landing: [10, 6, 5],
  "foot of the roof stair": [18, 7, 15],
})) check(`${name} is reachable upstairs`, upstairs.has(cell.join(",")));

const roof = reachable([18, 12, 9], 12, 14);
check("roof deck is reachable from the roof stair", roof.has([15, 12, 3].join(",")));

// 8. Demolition puts the lot back to lawn.
const beforeSolid = [...store.values()].filter((id) => id !== "minecraft:air").length;
use({ source: player, itemStack: { typeId: "luxury:wrecking_permit" } });
drain();
const standing = [...store.entries()].filter(
  ([key, id]) => Number(key.split(",")[1]) > 63 && id !== "minecraft:air"
);
check("demolition clears everything above the lawn", standing.length === 0,
  `${standing.length} blocks left of ${beforeSolid}`);

console.log(`\n${ticks} ticks to build, ${beforeSolid} blocks standing.`);
console.log(failures.length ? `${failures.length} FAILED` : "all checks passed");
process.exitCode = failures.length ? 1 : 0;
