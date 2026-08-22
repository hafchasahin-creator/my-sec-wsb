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

/** Clear the badge so the next update rebuilds it from the dynamic property. */
function refreshBadge(entity) {
  entity.nameTag = "";
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

// --- standard issue --------------------------------------------------------
const issued = guard.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand);
check("a hired bodyguard is issued a sidearm", issued?.typeId === "bg:sidearm", issued?.typeId);
check(
  "and the sidearm arms the matching shooting AI",
  stats.triggered.some((t) => t.event === "bg:arm_gun_sidearm")
);

// --- firing ----------------------------------------------------------------
stats.sounds.length = 0;
stats.particles.length = 0;
stats.animations.length = 0;
const bullet = overworld.spawnEntity("bg:bullet", {
  x: guard.location.x + 0.4,
  y: guard.location.y + 1.5,
  z: guard.location.z,
});
await advance(3);
noErrors("shot fired");
check("a shot makes a report", stats.sounds.some((s) => s.id === "firework.blast"));
check("a shot flashes the muzzle", stats.particles.some((p) => p.id === "bg:muzzle_flash"));
check(
  "and the shooter recoils",
  stats.animations.some((a) => a.id === guard.id && a.name === "animation.bodyguard.fire"),
  JSON.stringify(stats.animations)
);
check("the bullet is not tracked as a bodyguard", !overworld.getEntities({ type: "bg:bodyguard" }).includes(bullet));

// A bullet from a bodyguard carries its weapon's damage.
const shotVictim = spawnHostile(overworld, { x: guard.location.x + 2, y: guard.location.y, z: guard.location.z });
stats.damages.length = 0;
world.afterEvents.entityHurt._fire({
  hurtEntity: shotVictim,
  damage: 3,
  damageSource: { cause: "projectile", damagingEntity: guard, damagingProjectile: bullet },
});
await advance(2);
noErrors("bullet damage");
check("a bullet adds the weapon's damage on top", stats.damages.length === 1, String(stats.damages.length));
check("the impact sparks", stats.particles.some((p) => p.id === "bg:bullet_impact"));

// Swapping to a carbine re-arms the AI and raises the bullet damage.
stats.triggered.length = 0;
stats.damages.length = 0;
guard.getComponent("minecraft:equippable").setEquipment(EquipmentSlot.Mainhand, new ItemStack("bg:carbine"));
await advance(20);
check("a carbine re-arms the AI", stats.triggered.some((t) => t.event === "bg:arm_gun_carbine"));
world.afterEvents.entityHurt._fire({
  hurtEntity: shotVictim,
  damage: 3,
  damageSource: { cause: "projectile", damagingEntity: guard, damagingProjectile: bullet },
});
await advance(2);
check("the carbine hits harder", stats.damages[0]?.amount > 3, JSON.stringify(stats.damages[0]));

// A bullet that somehow reaches the owner costs the owner nothing.
const beforeStray = owner.getComponent("minecraft:health").currentValue;
owner.getComponent("minecraft:health").setCurrentValue(12);
world.afterEvents.entityHurt._fire({
  hurtEntity: owner,
  damage: 6,
  damageSource: { cause: "projectile", damagingEntity: guard, damagingProjectile: bullet },
});
await advance(2);
check(
  "a stray bullet from your own bodyguard is refunded",
  owner.getComponent("minecraft:health").currentValue >= 18,
  String(owner.getComponent("minecraft:health").currentValue)
);
bullet.remove();
shotVictim.remove();
guard.getComponent("minecraft:equippable").setEquipment(EquipmentSlot.Mainhand, new ItemStack("bg:sidearm"));
await advance(20);

// --- the player pulling the trigger ---------------------------------------
const mark = spawnHostile(overworld, { x: owner.location.x, y: owner.location.y, z: owner.location.z + 6 });
const markHealth = mark.getComponent("minecraft:health");
markHealth.setCurrentValue(40);
const pistol = new ItemStack("bg:sidearm");
owner.getComponent("minecraft:equippable").setEquipment(EquipmentSlot.Mainhand, pistol);
stats.sounds.length = 0;
stats.particles.length = 0;
stats.damages.length = 0;
stats.cooldowns.length = 0;
world.afterEvents.itemUse._fire({ source: owner, itemStack: pistol });
await advance(2);
noErrors("player fire");
check("a player's shot hits what they are looking at", stats.damages.length === 1, String(stats.damages.length));
check("it hurts", markHealth.currentValue < 40, String(markHealth.currentValue));
check("it draws a tracer", stats.particles.filter((p) => p.id === "minecraft:basic_crit_particle").length >= 2);
check("it starts a cooldown", stats.cooldowns.length === 1, JSON.stringify(stats.cooldowns));

// Firing again inside the cooldown does nothing.
stats.damages.length = 0;
world.afterEvents.itemUse._fire({ source: owner, itemStack: pistol });
await advance(2);
check("and the cooldown blocks the next shot", stats.damages.length === 0);

// Durability is spent, and the weapon eventually breaks.
const held = owner.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand);
check("a shot costs durability", held?.getComponent("minecraft:durability").damage >= 1);
held.getComponent("minecraft:durability").damage = 899;
owner.getComponent("minecraft:equippable").setEquipment(EquipmentSlot.Mainhand, held);
await advance(20);
world.afterEvents.itemUse._fire({ source: owner, itemStack: held });
await advance(3);
check(
  "a worn-out weapon breaks",
  !owner.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand)
);
mark.remove();
await advance(10);

// --- the command panel -----------------------------------------------------
await advance(15); // clear the input de-duplication windows
ui.resetForms();
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard, eventId: "bg:command_panel" });
await advance(2);
check("panel opened for the owner", ui.forms.shown.length === 1, JSON.stringify(ui.forms.shown));
const panel = ui.forms.shown[0];
check(
  "panel has five modes plus five actions",
  panel && panel.buttons.length === 10,
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

// A stray arrow from your own bodyguard must cost you nothing.
ownerHealth.setCurrentValue(14);
world.afterEvents.entityHurt._fire({
  hurtEntity: owner,
  damage: 5,
  damageSource: { cause: "projectile", damagingEntity: guard, damagingProjectile: zombie },
});
await advance(2);
check(
  "friendly fire from your own bodyguard is refunded",
  ownerHealth.currentValue >= 19,
  String(ownerHealth.currentValue)
);

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

// The regeneration rate must not depend on how many bodyguards exist: the
// update cadence is per-bodyguard, not "whatever is left of the tick budget".
guardHealth.setCurrentValue(20);
await advance(20 * 60);
const soloGain = guardHealth.currentValue - 20;
check(
  "regeneration is slow, not a heal button",
  soloGain >= 10 && soloGain <= 30,
  soloGain + " health in 60s"
);

const crowd = [];
for (let i = 0; i < 8; i++) {
  const extra = overworld.spawnEntity("bg:bodyguard", { x: 700 + i, y: 64, z: 700 });
  extra.setDynamicProperty("bg:ownerName", "Ripley");
  extra.setDynamicProperty("bg:mode", 0);
  crowd.push(extra);
}
await advance(20 * 12); // let the registry pick them up
guardHealth.setCurrentValue(20);
await advance(20 * 60);
const crowdGain = guardHealth.currentValue - 20;
check(
  "the same rate holds with a crowd of bodyguards",
  Math.abs(crowdGain - soloGain) <= 4,
  "solo " + soloGain + " vs crowd " + crowdGain
);
// Round-robin fairness: every bodyguard in a crowd must actually be reached.
// A sweep that skips one entry produces a bodyguard that never regenerates,
// never notices it is stuck, and never gets its badge back.
for (const extra of crowd) {
  extra.nameTag = "";
  extra.setDynamicProperty("bg:codename", "Crowd");
}
guard.nameTag = "";
await advance(20 * 6);
const unreached = crowd.concat([guard]).filter((e) => !/\u00a78\|/.test(e.nameTag));
check(
  "every bodyguard in a crowd is reached by the update sweep",
  unreached.length === 0,
  unreached.length + " of " + (crowd.length + 1) + " never updated"
);

for (const extra of crowd) extra.remove();
await advance(20 * 12);

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

// --- the owner going down and coming back ---------------------------------
const escort = overworld.spawnEntity("bg:bodyguard", { x: 5, y: 64, z: 5 });
await advance(4);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: escort, eventId: "bg:on_bind" });
await advance(4);
owner.location = { x: 5, y: 64, z: 5 };
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: escort, eventId: "bg:on_bind" });
await advance(4);
escort.setDynamicProperty("bg:ownerName", "Ripley");
escort.setDynamicProperty("bg:ownerId", owner.id);
escort.setDynamicProperty("bg:mode", 0);
await advance(20);

stats.particles.length = 0;
world.afterEvents.entityDie._fire({
  deadEntity: owner,
  damageSource: { cause: "entityAttack", damagingEntity: zombie },
});
await advance(4);
noErrors("owner death");
check("the escort reacts to the owner going down", stats.particles.some((p) => p.id === "bg:alert_ping"));

escort.location = { x: 900, y: 64, z: 900 };
owner.location = { x: 0, y: 70, z: 0 };
stats.teleports.length = 0;
world.afterEvents.playerSpawn._fire({ player: owner, initialSpawn: false });
await advance(40);
noErrors("respawn regroup");
check(
  "the escort regroups on respawn",
  stats.teleports.some((t) => t.id === escort.id),
  JSON.stringify(escort.location)
);
escort.remove();
await advance(20);

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
check(
  "an unhired recruit says how to hire it",
  /gold ingot/.test(guard2.nameTag),
  guard2.nameTag
);
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
check("drawing the bow arms the bow goal", stats.triggered.some((t) => t.event === "bg:arm_ranged"));
sniper.remove();

// It holsters again once the fight is over.
stats.triggered.length = 0;
await advance(20 * 20);
check(
  "the bow is holstered after the fight",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId === "minecraft:iron_sword",
  gear2.getEquipment(EquipmentSlot.Mainhand)?.typeId
);
check("and it goes back to melee", stats.triggered.some((t) => t.event === "bg:arm_melee"));

// --- rename ----------------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 7); // Rename
ui.answer("modal", undefined, ["Bishop"]);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(8);
check("renaming works", guard2.getDynamicProperty("bg:codename") === "Bishop");
check("the new name shows on the badge", /Bishop/.test(guard2.nameTag), guard2.nameTag);

// --- a name tag renames it, rather than fighting the badge -----------------
guard2.nameTag = "Reyes";
await advance(30);
check("a name tag is adopted as the codename", guard2.getDynamicProperty("bg:codename") === "Reyes");
check("and the badge comes back with it", /Reyes/.test(guard2.nameTag) && /\u00a78\|/.test(guard2.nameTag), guard2.nameTag);
guard2.setDynamicProperty("bg:codename", "Bishop");
refreshBadge(guard2);

// --- post settings ---------------------------------------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 2); // GUARD
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(6);
check("GUARD mode is set", guard2.getDynamicProperty("bg:mode") === 2);

await advance(15);
ui.resetForms();
ui.answer("action", 6); // Post Settings
ui.answer("modal", undefined, [true, 24]);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(10);
noErrors("post settings");
check("the guard radius is applied", guard2.getDynamicProperty("bg:radius") === 24, String(guard2.getDynamicProperty("bg:radius")));
const movedPost = guard2.getDynamicProperty("bg:anchor");
check(
  "the post moved to where the owner stood",
  movedPost && Math.abs(movedPost.x - owner2.location.x) < 0.01,
  JSON.stringify(movedPost)
);

// Back to FOLLOW so the remaining checks behave.
await advance(15);
ui.resetForms();
ui.answer("action", 0);
world.afterEvents.dataDrivenEntityTrigger._fire({ entity: guard2, eventId: "bg:command_panel" });
await advance(6);

// --- sneak + tap a block reaches the squad panel ---------------------------
await advance(15);
ui.resetForms();
ui.answer("action", 0);
owner2.isSneaking = true;
world.afterEvents.itemUseOn._fire({
  source: owner2,
  itemStack: contract,
  block: { location: { x: 210, y: 64, z: 210 } },
  blockFace: "Up",
});
await advance(8);
owner2.isSneaking = false;
noErrors("sneak squad panel");
check("sneak + tap opens the squad panel instead of summoning", ui.forms.shown.length >= 1);
check(
  "and it does not summon",
  overworld.getEntities({ type: "bg:bodyguard" }).every((e) => Math.abs(e.location.x - 210.5) > 0.1)
);

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
ui.answer("action", 9); // Dismiss
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
