/*
 * Behaviour tests for behavior_packs/anaconda_bp/scripts/main.js.
 *
 * The add-on script imports @minecraft/server, which only exists inside the
 * game, so the import is rewritten to point at mock_server.mjs and the hunting
 * loop is stepped by hand against fake entities.
 *
 * Usage:  node tools/tests/test_anaconda.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(
  HERE, "..", "..", "behavior_packs", "anaconda_bp", "scripts", "main.js"
);

// Point the add-on's import at the mock instead of the real module. The copy
// goes to a temp dir so nothing lands in the packs.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "anaconda-test-"));
fs.copyFileSync(path.join(HERE, "mock_server.mjs"), path.join(work, "mock_server.mjs"));
fs.writeFileSync(
  path.join(work, "main.under-test.mjs"),
  fs.readFileSync(SRC, "utf8")
    .replace('from "@minecraft/server"', 'from "./mock_server.mjs"')
);

const mock = await import(path.join(work, "mock_server.mjs"));
await import(path.join(work, "main.under-test.mjs")); // registers the interval

const { spawn, tick, log } = mock;

const snake = spawn("anaconda:anaconda", { x: 0, y: 64, z: 0 }, { health: 60, maxHealth: 60 });
const chicken = spawn("minecraft:chicken", { x: 1, y: 64, z: 1 }, { health: 4, maxHealth: 4 });
const zombie = spawn("minecraft:zombie", { x: 1, y: 64, z: 0 }, { health: 20, maxHealth: 20 });
const drop = spawn("minecraft:item", { x: 0.5, y: 64, z: 0.5 });
const arrow = spawn("minecraft:arrow", { x: 0.5, y: 64, z: 0.5 });
const other = spawn("anaconda:anaconda", { x: 2, y: 64, z: 0 }, { health: 60, maxHealth: 60 });
const builder = spawn("minecraft:player", { x: 1, y: 64, z: 1 }, { health: 20, maxHealth: 20, gameMode: "creative" });
const victim = spawn("minecraft:player", { x: 2, y: 64, z: 0 }, { health: 20, maxHealth: 20 });
const faraway = spawn("minecraft:cow", { x: 5, y: 64, z: 0 }, { health: 10, maxHealth: 10 });
const safeCow = spawn("minecraft:cow", { x: 1, y: 64, z: 0 }, { health: 10, maxHealth: 10, tags: ["anaconda_safe"] });

tick(4);

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}: ${err.message}`); }
}

console.log("Anaconda script behaviour:");
check("stage inferred from max health", () =>
  assert.ok(snake.getTags().includes("anaconda_stage:juvenile")));
check("weak mob within gulp range is swallowed whole", () =>
  assert.ok(chicken.removed));
check("tough mob is crushed, not swallowed", () =>
  assert.ok(!zombie.removed && zombie.damage > 0));
// Two snakes are in squeezing range of the zombie, so 4 passes = 1 squeeze each.
check("crush is throttled to once a second per snake", () =>
  assert.strictEqual(zombie.damage, 10, `got ${zombie.damage} over 4 passes`));
check("dropped item is eaten", () => assert.ok(drop.removed));
check("arrow is not eaten", () => assert.ok(!arrow.removed));
check("other anacondas are never eaten", () => assert.ok(!other.removed));
check("anaconda_safe tag protects a mob", () =>
  assert.ok(!safeCow.removed && safeCow.damage === 0));
check("creative player is untouched", () =>
  assert.ok(!builder.removed && builder.damage === 0));
check("survival player in range takes damage", () =>
  assert.ok(victim.damage > 0));
check("distant mob is dragged in, not damaged", () =>
  assert.ok(faraway.knockbacks.length > 0 && faraway.damage === 0));
// Same again: 4 passes = 2 pulls per snake, and both snakes are in range.
check("pull is throttled to twice a second per snake", () =>
  assert.strictEqual(faraway.knockbacks.length, 4, `got ${faraway.knockbacks.length}`));
check("swallowing triggers the bulge animation event", () =>
  assert.ok(snake.events.includes("anaconda:ate")));
check("meals are recorded on the snake", () =>
  assert.ok(snake.getTags().some((t) => t.startsWith("anaconda_meals:"))));
check("snake heals when it eats", () =>
  assert.ok(log.some((l) => l.startsWith("heal:anaconda"))));

// Now feed it until it grows up. One chicken per pass; the nearest snake in the
// iteration order gets the meal.
function feedChickens(count) {
  for (let i = 0; i < count; i += 1) {
    spawn("minecraft:chicken", { x: 1, y: 64, z: 1 }, { health: 4, maxHealth: 4 });
    tick(1);
  }
}

snake.events.length = 0;
feedChickens(8);
check("eight meals promote a juvenile to adult", () =>
  assert.ok(snake.events.includes("anaconda:grow_adult")));
check("grown snakes stop despawning", () =>
  assert.ok(snake.events.includes("anaconda:make_persistent")));
check("stage tag follows the growth", () =>
  assert.ok(snake.getTags().includes("anaconda_stage:adult")));
check("sixteen more meals promote an adult to titan", () => {
  snake.events.length = 0;
  feedChickens(16);
  assert.ok(snake.events.includes("anaconda:grow_titan"));
  assert.ok(snake.getTags().includes("anaconda_stage:titan"));
});
check("titan never triggers a further growth event", () => {
  snake.events.length = 0;
  feedChickens(40);
  assert.ok(!snake.events.some((e) => e.startsWith("anaconda:grow")));
});

console.log(failures.length ? `\n${failures.length} failing` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
