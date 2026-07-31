/*
 * Spirit Guardian - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Spawn the spirit and it binds to you. From then on it flies: it orbits your
 * shoulder, follows you anywhere, and the moment something hurts you it breaks
 * off, chases the attacker down and takes its soul. Souls come back to you as
 * healing, and stack up into Absorption.
 *
 * Flight is driven from script rather than by mob AI. The entity has no
 * gravity and no navigation components, and this loop teleports it along a
 * smoothed path each update, which is what lets it hover, orbit and dive the
 * way vanilla pathing never would.
 */

import { world, system, EntityDamageCause } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const SPIRIT = "spirit:guardian";

const CONFIG = {
  updateTicks: 2, // how often the flight loop runs

  // Hovering beside its owner.
  orbitRadius: 2.1,
  orbitSpeed: 0.09, // radians per update
  hoverHeight: 1.5,
  bobHeight: 0.35,
  // Speeds are per update and scale with how far behind it is, otherwise a
  // sprinting player simply outruns it forever.
  followSpeed: 0.5,
  maxFollowSpeed: 2.6,
  chaseSpeed: 1.1,
  maxChaseSpeed: 3.2,
  catchUp: 0.35, // extra speed per block of lag
  recallDistance: 28, // beyond this it blinks straight to the owner
  resummonAfter: 3, // updates without finding a bound spirit before recalling it

  // Guarding.
  bindRadius: 24, // how far away a new spirit will look for an owner
  guardRadius: 14, // hostiles this close to the owner get hunted unprompted
  strikeRange: 2.4, // how close it must get to take a soul
  hunt: {
    giveUpTicks: 200, // stop chasing something it cannot reach
  },
  instantKill: true, // false = deal strikeDamage instead of taking the soul whole
  strikeDamage: 40,

  // What a soul is worth to you.
  healPerSoul: 4, // half-hearts
  absorptionEvery: 5, // souls per Absorption tier
  absorptionSeconds: 90,
  maxAbsorption: 4,

  protectOwner: true, // avenge damage dealt to the owner
  huntHostiles: true, // also hunt hostiles that merely come close
};

/* Never a valid target, whatever else happens. */
const NEVER_TARGET = new Set([
  SPIRIT,
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:area_effect_cloud",
  "minecraft:lightning_bolt",
  "minecraft:painting",
  "minecraft:leash_knot",
  "minecraft:armor_stand",
  "minecraft:boat",
  "minecraft:chest_boat",
  "minecraft:minecart",
  "minecraft:falling_block",
  "minecraft:tnt",
  "minecraft:fishing_hook",
  "minecraft:eye_of_ender_signal",
  "minecraft:ender_crystal",
]);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function safe(fn) {
  try {
    fn();
  } catch (error) {
    /* ignored on purpose */
  }
}

function attempt(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function spawnParticle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function playSound(dimension, id, location) {
  safe(() => dimension.playSound(id, location));
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** isValid is a method on some 1.21 builds and a property on others. */
function isAlive(entity) {
  if (!entity) return false;
  return attempt(() => {
    if (typeof entity.isValid === "function") return entity.isValid();
    if (typeof entity.isValid === "boolean") return entity.isValid;
    return entity.location !== undefined;
  }, false);
}

function isPlayer(entity) {
  return entity?.typeId === "minecraft:player";
}

/* Dynamic properties are the only storage that survives a reload; the maps are
 * the fallback for builds that refuse them. */
const memory = new Map();

function remember(entity, key, value) {
  memory.set(`${entity.id}:${key}`, value);
  safe(() => entity.setDynamicProperty(key, value));
}

function recall(entity, key) {
  const stored = attempt(() => entity.getDynamicProperty(key));
  if (stored !== undefined) return stored;
  return memory.get(`${entity.id}:${key}`);
}

/* ------------------------------------------------------------------ *
 * Per-spirit state
 * ------------------------------------------------------------------ */

const state = new Map(); // spirit id -> { angle, targetId, huntStart, position }

function stateOf(spirit) {
  let value = state.get(spirit.id);
  if (!value) {
    value = { angle: Math.random() * Math.PI * 2, targetId: undefined, huntStart: 0 };
    state.set(spirit.id, value);
  }
  return value;
}

function ownerOf(spirit) {
  const ownerId = recall(spirit, "spirit:owner");
  if (!ownerId) return undefined;
  return world.getAllPlayers().find((player) => player.id === ownerId);
}

function bindTo(spirit, player) {
  remember(spirit, "spirit:owner", player.id);
  remember(spirit, "spirit:mode", "guard");
  safe(() => world.setDynamicProperty(`spirit:bound:${player.id}`, true));
  safe(() => (spirit.nameTag = `§b${player.name}'s Spirit`));
  player.sendMessage("§b[Spirit]§r A guardian has bound itself to you.");
  playSound(spirit.dimension, "beacon.activate", spirit.location);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    spawnParticle(
      spirit.dimension,
      "minecraft:endrod",
      offset(bodyLocation(spirit), Math.cos(angle), 0.2, Math.sin(angle))
    );
  }
}

/* Souls are the owner's, not the spirit's, so they survive a re-summon. */
function soulsOf(player) {
  return attempt(() => world.getDynamicProperty(`spirit:souls:${player.id}`), 0) ?? 0;
}

function setSouls(player, count) {
  safe(() => world.setDynamicProperty(`spirit:souls:${player.id}`, count));
}

/* ------------------------------------------------------------------ *
 * Targeting
 * ------------------------------------------------------------------ */

function isValidTarget(entity, owner) {
  if (!entity || !isAlive(entity)) return false;
  if (NEVER_TARGET.has(entity.typeId)) return false;
  if (isPlayer(entity)) return false; // the spirit never turns on people
  if (owner && entity.id === owner.id) return false;
  return true;
}

/** Hostiles loitering near the owner, nearest first. */
function nearbyHostiles(owner) {
  const found = attempt(
    () =>
      owner.dimension.getEntities({
        location: owner.location,
        maxDistance: CONFIG.guardRadius,
        families: ["monster"],
      }),
    []
  );
  return found
    .filter((entity) => isValidTarget(entity, owner))
    .sort((a, b) => distance(a.location, owner.location) - distance(b.location, owner.location));
}

/* ------------------------------------------------------------------ *
 * Taking a soul
 * ------------------------------------------------------------------ */

// Our own killing blow raises entityHurt again; without this the avenge
// handler would mark the spirit's victim as a fresh attacker.
const executing = new Set();

function takeSoul(spirit, target, owner) {
  if (!isValidTarget(target, owner)) return false;
  if (executing.has(target.id)) return false;

  executing.add(target.id);
  const release = target.id;
  system.run(() => executing.delete(release));

  const dimension = spirit.dimension;
  const where = bodyLocation(target);

  // The strike itself.
  spawnParticle(dimension, "minecraft:critical_hit_emitter", where);
  playSound(dimension, "mob.evocation_illager.prepare_attack", where);

  if (CONFIG.instantKill) {
    // Damage credited to the owner first, so drops and XP behave normally.
    safe(() =>
      target.applyDamage(1000000, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: owner ?? spirit,
      })
    );
    if (isAlive(target)) safe(() => target.kill());
  } else {
    safe(() =>
      target.applyDamage(CONFIG.strikeDamage, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: owner ?? spirit,
      })
    );
    if (isAlive(target)) return false; // wounded, not harvested
  }

  soulOrb(dimension, where, spirit, owner);
  return true;
}

/** The soul drifting out of the body and into the owner. */
function soulOrb(dimension, from, spirit, owner) {
  const destination = owner && isAlive(owner) ? owner : spirit;
  playSound(dimension, "mob.wither.death", from);

  let step = 0;
  const steps = 10;
  const travel = () => {
    const to = isAlive(destination) ? bodyLocation(destination) : from;
    const progress = step / steps;
    const point = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress + Math.sin(progress * Math.PI) * 0.8,
      z: from.z + (to.z - from.z) * progress,
    };
    spawnParticle(dimension, "minecraft:endrod", point);
    if (step % 3 === 0) spawnParticle(dimension, "minecraft:basic_smoke_particle", point);

    step += 1;
    if (step <= steps) {
      system.runTimeout(travel, 1);
      return;
    }
    if (owner && isAlive(owner)) claimSoul(owner, dimension);
  };
  system.run(travel);
}

function claimSoul(owner, dimension) {
  const souls = soulsOf(owner) + 1;
  setSouls(owner, souls);

  safe(() => {
    const health = owner.getComponent("minecraft:health");
    if (health) {
      health.setCurrentValue(
        Math.min(health.effectiveMax ?? health.defaultValue ?? 20,
          health.currentValue + CONFIG.healPerSoul)
      );
    }
  });
  spawnParticle(dimension, "minecraft:heart_particle", bodyLocation(owner));
  playSound(dimension, "random.orb", owner.location);

  if (souls % CONFIG.absorptionEvery === 0) {
    const tier = Math.min(CONFIG.maxAbsorption, Math.floor(souls / CONFIG.absorptionEvery) - 1);
    safe(() =>
      owner.addEffect("absorption", CONFIG.absorptionSeconds * 20, {
        amplifier: Math.max(0, tier),
        showParticles: true,
      })
    );
    spawnParticle(dimension, "minecraft:totem_particle", bodyLocation(owner));
    playSound(dimension, "random.totem", owner.location);
    owner.sendMessage(`§b[Spirit]§r ${souls} souls taken - the bond strengthens.`);
  }
  safe(() => owner.onScreenDisplay.setActionBar(`§b❂ Souls: ${souls}`));
}

/* ------------------------------------------------------------------ *
 * Flight
 * ------------------------------------------------------------------ */

/** How fast to move when `gap` blocks from where it wants to be. */
function speedFor(gap, base, cap) {
  return Math.min(cap, base + gap * CONFIG.catchUp);
}

/** Move the spirit toward `goal`, at most `speed` blocks, facing `lookAt`. */
function glide(spirit, goal, speed, lookAt) {
  const here = spirit.location;
  const gap = distance(here, goal);

  let destination = goal;
  if (gap > speed) {
    const scale = speed / gap;
    destination = {
      x: here.x + (goal.x - here.x) * scale,
      y: here.y + (goal.y - here.y) * scale,
      z: here.z + (goal.z - here.z) * scale,
    };
  }

  safe(() =>
    spirit.teleport(destination, {
      dimension: spirit.dimension,
      facingLocation: lookAt ?? offset(destination, 0, 0, 1),
      keepVelocity: false,
    })
  );
}

function hoverPoint(owner, spiritState) {
  spiritState.angle = (spiritState.angle + CONFIG.orbitSpeed) % (Math.PI * 2);
  const bob = Math.sin(spiritState.angle * 3) * CONFIG.bobHeight;
  return {
    x: owner.location.x + Math.cos(spiritState.angle) * CONFIG.orbitRadius,
    y: owner.location.y + CONFIG.hoverHeight + bob,
    z: owner.location.z + Math.sin(spiritState.angle) * CONFIG.orbitRadius,
  };
}

function trail(spirit) {
  if (system.currentTick % 4 !== 0) return;
  spawnParticle(spirit.dimension, "minecraft:endrod", bodyLocation(spirit));
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

function updateSpirit(spirit, owner) {
  const spiritState = stateOf(spirit);

  // No owner yet, or the owner is away: hold station and wait.
  if (!owner || !isAlive(owner)) {
    trail(spirit);
    return;
  }

  // Different dimension, or simply left behind - blink to the owner.
  if (
    spirit.dimension.id !== owner.dimension.id ||
    distance(spirit.location, owner.location) > CONFIG.recallDistance
  ) {
    const point = hoverPoint(owner, spiritState);
    safe(() =>
      spirit.teleport(point, { dimension: owner.dimension, facingLocation: bodyLocation(owner) })
    );
    spawnParticle(owner.dimension, "minecraft:endrod", point);
    spiritState.targetId = undefined;
    return;
  }

  // Pick or keep a target.
  let target = spiritState.targetId
    ? attempt(() => spirit.dimension.getEntities({ location: spirit.location, maxDistance: 64 }), [])
        .find((entity) => entity.id === spiritState.targetId)
    : undefined;

  if (target && !isValidTarget(target, owner)) target = undefined;
  if (target && system.currentTick - spiritState.huntStart > CONFIG.hunt.giveUpTicks) {
    target = undefined;
  }
  const guarding = (recall(spirit, "spirit:mode") ?? "guard") === "guard";
  if (!target && CONFIG.huntHostiles && guarding) {
    target = nearbyHostiles(owner)[0];
    if (target) spiritState.huntStart = system.currentTick;
  }
  spiritState.targetId = target?.id;

  if (target) {
    const aim = bodyLocation(target);
    glide(
      spirit,
      aim,
      speedFor(distance(spirit.location, aim), CONFIG.chaseSpeed, CONFIG.maxChaseSpeed),
      aim
    );
    trail(spirit);

    if (distance(spirit.location, aim) <= CONFIG.strikeRange) {
      if (takeSoul(spirit, target, owner)) {
        spiritState.targetId = undefined;
      }
    }
    return;
  }

  const station = hoverPoint(owner, spiritState);
  glide(
    spirit,
    station,
    speedFor(distance(spirit.location, station), CONFIG.followSpeed, CONFIG.maxFollowSpeed),
    bodyLocation(owner)
  );
  trail(spirit);
}

const DIMENSION_IDS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

function loadedDimensions() {
  const found = [];
  for (const id of DIMENSION_IDS) {
    const dimension = attempt(() => world.getDimension(id));
    if (dimension) found.push(dimension);
  }
  return found;
}

/** Owners whose spirit we could not find this update, and for how long. */
const missing = new Map();

function summonFor(player) {
  const spirit = attempt(() =>
    player.dimension.spawnEntity(SPIRIT, offset(player.location, 0, 1.5, 0))
  );
  if (!spirit) return undefined;
  // Set the owner before the spawn handler runs, so it binds to the right
  // player even if somebody else happens to be standing closer.
  remember(spirit, "spirit:owner", player.id);
  remember(spirit, "spirit:mode", "guard");
  safe(() => (spirit.nameTag = `§b${player.name}'s Spirit`));
  player.sendMessage("§b[Spirit]§r Your guardian finds its way back to you.");
  playSound(player.dimension, "mob.endermen.portal", player.location);
  return spirit;
}

system.runInterval(() => {
  const players = attempt(() => world.getAllPlayers(), []);
  const byOwner = new Map();
  const unbound = [];

  // Sweep every loaded dimension, not just the space around each player: a
  // spirit that gets left behind is exactly the one that needs recalling, and
  // it is never within scanning range of its owner when that happens.
  for (const dimension of loadedDimensions()) {
    for (const spirit of attempt(() => dimension.getEntities({ type: SPIRIT }), [])) {
      const ownerId = recall(spirit, "spirit:owner");
      if (!ownerId) {
        unbound.push(spirit);
        continue;
      }
      if (byOwner.has(ownerId)) {
        // One guardian each. Duplicates fade rather than stack up.
        safe(() => (typeof spirit.remove === "function" ? spirit.remove() : spirit.kill()));
        continue;
      }
      byOwner.set(ownerId, spirit);
    }
  }

  // A spirit nobody owns binds to whoever is closest.
  for (const spirit of unbound) {
    let closest;
    let best = CONFIG.bindRadius;
    for (const player of players) {
      if (player.dimension.id !== spirit.dimension.id) continue;
      const away = distance(player.location, spirit.location);
      if (away <= best && !byOwner.has(player.id)) {
        best = away;
        closest = player;
      }
    }
    if (closest) {
      bindTo(spirit, closest);
      byOwner.set(closest.id, spirit);
    }
  }

  for (const player of players) {
    const spirit = byOwner.get(player.id);

    if (!spirit) {
      // Bound, but its chunk is gone - after a moment, call it back.
      if (attempt(() => world.getDynamicProperty(`spirit:bound:${player.id}`), false)) {
        const misses = (missing.get(player.id) ?? 0) + 1;
        missing.set(player.id, misses);
        if (misses >= CONFIG.resummonAfter) {
          missing.set(player.id, 0);
          summonFor(player);
        }
      }
      continue;
    }

    missing.set(player.id, 0);
    try {
      updateSpirit(spirit, player);
    } catch (error) {
      console.warn(`[Spirit Guardian] update failed: ${error}`);
    }
  }

  // Spirits whose owner is offline just drift where they are.
  for (const [ownerId, spirit] of byOwner) {
    if (!players.some((player) => player.id === ownerId)) trail(spirit);
  }
}, CONFIG.updateTicks);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

/** Anything that hurts the owner becomes the spirit's problem. */
world.afterEvents.entityHurt.subscribe((event) => {
  if (!CONFIG.protectOwner) return;
  const { hurtEntity, damage, damageSource } = event;
  if (!hurtEntity || !isPlayer(hurtEntity) || damage <= 0) return;

  const attacker = damageSource?.damagingEntity;
  if (!attacker || executing.has(attacker.id)) return;
  if (!isValidTarget(attacker, hurtEntity)) return;

  const spirits = attempt(
    () =>
      hurtEntity.dimension.getEntities({
        type: SPIRIT,
        location: hurtEntity.location,
        maxDistance: 64,
      }),
    []
  );

  for (const spirit of spirits) {
    if (recall(spirit, "spirit:owner") !== hurtEntity.id) continue;
    const spiritState = stateOf(spirit);
    if (spiritState.targetId === attacker.id) continue;
    spiritState.targetId = attacker.id;
    spiritState.huntStart = system.currentTick;
    playSound(spirit.dimension, "mob.vex.charge", spirit.location);
    spawnParticle(spirit.dimension, "minecraft:critical_hit_emitter", bodyLocation(spirit));
  }
});

/** A freshly spawned spirit binds to whoever is closest. */
world.afterEvents.entitySpawn.subscribe((event) => {
  const spirit = event.entity;
  if (!spirit || spirit.typeId !== SPIRIT) return;
  if (recall(spirit, "spirit:owner")) return;

  system.run(() => {
    if (!isAlive(spirit)) return;
    const players = attempt(() => world.getAllPlayers(), []);
    let closest;
    let best = CONFIG.bindRadius;
    for (const player of players) {
      if (player.dimension.id !== spirit.dimension.id) continue;
      const gap = distance(player.location, spirit.location);
      if (gap <= best) {
        best = gap;
        closest = player;
      }
    }
    if (closest) bindTo(spirit, closest);
  });
});

/** Tap the spirit for a status report; sneak-tap to toggle hunting. */
world.afterEvents.playerInteractWithEntity?.subscribe((event) => {
  const spirit = event.target;
  const player = event.player;
  if (!spirit || spirit.typeId !== SPIRIT || !player) return;

  const ownerId = recall(spirit, "spirit:owner");
  if (ownerId && ownerId !== player.id) {
    player.sendMessage("§b[Spirit]§r This spirit is bound to someone else.");
    return;
  }
  if (!ownerId) {
    bindTo(spirit, player);
    return;
  }

  if (player.isSneaking) {
    // Sneak-tap cycles guard -> escort -> dismissed. Dismissing matters:
    // a bound spirit is recalled automatically, so this is the way to be rid
    // of one. A spawn egg gets you another whenever you want it.
    const current = recall(spirit, "spirit:mode") ?? "guard";
    if (current === "guard") {
      remember(spirit, "spirit:mode", "escort");
      player.sendMessage("§b[Spirit]§r Escort mode: it will only avenge attacks on you.");
      return;
    }
    if (current === "escort") {
      remember(spirit, "spirit:mode", "dismissed");
      safe(() => world.setDynamicProperty(`spirit:bound:${player.id}`, false));
      spawnParticle(spirit.dimension, "minecraft:basic_smoke_particle", bodyLocation(spirit));
      playSound(spirit.dimension, "mob.endermen.portal", spirit.location);
      safe(() => (typeof spirit.remove === "function" ? spirit.remove() : spirit.kill()));
      player.sendMessage(
        `§b[Spirit]§r The guardian fades. Your ${soulsOf(player)} souls stay with you.`
      );
      return;
    }
    return;
  }

  player.sendMessage(
    `§b[Spirit]§r Souls taken: §f${soulsOf(player)}§b. Mode: §f${recall(spirit, "spirit:mode") ?? "guard"}§b.`
  );
  safe(() => player.onScreenDisplay.setActionBar(`§b❂ Souls: ${soulsOf(player)}`));
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§b[Spirit Guardian]§r v1.0.0 loaded - use the spawn egg, or /function spirit_summon."
    )
  );
});
