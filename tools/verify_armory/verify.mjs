/*
 * Run the armoury against a stand-in for the Bedrock scripting API and assert
 * the things that decide whether these weapons actually work in a world:
 * that one hit kills anything regardless of health, that our own fatal damage
 * cannot recurse back into the kill handler, that every ability fires, emits
 * particles and clears its targets, and that cooldowns gate the abilities.
 *
 * Usage:  node tools/verify_armory/verify.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "../../behavior_packs/onetap_armory_bp/scripts/main.js");
const mockPath = resolve(here, "mock_server.mjs");
const mockUrl = pathToFileURL(mockPath).href;

// main.js imports "@minecraft/server" by name. Rather than plant a node_modules
// tree in the repo, point a throwaway copy of it at the mock instead.
const stage = mkdtempSync(join(tmpdir(), "onetap-verify-"));
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

const { Entity, Player, dimension, log, runTicks, meleeHit, useItem, reset } = mock;

const WEAPONS = {
  reaper: "onetap:reapers_edge",
  lance: "onetap:void_lance",
  hammer: "onetap:judgment_hammer",
  dagger: "onetap:whisper_dagger",
  cannon: "onetap:doom_cannon",
};

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
}

const at = (x, y, z) => ({ x, y, z });

/* ------------------------------------------------------------------ *
 * 1. One tap kills anything, however much health it has
 * ------------------------------------------------------------------ */

for (const [label, weapon] of Object.entries(WEAPONS)) {
  reset();
  const player = new Player(at(0, 10, 0), { held: weapon });
  // Health well past an Ender Dragon (200) and a Wither (600).
  const boss = new Entity("minecraft:wither", at(1, 10, 0), 100000);
  meleeHit(player, boss);
  runTicks(3);
  check(`${label}: one hit kills a 100000 hp mob`, !boss.isValid(),
    `health left ${boss.health}, kill() called ${boss.killCalls}x`);
}

/* ------------------------------------------------------------------ *
 * 2. Our own fatal damage must not recurse back into the handler
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 10, 0), { held: WEAPONS.reaper });
  const mob = new Entity("minecraft:zombie", at(1, 10, 0), 20);
  meleeHit(player, mob);
  runTicks(3);
  // One swing = the game's own damage event, plus at most our single finisher.
  check("kill does not loop back through entityHurt", mob.damageEvents <= 2,
    `${mob.damageEvents} damage events on one swing`);
  check("no warnings logged during a kill", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 3. The wielder, and creative players, are never the victim
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 10, 0), { held: WEAPONS.hammer });
  const creative = new Player(at(2, 10, 0), { gameMode: "creative" });
  const survival = new Player(at(3, 10, 0), { gameMode: "survival" });
  useItem(player, WEAPONS.hammer);
  runTicks(20);
  check("the wielder survives their own ability", player.isValid());
  check("creative players are not killed", creative.isValid());
  check("survival players are killed when killPlayers is on", !survival.isValid());
}

/* ------------------------------------------------------------------ *
 * 4. Every ability fires, animates and clears its targets
 * ------------------------------------------------------------------ */

function abilityCase(label, weapon, place, ticks = 40) {
  reset();
  const player = new Player(at(0, 10, 0), { held: weapon });
  const targets = place(player);
  const particlesBefore = log.particles.length;
  useItem(player, weapon);
  runTicks(ticks);

  const alive = targets.filter((t) => t.isValid());
  const particles = log.particles.length - particlesBefore;
  check(`${label}: clears its targets`, alive.length === 0, `${alive.length} still alive`);
  check(`${label}: plays an animation`, particles > 20, `${particles} particles`);
  check(`${label}: reports back to the player`, player.messages.length > 0);
  check(`${label}: raised no errors`, log.warnings.length === 0, log.warnings.join("; "));
  return player;
}

// Soul Harvest: a ring of mobs at increasing distance, all inside radius 14.
abilityCase("soul harvest", WEAPONS.reaper, () =>
  [3, 7, 11, 13].map((d, i) => new Entity("minecraft:zombie", at(d, 10, i), 40))
);

// Void Beam: mobs strung out along +Z, which is where the mock player looks.
abilityCase("void beam", WEAPONS.lance, (p) =>
  [6, 18, 33, 45].map((d) => new Entity("minecraft:skeleton", at(p.location.x, p.location.y + 1.6, d), 60))
);

// Judgment Slam: everything on the ground around the player.
abilityCase("judgment slam", WEAPONS.hammer, () =>
  [2, 6, 10, 15].map((d) => new Entity("minecraft:creeper", at(d, 10, 0), 40))
);

// Shadow Step: whatever the player is looking at.
{
  reset();
  const player = new Player(at(0, 10, 0), { held: WEAPONS.dagger });
  const mark = new Entity("minecraft:enderman", at(0, 10, 25), 200);
  player.viewTargets = [mark];
  useItem(player, WEAPONS.dagger);
  runTicks(20);
  check("shadow step: kills the marked target", !mark.isValid());
  check("shadow step: blinks the player to it", player.teleports.length === 1,
    `${player.teleports.length} teleports`);
  check("shadow step: grants invisibility", player.effects.some((e) => e.name === "invisibility"));
}

// Doom Cannon: detonates on the first thing in the line and takes the rest with it.
abilityCase("doom cannon", WEAPONS.cannon, (p) => [
  new Entity("minecraft:ravager", at(p.location.x, p.location.y + 1.6, 20), 100),
  new Entity("minecraft:ravager", at(p.location.x + 3, p.location.y + 1.6, 21), 100),
]);

/* ------------------------------------------------------------------ *
 * 5. Abilities with nothing to hit still behave
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 10, 0), { held: WEAPONS.dagger });
  useItem(player, WEAPONS.dagger);
  runTicks(10);
  check("shadow step with no target says so", player.messages.length === 1, player.messages.join("|"));
  check("empty ability raises no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 6. Cooldowns gate the abilities
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 10, 0), { held: WEAPONS.cannon });
  const first = new Entity("minecraft:pig", at(0, 11.6, 15), 10);
  useItem(player, WEAPONS.cannon);
  runTicks(20);
  const second = new Entity("minecraft:pig", at(0, 11.6, 15), 10);
  useItem(player, WEAPONS.cannon);
  runTicks(20);
  check("first use fires", !first.isValid());
  check("second use is blocked by the cooldown", second.isValid());
  check("cooldown is shown on the action bar", player.actionBars.some((t) => t.includes("Ready in")));
}

/* ------------------------------------------------------------------ *
 * 7. A single tap cannot double-fire through itemUse + itemUseOn
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 10, 0), { held: WEAPONS.lance });
  const { handlers } = mock;
  const event = { source: player, itemStack: { typeId: WEAPONS.lance } };
  for (const handler of handlers.itemUse) handler(event);
  for (const handler of handlers.itemUseOn) handler(event);
  runTicks(30);
  const beamMessages = player.messages.filter((m) => m.includes("Void Beam"));
  check("one tap fires the ability exactly once", beamMessages.length === 1,
    `${beamMessages.length} beams`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
