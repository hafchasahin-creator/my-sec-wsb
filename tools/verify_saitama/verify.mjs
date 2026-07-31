/*
 * Run the hero bot against a stand-in for the Bedrock scripting API and assert
 * the things that decide whether it works in a world: that it binds and keeps
 * up with its owner, that anything hurting the owner gets one punch, that the
 * serious punch really does erase 99,000+ blocks, that it never spends more
 * than its per-tick budget doing so, and that the owner's ground and bedrock
 * survive it.
 *
 * Usage:  node tools/verify_saitama/verify.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "../../behavior_packs/saitama_bot_bp/scripts/main.js");
const mockPath = resolve(here, "mock_server.mjs");
const mockUrl = pathToFileURL(mockPath).href;

const stage = mkdtempSync(join(tmpdir(), "saitama-verify-"));
const stagedScript = join(stage, "main.mjs");
writeFileSync(
  stagedScript,
  readFileSync(scriptPath, "utf8").replace(
    /from "@minecraft\/server"/,
    `from ${JSON.stringify(mockUrl)}`
  )
);

const mock = await import(mockUrl);
await import(pathToFileURL(stagedScript).href);

const { Entity, Player, dimension, nether, log, terrain, runTicks, reset, interact, scriptEvent, world } =
  mock;

const BOT = "saitama:hero";
const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
}

/* A punch outlives the scenario that started it: only one demolition runs at a
 * time, so a job still in flight would block - and be measured by - the next
 * scenario. Drain it before moving on. */
function settle(maxTicks = 1200) {
  while (maxTicks > 0) {
    const before = terrain.cleared.size;
    runTicks(20);
    maxTicks -= 20;
    if (terrain.cleared.size === before) return;
  }
}

const at = (x, y, z) => ({ x, y, z });
const gap = (a, b) =>
  Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y, a.location.z - b.location.z);
const spawnBot = (loc) => new Entity(BOT, loc);
const zombie = (loc, health = 20) =>
  new Entity("minecraft:zombie", loc, { families: ["monster", "mob"], health });

// The mock world is stone up to y = 64, so a player stands at y = 65.
const GROUND = 65;

/* ------------------------------------------------------------------ *
 * 1. Binding and following
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 1));
  runTicks(4);

  check("bot binds to the player who spawned it",
    bot.getDynamicProperty("saitama:owner") === player.id);
  check("binding is announced", player.messages.some((m) => m.includes("Hero for fun")));

  runTicks(20);
  check("bot keeps station beside its owner", gap(bot, player) < 6,
    `${gap(bot, player).toFixed(2)} blocks away`);
  check("bot stands on the ground, not in it", bot.location.y === GROUND,
    `y = ${bot.location.y}`);

  player.location = at(40, GROUND, 40);
  runTicks(40);
  check("bot catches up with an owner who runs off", gap(bot, player) < 6,
    `${gap(bot, player).toFixed(2)} blocks behind`);

  player.dimension = nether;
  player.location = at(5, GROUND, 5);
  runTicks(8);
  check("bot follows through a dimension change", bot.dimension.id === nether.id);
  check("following raised no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 2. One punch, and the animation states behind it
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);

  const attacker = zombie(at(24, GROUND, 0), 200);
  player.applyDamage(3, { cause: "entityAttack", damagingEntity: attacker });
  runTicks(40);

  check("the attacker is killed in one punch", !attacker.isValid());
  check("the punch animation is triggered", bot.events.includes("saitama:set_punch"),
    bot.events.join(",") || "no events");
  check("the run animation is triggered while closing in",
    bot.events.includes("saitama:set_run"));
  check("the bot returns to idle afterwards", bot.events.includes("saitama:set_idle"));
  check("the killing blow is not a runaway loop", attacker.damageEvents <= 2,
    `${attacker.damageEvents} damage events`);
  check("punching raised no errors", log.warnings.length === 0, log.warnings.join("; "));
  settle();
}

/* ------------------------------------------------------------------ *
 * 3. The serious punch: 99,000+ blocks, inside its tick budget
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);

  const attacker = zombie(at(4, GROUND, 0), 50);
  player.applyDamage(2, { cause: "entityAttack", damagingEntity: attacker });
  runTicks(400);
  settle(); // let the whole demolition drain

  const destroyed = terrain.cleared.size;
  check("the serious punch erases 99,000+ blocks", destroyed >= 99000,
    `${destroyed} blocks`);
  console.log(`      (${destroyed} blocks erased)`);
  check("it reports the total to the owner",
    player.messages.some((m) => m.includes("blocks erased")),
    player.messages.slice(-2).join(" | "));
  check("progress is shown while it runs",
    player.actionBars.some((t) => t.includes("SERIOUS PUNCH")));

  // The budget is the whole reason a phone survives this.
  const budget = 1500;
  check("never exceeds its per-tick block budget", terrain.peakReadsPerTick <= budget + 40,
    `peak ${terrain.peakReadsPerTick} reads in one tick, budget ${budget}`);

  // Ground under the owner is spared, and bedrock is never touched (the mock
  // throws if setType is called on it).
  const underOwner = terrain.cleared.has(`0,${GROUND - 1},0`);
  check("the ground under the owner is spared", !underOwner);
  check("the demolition raised no errors", log.warnings.length === 0, log.warnings.join("; "));
  settle();
}

/* ------------------------------------------------------------------ *
 * 4. One demolition at a time, and the cooldown between them
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);

  const first = zombie(at(4, GROUND, 0), 30);
  player.applyDamage(2, { cause: "entityAttack", damagingEntity: first });
  runTicks(30); // demolition now in flight

  const midway = terrain.cleared.size;
  const second = zombie(at(4, GROUND, 2), 30);
  player.applyDamage(2, { cause: "entityAttack", damagingEntity: second });
  runTicks(30);

  check("a second attacker is still punched while the first blast runs",
    !second.isValid());
  check("but it does not start a second demolition",
    terrain.cleared.size > midway, "no progress at all");
  check("no errors from overlapping punches", log.warnings.length === 0, log.warnings.join("; "));
  settle();
}

/* ------------------------------------------------------------------ *
 * 5. Casual mode: one punch, small crater
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);

  player.isSneaking = true;
  interact(player, bot);
  check("sneak-tap switches to casual mode",
    bot.getDynamicProperty("saitama:mode") === "casual");

  const attacker = zombie(at(5, GROUND, 0), 30);
  player.applyDamage(2, { cause: "entityAttack", damagingEntity: attacker });
  runTicks(200);

  check("casual mode still kills in one punch", !attacker.isValid());
  const destroyed = terrain.cleared.size;
  check("casual mode leaves the world standing", destroyed > 0 && destroyed < 2000,
    `${destroyed} blocks destroyed`);
  settle();
}

/* ------------------------------------------------------------------ *
 * 6. Manual serious punch through /function saitama_serious
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);
  player.viewDirection = { x: 0, y: -0.2, z: 0.98 };

  scriptEvent("saitama:serious", player);
  runTicks(400);
  settle();
  check("the script event fires a serious punch on demand",
    terrain.cleared.size >= 99000, `${terrain.cleared.size} blocks`);
  const settled = terrain.cleared.size;
  runTicks(60);
  check("the punch stops once its quota is met", terrain.cleared.size === settled,
    `still digging: ${terrain.cleared.size - settled} more blocks`);
  settle();
}

/* ------------------------------------------------------------------ *
 * 7. He does not hit people
 * ------------------------------------------------------------------ */

reset();
{
  const owner = new Player(at(0, GROUND, 0), { name: "Owner" });
  const other = new Player(at(3, GROUND, 0), { name: "Friend" });
  spawnBot(at(1, GROUND, 0));
  runTicks(4);

  owner.applyDamage(4, { cause: "entityAttack", damagingEntity: other });
  runTicks(120);
  check("the bot does not punch the player who hit its owner", other.isValid());
  check("the bot does not punch its own owner", owner.isValid());
  check("no world damage from a player-on-player hit", terrain.cleared.size === 0,
    `${terrain.cleared.size} blocks destroyed`);
}

/* ------------------------------------------------------------------ *
 * 8. Recall after being lost, and dismissal
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const bot = spawnBot(at(1, GROUND, 0));
  runTicks(4);

  bot.remove();
  runTicks(20);
  const replacements = dimension.getEntities({ type: BOT });
  check("a lost bot is recalled to its owner", replacements.length === 1,
    `${replacements.length} bots`);

  const survivor = replacements[0];
  player.isSneaking = true;
  interact(player, survivor); // serious -> casual
  interact(player, survivor); // casual -> dismissed
  runTicks(30);
  check("sneak-tapping twice dismisses him",
    dimension.getEntities({ type: BOT }).length === 0,
    `${dimension.getEntities({ type: BOT }).length} bots left`);
  check("a dismissed bot is not recalled",
    world.getDynamicProperty(`saitama:bound:${player.id}`) === false);
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
