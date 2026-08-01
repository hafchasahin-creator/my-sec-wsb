/*
 * Run Builder Buddy's behaviour script against a simulated world.
 *
 * This is the check that JSON linting cannot do: it actually executes a whole
 * house build and then inspects the result, so a bad block id, a mistyped
 * block state, a wall with a hole in it or a build loop that never finishes
 * all fail here instead of on a phone.
 *
 * Usage:  node tools/test_builder_buddy.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const SCRIPT = path.join(repo, "behavior_packs", "Builder_Buddy_BP", "scripts", "main.js");

// ---------------------------------------------------------------------------
// Stage the script next to a node_modules holding the two mock modules, so its
// bare "@minecraft/server" imports resolve without touching the repo.
// ---------------------------------------------------------------------------

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bb-test-"));
const mcDir = path.join(sandbox, "node_modules", "@minecraft");
fs.mkdirSync(path.join(mcDir, "server"), { recursive: true });
fs.mkdirSync(path.join(mcDir, "server-ui"), { recursive: true });

fs.copyFileSync(path.join(here, "mock_minecraft", "server.js"), path.join(mcDir, "server", "index.js"));
fs.copyFileSync(path.join(here, "mock_minecraft", "server-ui.js"), path.join(mcDir, "server-ui", "index.js"));
for (const name of ["server", "server-ui"]) {
  fs.writeFileSync(
    path.join(mcDir, name, "package.json"),
    JSON.stringify({ name: `@minecraft/${name}`, version: "1.0.0", type: "module", main: "index.js" })
  );
}
fs.writeFileSync(path.join(sandbox, "package.json"), JSON.stringify({ type: "module" }));
fs.copyFileSync(SCRIPT, path.join(sandbox, "main.js"));

process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));

const mc = await import(path.join(mcDir, "server", "index.js"));
const ui = await import(path.join(mcDir, "server-ui", "index.js"));

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function check(label, ok, detail) {
  checks++;
  if (ok) return;
  failures++;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// Build a flat grass world and drop a player into it
// ---------------------------------------------------------------------------

const { world, system, advance, testWorld } = mc;
const dim = testWorld.overworld;

const GROUND = 64; // top solid block; y = 65 is the first air block
dim.terrain = (x, y, z) => {
  if (y < GROUND) return "minecraft:dirt";
  if (y === GROUND) return "minecraft:grass_block";
  return "minecraft:air";
};

const player = new testWorld.Player(dim, { x: 0, y: GROUND + 1, z: 0 }, "Tester");
dim.entities.push(player);

// Importing the script registers every handler and starts the companion loop.
await import(path.join(sandbox, "main.js"));

section("Companion loop");
{
  const bot = dim.spawnEntity("bb:builder_buddy", { x: 2, y: GROUND + 1, z: 2 });
  advance(30);
  check("buddy gets a health name tag", bot.nameTag.includes("40"), `nameTag=${bot.nameTag}`);
  check("buddy name tag says Builder Buddy", bot.nameTag.includes("Builder Buddy"));

  // Wander far away: the buddy should be teleported back to the player.
  bot.teleport({ x: 200, y: GROUND + 1, z: 200 }, {});
  advance(20);
  const back = Math.hypot(bot.location.x - player.location.x, bot.location.z - player.location.z);
  check("buddy teleports back when left behind", back < 5, `distance=${back.toFixed(1)}`);

  // Attacking should switch it into the attack pose and back again.
  bot.events.length = 0;
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bot, hitEntity: player });
  check("attack pose triggered", bot.events.includes("bb:pose_attack_event"), bot.events.join(","));
  advance(15);
  check("attack pose released", bot.events.includes("bb:pose_normal_event"), bot.events.join(","));

  bot.dead = true;
  dim.entities = dim.entities.filter((e) => e !== bot);
}

section("Controls");
{
  const bot = dim.spawnEntity("bb:builder_buddy", { x: 2, y: GROUND + 1, z: 2 });
  advance(10);

  mc.fireScriptEvent("bb:stay", player);
  check("stay adds the stay tag", bot.hasTag("bb_stay"), [...bot.tags].join(","));
  check("stay triggers the entity event", bot.events.includes("bb:mode_stay_event"));

  mc.fireScriptEvent("bb:follow", player);
  check("follow adds the follow tag", bot.hasTag("bb_follow"), [...bot.tags].join(","));
  check("follow clears the stay tag", !bot.hasTag("bb_stay"));

  player.messages.length = 0;
  mc.fireScriptEvent("bb:help", player);
  check("help lists the house function", player.messages.some((m) => m.includes("builder_buddy_house")));

  // The menu should offer exactly the five documented options.
  ui.shownForms.length = 0;
  mc.fireScriptEvent("bb:menu", player);
  advance(2);
  const form = ui.shownForms[0];
  check("menu opened", !!form);
  if (form) {
    const labels = form.buttons.map((b) => b.label);
    for (const want of ["Follow Me", "Stay Here", "Defend Me", "Build House", "Cancel Building"]) {
      check(`menu has "${want}"`, labels.includes(want), labels.join(", "));
    }
  }

  bot.dead = true;
  dim.entities = dim.entities.filter((e) => e !== bot);
}

// ---------------------------------------------------------------------------
// The main event: a full staged build
// ---------------------------------------------------------------------------

section("House build");

const bot = dim.spawnEntity("bb:builder_buddy", { x: 2, y: GROUND + 1, z: 2 });
advance(10);
player.messages.length = 0;
dim.writes = 0;

mc.fireScriptEvent("bb:build_house", player);

// Let the site search and every stage run to completion.
let elapsed = 0;
const LIMIT = 6000;
while (elapsed < LIMIT) {
  advance(20);
  elapsed += 20;
  if (player.messages.some((m) => m.includes("House completed!"))) break;
}

check("build finished within a reasonable time", elapsed < LIMIT, `gave up after ${elapsed} ticks`);
console.log(`  build took ~${elapsed} ticks (~${(elapsed / 20).toFixed(0)}s), ${dim.writes} blocks placed`);

const stageLines = [
  "Clearing the ground",
  "Foundation going down",
  "Walls are going up",
  "Glass in the windows",
  "Roof time",
  "Bed, chests",
  "Lanterns and torches",
  "Fence up and wheat planted"
];
for (const line of stageLines) {
  check(`stage announced: "${line}"`, player.messages.some((m) => m.includes(line)));
}
check(
  "start message matches the brief",
  player.messages.some((m) => m.includes("I'll build the house here.")),
  player.messages.join(" | ")
);
check("completion message matches the brief", player.messages.some((m) => m.includes("House completed!")));

// ---------------------------------------------------------------------------
// Inspect the finished house
// ---------------------------------------------------------------------------

// Work out where it went by finding the door.
let origin;
for (const [k, p] of dim.blocks) {
  if (p.typeId === "minecraft:oak_door" && p.states.upper_block_bit === false) {
    const [x, y, z] = k.split(",").map(Number);
    // The door sits at local (7, 0, 10).
    origin = { ox: x - 7, oy: y, oz: z - 10 };
    break;
  }
}

check("a front door was placed", !!origin);

if (origin) {
  const { ox, oy, oz } = origin;
  const at = (lx, ly, lz) => dim.getId(ox + lx, oy + ly, oz + lz);
  const count = (pred) => {
    let n = 0;
    for (const p of dim.blocks.values()) if (pred(p.typeId)) n++;
    return n;
  };

  section("Finished house");

  // Structure.
  check("upper door half above the lower one", at(7, 1, 10) === "minecraft:oak_door");
  check("stone brick foundation under the house", at(7, -1, 6) === "minecraft:stone_bricks");
  check("corner posts are logs", at(3, 0, 2) === "minecraft:oak_log");
  check("upper floor deck exists", at(7, 4, 5) === "minecraft:oak_planks");
  check("second storey walls exist", at(3, 5, 6) === "minecraft:oak_planks");
  check("upper floor windows are glazed", at(3, 6, 6) === "minecraft:glass_pane");
  check("roof apex is capped", at(7, 13, 6) === "minecraft:oak_planks");
  check("roof edges use stairs", at(2, 9, 6) === "minecraft:oak_stairs");

  // The ground floor perimeter must be solid apart from the door and windows.
  let gaps = 0;
  const openings = new Set(["minecraft:oak_door", "minecraft:glass_pane"]);
  for (let lx = 3; lx <= 11; lx++) {
    for (let lz = 2; lz <= 10; lz++) {
      const wall = lx === 3 || lx === 11 || lz === 2 || lz === 10;
      if (!wall) continue;
      for (let ly = 0; ly <= 3; ly++) {
        const id = at(lx, ly, lz);
        if (id === "minecraft:air" && !openings.has(id)) gaps++;
      }
    }
  }
  check("ground floor walls have no holes", gaps === 0, `${gaps} open wall blocks`);

  // Interior is actually hollow and stood on solid floor.
  check("ground floor interior is open", at(6, 1, 5) === "minecraft:air");
  check("upper floor interior is open", at(7, 6, 6) === "minecraft:air");
  check("the indoor table is set", at(7, 1, 6) === "minecraft:white_carpet");
  check("staircase reaches the upper floor", at(4, 3, 7) === "minecraft:oak_stairs");
  check("stairwell opening is clear", at(4, 4, 8) === "minecraft:air");

  // Everything the brief asked the finished house to contain.
  check("glass windows", count((id) => id === "minecraft:glass_pane") >= 20);
  check("bed", count((id) => id === "minecraft:bed") === 2);
  check("crafting table", count((id) => id === "minecraft:crafting_table") >= 1);
  check("furnace", count((id) => id === "minecraft:furnace") >= 1);
  check("chests", count((id) => id === "minecraft:chest") >= 2);
  check("bookshelves", count((id) => id === "minecraft:bookshelf") >= 4);
  check("torches", count((id) => id === "minecraft:torch") >= 4);
  check("lanterns", count((id) => id === "minecraft:lantern") >= 4);
  check("fence ring", count((id) => id === "minecraft:oak_fence") >= 50);
  check("fence gate", count((id) => id === "minecraft:oak_fence_gate") === 1);
  check("farm has wheat", count((id) => id === "minecraft:wheat") >= 12);
  check("farm has a water source", count((id) => id === "minecraft:water") === 1);
  check("path to the gate", at(7, -1, 13) === "minecraft:cobblestone");

  // The buddy should have been walked around the plot, not left standing still.
  const inPlot =
    bot.location.x >= ox - 2 &&
    bot.location.x <= ox + 17 &&
    bot.location.z >= oz - 2 &&
    bot.location.z <= oz + 17;
  check("buddy ended up at the build site", inPlot, JSON.stringify(bot.location));
  check("buddy played the build pose", bot.events.includes("bb:pose_build_event"));
  check("buddy celebrated at the end", bot.events.includes("bb:pose_celebrate_event"));

  // And it must not have built on the player.
  const onPlayer =
    player.location.x >= ox && player.location.x <= ox + 15 &&
    player.location.z >= oz && player.location.z <= oz + 15;
  check("house is not on top of the player", !onPlayer);
}

section("Cooldown");
{
  player.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", player);
  advance(5);
  check(
    "second build is refused while cooling down",
    player.messages.some((m) => m.includes("rest")),
    player.messages.join(" | ")
  );
}

section("Site rejection");
{
  // Flood the whole area: there is nowhere safe to build any more.
  const lake = new mc.Dimension("overworld");
  lake.terrain = (x, y, z) => {
    if (y < GROUND) return "minecraft:stone";
    if (y === GROUND) return "minecraft:water";
    return "minecraft:air";
  };
  const swimmer = new testWorld.Player(lake, { x: 0, y: GROUND + 1, z: 0 }, "Swimmer");
  lake.entities.push(swimmer);
  lake.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 1 });

  // Skip the cooldown by using a player the script has never seen build.
  advance(5);
  swimmer.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", swimmer);
  advance(200);
  check(
    "refuses to build on water",
    swimmer.messages.some((m) => m.includes("no safe")),
    swimmer.messages.join(" | ")
  );
}

{
  // Underground: solid stone overhead in every direction is a cave, not a plot.
  const cave = new mc.Dimension("overworld");
  cave.terrain = (x, y, z) => {
    if (y < 20) return "minecraft:stone";
    if (y < 24) return "minecraft:air"; // a four-block-high gallery
    return "minecraft:stone";
  };
  const spelunker = new testWorld.Player(cave, { x: 0, y: 21, z: 0 }, "Spelunker");
  cave.entities.push(spelunker);
  cave.spawnEntity("bb:builder_buddy", { x: 1, y: 21, z: 1 });
  advance(5);
  spelunker.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", spelunker);
  advance(200);
  check(
    "refuses to build in a cave",
    spelunker.messages.some((m) => m.includes("no safe")),
    spelunker.messages.join(" | ")
  );
}

{
  // Somebody already built here.
  const town = new mc.Dimension("overworld");
  town.terrain = (x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    if (y <= GROUND + 3) return "minecraft:oak_planks"; // existing buildings
    return "minecraft:air";
  };
  const settler = new testWorld.Player(town, { x: 0, y: GROUND + 1, z: 0 }, "Settler");
  town.entities.push(settler);
  town.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 1 });
  advance(5);
  settler.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", settler);
  advance(200);
  check(
    "refuses to build inside an existing structure",
    settler.messages.some((m) => m.includes("no safe")),
    settler.messages.join(" | ")
  );
}

section("Hilly but buildable ground");
{
  mc.fireScriptEvent("bb:cancel", player); // isolate from any earlier attempt
  const hills = new mc.Dimension("overworld");
  // A gentle two-block roll - well within the levelling tolerance.
  hills.terrain = (x, y, z) => {
    const top = GROUND + (Math.abs((x * 7 + z * 3) % 5) > 3 ? 2 : 0);
    if (y < top) return "minecraft:dirt";
    if (y === top) return "minecraft:grass_block";
    return "minecraft:air";
  };
  const walker = new testWorld.Player(hills, { x: 0, y: GROUND + 3, z: 0 }, "Walker");
  hills.entities.push(walker);
  hills.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 3, z: 1 });
  advance(5);
  walker.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", walker);

  let spent = 0;
  while (spent < 4000) {
    advance(20);
    spent += 20;
    if (walker.messages.some((m) => m.includes("House completed!"))) break;
  }
  check(
    "still builds on gently rolling ground",
    walker.messages.some((m) => m.includes("House completed!")),
    walker.messages.join(" | ")
  );
}

section("Death during a build");
{
  const plain = new mc.Dimension("overworld");
  plain.terrain = (x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    return "minecraft:air";
  };
  const victimOwner = new testWorld.Player(plain, { x: 0, y: GROUND + 1, z: 0 }, "Owner");
  plain.entities.push(victimOwner);
  const doomed = plain.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 1 });
  advance(5);
  victimOwner.messages.length = 0;
  mc.fireScriptEvent("bb:build_house", victimOwner);
  advance(60); // partway through the build

  doomed.dead = true;
  plain.entities = plain.entities.filter((e) => e !== doomed);
  world.messages.length = 0;
  world.afterEvents.entityDie.emit({ deadEntity: doomed });

  check(
    "death is announced",
    world.messages.some((m) => m.includes("I'm down")),
    world.messages.join(" | ")
  );
  advance(260);
  const respawned = plain.entities.filter((e) => e.typeId === "bb:builder_buddy" && !e.dead);
  check("a new buddy is summoned after death", respawned.length >= 1, `found ${respawned.length}`);

  // The abandoned job must not still be running.
  victimOwner.messages.length = 0;
  advance(200);
  check(
    "the interrupted build stopped cleanly",
    !victimOwner.messages.some((m) => m.includes("Roof time")),
    victimOwner.messages.join(" | ")
  );
}

section("Autonomous survival work");
{
  // A clearing with an oak tree and a rock outcrop next to the player.
  mc.fireScriptEvent("bb:cancel", player); // make sure nothing is still building
  const wild = mc.resetOverworld((x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    return "minecraft:air";
  });
  const woodsman = new testWorld.Player(wild, { x: 0, y: GROUND + 1, z: 0 }, "Woodsman");
  wild.entities.push(woodsman);

  // Tree at (4, z=0): trunk plus leaves so it reads as a tree, not a build.
  for (let dy = 1; dy <= 4; dy++) wild.setId(4, GROUND + dy, 0, "minecraft:oak_log", { pillar_axis: "y" });
  for (let dy = 5; dy <= 6; dy++) wild.setId(4, GROUND + dy, 0, "minecraft:oak_leaves", {});

  const worker = wild.spawnEntity("bb:builder_buddy", { x: 2, y: GROUND + 1, z: 0 });
  advance(20);

  check("work is switched on by default", worker.hasTag("bb_work"), [...worker.tags].join(","));

  woodsman.messages.length = 0;
  advance(400);

  check(
    "buddy chops wood on its own",
    woodsman.messages.some((m) => m.includes("wood")),
    woodsman.messages.slice(0, 4).join(" | ")
  );
  const logsLeft = [1, 2, 3, 4].filter(
    (dy) => wild.getId(4, GROUND + dy, 0) === "minecraft:oak_log"
  ).length;
  check("the trunk actually came down", logsLeft < 4, `${logsLeft}/4 logs still standing`);
  check(
    "buddy crafts what it gathers",
    woodsman.messages.some((m) => m.includes("Crafted")),
    woodsman.messages.slice(0, 8).join(" | ")
  );
  check("buddy plays the build pose while working", worker.events.includes("bb:work_start_event"));
  check("buddy hands control back after a task", worker.events.includes("bb:work_end_event"));

  // Handing supplies over should put real items in the player's inventory.
  woodsman.messages.length = 0;
  mc.fireScriptEvent("bb:give", woodsman);
  check(
    "buddy hands supplies over",
    woodsman.messages.some((m) => m.includes("Here you go")),
    woodsman.messages.join(" | ")
  );
  check("items landed in the inventory", woodsman.container.items.length > 0);
  const stacks = woodsman.container.items;
  check("no stack exceeds 64", stacks.every((s) => s.amount <= 64));

  // Status readout.
  woodsman.messages.length = 0;
  mc.fireScriptEvent("bb:status", woodsman);
  check("status reports the work mode", woodsman.messages.some((m) => m.includes("Work:")));
  check("status reports the pack", woodsman.messages.some((m) => m.includes("Pack:")));

  // The toggle has to actually stop the work.
  mc.fireScriptEvent("bb:work", woodsman);
  check("work can be switched off", !worker.hasTag("bb_work"));
  const before = wild.writes;
  advance(300);
  check("no work happens once switched off", wild.writes === before, `${wild.writes - before} blocks changed`);
}

section("The buddy leaves your builds alone");
{
  const town = mc.resetOverworld((x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    return "minecraft:air";
  });
  const builder = new testWorld.Player(town, { x: 0, y: GROUND + 1, z: 0 }, "Builder");
  town.entities.push(builder);

  // A player-built log cabin wall: logs, but no leaves above.
  for (let dx = 2; dx <= 5; dx++) {
    for (let dy = 1; dy <= 3; dy++) {
      town.setId(dx, GROUND + dy, 2, "minecraft:oak_log", { pillar_axis: "y" });
    }
  }
  // And a plank floor, which must never be mined.
  for (let dx = 2; dx <= 5; dx++) town.setId(dx, GROUND, 3, "minecraft:oak_planks", {});

  town.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 2 });
  advance(500);

  let logs = 0;
  for (let dx = 2; dx <= 5; dx++) {
    for (let dy = 1; dy <= 3; dy++) {
      if (town.getId(dx, GROUND + dy, 2) === "minecraft:oak_log") logs++;
    }
  }
  check("bare logs with no leaves are left standing", logs === 12, `${logs}/12 left`);

  let planks = 0;
  for (let dx = 2; dx <= 5; dx++) if (town.getId(dx, GROUND, 3) === "minecraft:oak_planks") planks++;
  check("player-placed planks are never mined", planks === 4, `${planks}/4 left`);
}

section("Lighting up after dark");
{
  const dusk = mc.resetOverworld((x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    return "minecraft:air";
  });
  const camper = new testWorld.Player(dusk, { x: 0, y: GROUND + 1, z: 0 }, "Camper");
  dusk.entities.push(camper);
  dusk.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 1 });

  // Drop torches at its feet - it should pocket them, then use one after dark.
  dusk.spawnItem(new mc.ItemStack("minecraft:torch", 16), { x: 1, y: GROUND + 1, z: 1 });
  advance(40);
  check("buddy pockets useful drops", camper.messages.some((m) => m.includes("Picked up")));

  world.timeOfDay = 15000; // night
  camper.messages.length = 0;
  advance(400);
  world.timeOfDay = 6000;

  let torches = 0;
  for (const p of dusk.blocks.values()) if (p.typeId === "minecraft:torch") torches++;
  check(
    "buddy lights the area up at night",
    torches > 0 || camper.messages.some((m) => m.includes("torch")),
    `${torches} torches, msgs: ${camper.messages.slice(0, 3).join(" | ")}`
  );
}

section("Emergency night shelter");
{
  const night = mc.resetOverworld((x, y, z) => {
    if (y < GROUND) return "minecraft:dirt";
    if (y === GROUND) return "minecraft:grass_block";
    return "minecraft:air";
  });
  const lost = new testWorld.Player(night, { x: 0, y: GROUND + 1, z: 0 }, "Lost");
  night.entities.push(lost);
  night.spawnEntity("bb:builder_buddy", { x: 1, y: GROUND + 1, z: 1 });

  // Hand it a pile of logs; it should craft them up into planks.
  for (let i = 0; i < 5; i++) {
    night.spawnItem(new mc.ItemStack("minecraft:oak_log", 64), { x: 1, y: GROUND + 1, z: 1 });
  }

  world.timeOfDay = 15000;
  lost.messages.length = 0;
  advance(1500);
  world.timeOfDay = 6000;

  check(
    "buddy throws up a shelter after dark",
    lost.messages.some((m) => m.includes("shelter")),
    lost.messages.slice(0, 6).join(" | ")
  );

  let doors = 0;
  let walls = 0;
  for (const p of night.blocks.values()) {
    if (p.typeId === "minecraft:oak_door") doors++;
    if (p.typeId === "minecraft:oak_planks") walls++;
  }
  check("the shelter has a door", doors === 2, `${doors} door halves`);
  check("the shelter has walls and a roof", walls > 40, `${walls} planks placed`);
}

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("Builder Buddy simulation OK.");
