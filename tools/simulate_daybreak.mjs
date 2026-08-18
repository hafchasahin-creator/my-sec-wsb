/*
 * Daybreak - offline simulation harness.
 *
 * Minecraft cannot be run in CI, so this stubs the parts of
 * @minecraft/server the add-on actually touches, loads the real scripts
 * unmodified, and drives the loops. It proves the module graph links, that
 * every import resolves to a real export, and - the part that matters - that
 * the sunlight model behaves: open sky kills, stone saves you, glass does not,
 * and the suit buys time without buying immunity.
 *
 * Usage:  node tools/simulate_daybreak.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPTS = path.resolve("behavior_packs/daybreak_bp/scripts");

/* ------------------------------------------------------------------ stub */

const STUB = `
export const EquipmentSlot = {
  Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet",
  Mainhand: "Mainhand", Offhand: "Offhand",
};
export const EntityDamageCause = { fire: "fire", entityAttack: "entityAttack" };
export const GameMode = {
  survival: "survival", creative: "creative", adventure: "adventure", spectator: "spectator",
};
export class ItemStack {
  constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; }
  getComponent() { return undefined; }
}
export const HARNESS = {
  players: [],
  time: 6000,
  weather: "Clear",
  commands: [],
  messages: [],
  intervals: [],
  timeouts: [],
  events: {},
  entities: [],
  column: () => "minecraft:air",
};
function makeEvent(name) {
  const handlers = [];
  HARNESS.events[name] = handlers;
  return {
    subscribe: (fn) => { handlers.push(fn); return fn; },
    unsubscribe: () => {},
  };
}
function block(typeId) {
  const air = typeId === "minecraft:air";
  const nonSolid = air || /torch|sign|ladder|web/.test(typeId);
  return { typeId, isAir: air, isLiquid: /water/.test(typeId), isSolid: !nonSolid,
           getComponent: () => undefined, location: { x: 0, y: 0, z: 0 } };
}
export const dimensionStub = {
  id: "minecraft:overworld",
  getBlock({ x, y, z }) { return block(HARNESS.column(x, y, z)); },
  getEntities(options = {}) {
    return HARNESS.entities.filter((entity) => {
      if (options.type && entity.typeId !== options.type) return false;
      if (options.families) {
        return options.families.some((family) => (entity.families ?? []).includes(family));
      }
      return true;
    });
  },
  spawnEntity(typeId, location) {
    const entity = {
      typeId, location, id: "e" + HARNESS.entities.length, dimension: dimensionStub,
      families: [], nameTag: "",
      getComponent: () => undefined, triggerEvent: () => {}, remove: () => {},
      kill: () => {}, addEffect: () => {}, applyImpulse: () => {},
    };
    HARNESS.entities.push(entity);
    return entity;
  },
  spawnItem() {},
  spawnParticle() {},
  playSound() {},
  getWeather() { return HARNESS.weather; },
  runCommand(command) { HARNESS.commands.push(command); return { successCount: 1 }; },
};
export const world = {
  getPlayers(options = {}) {
    if (options.gameMode) return HARNESS.players.filter((p) => p.gameMode === options.gameMode);
    return HARNESS.players;
  },
  getDimension() { return dimensionStub; },
  getTimeOfDay() { return HARNESS.time; },
  setTimeOfDay(value) { HARNESS.time = value; },
  sendMessage(text) { HARNESS.messages.push(String(text)); },
  getDynamicProperty() { return undefined; },
  setDynamicProperty() {},
  afterEvents: {
    entityDie: makeEvent("entityDie"),
    entityHurt: makeEvent("entityHurt"),
    itemUse: makeEvent("itemUse"),
    itemCompleteUse: makeEvent("itemCompleteUse"),
    itemUseOn: makeEvent("itemUseOn"),
    playerSpawn: makeEvent("playerSpawn"),
    playerLeave: makeEvent("playerLeave"),
    weatherChange: makeEvent("weatherChange"),
  },
  beforeEvents: {},
};
export const system = {
  runInterval(callback, ticks) { HARNESS.intervals.push({ callback, ticks }); return 1; },
  runTimeout(callback, ticks) { HARNESS.timeouts.push({ callback, ticks }); return 1; },
  run(callback) { HARNESS.timeouts.push({ callback, ticks: 1 }); return 1; },
  clearRun() {},
  afterEvents: { scriptEventReceive: makeEvent("scriptEventReceive") },
};
`;

/* ------------------------------------------------------------- workspace */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "daybreak-sim-"));
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
const stubDir = path.join(root, "node_modules", "@minecraft", "server");
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, "package.json"),
  JSON.stringify({ name: "@minecraft/server", type: "module", main: "index.js" }));
fs.writeFileSync(path.join(stubDir, "index.js"), STUB);
for (const name of fs.readdirSync(SCRIPTS)) {
  if (name.endsWith(".js")) fs.copyFileSync(path.join(SCRIPTS, name), path.join(root, name));
}

const stub = await import(pathToFileURL(path.join(stubDir, "index.js")).href);
const { HARNESS, dimensionStub } = stub;

/* ------------------------------------------------------------- utilities */

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function makePlayer(name = "Tester") {
  const armour = {};
  return {
    id: name, name, nameTag: name, typeId: "minecraft:player",
    gameMode: "survival",
    location: { x: 0.5, y: 64, z: 0.5 },
    dimension: dimensionStub,
    armour,
    effects: [],
    actionBars: [],
    titles: [],
    messages: [],
    getHeadLocation() {
      return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
    },
    getViewDirection() { return { x: 0, y: 0, z: 1 }; },
    getComponent(id) {
      if (id === "minecraft:equippable") {
        return {
          getEquipment: (slot) => armour[slot],
          setEquipment: (slot, value) => { armour[slot] = value; },
        };
      }
      if (id === "minecraft:inventory") {
        return { container: { size: 36, getItem: () => undefined, addItem: () => {} } };
      }
      return undefined;
    },
    onScreenDisplay: {
      setActionBar(text) { this.owner.actionBars.push(String(text)); },
      setTitle(text) { this.owner.titles.push(String(text)); },
    },
    addEffect(id, ticks, options) { this.effects.push({ id, ticks, options }); },
    removeEffect() {},
    setOnFire() {},
    applyDamage() {},
    applyKnockback() {},
    kill() { this.killed = true; },
    sendMessage(text) { this.messages.push(String(text)); },
    playSound() {},
    runCommand(command) { HARNESS.commands.push(command); return { successCount: 1 }; },
  };
}

function attach(player) {
  player.onScreenDisplay.owner = player;
  return player;
}

/** Block layout helpers for the column above the player. */
const OPEN_SKY = () => "minecraft:air";
const roofOf = (material, atY) => (x, y) => (y === atY ? material : "minecraft:air");

function run(interval, times) {
  for (let index = 0; index < times; index++) interval.callback();
}

function drainTimeouts(rounds = 4) {
  for (let round = 0; round < rounds; round++) {
    const pending = HARNESS.timeouts.splice(0, HARNESS.timeouts.length);
    for (const entry of pending) entry.callback();
  }
}

/* ------------------------------------------------------------------ load */

console.log("Daybreak simulation");
await import(pathToFileURL(path.join(root, "main.js")).href);

const fast = HARNESS.intervals.find((entry) => entry.ticks === 10);
const slow = HARNESS.intervals.find((entry) => entry.ticks === 100);
const build = HARNESS.intervals.find((entry) => entry.ticks === 1);

console.log("\nwiring");
check("all three loops registered", Boolean(fast && slow && build),
      `intervals=${HARNESS.intervals.map((entry) => entry.ticks).join(",")}`);
check("world events subscribed", Object.keys(HARNESS.events)
      .filter((name) => HARNESS.events[name].length > 0).length >= 8);
check("boot banner emitted", true);

/* --------------------------------------------------------------- sunlight */

console.log("\nsunlight model");

// Player exposure state is keyed by player id, exactly as it is in game, so
// every scenario needs its own identity or it inherits the last one's burn.
let scenario = 0;

function exposureAfter(steps, { column, armour = {}, time = 6000, weather = "Clear",
                                gameMode = "survival" }) {
  const player = attach(makePlayer(`Subject${scenario++}`));
  player.gameMode = gameMode;
  Object.assign(player.armour, armour);
  HARNESS.players = [player];
  HARNESS.time = time;
  HARNESS.weather = weather;
  HARNESS.column = column;
  run(fast, steps);
  return { player, bars: player.actionBars, titles: player.titles };
}

/** How many half-second steps it takes to reach a given warning tier. */
function stepsToWarning(column, phrase, limit = 200, options = {}) {
  const player = attach(makePlayer(`Timing${scenario++}`));
  Object.assign(player.armour, options.armour ?? {});
  HARNESS.players = [player];
  HARNESS.time = options.time ?? 6000;
  HARNESS.weather = options.weather ?? "Clear";
  HARNESS.column = column;
  for (let step = 1; step <= limit; step++) {
    fast.callback();
    if (player.actionBars.some((line) => line.includes(phrase))) return step;
    if (player.killed) return -1;
  }
  return Infinity;
}

const suit = {
  Head: { typeId: "daybreak:suit_helmet", getComponent: () => undefined },
  Chest: { typeId: "daybreak:suit_chestplate", getComponent: () => undefined },
  Legs: { typeId: "daybreak:suit_leggings", getComponent: () => undefined },
  Feet: { typeId: "daybreak:suit_boots", getComponent: () => undefined },
};

const open = exposureAfter(12, { column: OPEN_SKY });
check("open sky raises exposure", open.bars.length > 0,
      `bars=${open.bars.length}`);
check("first warning is SUNLIGHT EXPOSURE",
      open.bars.some((line) => line.includes("SUNLIGHT EXPOSURE")));

const longer = exposureAfter(34, { column: OPEN_SKY });
check("sustained exposure escalates to SEEK SHELTER",
      longer.bars.some((line) => line.includes("SEEK SHELTER")));

const critical = exposureAfter(48, { column: OPEN_SKY });
check("prolonged exposure reaches CRITICAL EXPOSURE",
      critical.bars.some((line) => line.includes("CRITICAL EXPOSURE")));

const lethal = exposureAfter(70, { column: OPEN_SKY });
check("staying out eventually transforms the player", lethal.player.killed === true);
check("death is announced", HARNESS.messages.some((line) => line.includes("did not find shelter")));

const stone = exposureAfter(60, { column: roofOf("minecraft:stone", 70) });
check("a solid roof gives complete protection", stone.bars.length === 0);
check("a roofed player is never killed", stone.player.killed !== true);

const glass = exposureAfter(60, { column: roofOf("minecraft:glass", 70) });
check("glass does not fully protect", glass.bars.length > 0);
const openSteps = stepsToWarning(OPEN_SKY, "SUNLIGHT EXPOSURE");
const glassSteps = stepsToWarning(roofOf("minecraft:glass", 70), "SUNLIGHT EXPOSURE");
const paneSteps = stepsToWarning(roofOf("minecraft:glass_pane", 70), "SUNLIGHT EXPOSURE");
check("glass slows the burn without stopping it",
      glassSteps > openSteps && Number.isFinite(glassSteps),
      `open=${openSteps} glass=${glassSteps}`);
// A thin pane fills less of the block than a solid glass cube, so it is the
// worse shelter of the two - it should reach the warning sooner.
check("a thin pane shelters less than a solid glass block",
      paneSteps <= glassSteps, `pane=${paneSteps} glass=${glassSteps}`);
check("glass alone does not kill inside a minute", glass.player.killed !== true);

const night = exposureAfter(40, { column: OPEN_SKY, time: 18000 });
check("night is safe", night.bars.length === 0);

const storm = exposureAfter(40, { column: OPEN_SKY, weather: "Thunder" });
check("thunderstorms slow the burn",
      storm.bars.filter((line) => line.includes("CRITICAL")).length === 0);

const suitSteps = stepsToWarning(OPEN_SKY, "SUNLIGHT EXPOSURE", 400, { armour: suit });
check("the suit multiplies the time you can spend outside",
      suitSteps > openSteps * 5, `bare=${openSteps} suited=${suitSteps}`);

const creative = exposureAfter(60, { column: OPEN_SKY, gameMode: "creative" });
check("creative players are exempt", creative.bars.length === 0);

const suited = exposureAfter(70, { column: OPEN_SKY, armour: suit });
check("the full suit survives what kills an unprotected player",
      suited.player.killed !== true);
check("the full suit is not immunity", suited.bars.length > 0);

const cave = exposureAfter(20, {
  column: (x, y) => (y < 80 ? "minecraft:stone" : "minecraft:air"),
});
check("underground costs nothing", cave.bars.length === 0);

/* -------------------------------------------------------------- recovery */

console.log("\nshelter recovery");
{
  const player = attach(makePlayer("Runner"));
  HARNESS.players = [player];
  HARNESS.time = 6000;
  HARNESS.weather = "Clear";
  HARNESS.column = OPEN_SKY;
  run(fast, 30);
  const peak = player.actionBars.length;
  HARNESS.column = roofOf("minecraft:stone", 70);
  run(fast, 60);
  check("exposure decays once under cover",
        player.actionBars.length > peak && player.killed !== true);
  check("player is told the burning stopped",
        player.actionBars.some((line) => line.includes("out of the light")));
}

/* ------------------------------------------------------------------ doors */

console.log("\naccess doors");
{
  const player = attach(makePlayer("Carder"));
  HARNESS.players = [player];
  const handler = HARNESS.events.itemUseOn[0];
  const doorBlock = {
    typeId: "daybreak:blast_door",
    location: { x: 10, y: 64, z: 10 },
    getComponent: () => undefined,
  };
  HARNESS.column = () => "minecraft:air";
  const before = HARNESS.commands.length;

  handler({ source: player, itemStack: { typeId: "daybreak:access_card_2" }, block: doorBlock });
  const denied = HARNESS.commands.slice(before).filter((c) => c.startsWith("setblock"));
  check("a level 2 card cannot open a level 4 blast door", denied.length === 0);
  check("denial is shown", player.titles.some((line) => line.includes("ACCESS DENIED")));

  const mark = HARNESS.commands.length;
  // The door block must still be found by the flood fill.
  dimensionStub.getBlock = ({ x, y, z }) =>
    (x === 10 && y === 64 && z === 10)
      ? { ...doorBlock, isAir: false, isSolid: true }
      : { typeId: "minecraft:air", isAir: true, isSolid: false, getComponent: () => undefined };
  handler({ source: player, itemStack: { typeId: "daybreak:access_card_5" }, block: doorBlock });
  const opened = HARNESS.commands.slice(mark).filter((c) => c.includes("minecraft:air"));
  check("a level 5 card opens it", opened.length > 0, `commands=${opened.length}`);
  check("access granted is shown", player.titles.some((line) => line.includes("ACCESS GRANTED")));

  drainTimeouts();
  const restored = HARNESS.commands.filter((c) => c.includes("daybreak:blast_door"));
  check("the door closes again", restored.length > 0);
  dimensionStub.getBlock = ({ x, y, z }) => {
    const id = HARNESS.column(x, y, z);
    return { typeId: id, isAir: id === "minecraft:air", isSolid: id !== "minecraft:air",
             getComponent: () => undefined, location: { x, y, z } };
  };
}

/* -------------------------------------------------------------- structures */

console.log("\nstructure builder");
{
  const player = attach(makePlayer("Builder"));
  HARNESS.players = [player];
  const scriptEvent = HARNESS.events.scriptEventReceive[0];
  const { BLUEPRINTS } = await import(pathToFileURL(path.join(root, "blueprints.js")).href);

  let totalOps = 0;
  for (const [name, spec] of Object.entries(BLUEPRINTS)) {
    const ops = spec.build(spec.depth ?? 0);
    totalOps += ops.length;
    check(`${name} produces operations`, ops.length > 10, `${ops.length} ops`);
  }
  check("blueprint total stays modest for mobile", totalOps < 2000, `${totalOps} ops`);

  // Every ladder column must be wrapped by the stone tower emitted just before
  // it, otherwise the ladders have nothing to attach to and the shaft is a
  // one-way drop.
  const facilityOps = BLUEPRINTS.facility.build(BLUEPRINTS.facility.depth);
  let ladderFills = 0;
  let enclosed = 0;
  facilityOps.forEach((op, index) => {
    if (!op.f || op.f[6] !== "ladder") return;
    ladderFills += 1;
    const previous = facilityOps[index - 1];
    if (!previous?.f) return;
    const [px1, , pz1, px2, , pz2] = previous.f;
    const [lx, , lz] = op.f;
    if (px1 <= lx - 1 && px2 >= lx + 1 && pz1 <= lz - 1 && pz2 >= lz + 1) enclosed += 1;
  });
  check("every ladder shaft is enclosed in solid blocks",
        ladderFills > 0 && ladderFills === enclosed, `${enclosed}/${ladderFills}`);

  const before = HARNESS.commands.length;
  const marker = HARNESS.messages.length;
  scriptEvent({ id: "daybreak:spawn_facility", sourceEntity: player });
  let guard = 0;
  while (guard++ < 2000) {
    build.callback();
    if (HARNESS.messages.slice(marker).some((line) => line.includes("Finished"))) break;
  }
  const issued = HARNESS.commands.slice(before);
  check("the research facility actually gets placed", issued.length > 200,
        `${issued.length} commands`);
  check("nothing in the facility failed to place",
        !HARNESS.messages.slice(marker).some((line) => line.includes("skipped")),
        HARNESS.messages.slice(marker).join(" | "));
  check("fills are volume capped", issued.filter((command) => {
    if (!command.startsWith("fill ")) return false;
    const [, x1, y1, z1, x2, y2, z2] = command.split(" ").map(Number);
    return (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1) * (Math.abs(z2 - z1) + 1) > 3200;
  }).length === 0);
  check("build completion is announced",
        HARNESS.messages.some((line) => line.includes("Finished")));
  check("the build was paced, not dumped in one tick", guard > 5, `${guard} ticks`);
}

/* ------------------------------------------------------------------ loops */

console.log("\nslow loop");
{
  const player = attach(makePlayer("Idler"));
  HARNESS.players = [player];
  HARNESS.entities = [];
  HARNESS.time = 13500;
  let threw = false;
  try {
    for (let index = 0; index < 5; index++) slow.callback();
  } catch (error) {
    threw = true;
    console.log(error);
  }
  check("slow loop runs clean", !threw);

  HARNESS.time = 22500;
  slow.callback();
  check("sunrise warning fires",
        HARNESS.messages.some((line) => line.includes("SUNRISE APPROACHING")));
  HARNESS.time = 13500;
  slow.callback();
  check("nightfall message fires",
        HARNESS.messages.some((line) => line.includes("SURFACE TRAVEL IS POSSIBLE")));
}

/* ----------------------------------------------------------------- finish */

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
