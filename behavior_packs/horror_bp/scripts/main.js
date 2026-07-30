/*
 * Horror Mode
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Turned on by typing a command in chat:
 *
 *     /scriptevent horror:on
 *     /scriptevent horror:off
 *     /scriptevent horror:level 3
 *     /scriptevent horror:scare
 *     /scriptevent horror:status
 *
 * /scriptevent is used rather than a plain chat word on purpose:
 * world.beforeEvents.chatSend - the only way to read ordinary chat messages -
 * is an EXPERIMENTAL API and does nothing unless the world has the Beta APIs
 * toggle on. system.afterEvents.scriptEventReceive is stable, so this works on
 * a default world with no experiments. It does need cheats enabled, because
 * that is what /scriptevent itself needs; the Cursed Totem item is the
 * no-cheats way in and toggles the same state.
 *
 * Everything the mode does is driven from one 1-second interval, so it costs
 * effectively nothing while idle and can be switched off cleanly.
 */

import { world, system, EntityDamageCause } from "@minecraft/server";

const VERSION = "1.0.0";
const TOTEM = "horror:dread_totem";
const WATCHER = "horror:watcher";

const PROPERTY = {
  on: "horror:on",
  level: "horror:level",
};

/* ------------------------------------------------------------------ *
 * Tuning - all chances are "per player, per second"
 * ------------------------------------------------------------------ */

const LEVELS = {
  1: {
    name: "Unsettling",
    ambient: 0.25,
    whisper: 0.05,
    jumpscare: 0,
    watcher: 0,
    darkness: 0,
    hunts: false,
  },
  2: {
    name: "Haunted",
    ambient: 0.35,
    whisper: 0.09,
    jumpscare: 0.012,
    watcher: 0.06,
    darkness: 0,
    hunts: false,
  },
  3: {
    name: "Hunted",
    ambient: 0.5,
    whisper: 0.14,
    jumpscare: 0.03,
    watcher: 0.12,
    darkness: 0.05,
    hunts: true,
  },
};

const CONFIG = {
  // Hold the world at night and in a storm. Re-applied on this cadence because
  // the daylight cycle keeps running underneath.
  reassertSeconds: 20,
  // How far behind the player The Watcher appears, and how far out it is culled.
  spawnMin: 18,
  spawnMax: 30,
  cullDistance: 90,
  // Dot product of view direction against the direction to The Watcher that
  // counts as "you are looking at it". 0.93 is roughly a 21 degree cone.
  gazeThreshold: 0.93,
  // Level 3 only: how close it creeps each time you are not looking.
  stalkStep: 7,
  strikeDistance: 3.2,
  strikeDamage: 7,
  fogId: "horror:dread",
  fogTag: "dread",
};

const AMBIENT_SOUNDS = [
  "ambient.cave",
  "mob.ghast.moan",
  "mob.wither.ambient",
  "mob.zombie.say",
  "mob.skeleton.step",
  "random.door_close",
  "mob.warden.nearby_close",
  "mob.warden.heartbeat",
  "ambient.weather.thunder",
];

const SCARE_SOUNDS = [
  "mob.enderman.stare",
  "mob.enderman.scream",
  "mob.ghast.scream",
  "mob.creeper.say",
  "mob.warden.roar",
];

const WHISPERS = [
  "did you hear that?",
  "it is standing behind you.",
  "do not turn around.",
  "you were followed here.",
  "the torches will not help you.",
  "it has been counting your steps.",
  "it is closer every time you look away.",
  "something is wearing your name.",
  "you should not have dug so deep.",
  "it remembers your face.",
  "stop walking.",
  "there were two sets of footprints.",
];

const SCARE_TITLES = [
  "§4§lBEHIND YOU",
  "§4§lDON'T MOVE",
  "§4§lIT SAW YOU",
  "§4§lRUN",
  "§8§lit is here",
];

/* ------------------------------------------------------------------ *
 * Helpers - every cosmetic call is swallowed so a device missing one
 * particle or sound id degrades that effect alone.
 * ------------------------------------------------------------------ */

function safe(fn) {
  try {
    fn();
  } catch {
    /* cosmetic or optional - ignore */
  }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function chance(probability) {
  return Math.random() < probability;
}

function tell(player, message) {
  safe(() => player.sendMessage(message));
}

function whisper(player, text) {
  tell(player, `§8§o${text}§r`);
}

function title(player, text) {
  safe(() =>
    player.onScreenDisplay.setTitle(text, {
      fadeInDuration: 0,
      stayDuration: 25,
      fadeOutDuration: 10,
    })
  );
}

function localSound(player, id, location) {
  // Player.playSound is per-player, which is what makes a scare feel personal
  // rather than something the whole server hears.
  safe(() => player.playSound(id, { location, volume: 1.0 }));
}

function shake(player, intensity, seconds) {
  safe(() =>
    player.runCommand(`camerashake add @s ${intensity} ${seconds} positional`)
  );
}

function command(dimension, text) {
  safe(() => dimension.runCommand(text));
}

function dimensions() {
  const found = [];
  for (const id of ["overworld", "nether", "the_end"]) {
    try {
      found.push(world.getDimension(id));
    } catch {
      /* a dimension can be unavailable on some worlds */
    }
  }
  return found;
}

/** Walk down from `location` until a non-air block is found. */
function groundBelow(dimension, location) {
  let y = Math.floor(location.y);
  for (let i = 0; i < 48; i++) {
    try {
      const block = dimension.getBlock({
        x: Math.floor(location.x),
        y,
        z: Math.floor(location.z),
      });
      if (!block) break; // unloaded chunk - use what we have
      if (!block.isAir && !block.isLiquid) {
        return { x: location.x, y: y + 1, z: location.z };
      }
    } catch {
      break;
    }
    y -= 1;
  }
  return location;
}

/* ------------------------------------------------------------------ *
 * State, stored per world so it survives a rejoin
 * ------------------------------------------------------------------ */

function isOn() {
  try {
    return world.getDynamicProperty(PROPERTY.on) === true;
  } catch {
    return false;
  }
}

function level() {
  try {
    const stored = world.getDynamicProperty(PROPERTY.level);
    if (typeof stored === "number" && LEVELS[stored]) return stored;
  } catch {
    /* fall through to the default */
  }
  return 2;
}

function settings() {
  return LEVELS[level()];
}

/* ------------------------------------------------------------------ *
 * The Watcher
 *
 * A silent, invulnerable, AI-less humanoid. Everything it does is scripted
 * from here: it has no behaviour components at all, which is deliberate -
 * a mob with pathfinding walks at you like any other mob, while one that only
 * ever moves when you are not looking reads as something else entirely.
 * ------------------------------------------------------------------ */

function watchersNear(player, radius) {
  try {
    return player.dimension.getEntities({
      type: WATCHER,
      location: player.location,
      maxDistance: radius,
    });
  } catch {
    return [];
  }
}

function despawn(entity) {
  try {
    entity.remove();
  } catch {
    safe(() => entity.kill());
  }
}

/** Is the player looking at `entity`, within a cone? */
function looksAt(player, entity) {
  try {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const dx = entity.location.x - head.x;
    const dy = entity.location.y + 1.2 - head.y;
    const dz = entity.location.z - head.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const dot = (view.x * dx + view.y * dy + view.z * dz) / length;
    return dot >= CONFIG.gazeThreshold;
  } catch {
    return false;
  }
}

function distanceTo(player, entity) {
  const dx = entity.location.x - player.location.x;
  const dy = entity.location.y - player.location.y;
  const dz = entity.location.z - player.location.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A point behind the player, off to one side, dropped onto the ground. */
function behind(player, minDistance, maxDistance) {
  const view = player.getViewDirection();
  const spread = (Math.random() - 0.5) * 1.4; // radians, roughly +-40 degrees
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  const back = {
    x: -(view.x * cos - view.z * sin),
    z: -(view.x * sin + view.z * cos),
  };
  const distance = minDistance + Math.random() * (maxDistance - minDistance);
  const at = {
    x: player.location.x + back.x * distance,
    y: player.location.y + 3,
    z: player.location.z + back.z * distance,
  };
  return groundBelow(player.dimension, at);
}

function summonWatcher(player) {
  const at = behind(player, CONFIG.spawnMin, CONFIG.spawnMax);
  let watcher;
  try {
    watcher = player.dimension.spawnEntity(WATCHER, at);
  } catch {
    return; // unloaded chunk or spawn refused - try again next second
  }
  faceWatcher(watcher, player);
  localSound(player, "random.fizz", at);
}

function faceWatcher(watcher, player) {
  safe(() =>
    watcher.teleport(watcher.location, {
      facingLocation: player.getHeadLocation(),
    })
  );
}

function vanish(watcher, player, seen) {
  despawn(watcher);
  if (!seen) return;
  localSound(player, "mob.enderman.scream", player.location);
  if (chance(0.5)) whisper(player, pick(WHISPERS));
  if (settings().hunts) {
    safe(() => player.addEffect("darkness", 80, { showParticles: false }));
  }
}

function strike(watcher, player) {
  despawn(watcher);
  title(player, pick(SCARE_TITLES));
  localSound(player, "mob.warden.roar", player.location);
  shake(player, 4, 2.5);
  safe(() => player.addEffect("blindness", 100, { showParticles: false }));
  safe(() => player.addEffect("slowness", 100, { amplifier: 2, showParticles: false }));
  safe(() =>
    player.applyDamage(CONFIG.strikeDamage, { cause: EntityDamageCause.magic })
  );
}

function creepCloser(watcher, player) {
  const dx = player.location.x - watcher.location.x;
  const dz = player.location.z - watcher.location.z;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  const step = Math.min(CONFIG.stalkStep, length - 1);
  if (step <= 0) return;

  const target = groundBelow(watcher.dimension, {
    x: watcher.location.x + (dx / length) * step,
    y: watcher.location.y + 3,
    z: watcher.location.z + (dz / length) * step,
  });
  safe(() =>
    watcher.teleport(target, { facingLocation: player.getHeadLocation() })
  );
  if (chance(0.3)) localSound(player, "mob.skeleton.step", target);
}

function updateWatchers(player) {
  const config = settings();
  const watchers = watchersNear(player, CONFIG.cullDistance + 40);

  for (const watcher of watchers) {
    const distance = distanceTo(player, watcher);

    if (distance > CONFIG.cullDistance) {
      despawn(watcher);
      continue;
    }
    if (looksAt(player, watcher)) {
      vanish(watcher, player, true);
      continue;
    }
    if (distance <= CONFIG.strikeDistance) {
      strike(watcher, player);
      continue;
    }

    faceWatcher(watcher, player);
    if (config.hunts && chance(0.55)) creepCloser(watcher, player);
    if (chance(0.15)) localSound(player, "mob.warden.heartbeat", watcher.location);
  }

  if (config.watcher > 0 && watchers.length === 0 && chance(config.watcher)) {
    summonWatcher(player);
  }
}

function clearWatchers() {
  for (const dimension of dimensions()) {
    let found = [];
    try {
      found = dimension.getEntities({ type: WATCHER });
    } catch {
      continue;
    }
    for (const watcher of found) despawn(watcher);
  }
}

/* ------------------------------------------------------------------ *
 * Atmosphere
 * ------------------------------------------------------------------ */

function pushFog(player) {
  safe(() =>
    player.runCommand(`fog @s push ${CONFIG.fogId} ${CONFIG.fogTag}`)
  );
}

function popFog(player) {
  safe(() => player.runCommand(`fog @s remove ${CONFIG.fogTag}`));
}

function holdNight() {
  for (const dimension of dimensions()) {
    command(dimension, "time set night");
    command(dimension, "weather thunder 600");
  }
}

function ambientNoise(player) {
  // Positioned just out of sight so it reads as coming from somewhere real.
  const angle = Math.random() * Math.PI * 2;
  const radius = 4 + Math.random() * 10;
  const at = {
    x: player.location.x + Math.cos(angle) * radius,
    y: player.location.y + (Math.random() - 0.3) * 4,
    z: player.location.z + Math.sin(angle) * radius,
  };
  localSound(player, pick(AMBIENT_SOUNDS), at);

  if (chance(0.25)) {
    safe(() =>
      player.dimension.spawnParticle("minecraft:sculk_soul_particle", at)
    );
  }
}

function jumpscare(player) {
  title(player, pick(SCARE_TITLES));
  localSound(player, pick(SCARE_SOUNDS), player.location);
  shake(player, 3, 1.5);
  safe(() => player.addEffect("blindness", 40, { showParticles: false }));
  if (chance(0.5)) whisper(player, pick(WHISPERS));
}

/* ------------------------------------------------------------------ *
 * Turning the mode on and off
 * ------------------------------------------------------------------ */

function enable(source, requestedLevel) {
  safe(() => world.setDynamicProperty(PROPERTY.on, true));
  if (requestedLevel && LEVELS[requestedLevel]) {
    safe(() => world.setDynamicProperty(PROPERTY.level, requestedLevel));
  }

  holdNight();
  for (const player of world.getPlayers()) {
    pushFog(player);
    tell(player, "§4§lHORROR MODE§r §8engaged.§r");
    whisper(player, "it knows you are here now.");
    localSound(player, "mob.wither.spawn", player.location);
    title(player, "§4§lHORROR MODE");
  }
  report(source);
}

function disable(source) {
  safe(() => world.setDynamicProperty(PROPERTY.on, false));
  clearWatchers();

  for (const dimension of dimensions()) command(dimension, "weather clear");
  for (const player of world.getPlayers()) {
    popFog(player);
    safe(() => player.removeEffect("darkness"));
    safe(() => player.removeEffect("blindness"));
    tell(player, "§7Horror mode off. It is quiet again.§r");
  }
  if (source) tell(source, "§7[Horror] off§r");
}

function report(source) {
  if (!source) return;
  const config = settings();
  tell(
    source,
    `§8[Horror]§r ${isOn() ? "§4on§r" : "§7off§r"} · level §f${level()}§r (${config.name})`
  );
  tell(
    source,
    "§7/scriptevent horror:on · horror:off · horror:level 1-3 · horror:scare§r"
  );
}

/* ------------------------------------------------------------------ *
 * The main loop - one tick a second, and it returns immediately when the
 * mode is off, so an inactive world pays almost nothing for having this
 * pack installed.
 * ------------------------------------------------------------------ */

let seconds = 0;

system.runInterval(() => {
  if (!isOn()) return;
  seconds++;

  try {
    if (seconds % CONFIG.reassertSeconds === 0) holdNight();

    const config = settings();
    for (const player of world.getPlayers()) {
      if (chance(config.ambient)) ambientNoise(player);
      if (chance(config.whisper)) whisper(player, pick(WHISPERS));
      if (config.jumpscare > 0 && chance(config.jumpscare)) jumpscare(player);
      if (config.darkness > 0 && chance(config.darkness)) {
        safe(() => player.addEffect("darkness", 120, { showParticles: false }));
      }
      updateWatchers(player);
    }
  } catch (err) {
    console.warn(`[Horror] tick failed: ${err}`);
  }
}, 20);

/* ------------------------------------------------------------------ *
 * Chat control via /scriptevent - the stable way to read a typed command
 * ------------------------------------------------------------------ */

system.afterEvents.scriptEventReceive.subscribe((event) => {
  const id = event.id.toLowerCase();
  if (!id.startsWith("horror:")) return;

  const action = id.slice("horror:".length);
  const source = event.sourceEntity;
  const argument = (event.message ?? "").trim();

  try {
    switch (action) {
      case "on":
        enable(source, Number.parseInt(argument, 10) || undefined);
        break;
      case "off":
        disable(source);
        break;
      case "toggle":
        if (isOn()) disable(source);
        else enable(source);
        break;
      case "level": {
        const requested = Number.parseInt(argument, 10);
        if (!LEVELS[requested]) {
          if (source) tell(source, "§c[Horror] level must be 1, 2 or 3§r");
          break;
        }
        safe(() => world.setDynamicProperty(PROPERTY.level, requested));
        if (source) tell(source, `§8[Horror]§r level §f${requested}§r — ${LEVELS[requested].name}`);
        break;
      }
      case "scare":
        for (const player of world.getPlayers()) jumpscare(player);
        break;
      case "watcher":
        for (const player of world.getPlayers()) summonWatcher(player);
        break;
      case "status":
        report(source);
        break;
      default:
        if (source) tell(source, "§c[Horror] unknown command. horror:status§r");
        break;
    }
  } catch (err) {
    console.warn(`[Horror] command failed: ${err}`);
  }
});

/* ------------------------------------------------------------------ *
 * The Cursed Totem - the same toggle, for worlds with cheats off, where
 * /scriptevent is not available at all.
 * ------------------------------------------------------------------ */

const lastUse = new Map();

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  if (!player || event.itemStack?.typeId !== TOTEM) return;

  // itemUse and itemUseOn can both fire for one tap on touch controls.
  if (lastUse.get(player.id) === system.currentTick) return;
  lastUse.set(player.id, system.currentTick);

  try {
    if (player.isSneaking) {
      // Sneak + tap cycles the level without needing chat at all.
      const next = (level() % 3) + 1;
      safe(() => world.setDynamicProperty(PROPERTY.level, next));
      tell(player, `§8[Horror]§r level §f${next}§r — ${LEVELS[next].name}`);
      localSound(player, "random.orb", player.location);
      return;
    }
    if (isOn()) disable(player);
    else enable(player);
  } catch (err) {
    console.warn(`[Horror] totem failed: ${err}`);
  }
});

/* ------------------------------------------------------------------ *
 * Join handling - the fog is per-player and does not survive a rejoin.
 * ------------------------------------------------------------------ */

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (isOn()) {
    pushFog(player);
    if (event.initialSpawn) whisper(player, "you came back.");
    return;
  }
  if (!event.initialSpawn) return;
  tell(player, `§8[Horror Mode]§r v${VERSION} installed — currently §7off§r.`);
  tell(player, "§7Type §f/scriptevent horror:on§7 in chat to begin.§r");
});

console.warn(`[Horror] loaded (v${VERSION}) - awaiting /scriptevent horror:on`);
