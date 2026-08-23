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
  carry: {
    intervalTicks: 20,
    // A dormant grub in your bag wakes up on its own somewhere in this
    // window. Carrying several stacks counts several times per second, so a
    // pile of them wakes far sooner than a single specimen.
    minAgitationToWake: 90,
    maxAgitationToWake: 240,
    // Once it is this restless it starts testing your skin.
    agitationToBite: 45,
    biteChance: 0.12,
    biteDamage: 1,
    whisperChance: 0.22,
    // Creative players can carry and build with it safely.
    creativeImmune: true,
  },

  hunt: {
    intervalTicks: 4,
    scanRadius: 24,
    // A grub cannot latch until it has existed this long - you always get to
    // see it come at you.
    armTicks: 12,
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
    // How many fresh grubs crawl out of the crater.
    brood: 2,
    lethal: true,
    deathMessage: true,
  },

  serum: {
    // Cutting it out costs you.
    selfDamage: 7,
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
 * Several ids per effect on purpose: safe() swallows any that a given build
 * does not know, so the survivors still carry the moment.
 * ------------------------------------------------------------------ */

const FX = {
  squelch: ["mob.slime.squish", "mob.slime.attack"],
  chitter: ["mob.silverfish.say", "mob.spider.say"],
  gnash: ["mob.silverfish.hurt", "mob.slime.attack"],
  wake: ["mob.warden.nearby_closest", "mob.ghast.moan", "mob.silverfish.say"],
  burrow: ["mob.warden.angry", "mob.slime.big", "random.burp"],
  heartbeat: ["mob.warden.heartbeat", "mob.slime.small"],
  panic: ["mob.ghast.scream", "mob.warden.angry"],
  rupture: ["random.explode", "mob.warden.sonic_boom", "mob.slime.big"],
  cut: ["random.break", "mob.silverfish.kill", "random.drink"],
  grubDeath: ["mob.silverfish.kill", "mob.slime.small", "random.burp"],
};

const PFX = {
  ooze: [
    "minecraft:basic_smoke_particle",
    "minecraft:villager_angry",
  ],
  bulge: [
    "minecraft:villager_angry",
    "minecraft:basic_crit_particle",
  ],
  gore: [
    "minecraft:critical_hit_emitter",
    "minecraft:basic_crit_particle",
    "minecraft:villager_angry",
  ],
  rupture: [
    "minecraft:huge_explosion_emitter",
    "minecraft:critical_hit_emitter",
  ],
  cure: [
    "minecraft:villager_happy",
    "minecraft:basic_smoke_particle",
  ],
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

function sound(dimension, ids, location, volume = 1, pitch = 1) {
  for (const id of ids) {
    safe(() => dimension.playSound(id, location, { volume, pitch }));
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
  try {
    return dimension.spawnEntity(ENTITY, location);
  } catch {
    /* location was unloaded or inside a block - try the fallback */
  }
  if (fallback) {
    try {
      return dimension.spawnEntity(ENTITY, fallback);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function bindTo(grub, player, tick, armTicks) {
  if (!grub) return;
  bound.set(grub.id, {
    hostId: player.id,
    until: tick + CONFIG.hunt.bindTicks,
    armAt: tick + armTicks,
  });
  seenGrubs.set(grub.id, tick);
}

/** Shove a grub through the air at a point - the visible pounce. */
function lungeAt(grub, targetLocation) {
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
  sound(grub.dimension, FX.gnash, grub.location, 1, 0.7);
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

  const spot = offset(player.location, view.x * 1.2, 1.4, view.z * 1.2);
  const grub = spawnGrub(dimension, spot, offset(player.location, 0, 1, 0));
  if (!grub) {
    actionBar(player, "§8It will not come out here.");
    return false;
  }

  bindTo(grub, player, tick, CONFIG.hunt.armTicks);
  safe(() => grub.applyImpulse({ x: -view.x * 0.3, y: 0.25, z: -view.z * 0.3 }));

  sound(dimension, FX.wake, player.location, 1, 1.15);
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

  const spot = offset(
    player.location,
    view.x * 2.6,
    1.3 + view.y * 1.5,
    view.z * 2.6
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

  latchGrace.set(player.id, tick + CONFIG.serum.graceTicks);
  sound(dimension, FX.chitter, spot, 1, 0.9);
  sound(dimension, ["random.glass"], player.location, 0.8, 1.4);
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

  sound(dimension, FX.burrow, at, 1, 0.8);
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i) / 10;
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
    beat: 26,
    whisper: "§7Something went in under your skin.",
    effects: [["nausea", 1]],
    bite: 0,
    shake: 0.2,
  },
  {
    at: 0.2,
    beat: 20,
    whisper: "§7It is working its way toward your chest.",
    effects: [["nausea", 1], ["slowness", 0]],
    bite: 2,
    shake: 0.4,
  },
  {
    at: 0.42,
    beat: 14,
    whisper: "§cIt has started eating.",
    effects: [["nausea", 2], ["weakness", 1]],
    bite: 3,
    shake: 0.7,
    banner: ["§c§lIT IS EATING", "§7use a Purge Serum"],
  },
  {
    at: 0.66,
    beat: 9,
    whisper: "§4Your ribs are creaking outward.",
    effects: [["nausea", 2], ["weakness", 1], ["mining_fatigue", 1]],
    heavy: [["blindness", 0]],
    bite: 4,
    shake: 1.1,
  },
  {
    at: 0.87,
    beat: 5,
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
  sound(player.dimension, FX.squelch, chest(player), 0.9, 0.6);
}

/** Damage from inside ignores armour, and by default leaves you alive for the blast. */
function biteHost(player, amount) {
  let allowed = amount;
  if (!CONFIG.infest.bitesCanKill) {
    try {
      const health = player.getComponent("minecraft:health");
      const current = health?.currentValue ?? 20;
      allowed = Math.min(amount, Math.max(0, current - 1));
    } catch {
      allowed = amount;
    }
  }
  if (allowed <= 0) return;
  hurt(player, allowed, EntityDamageCause.magic);
  particle(player.dimension, PFX.bulge, chest(player));
}

function clearInfest(player) {
  infested.delete(player.id);
  safe(() => player.removeTag(TAG_INFESTED));
}

function tickInfestation(player, state) {
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
    state.nextBeat = stage.beat;
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
  try {
    const health = player.getComponent("minecraft:health");
    if (health && health.currentValue > 0) health.setCurrentValue(0);
  } catch {
    /* fall through */
  }
  try {
    const health = player.getComponent("minecraft:health");
    if (health && health.currentValue > 0) player.kill?.();
  } catch {
    /* nothing left to try - a totem earned it */
  }
}

function detonate(player) {
  const dimension = player.dimension;
  const at = player.location;
  const core = chest(player);
  const name = player.name ?? "Someone";

  clearInfest(player);
  latchGrace.set(player.id, now() + CONFIG.serum.graceTicks);

  sound(dimension, FX.panic, core, 1, 0.6);
  shake(player, 3.5, 0.5);

  // Explode on the next tick so nothing here runs inside a read-only window.
  system.run(() => {
    safe(() =>
      dimension.createExplosion(at, CONFIG.blast.radius, {
        breaksBlocks: CONFIG.blast.breaksBlocks,
        causesFire: CONFIG.blast.causesFire,
        allowUnderwater: true,
      })
    );

    particle(dimension, PFX.rupture, core);
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16;
      particle(
        dimension,
        PFX.gore,
        offset(core, Math.cos(angle) * 1.4, (i % 4) * 0.4 - 0.4, Math.sin(angle) * 1.4)
      );
    }
    sound(dimension, FX.rupture, core, 1, 0.8);

    for (const other of nearbyEntities(dimension, at, CONFIG.blast.splashRadius)) {
      if (other.id === player.id) continue;
      hurt(other, CONFIG.blast.splashDamage, EntityDamageCause.entityExplosion);
    }

    killHost(player);

    const tick = now();
    for (let i = 0; i < CONFIG.blast.brood; i++) {
      const angle = (Math.PI * 2 * i) / Math.max(1, CONFIG.blast.brood);
      const spot = offset(at, Math.cos(angle) * 1.2, 0.6, Math.sin(angle) * 1.2);
      const child = spawnGrub(dimension, spot, at);
      if (child) seenGrubs.set(child.id, tick);
    }

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
    actionBar(player, "§8Nothing is inside you. Not yet.");
    sound(player.dimension, ["random.drink"], player.location, 0.7, 1.2);
    return true;
  }

  const dimension = player.dimension;
  const tick = now();
  clearInfest(player);

  // Always leaves you standing, but barely.
  const before = CONFIG.infest.bitesCanKill;
  CONFIG.infest.bitesCanKill = false;
  biteHost(player, CONFIG.serum.selfDamage);
  CONFIG.infest.bitesCanKill = before;

  effect(player, "nausea", CONFIG.serum.nauseaTicks, 2);
  effect(player, "poison", CONFIG.serum.poisonTicks, 0);
  effect(player, "slowness", 120, 1);
  effect(player, "weakness", 200, 1);

  sound(dimension, FX.cut, chest(player), 1, 0.9);
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
        };
        carrying.set(player.id, state);
      }

      state.agitation += count;

      if (Math.random() < CONFIG.carry.whisperChance) {
        sound(player.dimension, FX.squelch, player.location, 0.35, 0.7);
        if (state.agitation > CONFIG.carry.agitationToBite) {
          actionBar(player, "§8Something in your bag just moved.");
          particle(player.dimension, PFX.ooze, chest(player));
        }
      }

      if (
        state.agitation > CONFIG.carry.agitationToBite &&
        Math.random() < CONFIG.carry.biteChance
      ) {
        hurt(player, CONFIG.carry.biteDamage, EntityDamageCause.contact);
        actionBar(player, "§cIt bit you through the bag.");
        sound(player.dimension, FX.gnash, player.location, 0.6, 1.1);
      }

      if (state.agitation >= state.wakeAt) {
        carrying.delete(player.id);
        if (!consumeSlot(container, slot)) continue;

        let view = { x: 0, y: 0, z: 1 };
        safe(() => {
          view = player.getViewDirection();
        });
        const spot = offset(player.location, -view.x * 0.9, 1.6, -view.z * 0.9);
        const grub = spawnGrub(spot ? player.dimension : player.dimension, spot, offset(player.location, 0, 1, 0));
        if (!grub) continue;

        bindTo(grub, player, tick, CONFIG.hunt.armTicks);
        sound(player.dimension, FX.wake, player.location, 1, 0.85);
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
  pruneGrubState(tick);

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

      for (const grub of grubs) {
        if (!alive(grub)) continue;

        const link = bound.get(grub.id);
        if (link && link.hostId !== player.id) continue;

        if (!seenGrubs.has(grub.id)) seenGrubs.set(grub.id, tick);
        const armAt = link?.armAt ?? (seenGrubs.get(grub.id) + CONFIG.hunt.armTicks);
        if (tick < armAt) continue;

        const gap = distance(grub.location, player.location);
        const heightGap = Math.abs(grub.location.y - player.location.y);

        if (gap <= CONFIG.hunt.latchRadius && heightGap <= CONFIG.hunt.latchMaxHeightDelta) {
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
        infested.delete(playerId);
        continue;
      }
      tickInfestation(player, state);
    } catch (err) {
      console.warn(`[Bloatgrub] infest tick failed: ${err}`);
      infested.delete(playerId);
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
  useGuard.set(player.id, tick + 6);

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
    sound(dimension, FX.grubDeath, at, 1, 1.05);
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
      const child = spawnGrub(dimension, offset(dead.location, 0.4, 0.4, 0.4), dead.location);
      if (child) {
        seenGrubs.set(child.id, now());
        sound(dimension, FX.chitter, at, 1, 1.3);
      }
    });
  } catch (err) {
    console.warn(`[Bloatgrub] death handler failed: ${err}`);
  }
});

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
    // A respawn always comes back clean, whatever was inside you.
    infested.delete(player.id);
    safe(() => player.removeTag(TAG_INFESTED));
    if (!event.initialSpawn) return;
    player.sendMessage(
      `§2[Bloatgrub]§r v${VERSION} loaded - do not pick it up.`
    );
  } catch {
    /* ignore */
  }
});

console.warn(`[Bloatgrub] v${VERSION} loaded.`);
