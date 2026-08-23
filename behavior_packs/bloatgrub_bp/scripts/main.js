/*
 * Bloatgrub - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * The whole add-on is one nasty little life cycle:
 *
 *   dormant grub in your inventory
 *        |  you use it, or it simply gets tired of waiting
 *        v
 *   live grub on the ground  --leap-->  latched onto you
 *        |                                   |
 *        |  you kill it                      |  it burrows in
 *        v                                   v
 *   dormant grub drops                  INFESTED (a timer you can hear)
 *                                            |
 *                          purge serum <-----+-----> detonation
 *                          (survive, hurt)          (you die, brood hatches)
 *
 * Every cosmetic call is wrapped: a device or build missing one particle or
 * sound id should lose that flourish, never the mod. Every loop body is
 * wrapped too, so one bad entity cannot stop the ticking systems.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";

const VERSION = "1.0.0";

const ENTITY = "grub:bloatgrub";

const ITEMS = {
  DORMANT: "grub:dormant_bloatgrub",
  JAR: "grub:grub_jar",
  SERUM: "grub:purge_serum",
};

const TAG_INFESTED = "grub_infested";

/* ------------------------------------------------------------------ *
 * Tuning - everything you would want to change lives here
 * ------------------------------------------------------------------ */

const CONFIG = {
  // Ignore repeat itemUse events for this long after one is handled. It must
  // exceed the longest use_duration declared by any of the items, because
  // Bedrock re-fires the use action while the touch interact button is held,
  // at roughly that interval - a shorter guard lets one press eat a stack.
  useGuardTicks: 20,

  carry: {
    intervalTicks: 20,
    // A dormant grub in your bag wakes up on its own somewhere in this
    // window. Carrying several stacks counts several times per second, so a
    // pile of them wakes far sooner than a single specimen.
    minAgitationToWake: 90,
    maxAgitationToWake: 240,
    // Once it is this restless it starts testing your skin. A bite is a
    // warning, not a way to die: it never takes you below biteFloorHealth,
    // and it cannot land again until the cooldown is up. Without both of
    // those, a grub carried long enough simply nibbles you to death before
    // it ever wakes, which is neither scary nor fair.
    agitationToBite: 45,
    // ...but it starts muttering at you well before it starts biting.
    agitationToWhisper: 15,
    biteChance: 0.12,
    biteDamage: 1,
    biteFloorHealth: 6,
    biteCooldownTicks: 120,
    whisperChance: 0.22,
    // Creative players can carry and build with it safely.
    creativeImmune: true,
  },

  hunt: {
    intervalTicks: 4,
    scanRadius: 24,
    // The proximity scan is the only thing in this add-on that runs forever on
    // every player, so it does not run when there is nothing to find. It stays
    // awake for idleAfterTicks past the last sighting of a grub, and takes one
    // look every resyncTicks regardless, so a naturally spawned one wandering
    // into range is still picked up within a couple of seconds.
    idleAfterTicks: 200,
    resyncTicks: 40,
    // A grub cannot latch until it has existed this long - you always get to
    // see it come at you.
    armTicks: 24,
    // ...and a grub released or woken at YOUR expense must complete at least
    // one visible pounce before it is allowed in. Without this it simply walks
    // the last metre and burrows, and the middle beat of the whole mod - the
    // thing leaping at you - never happens. After this window it may burrow
    // regardless, so a grub cornered against a wall cannot deadlock.
    lungeWindowTicks: 200,
    // It lunges from here...
    leapRadius: 5.5,
    leapCooldownTicks: 26,
    leapForward: 0.85,
    leapUp: 0.45,
    // ...and gets inside from here.
    latchRadius: 1.75,
    latchMaxHeightDelta: 2.5,
    // How long a released grub stays fixated on whoever released it.
    bindTicks: 600,
  },

  infest: {
    intervalTicks: 2,
    // 11 seconds from burrow to blast.
    totalTicks: 220,
    biteIntervalTicks: 30,
    // mob.warden.heartbeat is about half a second long, and vanilla's own
    // minecraft:heartbeat never schedules it faster than every 0.5s. Below
    // that the samples overlap and the accelerating pulse - the only cue for
    // how much time is left - collapses into a flat drone.
    minBeatTicks: 10,
    // Internal bites never land the killing blow - the detonation does.
    bitesCanKill: false,
    // Blindness and darkness are strong; set to false if you find them unfair.
    useHeavyScreenEffects: true,
  },

  blast: {
    radius: 3.0,
    breaksBlocks: true,
    causesFire: false,
    // Extra guaranteed damage to everything standing next to the host.
    splashRadius: 4.0,
    splashDamage: 8,
    // How many fresh grubs crawl out of the crater - and a ceiling, so that
    // detonating next to your own bed cannot compound: two grubs become four
    // become six as you respawn into them.
    brood: 2,
    broodMaxNearby: 4,
    broodDelayTicks: 10,
    lethal: true,
    // A Totem of Undying is the game's own answer to "you are about to die".
    // Burning it and killing the player anyway makes it worthless; leave this
    // false and surviving the blast is exactly what the totem is for.
    ignoreTotems: false,
    deathMessage: true,
    // Nothing may re-enter the crater's victim for this long. Has to outlast
    // respawning and walking back, or the brood simply re-infests you.
    graceTicks: 300,
  },

  jar: {
    // How far the jar throws it, and how long its fumes keep the thrower off
    // the menu afterwards.
    throwDistance: 2.6,
    maskTicks: 200,
  },

  serum: {
    // Cutting it out costs you, but it always leaves you standing.
    selfDamage: 7,
    floorHealth: 1,
    nauseaTicks: 220,
    poisonTicks: 120,
    // The ejected grub is furious, but it cannot re-enter you for a while.
    graceTicks: 200,
  },

  death: {
    // Chance a dying grub bursts and leaves a fresh one behind.
    splitChance: 0.2,
    // ...but only if the area is not already crawling.
    maxNearby: 3,
    nearbyRadius: 16,
  },
};

/* ------------------------------------------------------------------ *
 * Cosmetic vocabulary
 *
 * These are deliberate LAYERS, not fallback chains. Bedrock ignores an unknown
 * sound id silently rather than throwing, so a "try the next one" list would
 * just play every entry at once - three voices at full volume for one event,
 * which turns to mud on a phone speaker. Each entry is therefore capped at two
 * layers, [id, volume, pitch], with the second voice sitting well under the
 * lead. tools/build.py checks every id against Bedrock 1.21.0's real sound
 * event list, because a typo here would be inaudible rather than an error.
 * ------------------------------------------------------------------ */

const FX = {
  squelch: [["mob.slime.squish", 0.9, 0.7]],
  chitter: [["mob.silverfish.say", 1.0, 0.8]],
  gnash: [["mob.silverfish.hit", 1.0, 0.7]],
  wake: [["mob.warden.nearby_closest", 1.0, 1.0], ["mob.slime.big", 0.45, 0.55]],
  burrow: [["mob.warden.angry", 1.0, 0.75], ["mob.slime.big", 0.6, 0.5]],
  heartbeat: [["mob.warden.heartbeat", 1.0, 1.0]],
  panic: [["mob.ghast.scream", 1.0, 0.65]],
  rupture: [["random.explode", 1.0, 0.8], ["mob.warden.sonic_boom", 0.55, 0.7]],
  cut: [["random.break", 1.0, 0.9], ["random.drink", 0.5, 0.8]],
  grubDeath: [["mob.silverfish.kill", 1.0, 0.95], ["random.burp", 0.35, 0.6]],
  jarBreak: [["random.glass", 0.8, 1.4]],
};

// Particles are layered the same way and for the same reason, except that an
// unsupported particle id CAN throw, which safe() absorbs. Two ids per effect
// is the ceiling: the emitters below are spawned in rings, so a third id
// multiplies straight into the per-frame emitter count on a phone.
const PFX = {
  ooze: ["minecraft:basic_smoke_particle", "minecraft:villager_angry"],
  bulge: ["minecraft:villager_angry"],
  gore: ["minecraft:critical_hit_emitter", "minecraft:villager_angry"],
  rupture: ["minecraft:huge_explosion_emitter"],
  cure: ["minecraft:villager_happy"],
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Run a cosmetic call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    fn();
  } catch {
    /* cosmetic only - ignore */
  }
}

/** Play a layer stack. `volume` and `pitch` scale every layer in it. */
function sound(dimension, layers, location, volume = 1, pitch = 1) {
  for (const [id, layerVolume = 1, layerPitch = 1] of layers) {
    const finalPitch = Math.max(0.5, Math.min(2, pitch * layerPitch));
    safe(() =>
      dimension.playSound(id, location, {
        volume: volume * layerVolume,
        pitch: finalPitch,
      })
    );
  }
}

function particle(dimension, ids, location) {
  for (const id of ids) {
    safe(() => dimension.spawnParticle(id, location));
  }
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

/** Roughly chest height on a player, body centre on anything else. */
function chest(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1.1, z: loc.z };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function allPlayers() {
  try {
    return world.getAllPlayers();
  } catch {
    /* older signature */
  }
  try {
    return world.getPlayers();
  } catch {
    return [];
  }
}

function playerById(id) {
  for (const player of allPlayers()) {
    if (player.id === id) return player;
  }
  return undefined;
}

function isCreative(player) {
  try {
    // getGameMode() is not present on every 1.21 build, hence the guard.
    const mode = player.getGameMode?.();
    return mode === "creative" || mode === "spectator";
  } catch {
    return false;
  }
}

function alive(entity) {
  try {
    // isValid is a property on newer builds and a method on older ones.
    const valid = entity?.isValid;
    if (typeof valid === "function") return Boolean(valid.call(entity));
    if (typeof valid === "boolean") return valid;
    return Boolean(entity);
  } catch {
    return false;
  }
}

/** Is block-breaking allowed? Players turn this off to protect their builds. */
function mobGriefingAllowed() {
  try {
    const value = world.gameRules?.mobGriefing;
    return value === undefined ? true : Boolean(value);
  } catch {
    return true;
  }
}

function nearbyEntities(dimension, location, radius, type) {
  try {
    const query = { location, maxDistance: radius };
    if (type) query.type = type;
    return dimension.getEntities(query);
  } catch {
    return [];
  }
}

function hurt(entity, amount, cause, attacker) {
  try {
    entity.applyDamage(amount, { cause, damagingEntity: attacker });
  } catch {
    safe(() => entity.applyDamage(amount));
  }
}

function effect(entity, id, ticks, amplifier = 0, particles = false) {
  safe(() =>
    entity.addEffect(id, ticks, { amplifier, showParticles: particles })
  );
}

function command(player, text) {
  try {
    player.runCommand(text);
    return;
  } catch {
    /* fall through to the async form */
  }
  safe(() => player.runCommandAsync(text));
}

/** Positional camera shake. Silently does nothing where commands are blocked. */
function shake(player, intensity, seconds) {
  command(
    player,
    `camerashake add @s ${intensity.toFixed(2)} ${seconds.toFixed(2)} positional`
  );
}

function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

function title(player, text, subtitle, stay = 30) {
  safe(() =>
    player.onScreenDisplay.setTitle(text, {
      subtitle,
      fadeInDuration: 2,
      stayDuration: stay,
      fadeOutDuration: 6,
    })
  );
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

function inventoryOf(player) {
  try {
    return player.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

/** How many dormant grubs is this player carrying, and where is the first? */
function findDormant(player) {
  const container = inventoryOf(player);
  if (!container) return { container: undefined, count: 0, slot: -1 };

  let count = 0;
  let slot = -1;
  try {
    for (let index = 0; index < container.size; index++) {
      const item = container.getItem(index);
      if (item?.typeId !== ITEMS.DORMANT) continue;
      count += item.amount ?? 1;
      if (slot < 0) slot = index;
    }
  } catch {
    return { container, count: 0, slot: -1 };
  }
  return { container, count, slot };
}

function consumeSlot(container, slot) {
  try {
    const item = container.getItem(slot);
    if (!item) return false;
    if ((item.amount ?? 1) <= 1) {
      container.setItem(slot, undefined);
    } else {
      item.amount -= 1;
      container.setItem(slot, item);
    }
    return true;
  } catch {
    return false;
  }
}

/** Take one of `typeId` out of the main hand. Creative keeps its stack. */
function consumeHeld(player, typeId) {
  if (isCreative(player)) return true;
  try {
    const equippable = player.getComponent("minecraft:equippable");
    const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!item || item.typeId !== typeId) return false;
    if ((item.amount ?? 1) <= 1) {
      equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    } else {
      item.amount -= 1;
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
    }
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * State
 *
 * All of it is short lived (seconds), so it lives in memory rather than in
 * dynamic properties. The infested tag is the one durable marker, which also
 * gives players a documented escape hatch: /tag @s remove grub_infested
 * ------------------------------------------------------------------ */

/** playerId -> agitation score and the threshold it is climbing towards */
const carrying = new Map();
/** playerId -> { ticks, stage, nextBeat, nextBite } */
const infested = new Map();
/** grubId -> { hostId, until, armAt } */
const bound = new Map();
/** grubId -> tick the grub was first seen, so it cannot latch instantly */
const seenGrubs = new Map();
/** grubId -> tick its next lunge is allowed */
const lungeReady = new Map();
/** playerId -> tick until which nothing may latch onto them */
const latchGrace = new Map();
/** playerId -> tick until which a repeat itemUse is ignored */
const useGuard = new Map();

/** Tick a grub was last spawned, loaded or seen - gates the proximity scan. */
let lastGrubSeen = -1e9;
/** Tick the proximity scan last actually ran. */
let lastScan = -1e9;
/** Tick the bookkeeping maps were last swept. */
let lastPrune = -1e9;

function noticeGrub(tick) {
  lastGrubSeen = tick;
}

function now() {
  try {
    return system.currentTick;
  } catch {
    return 0;
  }
}

function forget(playerId) {
  carrying.delete(playerId);
  infested.delete(playerId);
  latchGrace.delete(playerId);
  useGuard.delete(playerId);
  for (const [grubId, link] of bound) {
    if (link.hostId === playerId) bound.delete(grubId);
  }
}

/** Drop bookkeeping for grubs that are gone, so the maps cannot grow forever. */
function pruneGrubState(tick) {
  for (const [grubId, link] of bound) {
    if (link.until < tick) bound.delete(grubId);
  }
  for (const [grubId, firstSeen] of seenGrubs) {
    if (tick - firstSeen > 12000) seenGrubs.delete(grubId);
  }
  for (const [grubId, ready] of lungeReady) {
    if (ready < tick - 1200) lungeReady.delete(grubId);
  }
  for (const [playerId, until] of latchGrace) {
    if (until < tick) latchGrace.delete(playerId);
  }
}

/* ------------------------------------------------------------------ *
 * Spawning grubs
 * ------------------------------------------------------------------ */

function spawnGrub(dimension, location, fallback) {
  let grub;
  try {
    grub = dimension.spawnEntity(ENTITY, location);
  } catch {
    /* location was unloaded or inside a block - try the fallback */
  }
  if (!grub && fallback) {
    try {
      grub = dimension.spawnEntity(ENTITY, fallback);
    } catch {
      return undefined;
    }
  }
  if (grub) noticeGrub(now());
  return grub;
}

function bindTo(grub, player, tick, armTicks) {
  if (!grub) return;
  bound.set(grub.id, {
    hostId: player.id,
    until: tick + CONFIG.hunt.bindTicks,
    armAt: tick + armTicks,
    hasLunged: false,
  });
  seenGrubs.set(grub.id, tick);
}

/** Shove a grub through the air at a point - the visible pounce. */
function lungeAt(grub, targetLocation) {
  const link = bound.get(grub.id);
  if (link) link.hasLunged = true;
  const from = grub.location;
  const dx = targetLocation.x - from.x;
  const dz = targetLocation.z - from.z;
  const flat = Math.sqrt(dx * dx + dz * dz) || 1;
  safe(() =>
    grub.applyImpulse({
      x: (dx / flat) * CONFIG.hunt.leapForward,
      y: CONFIG.hunt.leapUp,
      z: (dz / flat) * CONFIG.hunt.leapForward,
    })
  );
  sound(grub.dimension, FX.gnash, grub.location);
  particle(grub.dimension, PFX.ooze, chest(grub));
}

/* ------------------------------------------------------------------ *
 * Releasing a grub from the inventory
 * ------------------------------------------------------------------ */

/** You used the animal itself. It goes for the hand that held it. */
function releaseOnSelf(player) {
  const tick = now();
  const dimension = player.dimension;
  let view = { x: 0, y: 0, z: 1 };
  safe(() => {
    view = player.getViewDirection();
  });

  // Well outside latchRadius, and thrown further out, so it has to come back
  // at you through the air.
  const spot = offset(player.location, view.x * 4.0, 1.3, view.z * 4.0);
  const grub = spawnGrub(dimension, spot, offset(player.location, 0, 1, 0));
  if (!grub) {
    actionBar(player, "§8It will not come out here.");
    return false;
  }

  // Binding it to somebody who can never be infested - a creative player
  // showing it off to a friend - would make it refuse to burrow into anyone
  // at all until the bind expires. Leave it free to pick its own target.
  if (eligibleHost(player, tick)) {
    bindTo(grub, player, tick, CONFIG.hunt.armTicks);
  } else {
    seenGrubs.set(grub.id, tick);
  }
  safe(() => grub.applyImpulse({ x: view.x * 0.5, y: 0.3, z: view.z * 0.5 }));

  sound(dimension, FX.wake, player.location, 1, 1.1);
  particle(dimension, PFX.ooze, spot);
  shake(player, 0.35, 0.4);
  actionBar(player, "§cIt uncurls in your palm.");
  return true;
}

/** The jar throws it away from you, and masks your scent while you run. */
function releaseFromJar(player) {
  const tick = now();
  const dimension = player.dimension;
  let view = { x: 0, y: 0, z: 1 };
  safe(() => {
    view = player.getViewDirection();
  });

  const reach = CONFIG.jar.throwDistance;
  const spot = offset(
    player.location,
    view.x * reach,
    1.3 + view.y * 1.5,
    view.z * reach
  );
  const grub = spawnGrub(dimension, spot, offset(player.location, 0, 1, 0));
  if (!grub) {
    actionBar(player, "§8There is no room to throw it.");
    return false;
  }

  seenGrubs.set(grub.id, tick);
  safe(() =>
    grub.applyImpulse({ x: view.x * 1.1, y: 0.35 + view.y * 0.4, z: view.z * 1.1 })
  );

  latchGrace.set(player.id, tick + CONFIG.jar.maskTicks);
  sound(dimension, FX.chitter, spot);
  sound(dimension, FX.jarBreak, player.location);
  particle(dimension, PFX.ooze, spot);
  actionBar(player, "§7The jar breaks. Its fumes hide you - briefly.");
  return true;
}

/* ------------------------------------------------------------------ *
 * It gets inside you
 * ------------------------------------------------------------------ */

function eligibleHost(player, tick) {
  if (!alive(player)) return false;
  if (CONFIG.carry.creativeImmune && isCreative(player)) return false;
  if (infested.has(player.id)) return false;
  const grace = latchGrace.get(player.id) ?? 0;
  return grace <= tick;
}

function burrow(grub, player) {
  const dimension = player.dimension;
  const at = chest(player);

  safe(() => grub.remove());
  bound.delete(grub.id);
  seenGrubs.delete(grub.id);
  lungeReady.delete(grub.id);

  infested.set(player.id, {
    ticks: 0,
    stage: -1,
    nextBeat: 0,
    nextBite: CONFIG.infest.biteIntervalTicks,
  });
  safe(() => player.addTag(TAG_INFESTED));

  sound(dimension, FX.burrow, at);
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    particle(
      dimension,
      PFX.gore,
      offset(at, Math.cos(angle) * 0.6, (i % 3) * 0.25, Math.sin(angle) * 0.6)
    );
  }
  shake(player, 1.7, 0.7);
  title(
    player,
    "§4§lIT IS INSIDE YOU",
    "§7something is turning around behind your ribs",
    40
  );
}

/* ------------------------------------------------------------------ *
 * Infestation - the countdown you can hear
 * ------------------------------------------------------------------ */

const STAGES = [
  {
    at: 0.0,
    beat: 30,
    whisper: "§7Something went in under your skin.",
    effects: [["nausea", 1]],
    bite: 0,
    shake: 0.2,
  },
  {
    at: 0.2,
    beat: 24,
    whisper: "§7It is working its way toward your chest.",
    effects: [["nausea", 1], ["slowness", 0]],
    bite: 2,
    shake: 0.4,
  },
  {
    at: 0.42,
    beat: 16,
    whisper: "§cIt has started eating.",
    effects: [["nausea", 2], ["weakness", 1]],
    bite: 3,
    shake: 0.7,
    banner: ["§c§lIT IS EATING", "§7use a Purge Serum"],
  },
  {
    at: 0.66,
    beat: 12,
    whisper: "§4Your ribs are creaking outward.",
    effects: [["nausea", 2], ["weakness", 1], ["mining_fatigue", 1]],
    heavy: [["blindness", 0]],
    bite: 4,
    shake: 1.1,
  },
  {
    at: 0.87,
    beat: 10,
    whisper: "§4§lIT IS SWELLING",
    effects: [["nausea", 3], ["slowness", 2]],
    heavy: [["darkness", 0]],
    bite: 5,
    shake: 2.0,
    banner: ["§4§lIT IS SWELLING", "§8there is no time left"],
  },
];

function stageFor(progress) {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (progress >= STAGES[i].at) index = i;
  }
  return index;
}

function enterStage(player, stage) {
  for (const [id, amplifier] of stage.effects) {
    effect(player, id, 80, amplifier);
  }
  if (CONFIG.infest.useHeavyScreenEffects && stage.heavy) {
    for (const [id, amplifier] of stage.heavy) {
      effect(player, id, 70, amplifier);
    }
  }
  if (stage.banner) {
    title(player, stage.banner[0], stage.banner[1], 30);
  }
  actionBar(player, stage.whisper);
  shake(player, stage.shake, 0.6);
  sound(player.dimension, FX.squelch, chest(player), 0.9);
}

/**
 * Damage that refuses to be the killing blow.
 *
 * `floor` is the health it will not take you below; pass 0 to allow a kill.
 * Returns how much was actually dealt, so callers can tell a real bite from a
 * bite that had nothing left to take.
 */
function gnaw(player, amount, floor, cause) {
  let allowed = amount;
  if (floor > 0) {
    try {
      const health = player.getComponent("minecraft:health");
      const current = health?.currentValue ?? 20;
      allowed = Math.min(amount, Math.max(0, current - floor));
    } catch {
      allowed = amount;
    }
  }
  if (allowed <= 0) return 0;
  hurt(player, allowed, cause ?? EntityDamageCause.magic);
  return allowed;
}

/** Damage from inside ignores armour, and by default leaves you for the blast. */
function biteHost(player, amount) {
  const dealt = gnaw(
    player,
    amount,
    CONFIG.infest.bitesCanKill ? 0 : 1,
    EntityDamageCause.magic
  );
  if (dealt > 0) particle(player.dimension, PFX.bulge, chest(player));
  return dealt;
}

function clearInfest(player) {
  infested.delete(player.id);
  safe(() => player.removeTag(TAG_INFESTED));
}

/**
 * Is the player still marked?
 *
 * The tag is authoritative, not decorative, which is what makes
 * `/tag @s remove grub_infested` the escape hatch the README says it is.
 * On any error this answers yes: an API hiccup should not cure someone.
 */
function stillInfested(player) {
  try {
    return player.hasTag(TAG_INFESTED);
  } catch {
    return true;
  }
}

/** Forget an infestation whether or not the player object is still to hand. */
function dropInfest(playerId, player) {
  infested.delete(playerId);
  if (player) safe(() => player.removeTag(TAG_INFESTED));
}

function tickInfestation(player, state) {
  if (!stillInfested(player)) {
    // Somebody cleared the tag by hand. Let them go.
    infested.delete(player.id);
    return;
  }

  const step = CONFIG.infest.intervalTicks;
  const total = CONFIG.infest.totalTicks;
  state.ticks += step;

  const progress = state.ticks / total;
  const index = stageFor(progress);
  const stage = STAGES[index];

  if (index !== state.stage) {
    state.stage = index;
    enterStage(player, stage);
  }

  state.nextBeat -= step;
  if (state.nextBeat <= 0) {
    state.nextBeat = Math.max(CONFIG.infest.minBeatTicks, stage.beat);
    const pitch = 0.7 + progress * 0.6;
    sound(player.dimension, FX.heartbeat, chest(player), 1, pitch);
    particle(player.dimension, PFX.bulge, chest(player));
    if (progress > 0.6) shake(player, 0.35, 0.2);
  }

  state.nextBite -= step;
  if (state.nextBite <= 0) {
    state.nextBite = CONFIG.infest.biteIntervalTicks;
    if (stage.bite > 0) biteHost(player, stage.bite);
  }

  if (state.ticks >= total) detonate(player);
}

/* ------------------------------------------------------------------ *
 * Detonation
 * ------------------------------------------------------------------ */

function killHost(player) {
  if (!CONFIG.blast.lethal) return;
  hurt(player, 1000, EntityDamageCause.entityExplosion);

  let survived = false;
  try {
    survived = (player.getComponent("minecraft:health")?.currentValue ?? 0) > 0;
  } catch {
    survived = false;
  }
  if (!survived) return;

  // Still standing after a thousand damage means something intervened - a
  // totem, or another add-on. Let it.
  if (!CONFIG.blast.ignoreTotems) {
    actionBar(player, "§6Something held you together. It will not hold twice.");
    return;
  }

  try {
    const health = player.getComponent("minecraft:health");
    if (health && health.currentValue > 0) health.setCurrentValue(0);
  } catch {
    /* fall through */
  }
  safe(() => player.kill?.());
}

function detonate(player) {
  const dimension = player.dimension;
  const at = player.location;
  const core = chest(player);
  const name = player.name ?? "Someone";

  clearInfest(player);
  latchGrace.set(player.id, now() + CONFIG.blast.graceTicks);

  sound(dimension, FX.panic, core);
  shake(player, 3.5, 0.5);

  // Explode on the next tick so nothing here runs inside a read-only window.
  system.run(() => {
    safe(() =>
      dimension.createExplosion(at, CONFIG.blast.radius, {
        breaksBlocks: CONFIG.blast.breaksBlocks && mobGriefingAllowed(),
        causesFire: CONFIG.blast.causesFire,
        allowUnderwater: true,
      })
    );

    particle(dimension, PFX.rupture, core);
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      particle(
        dimension,
        PFX.gore,
        offset(core, Math.cos(angle) * 1.4, (i % 3) * 0.5 - 0.4, Math.sin(angle) * 1.4)
      );
    }
    sound(dimension, FX.rupture, core);

    for (const other of nearbyEntities(dimension, at, CONFIG.blast.splashRadius)) {
      if (other.id === player.id) continue;
      hurt(other, CONFIG.blast.splashDamage, EntityDamageCause.entityExplosion);
    }

    killHost(player);

    // Never hatch more than the area can hold. Without this, detonating near
    // your own bed compounds: you respawn into two grubs, they get you again,
    // and now there are four.
    const crowd = nearbyEntities(
      dimension,
      at,
      CONFIG.death.nearbyRadius,
      ENTITY
    ).length;
    const hatching = Math.max(
      0,
      Math.min(CONFIG.blast.brood, CONFIG.blast.broodMaxNearby - crowd)
    );
    // Half a second later, not in the blast frame. spawnEntity is the most
    // expensive call here - entity construction plus AI setup - and stacking
    // it on top of the explosion, the block breaking and the gore ring is a
    // visible hitch at exactly the moment this wants to land clean. It is a
    // better beat this way too: a still crater, and then things climb out.
    system.runTimeout(() => {
      try {
        for (let i = 0; i < hatching; i++) {
          const angle = (Math.PI * 2 * i) / Math.max(1, hatching);
          const spot = offset(at, Math.cos(angle) * 1.2, 0.6, Math.sin(angle) * 1.2);
          const child = spawnGrub(dimension, spot, at);
          if (child) seenGrubs.set(child.id, now());
        }
        if (hatching > 0) sound(dimension, FX.chitter, core, 1, 1.2);
      } catch (err) {
        console.warn(`[Bloatgrub] brood failed: ${err}`);
      }
    }, CONFIG.blast.broodDelayTicks);

    if (CONFIG.blast.deathMessage) {
      safe(() =>
        world.sendMessage(`§4${name} was hollowed out by a Bloatgrub.`)
      );
    }
  });
}

/* ------------------------------------------------------------------ *
 * Cutting it out
 * ------------------------------------------------------------------ */

function purge(player) {
  const state = infested.get(player.id);
  if (!state) {
    // Returning false is what stops the dose being consumed: a mis-tap, or a
    // second event from a held button, must not cost you the cure you are
    // about to need.
    actionBar(player, "§8Nothing is inside you. Not yet.");
    sound(player.dimension, FX.cut, player.location, 0.4, 1.3);
    return false;
  }

  const dimension = player.dimension;
  const tick = now();
  clearInfest(player);

  // Always leaves you standing, but barely.
  gnaw(
    player,
    CONFIG.serum.selfDamage,
    CONFIG.serum.floorHealth,
    EntityDamageCause.magic
  );

  effect(player, "nausea", CONFIG.serum.nauseaTicks, 2);
  effect(player, "poison", CONFIG.serum.poisonTicks, 0);
  effect(player, "slowness", 120, 1);
  effect(player, "weakness", 200, 1);

  sound(dimension, FX.cut, chest(player));
  particle(dimension, PFX.gore, chest(player));
  particle(dimension, PFX.cure, chest(player));
  shake(player, 1.4, 0.5);

  let view = { x: 0, y: 0, z: 1 };
  safe(() => {
    view = player.getViewDirection();
  });
  const spot = offset(player.location, view.x * 1.6, 0.8, view.z * 1.6);
  const grub = spawnGrub(dimension, spot, player.location);
  if (grub) {
    seenGrubs.set(grub.id, tick);
    safe(() => grub.triggerEvent("grub:enrage"));
    safe(() =>
      grub.applyImpulse({ x: view.x * 0.7, y: 0.4, z: view.z * 0.7 })
    );
  }

  latchGrace.set(player.id, tick + CONFIG.serum.graceTicks);
  title(player, "§a§lYOU CUT IT OUT", "§7it is still alive, and it is angry", 40);
  return true;
}

/* ------------------------------------------------------------------ *
 * Tick systems
 * ------------------------------------------------------------------ */

// 1. Carrying one. It does not stay asleep.
system.runInterval(() => {
  const tick = now();
  for (const player of allPlayers()) {
    try {
      const { container, count, slot } = findDormant(player);
      if (!container || count <= 0 || slot < 0) {
        carrying.delete(player.id);
        continue;
      }
      if (CONFIG.carry.creativeImmune && isCreative(player)) continue;

      let state = carrying.get(player.id);
      if (!state) {
        const span = CONFIG.carry.maxAgitationToWake - CONFIG.carry.minAgitationToWake;
        state = {
          agitation: 0,
          wakeAt: CONFIG.carry.minAgitationToWake + Math.floor(Math.random() * span),
          biteReadyAt: 0,
        };
        carrying.set(player.id, state);
        // Phones get played on mute. Say something the first time, or a
        // player can carry this for four minutes with no idea it is alive.
        actionBar(player, "§8It is warm. It should not be warm.");
        particle(player.dimension, PFX.ooze, chest(player));
      }

      state.agitation += count;

      if (Math.random() < CONFIG.carry.whisperChance) {
        sound(player.dimension, FX.squelch, player.location, 0.35);
        if (state.agitation > CONFIG.carry.agitationToWhisper) {
          actionBar(player, "§8Something in your bag just moved.");
          particle(player.dimension, PFX.ooze, chest(player));
        }
      }

      if (
        state.agitation > CONFIG.carry.agitationToBite &&
        tick >= state.biteReadyAt &&
        Math.random() < CONFIG.carry.biteChance
      ) {
        const dealt = gnaw(
          player,
          CONFIG.carry.biteDamage,
          CONFIG.carry.biteFloorHealth,
          EntityDamageCause.contact
        );
        if (dealt > 0) {
          state.biteReadyAt = tick + CONFIG.carry.biteCooldownTicks;
          actionBar(player, "§cIt bit you through the bag.");
          sound(player.dimension, FX.gnash, player.location, 0.6, 1.2);
        }
      }

      if (state.agitation >= state.wakeAt) {
        let view = { x: 0, y: 0, z: 1 };
        safe(() => {
          view = player.getViewDirection();
        });
        // Behind you and out of reach - it has to cross the gap itself.
        const spot = offset(player.location, -view.x * 3.4, 1.3, -view.z * 3.4);

        // Spawn first, consume second. The other order destroys the item when
        // there is nowhere for the grub to appear - crawling through a
        // one-block gap, or up against the world height limit - and the player
        // gets no grub, no item and no explanation.
        const grub = spawnGrub(
          player.dimension,
          spot,
          offset(player.location, 0, 1, 0)
        );
        if (!grub) continue; // leave the carry clock running; try again later
        carrying.delete(player.id);
        consumeSlot(container, slot);

        bindTo(grub, player, tick, CONFIG.hunt.armTicks);
        sound(player.dimension, FX.wake, player.location, 1, 0.9);
        particle(player.dimension, PFX.ooze, chest(player));
        shake(player, 1.0, 0.6);
        title(player, "§4§lIT WOKE UP", "§7it was never asleep", 35);
      }
    } catch (err) {
      console.warn(`[Bloatgrub] carry tick failed: ${err}`);
    }
  }
}, CONFIG.carry.intervalTicks);

// 2. Hunting. Lunge, then get inside.
system.runInterval(() => {
  const tick = now();

  // Nothing to hunt with, nothing to scan for.
  const quiet = tick - lastGrubSeen > CONFIG.hunt.idleAfterTicks;
  const overdue = tick - lastScan >= CONFIG.hunt.resyncTicks;
  if (quiet && !overdue) return;
  lastScan = tick;

  // Sweep on its own clock, not on `overdue`: that only becomes true after the
  // scan has been idle, which is precisely when there is nothing to sweep.
  if (tick - lastPrune >= CONFIG.hunt.resyncTicks) {
    lastPrune = tick;
    pruneGrubState(tick);
  }

  for (const player of allPlayers()) {
    try {
      if (!eligibleHost(player, tick)) continue;

      const dimension = player.dimension;
      const grubs = nearbyEntities(
        dimension,
        player.location,
        CONFIG.hunt.scanRadius,
        ENTITY
      );

      if (grubs.length > 0) noticeGrub(tick);

      for (const grub of grubs) {
        if (!alive(grub)) continue;

        const link = bound.get(grub.id);
        if (link && link.hostId !== player.id) continue;

        if (!seenGrubs.has(grub.id)) seenGrubs.set(grub.id, tick);
        const armAt = link?.armAt ?? (seenGrubs.get(grub.id) + CONFIG.hunt.armTicks);
        if (tick < armAt) continue;

        const gap = distance(grub.location, player.location);
        const heightGap = Math.abs(grub.location.y - player.location.y);

        // Make it earn the entrance: a grub bound to this player has to land
        // at least one pounce first, unless it has been trying for a while.
        const owes =
          link &&
          !link.hasLunged &&
          tick < link.armAt + CONFIG.hunt.lungeWindowTicks;

        if (
          !owes &&
          gap <= CONFIG.hunt.latchRadius &&
          heightGap <= CONFIG.hunt.latchMaxHeightDelta
        ) {
          burrow(grub, player);
          break;
        }

        if (gap <= CONFIG.hunt.leapRadius) {
          const ready = lungeReady.get(grub.id) ?? 0;
          if (tick >= ready) {
            lungeReady.set(grub.id, tick + CONFIG.hunt.leapCooldownTicks);
            lungeAt(grub, chest(player));
          }
        }
      }
    } catch (err) {
      console.warn(`[Bloatgrub] hunt tick failed: ${err}`);
    }
  }
}, CONFIG.hunt.intervalTicks);

// 3. The countdown.
system.runInterval(() => {
  if (infested.size === 0) return;
  for (const [playerId, state] of [...infested]) {
    try {
      const player = playerById(playerId);
      if (!player || !alive(player)) {
        dropInfest(playerId, player);
        continue;
      }
      tickInfestation(player, state);
    } catch (err) {
      console.warn(`[Bloatgrub] infest tick failed: ${err}`);
      dropInfest(playerId, playerById(playerId));
    }
  }
}, CONFIG.infest.intervalTicks);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack?.typeId;
  if (!player || !used) return;
  if (used !== ITEMS.DORMANT && used !== ITEMS.JAR && used !== ITEMS.SERUM) return;

  const tick = now();
  const guard = useGuard.get(player.id) ?? 0;
  if (tick < guard) return;
  useGuard.set(player.id, tick + CONFIG.useGuardTicks);

  try {
    if (used === ITEMS.DORMANT) {
      if (releaseOnSelf(player)) consumeHeld(player, ITEMS.DORMANT);
      return;
    }
    if (used === ITEMS.JAR) {
      if (releaseFromJar(player)) consumeHeld(player, ITEMS.JAR);
      return;
    }
    if (used === ITEMS.SERUM) {
      if (purge(player)) consumeHeld(player, ITEMS.SERUM);
    }
  } catch (err) {
    console.warn(`[Bloatgrub] item use failed: ${err}`);
  }
});

world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  if (!dead) return;

  try {
    if (dead.typeId === "minecraft:player") {
      // Dying to anything else robs the grub of its meal.
      infested.delete(dead.id);
      safe(() => dead.removeTag(TAG_INFESTED));
      carrying.delete(dead.id);
      return;
    }

    if (dead.typeId !== ENTITY) return;

    bound.delete(dead.id);
    seenGrubs.delete(dead.id);
    lungeReady.delete(dead.id);

    const dimension = dead.dimension;
    const at = chest(dead);
    // Read the corpse's position now: Entity.location throws once the handle
    // goes invalid, and the split below runs a tick later.
    const deadAt = { ...dead.location };
    sound(dimension, FX.grubDeath, at);
    particle(dimension, PFX.gore, at);

    if (Math.random() >= CONFIG.death.splitChance) return;
    const crowd = nearbyEntities(
      dimension,
      dead.location,
      CONFIG.death.nearbyRadius,
      ENTITY
    ).length;
    if (crowd >= CONFIG.death.maxNearby) return;

    system.run(() => {
      try {
        const child = spawnGrub(dimension, offset(deadAt, 0.4, 0.4, 0.4), deadAt);
        if (child) {
          seenGrubs.set(child.id, now());
          sound(dimension, FX.chitter, at, 1, 1.3);
        }
      } catch (err) {
        console.warn(`[Bloatgrub] brood split failed: ${err}`);
      }
    });
  } catch (err) {
    console.warn(`[Bloatgrub] death handler failed: ${err}`);
  }
});

// A grub that spawns naturally, or rides in on a chunk load, wakes the scan
// immediately rather than waiting for the next resync. Both signals exist in
// @minecraft/server 1.11.0; the guard is for builds where they do not.
for (const signal of ["entitySpawn", "entityLoad"]) {
  safe(() =>
    world.afterEvents[signal].subscribe((event) => {
      if (event?.entity?.typeId === ENTITY) noticeGrub(now());
    })
  );
}

world.afterEvents.playerLeave.subscribe((event) => {
  const id = event.playerId;
  if (id) forget(id);
});

// Visible proof the script module actually loaded. If you join a world and do
// NOT see this line in chat, the behaviour pack's scripts are not running and
// nothing below will happen - that is the first thing to check.
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  try {
    // A respawn always comes back clean, whatever was inside you - and gets
    // the same breathing room a purge grants, so a player cannot walk back to
    // their own crater and be taken straight back down by the brood.
    infested.delete(player.id);
    safe(() => player.removeTag(TAG_INFESTED));
    latchGrace.set(player.id, now() + CONFIG.blast.graceTicks);
    if (!event.initialSpawn) return;
    player.sendMessage(
      `§2[Bloatgrub]§r v${VERSION} loaded - do not pick it up.`
    );
  } catch {
    /* ignore */
  }
});

console.warn(`[Bloatgrub] v${VERSION} loaded.`);
