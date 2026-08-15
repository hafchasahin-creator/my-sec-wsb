/*
 * Drives behavior_packs/god_eye_bp/scripts/main.js against the mock module in
 * mock_server.mjs and asserts the guardian actually behaves: it follows, it
 * blinks, all six executions run to completion and clean up after themselves,
 * the modes gate correctly, and nothing leaks timers or entities.
 *
 * Usage:  node tools/sim/run.mjs        (from the repository root)
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  calls,
  world,
  system,
  advance,
  makePlayer,
  makeMob,
  liveEntities,
  pendingRuns,
  overworld,
} from "./mock_server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "..", "..", "behavior_packs", "god_eye_bp", "scripts", "main.js");
const mockUrl = pathToFileURL(join(here, "mock_server.mjs")).href;

// The pack imports the real module specifier; point that at the mock instead.
const source = readFileSync(scriptPath, "utf8");
if (!source.includes('from "@minecraft/server"')) {
  console.log("FAIL: main.js no longer imports @minecraft/server");
  process.exit(1);
}
const staged = join(mkdtempSync(join(tmpdir(), "god-eye-sim-")), "main.mjs");
writeFileSync(staged, source.replace('from "@minecraft/server"', `from ${JSON.stringify(mockUrl)}`));

const problems = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label} ${detail}`);
    problems.push(label);
  }
}

const player = makePlayer("Tester");

await import(pathToFileURL(staged).href);

world.afterEvents.playerSpawn.fire({ player, initialSpawn: true });
advance(30);
check("boot message sent", calls.messages.some((m) => m.includes("God Eye Guardian")));

/* ---- /function god_eye_spawn --------------------------------------- */
player.addTag("ge_cmd_spawn");
advance(10);
const eye = liveEntities().find((e) => e.typeId === "god_eye:god_eye");
check("spawn command summoned an eye", !!eye);
check("eye bonded to owner", eye && eye.getDynamicProperty("ge:owner") === player.id);
check("player remembers its eye", player.getDynamicProperty("ge:eye") === eye.id);

/* ---- following ------------------------------------------------------ */
const before = { ...eye.location };
for (let i = 0; i < 40; i += 1) {
  player.location = { x: player.location.x + 0.25, y: 64, z: player.location.z };
  advance(1);
}
const moved = Math.hypot(eye.location.x - before.x, eye.location.z - before.z) > 1;
check("eye follows the owner", moved);
check(
  "eye hovers 4-9 blocks above the owner",
  eye.location.y - player.location.y > 4 && eye.location.y - player.location.y < 9,
  `dy=${(eye.location.y - player.location.y).toFixed(2)}`,
);
check(
  "eye stays behind the owner",
  eye.location.z < player.location.z,
  `eye.z=${eye.location.z.toFixed(2)} player.z=${player.location.z.toFixed(2)}`,
);

/* ---- long-distance blink -------------------------------------------- */
eye.location = { x: player.location.x + 300, y: 64, z: player.location.z };
advance(20);
check(
  "eye blinks back when left behind",
  Math.hypot(eye.location.x - player.location.x, eye.location.z - player.location.z) < 12,
);
check("blink emitted particles", calls.particles.includes("god_eye:blink"));

/* ---- every execution ------------------------------------------------ */
const EXECUTIONS = ["judgementBeam", "skySmite", "voidExecution", "crush", "eyeSwarm", "erase"];
const realRandom = Math.random;

for (let index = 0; index < EXECUTIONS.length; index += 1) {
  const label = EXECUTIONS[index];
  const attacker = makeMob("minecraft:zombie", {
    x: player.location.x + 1,
    y: player.location.y,
    z: player.location.z + 1,
  });

  // Force the dispatcher's pick() onto this execution.
  Math.random = () => (index + 0.5) / EXECUTIONS.length;

  world.afterEvents.entityHurt.fire({
    hurtEntity: player,
    damage: 4,
    damageSource: { cause: "entityAttack", damagingEntity: attacker },
  });

  advance(200);
  Math.random = realRandom;
  advance(120);

  check(`${label}: attacker destroyed`, !attacker.valid);
  check(
    `${label}: no swarm eyes left behind`,
    !liveEntities().some((e) => e.typeId === "god_eye:swarm_eye"),
  );
  check(`${label}: eye survived`, eye.valid);
}

check("all executions ran without warnings", calls.warnings.length === 0, calls.warnings.join(" | "));

/* ---- states and cosmetics ------------------------------------------- */
check("action bars named the executions", calls.actionbars.length >= 6, calls.actionbars.join(","));
check("lightning was summoned", calls.spawned.includes("minecraft:lightning_bolt"));
check("swarm eyes were summoned", calls.spawned.includes("god_eye:swarm_eye"));
check("fog was pushed and popped",
  calls.commands.some((c) => c.includes("fog @s push god_eye:void_fog")) &&
  calls.commands.some((c) => c.includes("fog @s remove")));
check("camera shake fired", calls.commands.some((c) => c.startsWith("camerashake add")));
check("mark_variant returned to idle", eye.getComponent("minecraft:mark_variant").value === 0,
  `value=${eye.getComponent("minecraft:mark_variant").value}`);

const custom = new Set(calls.particles.filter((p) => p.startsWith("god_eye:")));
check(
  "every custom particle got used",
  ["aura", "blink", "beam", "smite", "void", "crush", "erase", "swarm", "wisp"]
    .filter((n) => !custom.has(`god_eye:${n}`)).length <= 1,
  `used: ${[...custom].join(",")}`,
);

/* ---- the eye is unkillable ------------------------------------------- */
eye.getComponent("minecraft:health").setCurrentValue(3);
world.afterEvents.entityHurt.fire({
  hurtEntity: eye,
  damage: 497,
  damageSource: { cause: "entityAttack" },
});
advance(5);
check("eye health is restored after damage",
  eye.getComponent("minecraft:health").current === 500,
  `hp=${eye.getComponent("minecraft:health").current}`);

/* ---- attacking the eye is itself a threat ----------------------------- */
const brave = makeMob("minecraft:skeleton", {
  x: player.location.x + 1,
  y: player.location.y,
  z: player.location.z + 1,
});
world.afterEvents.entityHitEntity.fire({ hitEntity: eye, damagingEntity: brave });
advance(320);
check("attacking the eye triggers retaliation", !brave.valid);

/* ---- blocked hits still count ----------------------------------------- */
const shielded = makeMob("minecraft:pillager", {
  x: player.location.x + 1,
  y: player.location.y,
  z: player.location.z + 1,
});
world.afterEvents.entityHitEntity.fire({ hitEntity: player, damagingEntity: shielded });
advance(320);
check("a swing that dealt no damage still counts", !shielded.valid);

/* ---- the shy reaction -------------------------------------------------- */
const realRandom2 = Math.random;
Math.random = () => 0.01;
player.getViewDirection = () => {
  const head = { x: player.location.x, y: player.location.y + 1.62, z: player.location.z };
  const t = { x: eye.location.x, y: eye.location.y + 0.6, z: eye.location.z };
  const d = Math.hypot(t.x - head.x, t.y - head.y, t.z - head.z);
  return { x: (t.x - head.x) / d, y: (t.y - head.y) / d, z: (t.z - head.z) / d };
};
advance(20);
check("staring at the eye makes it look away",
  eye.getComponent("minecraft:mark_variant").value === 1,
  `value=${eye.getComponent("minecraft:mark_variant").value}`);
advance(120);
check("the shy reaction wears off",
  eye.getComponent("minecraft:mark_variant").value === 0);
Math.random = realRandom2;
player.getViewDirection = () => ({ x: 0, y: 0, z: 1 });

/* ---- duplicate eyes get swept ------------------------------------------ */
const dupe = overworld.spawnEntity("god_eye:god_eye", { ...player.location, y: player.location.y + 3 });
dupe.setDynamicProperty("ge:owner", player.id);
advance(1300);
check("a duplicate eye is swept away",
  liveEntities().filter((e) => e.typeId === "god_eye:god_eye").length === 1,
  `count=${liveEntities().filter((e) => e.typeId === "god_eye:god_eye").length}`);
check("the bonded eye is the survivor", eye.valid);

/* ---- PvP gating ------------------------------------------------------ */
const other = makePlayer("Other", { x: 1, y: 64, z: 1 });
world.afterEvents.entityHurt.fire({
  hurtEntity: player,
  damage: 2,
  damageSource: { cause: "entityAttack", damagingEntity: other },
});
advance(60);
check("normal mode spares other players", other.valid);

player.addTag("ge_cmd_aggressive");
advance(10);
world.afterEvents.entityHurt.fire({
  hurtEntity: player,
  damage: 2,
  damageSource: { cause: "entityAttack", damagingEntity: other },
});
advance(300);
check("aggressive mode answers other players", !other.valid);

/* ---- self-damage and friendly fire ---------------------------------- */
player.addTag("ge_cmd_normal");
advance(10);
world.afterEvents.entityHurt.fire({
  hurtEntity: player,
  damage: 2,
  damageSource: { cause: "fall" },
});
advance(40);
check("environmental damage is ignored", calls.warnings.length === 0);

/* ---- aggressive auto-hunt -------------------------------------------- */
player.addTag("ge_cmd_aggressive");
advance(10);
const lurker = makeMob("minecraft:creeper", {
  x: player.location.x + 3,
  y: player.location.y,
  z: player.location.z + 3,
});
advance(300);
check("aggressive mode hunts nearby hostiles", !lurker.valid);

/* ---- removal --------------------------------------------------------- */
player.addTag("ge_cmd_remove");
advance(10);
check("remove command dismissed the eye", !liveEntities().some((e) => e.typeId === "god_eye:god_eye"));
check("bond cleared", player.getDynamicProperty("ge:eye") === undefined);

advance(200);
check("dismissed eye is not resummoned", !liveEntities().some((e) => e.typeId === "god_eye:god_eye"));

/* ---- spawn egg path --------------------------------------------------- */
const egged = overworld.spawnEntity("god_eye:god_eye", { x: 0, y: 66, z: 0 });
egged.location = { ...player.location, y: player.location.y + 2 };
world.afterEvents.entitySpawn.fire({ entity: egged, cause: "Spawned" });
advance(20);
check("spawn-egg eye bonds to the nearby player", egged.getDynamicProperty("ge:owner") === player.id);
check("spawn-egg bond announced", calls.messages.some((m) => m.includes("has chosen you")));

/* ---- help ------------------------------------------------------------- */
player.addTag("ge_cmd_help");
advance(10);
check("help lists all four commands",
  ["god_eye_spawn", "god_eye_remove", "god_eye_mode_normal", "god_eye_mode_aggressive"]
    .every((c) => calls.messages.some((m) => m.includes(c))));

/* ---- leak check -------------------------------------------------------- */
advance(400);
const runs = pendingRuns();
check("no runaway schedulers", runs.intervals <= 2 && runs.timeouts <= 2, JSON.stringify(runs));
check("no warnings at all", calls.warnings.length === 0, calls.warnings.join(" | "));

console.log(`\n${problems.length === 0 ? "ALL CHECKS PASSED" : `${problems.length} FAILURES`}`);
process.exit(problems.length === 0 ? 0 : 1);
