/*
 * Run the Tiny Parasite behaviour script against a simulated world.
 *
 * A self-replicating mob is the one thing you really do not want to debug by
 * loading it on a phone: if the population cap or the purge is broken you find
 * out when the game stops responding. This drives the whole life cycle -
 * infect, incubate, burst, spread - and checks the safety valves hold.
 *
 * Usage:  node tools/test_parasite.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const SCRIPT = path.join(repo, "behavior_packs", "Tiny_Parasite_BP", "scripts", "main.js");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "tp-test-"));
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

const { world, system, advance, testWorld } = mc;
const GROUND = 64;

const flat = (x, y, z) => {
  if (y < GROUND) return "minecraft:dirt";
  if (y === GROUND) return "minecraft:grass_block";
  return "minecraft:air";
};

const dim = mc.resetOverworld(flat);
const player = new testWorld.Player(dim, { x: 0, y: GROUND + 1, z: 0 }, "Tester");
dim.entities.push(player);

await import(path.join(sandbox, "main.js"));

/** Spawn a plain hostile-ish victim with a health component. */
function victim(x, z, typeId) {
  const v = dim.spawnEntity(typeId ?? "minecraft:cow", { x, y: GROUND + 1, z });
  v.families = ["mob", "animal"];
  return v;
}

function parasites() {
  return dim.entities.filter((e) => e.typeId === "tp:parasite" && !e.dead);
}

// ---------------------------------------------------------------------------

section("Infection");
{
  const bug = dim.spawnEntity("tp:parasite", { x: 3, y: GROUND + 1, z: 0 });
  const cow = victim(4, 0);
  advance(5);

  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: cow });

  check("host is marked infected", cow.hasTag("tp_infected"), [...cow.tags].join(","));
  check("parasite plays the lunge pose", bug.events.includes("tp:pose_lunge_event"), bug.events.join(","));
  check("parasite plays the burrow pose", bug.events.includes("tp:pose_burrow_event"));

  advance(12);
  check("parasite disappears into the host", bug.dead, "still present");

  advance(20);
  check("infection shows a countdown", cow.nameTag.includes("s"), `nameTag=${cow.nameTag}`);
  check("infection emits particles", dim.particles.length > 0, `${dim.particles.length} particles`);
}

section("Burst and spread");
{
  const before = parasites().length;
  world.messages.length = 0;
  advance(200); // past the 8 second incubation

  check("host is consumed", dim.entities.filter((e) => e.typeId === "minecraft:cow" && !e.dead).length === 0);
  check(
    "burst is announced",
    world.messages.some((m) => m.includes("burst open")),
    world.messages.join(" | ")
  );
  check("the blast does not break blocks", dim.explosions.every((e) => e.options?.breaksBlocks === false));
  check(
    "exactly two parasites crawl out",
    parasites().length === before + 2,
    `${before} -> ${parasites().length}`
  );

  const newborns = parasites();
  check("newborns start dormant", newborns.some((p) => p.events.includes("tp:born_event")));
}

section("Non-hosts are ignored");
{
  const bug = dim.spawnEntity("tp:parasite", { x: 10, y: GROUND + 1, z: 10 });
  const other = dim.spawnEntity("tp:parasite", { x: 11, y: GROUND + 1, z: 10 });
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: other });
  check("a parasite never infects another parasite", !other.hasTag("tp_infected"));

  const drop = dim.spawnItem(new mc.ItemStack("minecraft:apple", 1), { x: 12, y: GROUND + 1, z: 10 });
  drop.health = undefined; // items have no health component
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: drop });
  check("a parasite never infects a dropped item", !drop.hasTag("tp_infected"));

  // Already-infected hosts are not re-infected.
  const cow = victim(13, 10);
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: cow });
  const first = cow.hasTag("tp_infected");
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: cow });
  check("hosts are only infected once", first && cow.hasTag("tp_infected"));
  mc.fireScriptEvent("tp:purge", player);
}

section("Killing a host early");
{
  mc.resetOverworld(flat);
  dim.entities.push(player);
  const bug = dim.spawnEntity("tp:parasite", { x: 3, y: GROUND + 1, z: 0 });
  const cow = victim(4, 0);
  advance(5);
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: cow });
  advance(20);

  world.messages.length = 0;
  cow.kill(); // player cuts it down before it ripens
  advance(5);

  check(
    "an early kill still bursts",
    world.messages.some((m) => m.includes("cut down early")),
    world.messages.join(" | ")
  );
  check("but only one parasite escapes", parasites().length === 1, `${parasites().length} parasites`);
  mc.fireScriptEvent("tp:purge", player);
}

section("Population cap");
{
  mc.resetOverworld(flat);
  dim.entities.push(player);

  // Fill the dimension right up to the cap.
  for (let i = 0; i < 40; i++) dim.spawnEntity("tp:parasite", { x: i, y: GROUND + 1, z: 40 });
  const atCap = parasites().length;
  check("cap is reachable", atCap === 40, `${atCap} parasites`);

  const bug = dim.spawnEntity("tp:parasite", { x: 3, y: GROUND + 1, z: 0 });
  const cow = victim(4, 0);
  advance(5);
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: cow });
  world.messages.length = 0;
  advance(220);

  check(
    "no offspring once the cap is hit",
    parasites().length <= 41,
    `${parasites().length} parasites after the burst`
  );
  check(
    "the cap is reported to the players",
    world.messages.some((m) => m.includes("limit")),
    world.messages.join(" | ")
  );
}

section("Purge");
{
  const cow = victim(20, 20);
  cow.addTag("tp_infected");
  world.messages.length = 0;
  mc.fireScriptEvent("tp:purge", player);

  check("every parasite is removed", parasites().length === 0, `${parasites().length} left`);
  check("every host is cured", !cow.hasTag("tp_infected"));
  check(
    "the purge reports what it did",
    world.messages.some((m) => m.includes("Purged")),
    world.messages.join(" | ")
  );
}

section("Player infection and the serum");
{
  mc.resetOverworld(flat);
  dim.entities.push(player);
  player.health = { currentValue: 20, effectiveMax: 20 };
  player.actionBars.length = 0;
  player.messages.length = 0;

  const bug = dim.spawnEntity("tp:parasite", { x: 1, y: GROUND + 1, z: 0 });
  advance(5);
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: player });

  check("player is warned", player.messages.some((m) => m.includes("burrowed into you")));
  advance(60);
  check(
    "player sees a countdown on the action bar",
    player.actionBars.some((t) => t.includes("INFECTED")),
    player.actionBars.slice(-1).join("")
  );

  // Players get twice the incubation of a mob, so at 200 ticks they are safe.
  advance(140);
  check("player has not burst yet at 10s", player.hasTag("tp_infected"));

  // Cure with the serum, which must consume exactly one.
  player.container.setItem(0, new mc.ItemStack("tp:parasite_serum", 3));
  player.messages.length = 0;
  world.afterEvents.itemUse.emit({
    itemStack: { typeId: "tp:parasite_serum" },
    source: player
  });

  check("serum cures the player", !player.hasTag("tp_infected"));
  check("serum reports the cure", player.messages.some((m) => m.includes("Cured")));
  const left = player.container.getItem(0);
  check("serum consumes exactly one", left && left.amount === 2, `amount=${left ? left.amount : "gone"}`);

  advance(300);
  check("a cured player never bursts", player.health.currentValue === 20, `hp=${player.health.currentValue}`);
}

section("Player burst is survivable");
{
  mc.resetOverworld(flat);
  dim.entities.push(player);
  player.health = { currentValue: 20, effectiveMax: 20 };
  player.dead = false;

  const bug = dim.spawnEntity("tp:parasite", { x: 1, y: GROUND + 1, z: 0 });
  advance(5);
  world.afterEvents.entityHitEntity.emit({ damagingEntity: bug, hitEntity: player });
  advance(360); // past the 16 second player incubation

  check("player took heavy damage", player.health.currentValue < 20, `hp=${player.health.currentValue}`);
  check("player was not instantly killed", player.health.currentValue > 0, `hp=${player.health.currentValue}`);
  check("the infection cleared after bursting", !player.hasTag("tp_infected"));
  mc.fireScriptEvent("tp:purge", player);
}

section("Status and help");
{
  player.messages.length = 0;
  mc.fireScriptEvent("tp:status", player);
  check("status reports parasite numbers", player.messages.some((m) => m.includes("Parasites loaded")));
  check("status reports infected hosts", player.messages.some((m) => m.includes("Infected hosts")));

  player.messages.length = 0;
  mc.fireScriptEvent("tp:help", player);
  check("help lists the purge command", player.messages.some((m) => m.includes("parasite_purge")));

  player.messages.length = 0;
  world.messages.length = 0;
  mc.fireScriptEvent("tp:spawn", player);
  check("spawn command releases one", parasites().length >= 1, `${parasites().length}`);
  mc.fireScriptEvent("tp:purge", player);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("Tiny Parasite simulation OK.");
