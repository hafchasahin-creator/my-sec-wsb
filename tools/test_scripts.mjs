/*
 * Runs behavior_packs/bodyguard_bp/scripts/main.js against a stand-in for the
 * Bedrock 1.21.0 scripting API and drives it through the flows a player would
 * actually perform.
 *
 * This is where script bugs are meant to surface: a typo'd entity event, a
 * knockback vector that comes out NaN, a form that never resolves, an event
 * handler that throws on a dead entity, or an entity search that runs far more
 * often than the mobile budget allows.
 *
 * Usage:  node tools/test_scripts.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

// --- stage a sandbox where "@minecraft/server" resolves to the mock ---------
const sandbox = mkdtempSync(join(tmpdir(), "bodyguard-test-"));
for (const [name, file] of [
  ["server", "minecraft-server.mjs"],
  ["server-ui", "minecraft-server-ui.mjs"],
]) {
  const dir = join(sandbox, "node_modules", "@minecraft", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@minecraft/${name}`, version: "1.0.0", type: "module", main: "index.mjs" }));
  copyFileSync(join(here, "mock", file), join(dir, "index.mjs"));
}
writeFileSync(join(sandbox, "package.json"), JSON.stringify({ type: "module" }));
copyFileSync(join(repo, "behavior_packs/bodyguard_bp/scripts/main.js"), join(sandbox, "main.mjs"));

const mock = await import(pathToFileURL(join(sandbox, "node_modules/@minecraft/server/index.mjs")).href);
const ui = await import(pathToFileURL(join(sandbox, "node_modules/@minecraft/server-ui/index.mjs")).href);

// Teach the mock every event the real entity definition declares, so a
// triggerEvent typo in the script throws here.
const entityJson = JSON.parse(
  readFileSync(join(repo, "behavior_packs/bodyguard_bp/entities/bodyguard.json"), "utf8")
);
mock.loadKnownEvents(Object.keys(entityJson["minecraft:entity"].events));

const { world, system, stats, Player, Entity, ItemStack, EquipmentSlot, GameMode } = mock;

// --- test harness ----------------------------------------------------------
/**
 * Advance the simulated clock and then let promise callbacks run.  Form
 * responses arrive through .then(), so a purely synchronous tick loop would
 * never observe them.
 */
async function advance(ticks) {
  system.advance(ticks);
  for (let i = 0; i < 4; i++) {
    await new Promise((done) => setTimeout(done, 0));
    system.advance(1);
  }
}

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label + (detail ? " -- " + detail : ""));
  return false;
}

function noErrors(label) {
  const found = stats.errors.splice(0, stats.errors.length);
  return check(label + ": no exceptions", found.length === 0, found.map((e) => e.error).join("\n"));
}

function spawnPlayer(name, dimension, location) {
  const player = new Player(name, dimension, location);
  world._entities.set(player.id, player);
  return player;
}

function spawnHostile(dimension, location, typeId = "minecraft:zombie") {
  const mob = new Entity(typeId, dimension, location);
  mob._families = ["monster", "mob", "zombie", "undead"];
  world._entities.set(mob.id, mob);
  return mob;
}

// --- boot ------------------------------------------------------------------
await import(pathToFileURL(join(sandbox, "main.mjs")).href);
await advance(1);
noErrors("module load");

const overworld = world.getDimension("minecraft:overworld");
const nether = world.getDimension("minecraft:nether");
const owner = spawnPlayer("Ripley", overworld, { x: 0, y: 64, z: 0 });
const stranger = spawnPlayer("Burke", overworld, { x: 3, y: 64, z: 0 });

world.afterEvents.playerSpawn._fire({ player: owner, initialSpawn: true });
await advance(2);
check("greeting is sent on first spawn", stats.messages.some((m) => m.name === "Ripley" && /Bodyguard/.test(m.text)));

// --- summoning -------------------------------------------------------------
const contract = new ItemStack("bg:contract");
world.afterEvents.itemUseOn._fire({
  source: owner,
  itemStack: contract,
  block: { location: { x: 2, y: 64, z: 2 } },
  blockFace: "Up",
});
await advance(2);

let recruits = overworld.getEntities({ type: "bg:bodyguard" });
check("Contract on a block summons a recruit", recruits.length === 1, "got " + recruits.length);
noErrors("summon");

// A second press inside the de-duplication window must not double-summon.
world.afterEvents.itemUseOn._fire({
  source: owner,
  itemStack: contract,
  block: { location: { x: 2, y: 64, z: 2 } },
  blockFace: "Up",
});
await advance(2);
check(
  "a repeated press does not double-summon",
  overworld.getEntities({ type: "bg:bodyguard" }).length === 1
);

const guard = recruits[0];

// --- hiring ----------------------------------------------------------------
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:on_bind" });
await advance(3);
noErrors("hire");
check("owner is recorded by name", guard.getDynamicProperty("bg:ownerName") === "Ripley");
check("owner id is recorded", guard.getDynamicProperty("bg:ownerId") === owner.id);
check("starts in FOLLOW", guard.getDynamicProperty("bg:mode") === 0);
check("name badge shows the mode", /FOLLOW/.test(guard.nameTag), guard.nameTag);
check("hiring plays the oath particle", stats.particles.some((p) => p.id === "bg:oath_seal"));

// --- the command panel -----------------------------------------------------
await advance(15); // clear the input de-duplication windows
ui.resetForms();
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(2);
check("panel opened for the owner", ui.forms.shown.length === 1, JSON.stringify(ui.forms.shown));
const panel = ui.forms.shown[0];
check(
  "panel has five modes plus five actions",
  panel && panel.buttons.length === 9,
  panel ? String(panel.buttons.length) : "no panel"
);
check("panel is addressed to the owner", panel && panel.player === "Ripley");

// A non-owner must be refused.
await advance(15);
ui.resetForms();
stats.actionBars.length = 0;
owner.location = { x: 60, y: 64, z: 60 };
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(2);
check("a stranger cannot command someone else's bodyguard", ui.forms.shown.length === 0);
check(
  "the stranger is told why",
  stats.actionBars.some((a) => a.name === "Burke" && /only takes orders/.test(a.text))
);
owner.location = { x: 2, y: 64, z: 2 };
stranger.location = { x: 40, y: 64, z: 40 };

// --- switching modes -------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 1); // STAY
stats.triggered.length = 0;
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(4);
noErrors("mode switch");
check("STAY triggers the right entity event", stats.triggered.some((t) => t.event === "bg:set_stay"));
check("STAY records an anchor", !!guard.getDynamicProperty("bg:anchor"));
check("mode is persisted", guard.getDynamicProperty("bg:mode") === 1);
check("name badge updates", /STAY/.test(guard.nameTag), guard.nameTag);

// Back to FOLLOW for the rest of the run.
await advance(15);
ui.resetForms();
ui.answer("action", 0);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(4);
check("back to FOLLOW", guard.getDynamicProperty("bg:mode") === 0);

// --- gear ------------------------------------------------------------------
const equippable = owner.getComponent("minecraft:equippable");
equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:diamond_chestplate"));
await advance(15);
ui.resetForms();
ui.answer("action", 5); // open Equipment
ui.answer("action", 0); // then "Give held item"
ui.answer("action", 2); // then "Back"
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(10);
noErrors("equip");
const guardGear = guard.getComponent("minecraft:equippable");
check(
  "the chestplate reaches the bodyguard",
  guardGear.getEquipment(EquipmentSlot.Chest)?.typeId === "minecraft:diamond_chestplate"
);
check(
  "a diamond chestplate alone reaches tier 2",
  guard.getDynamicProperty("bg:tier") === 2,
  String(guard.getDynamicProperty("bg:tier"))
);
check("a tier change swaps the component group", stats.triggered.some((t) => /bg:set_tier_/.test(t.event)));

// Full diamond should reach the top tier.
guardGear.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:diamond_helmet"));
guardGear.setEquipment(EquipmentSlot.Legs, new ItemStack("minecraft:diamond_leggings"));
guardGear.setEquipment(EquipmentSlot.Feet, new ItemStack("minecraft:diamond_boots"));
await advance(40);
check(
  "full diamond is the top tier",
  guard.getDynamicProperty("bg:tier") === 4,
  String(guard.getDynamicProperty("bg:tier"))
);

// --- combat ----------------------------------------------------------------
guardGear.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:netherite_sword"));
const zombie = spawnHostile(overworld, { x: 3, y: 64, z: 2 });
stats.damages.length = 0;
stats.knockbacks.length = 0;
for (let i = 0; i < 6; i++) {
  world.afterEvents.entityHitEntity._fire({ damagingEntity: guard, hitEntity: zombie });
  await advance(5);
}
noErrors("melee");
check("melee applies knockback", stats.knockbacks.length >= 6, String(stats.knockbacks.length));
check(
  "knockback vectors are finite",
  stats.knockbacks.every((k) => [k.dx, k.dz, k.h, k.v].every(Number.isFinite))
);
check("combos land extra damage", stats.damages.length >= 1, String(stats.damages.length));

// A bodyguard must never damage its owner, even if something forces a hit.
stats.damages.length = 0;
const ownerHealth = owner.getComponent("minecraft:health");
ownerHealth.setCurrentValue(20);
world.afterEvents.entityHitEntity._fire({ damagingEntity: guard, hitEntity: owner });
await advance(2);
check("a hit on the owner deals no bonus damage", stats.damages.length === 0);
check("the owner is healed back instead", ownerHealth.currentValue > 20);

// --- reacting to the owner being attacked ----------------------------------
stats.effects.length = 0;
stats.particles.length = 0;
guard.location = { x: 40, y: 64, z: 40 };
world.afterEvents.entityHurt._fire({
  hurtEntity: owner,
  damage: 4,
  damageSource: { cause: "entityAttack", damagingEntity: zombie },
});
await advance(3);
noErrors("owner hurt");
check("the escort is hurried along", stats.effects.some((e) => e.type === "speed"));
check("the escort signals an alert", stats.particles.some((p) => p.id === "bg:alert_ping"));
check(
  "a bodyguard left behind is pulled back",
  stats.teleports.some((t) => t.id === guard.id)
);

// --- taking damage ---------------------------------------------------------
stats.triggered.length = 0;
const guardHealth = guard.getComponent("minecraft:health");
guardHealth.setMax(100);
guardHealth.setCurrentValue(20);
world.afterEvents.entityHurt._fire({
  hurtEntity: guard,
  damage: 9,
  damageSource: { cause: "entityAttack", damagingEntity: zombie },
});
await advance(2);
noErrors("guard hurt");
check("a wounded bodyguard raises its guard", stats.triggered.some((t) => t.event === "bg:defend_start"));
check("a heavy hit makes it dodge", stats.knockbacks.some((k) => k.id === guard.id));
check(
  "the owner is warned when it is badly hurt",
  stats.actionBars.some((a) => a.name === "Ripley" && /badly hurt/.test(a.text))
);

// --- regeneration ----------------------------------------------------------
guardHealth.setCurrentValue(30);
await advance(20 * 30);
noErrors("idle ticks");
check(
  "it regenerates out of combat",
  guardHealth.currentValue > 30,
  String(guardHealth.currentValue)
);

// --- teleport-back and dimensions ------------------------------------------
guard.location = { x: 500, y: 64, z: 500 };
stats.teleports.length = 0;
await advance(40);
check("a bodyguard left far behind teleports back", stats.teleports.length > 0);

owner.dimension = nether;
guard.location = { x: 0, y: 64, z: 0 };
stats.teleports.length = 0;
await advance(40);
check("it follows the owner between dimensions", guard.dimension === nether);
owner.dimension = overworld;
await advance(40);

// --- the special attack ----------------------------------------------------
guard.location = { x: 0, y: 64, z: 0 };
guard.dimension = overworld;
const pack = [];
for (let i = 0; i < 3; i++) pack.push(spawnHostile(overworld, { x: i * 0.5, y: 64, z: 1 }));
stats.triggered.length = 0;
stats.damages.length = 0;
world.afterEvents.entityHitEntity._fire({ damagingEntity: guard, hitEntity: pack[0] });
await advance(40);
noErrors("special attack");
check("a crowd triggers the Guard Breaker", stats.triggered.some((t) => t.event === "bg:special_start"));
check("the Guard Breaker damages the crowd", stats.damages.length >= 3, String(stats.damages.length));
check("the slam particle plays", stats.particles.some((p) => p.id === "bg:guard_slam"));

// --- performance budget ----------------------------------------------------
for (const mob of pack) mob.remove();
await advance(60);
stats.getEntitiesCalls = 0;
stats.getPlayersCalls = 0;
await advance(20 * 60); // one simulated minute, idle
noErrors("one idle minute");
check(
  "idle entity searches stay within the mobile budget",
  stats.getEntitiesCalls <= 12,
  stats.getEntitiesCalls + " getEntities calls in 60s"
);

// --- death -----------------------------------------------------------------
stats.messages.length = 0;
world.afterEvents.entityDie._fire({
  deadEntity: guard,
  damageSource: { cause: "entityAttack", damagingEntity: zombie },
});
await advance(3);
noErrors("death");
check("the owner is told", stats.messages.some((m) => m.name === "Ripley" && /has fallen/.test(m.text)));
guard.remove();
await advance(10);
noErrors("post-death ticks");

// --- resilience ------------------------------------------------------------
// Events that arrive for entities that are already gone must not throw.
world.afterEvents.entityHurt._fire({ hurtEntity: guard, damage: 3, damageSource: { cause: "fall" } });
world.afterEvents.entityHitEntity._fire({ damagingEntity: guard, hitEntity: zombie });
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
world.afterEvents.entityHurt._fire({ hurtEntity: owner, damage: 2, damageSource: { cause: "none" } });
await advance(20);
noErrors("stale entity events");

// A player leaving must not strand anything.
world.afterEvents.playerLeave._fire({ playerId: owner.id, playerName: owner.name });
await advance(40);
noErrors("player leave");

// --- summon cap ------------------------------------------------------------
const capOwner = spawnPlayer("Hicks", overworld, { x: 100, y: 64, z: 100 });
capOwner.setGameMode(GameMode.creative);
const summoned = [];
for (let i = 0; i < 6; i++) {
  world.afterEvents.itemUseOn._fire({
    source: capOwner,
    itemStack: contract,
    block: { location: { x: 100 + i, y: 64, z: 100 } },
    blockFace: "Up",
  });
  await advance(120); // clear the summon cooldown
  const spawnedNow = overworld
    .getEntities({ type: "bg:bodyguard" })
    .filter((e) => e.location.x >= 100);
  for (const entity of spawnedNow) {
    if (!summoned.includes(entity)) {
      summoned.push(entity);
      // Hire each one so it counts against the cap.
      capOwner.location = { ...entity.location };
      world.afterEvents.dataDrivenEntityTrigger._fire({ entity, eventId: "bg:on_bind" });
      await advance(3);
    }
  }
}
noErrors("summon cap");
const hired = summoned.filter((e) => e.getDynamicProperty("bg:ownerName") === "Hicks");
check("the per-player cap is enforced", hired.length <= 3, hired.length + " hired");

// --- a second bodyguard, for the flows the first one has already consumed ---
const owner2 = spawnPlayer("Vasquez", overworld, { x: 200, y: 64, z: 200 });
world.afterEvents.itemUseOn._fire({
  source: owner2,
  itemStack: contract,
  block: { location: { x: 200, y: 64, z: 200 } },
  blockFace: "Up",
});
await advance(4);
const guard2 = overworld.getEntities({ type: "bg:bodyguard" }).find((e) => e.location.x >= 199 && e.location.x < 202);
check("a second player can summon their own", !!guard2);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:on_bind" });
await advance(4);
check("it binds to the summoner, not a bystander", guard2.getDynamicProperty("bg:ownerName") === "Vasquez");

// A creeper must be punted harder than an ordinary mob.
const creeper = spawnHostile(overworld, { x: 201, y: 64, z: 200 }, "minecraft:creeper");
creeper._families = ["monster", "mob", "creeper"];
const skeleton = spawnHostile(overworld, { x: 201, y: 64, z: 200 }, "minecraft:skeleton");
stats.knockbacks.length = 0;
world.afterEvents.entityHitEntity._fire({ damagingEntity: guard2, hitEntity: skeleton });
await advance(2);
const skeletonPush = stats.knockbacks.filter((k) => k.id === skeleton.id).pop();
stats.knockbacks.length = 0;
world.afterEvents.entityHitEntity._fire({ damagingEntity: guard2, hitEntity: creeper });
await advance(2);
const creeperPush = stats.knockbacks.filter((k) => k.id === creeper.id).pop();
check(
  "creepers get punted harder than other mobs",
  creeperPush && skeletonPush && creeperPush.h > skeletonPush.h,
  JSON.stringify({ creeperPush, skeletonPush })
);
creeper.remove();
skeleton.remove();

// --- STAY holds its post ---------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 1); // STAY
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(6);
check("STAY records the post", !!guard2.getDynamicProperty("bg:anchor"));
const post = guard2.getDynamicProperty("bg:anchor");
guard2.location = { x: post.x + 40, y: post.y, z: post.z + 40 };
stats.teleports.length = 0;
await advance(60);
check(
  "a bodyguard that drifts off its post is brought back",
  stats.teleports.some((t) => t.id === guard2.id)
);
check(
  "and it is back near the post",
  Math.abs(guard2.location.x - post.x) < 2 && Math.abs(guard2.location.z - post.z) < 2,
  JSON.stringify(guard2.location)
);

// STAY must not chase the owner around.
owner2.location = { x: 300, y: 64, z: 300 };
stats.teleports.length = 0;
await advance(60);
check(
  "STAY does not follow the owner away",
  !stats.teleports.some((t) => t.id === guard2.id && Math.abs(t.location.x - 300) < 5)
);
owner2.location = { x: post.x, y: post.y, z: post.z };

// --- the bow holster -------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 0); // back to FOLLOW
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(6);

const gear2 = guard2.getComponent("minecraft:equippable");
gear2.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_sword"));
gear2.setEquipment(EquipmentSlot.Offhand, new ItemStack("minecraft:bow"));
stats.triggered.length = 0;
const sniper = spawnHostile(overworld, { x: post.x + 12, y: 68, z: post.z }, "minecraft:skeleton");
world.afterEvents.entityHurt._fire({
  hurtEntity: guard2,
  damage: 2,
  damageSource: { cause: "projectile", damagingEntity: sniper },
});
await advance(80); // past the melee-stall threshold, still in combat
check(
  "an unreachable target makes it draw the bow",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId === "minecraft:bow",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId
);
check("drawing the bow enables the ranged goal", stats.triggered.some((t) => t.event === "bg:ranged_on"));
sniper.remove();

// It holsters again once the fight is over.
stats.triggered.length = 0;
await advance(20 * 20);
check(
  "the bow is holstered after the fight",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId === "minecraft:iron_sword",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId
);
check("and the ranged goal is switched off", stats.triggered.some((t) => t.event === "bg:ranged_off"));

// --- rename ----------------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 6); // Rename
ui.answer("modal", undefined, ["Bishop"]);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(8);
check("renaming works", guard2.getDynamicProperty("bg:codename") === "Bishop");
check("the new name shows on the badge", /Bishop/.test(guard2.nameTag), guard2.nameTag);

// --- the squad panel -------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 0); // pick the first bodyguard
world.afterEvents.itemUse._fire({ source: owner2, itemStack: contract });
await advance(10);
check("the squad panel lists the detail", ui.forms.shown.length >= 1, String(ui.forms.shown.length));
check(
  "the squad panel names the bodyguard",
  ui.forms.shown.some((f) => f.buttons.some((b) => typeof b.text === "string" && /Bishop/.test(b.text)))
);

// --- dismissal returns the gear -------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 8); // Dismiss
ui.answer("message", 0); // confirm
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(10);
noErrors("dismiss");
check("dismissing removes the bodyguard", !guard2.isValid());
const inventory = owner2.getComponent("minecraft:inventory").container;
check(
  "dismissal hands the gear back",
  inventory.items.some((i) => i && i.typeId === "minecraft:iron_sword"),
  JSON.stringify(inventory.items.filter(Boolean).map((i) => i.typeId))
);

// --- report ----------------------------------------------------------------
rmSync(sandbox, { recursive: true, force: true });

console.log("\n" + passed + " checks passed");
if (failures.length) {
  console.error("\n" + failures.length + " failed:");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log("Script behaviour verified against the 1.21.0 API surface.");
