/*
 * Headless test harness for behavior_packs/bloatgrub_bp/scripts/main.js.
 *
 * The script is loaded unmodified. A throwaway directory is built with a
 * node_modules shim so that its `import ... from "@minecraft/server"` resolves
 * to tools/sim/mock-server.js, and then the mock's tick pump drives real game
 * scenarios: carrying a grub until it wakes, being leapt on, the infestation
 * countdown, the detonation, the serum, and the awkward cases in between.
 *
 * Usage:
 *     node tools/sim/run.mjs            # run every scenario
 *     node tools/sim/run.mjs latch      # only scenarios whose name matches
 *     SIM_VERBOSE=1 node tools/sim/run.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  world,
  system,
  log,
  ItemStack,
  GameMode,
} from "./mock-server.js";

let bootWarnings = [];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SCRIPT = path.join(REPO, "behavior_packs", "bloatgrub_bp", "scripts", "main.js");

const ENTITY = "grub:bloatgrub";
const DORMANT = "grub:dormant_bloatgrub";
const JAR = "grub:grub_jar";
const SERUM = "grub:purge_serum";
const TAG = "grub_infested";

// Generous upper bound on CONFIG.carry.maxAgitationToWake x carry.intervalTicks.
const CARRY_TIMEOUT_TICKS = 6000;

/* ------------------------------------------------------------------ *
 * Load the script under test
 * ------------------------------------------------------------------ */

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bloatgrub-sim-"));
  const shim = path.join(dir, "node_modules", "@minecraft", "server");
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(
    path.join(shim, "package.json"),
    JSON.stringify({ name: "@minecraft/server", version: "1.11.0", type: "module", main: "index.js" })
  );
  fs.writeFileSync(
    path.join(shim, "index.js"),
    `export * from ${JSON.stringify(pathToFileURL(path.join(HERE, "mock-server.js")).href)};\n`
  );
  fs.copyFileSync(SCRIPT, path.join(dir, "main.js"));
  return dir;
}

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
let current = "";

function check(label, condition, detail) {
  if (condition) {
    passed++;
    if (process.env.SIM_VERBOSE) console.log(`    ok   ${label}`);
    return true;
  }
  failures.push(`${current}: ${label}${detail ? ` -- ${detail}` : ""}`);
  console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  return false;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function reset() {
  log.reset();
  for (const dimension of Object.values(world.dimensions)) {
    dimension.entities.clear();
    dimension.spawnFails = false;
  }
  world.players.length = 0;
}

function addPlayer(name, location = { x: 0, y: 64, z: 0 }, dimension = world.overworld) {
  const player = world.addPlayer(name, dimension, location);
  world.afterEvents.playerSpawn.emit({ player, initialSpawn: true });
  return player;
}

function grubsIn(dimension = world.overworld) {
  return [...dimension.entities].filter((e) => e.typeId === ENTITY);
}

function useItem(player, typeId) {
  world.afterEvents.itemUse.emit({
    source: player,
    itemStack: new ItemStack(typeId, 1),
  });
}

/** Park a grub next to a player and let the hunt loop notice and arm it. */
function plantGrub(player, distance) {
  const grub = player.dimension.spawnEntity(ENTITY, {
    x: player.location.x + distance,
    y: player.location.y,
    z: player.location.z,
  });
  system.pump(20); // longer than CONFIG.hunt.armTicks
  return grub;
}

const scenarios = [];
function scenario(name, body) {
  scenarios.push({ name, body });
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

scenario("boot", () => {
  check(
    "announces itself on load",
    bootWarnings.some((w) => w.includes("[Bloatgrub]")),
    JSON.stringify(bootWarnings)
  );
  const player = addPlayer("Boot");
  check(
    "greets a player on initial spawn",
    log.messages.some((m) => m.player === "Boot" && m.text.includes("Bloatgrub")),
    JSON.stringify(log.messages)
  );
  check("player starts clean", !player.hasTag(TAG));
});

scenario("carry-wakes-up", () => {
  const player = addPlayer("Carrier");
  player._inventory.setItem(9, new ItemStack(DORMANT, 1));

  // The carry loop ticks once a second and the wake threshold is counted in
  // those ticks, so this has to run for minutes of game time, not seconds.
  system.pump(CARRY_TIMEOUT_TICKS);
  const grubs = grubsIn();
  check("the grub let itself out", grubs.length === 1, `spawned ${grubs.length}`);
  check(
    "and ate its way out of the inventory",
    player._inventory.countOf(DORMANT) === 0,
    `still holding ${player._inventory.countOf(DORMANT)}`
  );
  check(
    "told the player about it",
    log.titles.some((t) => t.text?.includes("WOKE UP")),
    JSON.stringify(log.titles.map((t) => t.text))
  );
  check(
    "bit them along the way",
    log.damage.some((d) => d.cause === "contact"),
    "no contact damage recorded"
  );
});

scenario("carry-stack-wakes-sooner", () => {
  const solo = addPlayer("Solo", { x: 0, y: 64, z: 0 });
  const stacked = addPlayer("Stacked", { x: 200, y: 64, z: 0 });
  solo._inventory.setItem(9, new ItemStack(DORMANT, 1));
  stacked._inventory.setItem(9, new ItemStack(DORMANT, 4));

  let stackedWokeAt = -1;
  let soloWokeAt = -1;
  let stackLeftAtFirstWake = -1;
  let looseAtFirstWake = -1;
  for (let i = 0; i < CARRY_TIMEOUT_TICKS && (stackedWokeAt < 0 || soloWokeAt < 0); i++) {
    system.pump(1);
    if (stackedWokeAt < 0 && stacked._inventory.countOf(DORMANT) < 4) {
      stackedWokeAt = i;
      stackLeftAtFirstWake = stacked._inventory.countOf(DORMANT);
      looseAtFirstWake = grubsIn().length;
    }
    if (soloWokeAt < 0 && solo._inventory.countOf(DORMANT) < 1) soloWokeAt = i;
  }
  check("the stack woke", stackedWokeAt >= 0, `never woke in ${CARRY_TIMEOUT_TICKS} ticks`);
  check(
    "a stack of four wakes before a single grub",
    stackedWokeAt >= 0 && (soloWokeAt < 0 || stackedWokeAt < soloWokeAt),
    `stack ${stackedWokeAt} vs solo ${soloWokeAt}`
  );
  check(
    "only one grub of the stack came out at that moment",
    stackLeftAtFirstWake === 3,
    `left ${stackLeftAtFirstWake}`
  );
  check(
    "the rest of the stack keeps its own counsel rather than waking together",
    looseAtFirstWake === 1,
    `${looseAtFirstWake} grubs loose the moment the first one woke`
  );
});

scenario("carrying-one-hurts-but-cannot-kill", () => {
  // Regression: the carry bite used to be an unclamped 1 damage on a 12%
  // roll every second, so a grub carried until it woke had already chewed
  // its way through most of a health bar - and could finish a hurt player
  // off before anything interesting happened.
  const player = addPlayer("Chewed");
  player._inventory.setItem(9, new ItemStack(DORMANT, 4));

  let lowest = player.health.current;
  for (let i = 0; i < CARRY_TIMEOUT_TICKS; i += 20) {
    system.pump(20);
    lowest = Math.min(lowest, player.health.current);
    if (player.health.current <= 0) break;
  }
  check("the carrier is still alive", player.health.current > 0, `hp ${player.health.current}`);
  check("but it did draw blood", lowest < 20, `never dropped below ${lowest}`);
  check(
    "and it stopped short of a fatal amount",
    lowest >= 5,
    `bottomed out at ${lowest} hp`
  );
});

scenario("creative-is-immune", () => {
  const player = addPlayer("Builder");
  player.gameMode = GameMode.creative;
  player._inventory.setItem(9, new ItemStack(DORMANT, 4));

  system.pump(CARRY_TIMEOUT_TICKS);
  check("nothing woke up", grubsIn().length === 0, `${grubsIn().length} grubs`);
  check("nothing was consumed", player._inventory.countOf(DORMANT) === 4);

  // ...and a grub already loose cannot get into a creative player either.
  plantGrub(player, 1.0);
  system.pump(20);
  check("a loose grub cannot burrow into them", !player.hasTag(TAG));
});

scenario("use-releases-and-consumes", () => {
  const player = addPlayer("Releaser");
  player.hold(DORMANT, 3);

  useItem(player, DORMANT);
  check("a grub came out", grubsIn().length === 1, `${grubsIn().length} grubs`);
  check(
    "exactly one was consumed",
    player._mainhand?.amount === 2,
    `mainhand now ${JSON.stringify(player._mainhand)}`
  );
});

scenario("use-does-not-duplicate-when-hand-changed", () => {
  const player = addPlayer("Swapper");
  player.hold(DORMANT, 1);
  // The player swaps to something else between the tap and the handler.
  player._mainhand = new ItemStack("minecraft:dirt", 1);

  useItem(player, DORMANT);
  check(
    "the swapped-in item is untouched",
    player._mainhand?.typeId === "minecraft:dirt" && player._mainhand.amount === 1,
    JSON.stringify(player._mainhand)
  );
});

scenario("use-fails-cleanly-when-nothing-can-spawn", () => {
  const player = addPlayer("Blocked");
  player.hold(DORMANT, 2);
  world.overworld.spawnFails = true;

  useItem(player, DORMANT);
  check("no grub appeared", grubsIn().length === 0);
  check(
    "and the item was not eaten for nothing",
    player._mainhand?.amount === 2,
    `mainhand now ${JSON.stringify(player._mainhand)}`
  );
  check(
    "the player was told why",
    log.actionBars.some((a) => a.player === "Blocked"),
    JSON.stringify(log.actionBars)
  );
  world.overworld.spawnFails = false;
});

scenario("jar-throws-it-away-and-masks-you", () => {
  const player = addPlayer("Thrower");
  player.hold(JAR, 2);
  player.viewDirection = { x: 0, y: 0, z: 1 };

  useItem(player, JAR);
  const grubs = grubsIn();
  check("a grub came out", grubs.length === 1);
  check("one jar was used", player._mainhand?.amount === 1);
  if (grubs.length) {
    const away = grubs[0].location.z - player.location.z;
    check("it was thrown away from the thrower", away > 2, `only ${away.toFixed(2)} blocks`);
  }

  // Walk it back onto the thrower - the mask should hold it off.
  if (grubs.length) grubs[0].location = { ...player.location };
  system.pump(40);
  check("the mask kept it out", !player.hasTag(TAG));
});

scenario("leap-then-latch", () => {
  const player = addPlayer("Prey");
  const grub = plantGrub(player, 4.0);

  system.pump(8);
  check(
    "it lunged from range",
    log.events.some((e) => e.kind === "impulse" && e.id === grub.id),
    "no impulse recorded"
  );
  check("it has not got in yet", !player.hasTag(TAG));

  grub.location = { x: player.location.x + 1.0, y: player.location.y, z: player.location.z };
  system.pump(8);
  check("it burrowed in", player.hasTag(TAG));
  check("the mob is gone", !grub.isValid && grubsIn().length === 0);
  check(
    "the screen said so",
    log.titles.some((t) => t.text?.includes("INSIDE YOU")),
    JSON.stringify(log.titles.map((t) => t.text))
  );
});

scenario("infestation-runs-then-detonates", () => {
  const player = addPlayer("Host");
  const grub = plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG), "never got in");

  log.reset();
  system.pump(120); // ~6s in
  check("still alive mid-countdown", player.health.current > 0);
  check("it is hurting them from inside", log.damage.some((d) => d.cause === "magic"));
  check(
    "armour-piercing only - no plain contact damage",
    !log.damage.some((d) => d.cause === "contact"),
    JSON.stringify(log.damage)
  );
  check("a heartbeat is playing", log.sounds.length > 0);
  check("no explosion yet", log.explosions.length === 0);

  system.pump(140); // past totalTicks = 220
  check("it went off", log.explosions.length === 1, `${log.explosions.length} explosions`);
  check("the host is dead", player.health.current <= 0, `hp ${player.health.current}`);
  check(
    "the tag was cleared",
    !player.hasTag(TAG),
    "player is still marked infested after dying"
  );
  check(
    "a brood crawled out",
    grubsIn().length === 2,
    `${grubsIn().length} grubs`
  );
  check(
    "chat announced it",
    log.messages.some((m) => m.broadcast && m.text.includes("hollowed out")),
    JSON.stringify(log.messages)
  );
  check("the original mob never came back", !grub.isValid);
});

scenario("bites-never-steal-the-kill", () => {
  const player = addPlayer("Fragile");
  player.health.current = 3; // one bite would normally finish them
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  system.pump(200); // most of the countdown, but not the blast
  check(
    "still breathing on 1 hp",
    player.health.current > 0,
    `hp ${player.health.current}`
  );
  check("the blast has not happened yet", log.explosions.length === 0);
});

scenario("serum-cuts-it-out", () => {
  const player = addPlayer("Patient");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  player.hold(SERUM, 2);
  const hpBefore = player.health.current;
  useItem(player, SERUM);

  check("no longer infested", !player.hasTag(TAG));
  check("one dose used", player._mainhand?.amount === 1, JSON.stringify(player._mainhand));
  check("it cost them", player.health.current < hpBefore, `hp ${player.health.current}`);
  check("but did not kill them", player.health.current > 0);
  const ejected = grubsIn();
  check("the grub was ejected alive", ejected.length === 1, `${ejected.length} grubs`);
  check(
    "and it is enraged",
    ejected[0]?.triggered.includes("grub:enrage"),
    JSON.stringify(ejected[0]?.triggered)
  );

  log.reset();
  system.pump(400);
  check("no delayed detonation", log.explosions.length === 0);
  check("the ejected grub could not re-enter during the grace", !player.hasTag(TAG));
});

scenario("serum-tap-with-nothing-inside-costs-nothing", () => {
  const player = addPlayer("Hypochondriac");
  player.hold(SERUM, 2);
  useItem(player, SERUM);
  check(
    "the player is told nothing is wrong",
    log.actionBars.some((a) => a.text.includes("Nothing is inside you")),
    JSON.stringify(log.actionBars)
  );
  check("no grub was conjured", grubsIn().length === 0);
  check(
    "and the dose is still in their hand",
    player._mainhand?.amount === 2,
    `mainhand now ${JSON.stringify(player._mainhand)}`
  );
});

scenario("holding-the-button-does-not-eat-the-stack", () => {
  // Bedrock re-fires the use action while the touch interact button is held,
  // at roughly the item's use_duration. The guard has to outlast that or one
  // panicked press burns the whole stack.
  const player = addPlayer("Panicker");
  player.hold(DORMANT, 4);

  useItem(player, DORMANT);
  useItem(player, DORMANT); // same tick
  system.pump(12); // shorter than the longest use_duration (0.8s = 16 ticks)
  useItem(player, DORMANT);

  check(
    "only one grub came out",
    grubsIn().length === 1,
    `${grubsIn().length} grubs`
  );
  check(
    "and only one was consumed",
    player._mainhand?.amount === 3,
    `mainhand now ${JSON.stringify(player._mainhand)}`
  );
});

scenario("wake-does-not-destroy-the-item-when-nothing-can-spawn", () => {
  const player = addPlayer("Cramped");
  player._inventory.setItem(9, new ItemStack(DORMANT, 1));
  world.overworld.spawnFails = true; // no room anywhere: a one-block gap

  system.pump(CARRY_TIMEOUT_TICKS);
  check("nothing spawned", grubsIn().length === 0);
  check(
    "and the grub is still in the bag rather than gone",
    player._inventory.countOf(DORMANT) === 1,
    `${player._inventory.countOf(DORMANT)} left`
  );

  // ...and once there is room, it still comes out.
  world.overworld.spawnFails = false;
  system.pump(60);
  check("it wakes as soon as there is room", grubsIn().length === 1);
});

scenario("clearing-the-tag-really-is-the-escape-hatch", () => {
  // README tells players /tag @s remove grub_infested gets them out. It only
  // does if the countdown actually consults the tag.
  const player = addPlayer("Desperate");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  player.removeTag(TAG);
  log.reset();
  system.pump(300);
  check("no detonation", log.explosions.length === 0);
  check("still alive", player.health.current > 0, `hp ${player.health.current}`);
  check("no errors", log.warnings.length === 0, JSON.stringify(log.warnings));
});

scenario("brood-cannot-compound", () => {
  // Detonating beside your own bed used to double the population every time
  // you respawned into it.
  const player = addPlayer("Doomed");
  for (let i = 0; i < 4; i++) {
    player.dimension.spawnEntity(ENTITY, { x: player.location.x + 10 + i, y: 64, z: 0 });
  }
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  const before = grubsIn().length;
  system.pump(240);
  check("it detonated", log.explosions.length === 1);
  check(
    "but the crater hatched nothing into an already crowded area",
    grubsIn().length <= before,
    `${before} before, ${grubsIn().length} after`
  );
});

scenario("creative-release-still-finds-a-victim", () => {
  // A creative player cannot be infested, so binding the grub to them would
  // make it refuse to burrow into anybody for the whole bind window.
  const host = addPlayer("Builder", { x: 0, y: 64, z: 0 });
  host.gameMode = GameMode.creative;
  const victim = addPlayer("Friend", { x: 2, y: 64, z: 0 });
  host.hold(DORMANT, 1);

  useItem(host, DORMANT);
  check("a grub came out", grubsIn().length === 1);

  for (const grub of grubsIn()) grub.location = { ...victim.location };
  system.pump(40);
  check("it went for the one who can actually be infested", victim.hasTag(TAG));
  check("and not the creative player", !host.hasTag(TAG));
});

scenario("dying-to-something-else-robs-it", () => {
  const player = addPlayer("Unlucky");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  player.applyDamage(100, { cause: "fall" });
  check("dead", player.health.current <= 0);
  check("no longer marked", !player.hasTag(TAG));

  log.reset();
  system.pump(400);
  check("the corpse does not explode later", log.explosions.length === 0);
});

scenario("respawn-comes-back-clean", () => {
  const player = addPlayer("Revenant");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  world.afterEvents.playerSpawn.emit({ player, initialSpawn: false });
  check("respawn cleared it", !player.hasTag(TAG));

  log.reset();
  system.pump(400);
  check("and nothing detonates afterwards", log.explosions.length === 0);
});

scenario("two-players-do-not-share-state", () => {
  const victim = addPlayer("Victim", { x: 0, y: 64, z: 0 });
  const bystander = addPlayer("Bystander", { x: 60, y: 64, z: 0 });
  bystander._inventory.setItem(9, new ItemStack(DORMANT, 1));

  plantGrub(victim, 1.0);
  system.pump(8);
  check("the victim is infested", victim.hasTag(TAG));
  check("the bystander is not", !bystander.hasTag(TAG));

  system.pump(240);
  check("the victim died", victim.health.current <= 0);
  check("the bystander lived", bystander.health.current > 0);
  check("the bystander was never infested", !bystander.hasTag(TAG));
});

scenario("logout-mid-countdown-leaves-nothing-behind", () => {
  const player = addPlayer("Quitter");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  world.players = world.players.filter((p) => p !== player);
  world.afterEvents.playerLeave.emit({ playerId: player.id, playerName: player.name });

  log.reset();
  system.pump(400);
  check("no explosion for an absent player", log.explosions.length === 0);
  check("no errors were logged", log.warnings.length === 0, JSON.stringify(log.warnings));
});

scenario("dimension-change-mid-countdown", () => {
  const player = addPlayer("Traveller");
  plantGrub(player, 1.0);
  system.pump(8);
  check("infested", player.hasTag(TAG));

  player.teleport({ x: 5, y: 40, z: 5 }, { dimension: world.nether });
  system.pump(260);
  check(
    "it still went off, in the nether",
    log.explosions.length === 1,
    `${log.explosions.length} explosions`
  );
  check("the host died there", player.health.current <= 0);
  check(
    "the brood hatched in the nether, not the overworld",
    grubsIn(world.nether).length === 2 && grubsIn(world.overworld).length === 0,
    `nether ${grubsIn(world.nether).length}, overworld ${grubsIn(world.overworld).length}`
  );
});

scenario("two-grubs-arriving-together", () => {
  const player = addPlayer("Swarmed");
  const a = plantGrub(player, 1.0);
  const b = player.dimension.spawnEntity(ENTITY, { ...player.location });
  system.pump(20);

  check("the player is infested once", player.hasTag(TAG));
  const left = grubsIn().filter((g) => g.isValid).length;
  check(
    "only one grub was consumed getting in",
    left === 1,
    `${left} grubs left (a=${a.isValid}, b=${b.isValid})`
  );
});

scenario("killing-a-grub-is-noisy-but-bounded", () => {
  const player = addPlayer("Exterminator");
  const dimension = player.dimension;
  for (let i = 0; i < 6; i++) {
    dimension.spawnEntity(ENTITY, { x: 100 + i, y: 64, z: 0 });
  }
  system.pump(4);
  const before = grubsIn().length;
  for (const grub of grubsIn()) grub.kill();
  system.pump(4);

  const after = grubsIn().filter((g) => g.isValid).length;
  check(
    "death splitting cannot outpace the killing",
    after < before,
    `${before} before, ${after} after`
  );
  check("no errors", log.warnings.length === 0, JSON.stringify(log.warnings));
});

scenario("effect-volume-stays-sane", () => {
  const player = addPlayer("Metrics");
  plantGrub(player, 1.0);
  system.pump(8);
  const burrowParticles = log.particles.length;
  const burrowSounds = log.sounds.length;

  log.reset();
  system.pump(240);
  console.log(
    `      burrow: ${burrowParticles} particles / ${burrowSounds} sounds; ` +
      `countdown+blast: ${log.particles.length} particles / ${log.sounds.length} sounds ` +
      `/ ${log.commands.length} commands`
  );
  // Budgets, not guesses: these are the measured levels, with a little room.
  // The point is that adding an id to an FX or PFX group multiplies straight
  // into the per-frame emitter and voice count on a phone, and nothing else
  // would notice.
  check(
    "one burrow stays inside its particle budget",
    burrowParticles <= 24,
    `${burrowParticles} particles in one burrow`
  );
  check(
    "one burrow does not stack a chord of sounds",
    burrowSounds <= 6,
    `${burrowSounds} simultaneous-ish sounds`
  );
  check(
    "the whole 11s infestation stays inside its particle budget",
    log.particles.length <= 80,
    `${log.particles.length} particles`
  );
  check(
    "and its sound budget",
    log.sounds.length <= 40,
    `${log.sounds.length} sounds`
  );
  check(
    "and does not fire a command every tick",
    log.commands.length <= 40,
    `${log.commands.length} commands`
  );
});

scenario("idle-world-is-quiet", () => {
  addPlayer("Idle");
  log.reset();
  system.pump(400);
  check("nothing happens on its own", log.spawns.length === 0);
  check("no sounds", log.sounds.length === 0);
  check("no errors", log.warnings.length === 0, JSON.stringify(log.warnings));
});

scenario("wanderer-is-still-found-after-the-scan-idles", () => {
  // The proximity scan sleeps when no grub has been seen for a while. A grub
  // that spawned far away, or came in on a chunk load the script never saw,
  // must still be picked up by the periodic resync rather than being ignored
  // forever.
  const player = addPlayer("Unsuspecting");
  const grub = player.dimension.spawnEntity(ENTITY, { x: 400, y: 64, z: 0 });

  system.pump(600); // far longer than hunt.idleAfterTicks
  check("nothing happened while it was miles away", !player.hasTag(TAG));

  const before = log.counts.getEntities;
  system.pump(100);
  const idleRate = log.counts.getEntities - before;
  check(
    "and the scan had gone to sleep",
    idleRate <= 6,
    `${idleRate} queries over 100 idle ticks`
  );

  grub.location = { ...player.location };
  system.pump(60); // three resync windows
  check("but it is found once it arrives", player.hasTag(TAG), "never noticed");
});

scenario("scan-cost", () => {
  // The hunt loop's entity query is the one thing in here that runs forever on
  // every player, so its cost is worth a number rather than a shrug. 400 ticks
  // is 20 seconds of game time.
  const quiet = [];
  for (let i = 0; i < 3; i++) addPlayer(`Quiet${i}`, { x: i * 40, y: 64, z: 0 });
  // The script's scan gate is module state and survives reset(), so let it
  // settle past hunt.idleAfterTicks before measuring - otherwise this reports
  // whatever the previous scenario left behind.
  system.pump(400);
  log.reset();
  system.pump(400);
  quiet.push(log.counts.getEntities);
  console.log(
    `      empty world, 3 players, 20s: ${log.counts.getEntities} entity ` +
      `queries (${(log.counts.getEntities / 3 / 20).toFixed(1)} per player per second)`
  );

  reset();
  const hunted = addPlayer("Hunted");
  for (let i = 0; i < 8; i++) {
    hunted.dimension.spawnEntity(ENTITY, { x: 12 + i, y: 64, z: 0 });
  }
  log.reset();
  system.pump(400);
  console.log(
    `      8 grubs nearby, 1 player, 20s: ${log.counts.getEntities} queries, ` +
      `${log.counts.entitiesScanned} entities walked`
  );

  check(
    "an empty world barely scans at all",
    quiet[0] <= 3 * 12,
    `${quiet[0]} queries for 3 players over 20 idle seconds`
  );
  check("no errors under load", log.warnings.length === 0, JSON.stringify(log.warnings));
});

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const dir = stage();
try {
  await import(pathToFileURL(path.join(dir, "main.js")).href);
} catch (err) {
  console.error("could not load the script under test:", err);
  process.exit(1);
}
bootWarnings = [...log.warnings];

const filter = process.argv[2];
const selected = scenarios.filter((s) => !filter || s.name.includes(filter));

console.log(`\nBloatgrub simulation - ${selected.length} scenario(s)\n`);
for (const { name, body } of selected) {
  current = name;
  console.log(`  ${name}`);
  reset();
  const before = failures.length;
  try {
    body();
  } catch (err) {
    failures.push(`${name}: threw ${err?.stack ?? err}`);
    console.log(`    FAIL threw ${err?.message ?? err}`);
  }
  if (failures.length === before && !process.env.SIM_VERBOSE) {
    console.log(`    ok`);
  }
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
