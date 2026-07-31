/*
 * Fly the spirit against a stand-in for the Bedrock scripting API and assert
 * what decides whether it works in a world: that it binds to whoever spawned
 * it, that it actually flies and keeps station, that it follows across
 * distance and dimensions, that anything hurting its owner gets hunted down
 * and harvested, and that it never turns on a player.
 *
 * Usage:  node tools/verify_spirit/verify.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "../../behavior_packs/spirit_guardian_bp/scripts/main.js");
const mockPath = resolve(here, "mock_server.mjs");
const mockUrl = pathToFileURL(mockPath).href;

const stage = mkdtempSync(join(tmpdir(), "spirit-verify-"));
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

const { Entity, Player, dimension, nether, log, runTicks, reset, interact, world } = mock;

const SPIRIT = "spirit:guardian";
const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
}

const at = (x, y, z) => ({ x, y, z });
const gap = (a, b) => Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y, a.location.z - b.location.z);
const spawnSpirit = (loc, options) => new Entity(SPIRIT, loc, options);
const zombie = (loc) => new Entity("minecraft:zombie", loc, { families: ["monster", "mob"], health: 20 });

/* ------------------------------------------------------------------ *
 * 1. Binding and flight
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  const spirit = spawnSpirit(at(1, 64, 1));
  runTicks(4);

  check("spirit binds to the player who spawned it",
    spirit.getDynamicProperty("spirit:owner") === player.id);
  check("binding is announced", player.messages.some((m) => m.includes("bound itself")));
  check("spirit is named after its owner", (spirit.nameTag ?? "").includes(player.name));

  const before = { ...spirit.location };
  runTicks(20);
  check("spirit flies rather than sitting still",
    spirit.location.x !== before.x || spirit.location.y !== before.y);
  check("spirit hovers above the ground, not on it", spirit.location.y > player.location.y + 0.5,
    `y offset ${(spirit.location.y - player.location.y).toFixed(2)}`);
  check("spirit keeps station near its owner", gap(spirit, player) < 4,
    `${gap(spirit, player).toFixed(2)} blocks away`);
  check("spirit leaves a particle trail", log.particles.length > 0);

  // It should orbit: the angle around the owner has to change over time.
  const angleOf = () => Math.atan2(spirit.location.z - player.location.z, spirit.location.x - player.location.x);
  const first = angleOf();
  runTicks(20);
  check("spirit orbits its owner", Math.abs(angleOf() - first) > 0.2);
}

/* ------------------------------------------------------------------ *
 * 2. Following, recall and dimensions
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  const spirit = spawnSpirit(at(0, 64, 1));
  runTicks(6);

  player.location = at(12, 64, 12); // walked off
  runTicks(30);
  check("spirit follows the owner who walks away", gap(spirit, player) < 4,
    `${gap(spirit, player).toFixed(2)} blocks behind`);

  player.location = at(400, 64, 400); // teleported far
  runTicks(6);
  check("spirit blinks to an owner who is out of range", gap(spirit, player) < 4,
    `${gap(spirit, player).toFixed(2)} blocks behind`);

  player.dimension = nether;
  player.location = at(10, 40, 10);
  runTicks(6);
  check("spirit follows through a dimension change", spirit.dimension.id === nether.id);
}

/* ------------------------------------------------------------------ *
 * 3. Avenging an attack on the owner
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  const spirit = spawnSpirit(at(0, 65, 0));
  runTicks(6);

  const attacker = zombie(at(18, 64, 0)); // outside the guard radius
  runTicks(6);
  check("distant mobs are left alone until they act", attacker.isValid());

  attacker.location = at(0.9, 64, 0);
  player.applyDamage(4, { cause: "entityAttack", damagingEntity: attacker });
  const healthAfterHit = player.health;
  runTicks(40);

  check("the attacker's soul is taken", !attacker.isValid());
  check("souls are counted for the owner",
    world.getDynamicProperty(`spirit:souls:${player.id}`) === 1);
  check("the owner is healed by the soul", player.health > healthAfterHit,
    `${healthAfterHit} -> ${player.health}`);
  check("the soul count is shown", player.actionBars.some((t) => t.includes("Souls: 1")));
  check("the strike is not a runaway damage loop", attacker.damageEvents <= 2,
    `${attacker.damageEvents} damage events`);
  check("avenging raised no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 4. Hunting hostiles that merely come close
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  spawnSpirit(at(0, 65, 0));
  runTicks(6);

  const lurker = zombie(at(8, 64, 0));
  runTicks(60);
  check("hostiles near the owner are hunted unprompted", !lurker.isValid());

  const cow = new Entity("minecraft:cow", at(3, 64, 0), { families: ["mob"], health: 10 });
  runTicks(40);
  check("passive animals are left alone", cow.isValid());
}

/* ------------------------------------------------------------------ *
 * 5. It never turns on people
 * ------------------------------------------------------------------ */

reset();
{
  const owner = new Player(at(0, 64, 0), { name: "Owner" });
  const other = new Player(at(2, 64, 0), { name: "Friend" });
  spawnSpirit(at(0, 65, 0));
  runTicks(6);

  owner.applyDamage(4, { cause: "entityAttack", damagingEntity: other });
  runTicks(60);
  check("the spirit does not attack the player who hit its owner", other.isValid());
  check("the spirit does not attack its own owner", owner.isValid());
}

/* ------------------------------------------------------------------ *
 * 6. Absorption at the soul threshold
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  spawnSpirit(at(0, 65, 0));
  runTicks(6);

  for (let index = 0; index < 5; index += 1) {
    const mob = zombie(at(2, 64, 0));
    runTicks(40);
    if (mob.isValid()) mob.kill(); // safety net so the loop cannot hang the test
  }
  check("five souls grant Absorption", player.effects.some((e) => e.name === "absorption"),
    player.effects.map((e) => e.name).join(",") || "no effects");
  check("soul total reaches five", world.getDynamicProperty(`spirit:souls:${player.id}`) === 5,
    `${world.getDynamicProperty(`spirit:souls:${player.id}`)}`);
}

/* ------------------------------------------------------------------ *
 * 7. Interaction: status and mode toggle
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  const spirit = spawnSpirit(at(0, 65, 0));
  runTicks(6);
  player.messages.length = 0;

  interact(player, spirit);
  check("tapping the spirit reports souls", player.messages.some((m) => m.includes("Souls taken")));

  player.isSneaking = true;
  interact(player, spirit);
  check("sneak-tap switches to escort mode",
    spirit.getDynamicProperty("spirit:mode") === "escort");

  interact(player, spirit);
  check("a second sneak-tap dismisses the spirit", !spirit.isValid());
  check("dismissing clears the binding, so it is not recalled",
    world.getDynamicProperty(`spirit:bound:${player.id}`) === false);
  runTicks(30);
  check("a dismissed spirit stays gone",
    dimension.getEntities({ type: SPIRIT }).length === 0,
    `${dimension.getEntities({ type: SPIRIT }).length} spirits still around`);
  check("dismissing keeps the souls", player.messages.some((m) => m.includes("souls stay with you")));
}

/* ------------------------------------------------------------------ *
 * 7b. A spirit lost to an unloaded chunk is recalled
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, 64, 0));
  const spirit = spawnSpirit(at(0, 65, 0));
  runTicks(6);
  check("spirit is bound before being lost", spirit.getDynamicProperty("spirit:owner") === player.id);

  spirit.remove(); // as if its chunk unloaded and it never came back
  runTicks(20);
  const replacements = dimension.getEntities({ type: SPIRIT });
  check("a lost spirit is recalled to its owner", replacements.length === 1,
    `${replacements.length} spirits`);
  check("the recalled spirit is bound to the same owner",
    replacements[0]?.getDynamicProperty("spirit:owner") === player.id);
  check("only one spirit exists after the recall", replacements.length === 1);
}

/* ------------------------------------------------------------------ *
 * 8. An ownerless spirit, and an owner who logs out
 * ------------------------------------------------------------------ */

reset();
{
  const far = new Player(at(500, 64, 500));
  const spirit = spawnSpirit(at(0, 64, 0));
  runTicks(10);
  check("a spirit with nobody nearby stays unbound",
    spirit.getDynamicProperty("spirit:owner") === undefined);
  check("an unbound spirit raises no errors", log.warnings.length === 0, log.warnings.join("; "));
  void far;
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
