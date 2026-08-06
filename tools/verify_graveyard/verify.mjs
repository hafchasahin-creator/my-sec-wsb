/*
 * Haunt a mock graveyard and assert the things the horror depends on: that the
 * wraith is frozen for exactly as long as you can see it, that looking away is
 * what lets it close, that walls and your back count as not looking, that
 * lanterns really ward it, that dawn ends it, and that the ledger builds a
 * graveyard that registers itself.
 *
 * Usage:  node tools/verify_graveyard/verify.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "../../behavior_packs/graveyard_horror_bp/scripts/main.js");
const mockPath = resolve(here, "mock_server.mjs");
const mockUrl = pathToFileURL(mockPath).href;

const stage = mkdtempSync(join(tmpdir(), "graveyard-verify-"));
const stagedScript = join(stage, "main.mjs");
writeFileSync(
  stagedScript,
  readFileSync(scriptPath, "utf8").replace(
    /from "@minecraft\/server"/g,
    `from ${JSON.stringify(mockUrl)}`
  )
);

const mock = await import(mockUrl);
await import(pathToFileURL(stagedScript).href);

const {
  Entity, Player, dimension, log, terrain, runTicks, reset, setTime,
  useItem, breakBlock, placeBlock, buildWall, world,
} = mock;

const WRAITH = "grave:wraith";
const LEDGER = "grave:gravekeepers_ledger";
const TOMBSTONE = "grave:tombstone";
const LANTERN = "grave:grave_lantern";
const GROUND = 65;

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
}

const at = (x, y, z) => ({ x, y, z });
const gap = (a, b) =>
  Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y, a.location.z - b.location.z);
const spawnWraith = (loc) => new Entity(WRAITH, loc);

/* ------------------------------------------------------------------ *
 * 1. The rule: it does not move while you are looking
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 20));
  player.lookAt(wraith.location);

  const before = { ...wraith.location };
  runTicks(60);
  const moved = Math.hypot(
    wraith.location.x - before.x,
    wraith.location.y - before.y,
    wraith.location.z - before.z
  );
  check("watched, it does not move at all", moved < 0.001, `it moved ${moved.toFixed(3)} blocks`);
  check("watched, it stares back", wraith.events.includes("grave:set_stare"),
    wraith.events.join(",") || "no state changes");

  const watchedDistance = gap(wraith, player);
  player.lookAway();
  runTicks(60);
  check("look away and it closes in", gap(wraith, player) < watchedDistance - 3,
    `${watchedDistance.toFixed(1)} -> ${gap(wraith, player).toFixed(1)}`);
  check("unwatched, it drifts", wraith.events.includes("grave:set_drift"));
  check("no errors while stalking", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 2. What counts as looking
 * ------------------------------------------------------------------ */

reset();
{
  // Behind you is not looking, even facing the same axis.
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, -18));
  player.viewDirection = { x: 0, y: 0, z: 1 }; // facing away from it
  const before = gap(wraith, player);
  runTicks(40);
  check("something behind you is not being watched", gap(wraith, player) < before - 2,
    `${before.toFixed(1)} -> ${gap(wraith, player).toFixed(1)}`);
}

reset();
{
  // A wall between you and it means you cannot see it.
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 14));
  player.lookAt(wraith.location);
  for (let z = 6; z <= 7; z += 1) {
    for (let y = GROUND; y < GROUND + 4; y += 1) buildWall(0, y, z, 1);
  }
  const before = gap(wraith, player);
  runTicks(40);
  check("a wall in the way means you are not watching it", gap(wraith, player) < before - 2,
    `${before.toFixed(1)} -> ${gap(wraith, player).toFixed(1)}`);
}

reset();
{
  // Too far away to make out counts as unobserved.
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 80));
  player.lookAt(wraith.location);
  const before = gap(wraith, player);
  runTicks(40);
  check("beyond seeing range it still approaches", gap(wraith, player) < before - 2,
    `${before.toFixed(1)} -> ${gap(wraith, player).toFixed(1)}`);
}

/* ------------------------------------------------------------------ *
 * 3. The strike
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 2));
  player.lookAt(wraith.location);
  runTicks(40);
  check("it will not strike while you watch it", player.health === 20,
    `health ${player.health}`);

  player.lookAway();
  runTicks(40);
  check("look away at arm's length and it strikes", player.health < 20,
    `health ${player.health}`);
  check("the strike blinds you", player.effects.some((e) => e.name === "blindness"));
  check("it lunges", wraith.events.includes("grave:set_lunge"));
  runTicks(40);
  check("then it is somewhere else", gap(wraith, player) > 8,
    `${gap(wraith, player).toFixed(1)} blocks away`);
  check("striking raised no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 4. Lanterns ward it
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  placeBlock(player, LANTERN, at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 9)); // inside the ward radius, outside burn
  player.lookAway();
  const before = gap(wraith, player);
  runTicks(60);
  check("a ward stops it approaching", gap(wraith, player) >= before - 0.5,
    `${before.toFixed(1)} -> ${gap(wraith, player).toFixed(1)}`);
  check("it survives at the edge of the light", wraith.isValid());

  const close = spawnWraith(at(0, GROUND, 3)); // inside the burn radius
  runTicks(20);
  check("a ward destroys one that gets too close", !close.isValid());

  // Distance alone is a bad tell here: once the ward is gone it closes, strikes
  // and then backs off again, so the damage is what proves it got through.
  breakBlock(player, LANTERN, at(0, GROUND, 0));
  const healthBefore = player.health;
  runTicks(90);
  check("break the lantern and it reaches you", player.health < healthBefore,
    `health ${healthBefore} -> ${player.health}, now ${gap(wraith, player).toFixed(1)} away`);
}

/* ------------------------------------------------------------------ *
 * 5. Dawn
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  const wraith = spawnWraith(at(0, GROUND, 12));
  runTicks(10);
  check("it is out at night", wraith.isValid());
  setTime(2000); // morning
  runTicks(10);
  check("daylight ends it", !wraith.isValid());
}

/* ------------------------------------------------------------------ *
 * 6. The ledger builds a graveyard
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  useItem(player, LEDGER);
  runTicks(400);

  const placedTypes = [...terrain.placed.values()];
  const count = (id) => placedTypes.filter((t) => t === id).length;

  check("the ledger builds something", placedTypes.length > 500, `${placedTypes.length} blocks`);
  check("it plants tombstones", count(TOMBSTONE) >= 20, `${count(TOMBSTONE)} tombstones`);
  check("it turns the soil", count("grave:grave_soil") >= 40, `${count("grave:grave_soil")}`);
  check("it raises a crypt", count("grave:crypt_stone") >= 50, `${count("grave:crypt_stone")}`);
  check("it lights wards", count(LANTERN) >= 6, `${count(LANTERN)} lanterns`);
  check("it reports back", player.messages.some((m) => m.includes("Consecrated")),
    player.messages.join(" | "));

  const anchors = JSON.parse(world.getDynamicProperty("grave:anchors") ?? "[]");
  check("the graveyard registers itself as haunted ground", anchors.length === 1);
  const lanterns = JSON.parse(world.getDynamicProperty("grave:lanterns") ?? "[]");
  check("its lanterns are registered as wards", lanterns.length >= 6, `${lanterns.length}`);
  check("building raised no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 7. Haunting: fog, sound, and something arriving
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0));
  useItem(player, LEDGER);
  runTicks(400);
  const soundsBefore = log.sounds.length;

  runTicks(240); // a few haunt ticks at night
  check("the fog closes in on haunted ground",
    log.commands.some((c) => c.includes("fog") && c.includes("push")),
    log.commands.join(" | ") || "no commands");
  check("you hear things", log.sounds.length > soundsBefore);
  check("something comes looking for you",
    dimension.getEntities({ type: WRAITH }).length > 0,
    "no wraith spawned");

  setTime(1000); // morning
  runTicks(120);
  check("dawn lifts the fog", log.commands.some((c) => c.includes("remove")));
  check("dawn clears the graveyard", dimension.getEntities({ type: WRAITH }).length === 0);
  check("haunting raised no errors", log.warnings.length === 0, log.warnings.join("; "));
}

/* ------------------------------------------------------------------ *
 * 8. Disturbing a grave
 * ------------------------------------------------------------------ */

reset();
{
  let wraiths = 0;
  let drops = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const player = new Player(at(attempt * 200, GROUND, 0));
    const before = dimension.getEntities({ type: WRAITH }).length;
    const itemsBefore = log.items.length;
    breakBlock(player, TOMBSTONE, at(attempt * 200, GROUND, 1));
    runTicks(2);
    if (dimension.getEntities({ type: WRAITH }).length > before) wraiths += 1;
    if (log.items.length > itemsBefore) drops += 1;
  }
  check("digging up a grave sometimes wakes something", wraiths > 5, `${wraiths}/40`);
  check("and sometimes pays out", drops > 5, `${drops}/40`);
  check("every dig does one or the other", wraiths + drops === 40, `${wraiths + drops}/40`);
}

/* ------------------------------------------------------------------ *
 * 9. It only haunts consecrated ground
 * ------------------------------------------------------------------ */

reset();
{
  const player = new Player(at(0, GROUND, 0)); // no graveyard anywhere
  runTicks(240);
  check("no graveyard, no fog", !log.commands.some((c) => c.includes("push")));
  check("no graveyard, no wraiths", dimension.getEntities({ type: WRAITH }).length === 0);
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
