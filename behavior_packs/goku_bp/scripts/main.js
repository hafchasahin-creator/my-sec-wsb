/*
 * Goku Abilities - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Every ability is an inventory item. Hold it and tap the use button (touch)
 * or right-click (keyboard/controller) to fire it.
 *
 * The whole file is defensive on purpose: a single unsupported particle or
 * sound id on a given device should never take the add-on down, so all
 * cosmetic calls are wrapped and every handler is guarded.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";

const VERSION = "1.0.0";

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

const ITEMS = {
  KI_BLAST: "goku:ki_blast",
  KAMEHAMEHA: "goku:kamehameha",
  SPIRIT_BOMB: "goku:spirit_bomb",
  DESTRUCTO_DISK: "goku:destructo_disk",
  DRAGON_FIST: "goku:dragon_fist",
  SOLAR_FLARE: "goku:solar_flare",
  INSTANT_TRANSMISSION: "goku:instant_transmission",
  FLYING_NIMBUS: "goku:flying_nimbus",
  KAIOKEN: "goku:kaioken",
  SUPER_SAIYAN: "goku:super_saiyan",
  SUPER_SAIYAN_BLUE: "goku:super_saiyan_blue",
  ULTRA_INSTINCT: "goku:ultra_instinct",
  SENZU_BEAN: "goku:senzu_bean",
  POWER_POLE: "goku:power_pole",
};

/* ------------------------------------------------------------------ *
 * Tuning - every number worth changing lives here
 * ------------------------------------------------------------------ */

const CONFIG = {
  kiBlast: {
    cooldownTicks: 20,
    range: 26,
    damage: 8,
    beamRadius: 1.4,
    knockback: 0.6,
  },
  kamehameha: {
    cooldownTicks: 160,
    chargeTicks: 16,
    range: 44,
    damage: 26,
    beamRadius: 2.0,
    knockback: 2.2,
    impactRadius: 2.5,
    breaksBlocks: false,
  },
  spiritBomb: {
    cooldownTicks: 600,
    chargeTicks: 60, // gathering energy - the caster is slowed while charging
    range: 40,
    fallHeight: 22,
    fallTicks: 24,
    explosionRadius: 6,
    damage: 45,
    damageRadius: 10,
    breaksBlocks: true,
    causesFire: false,
  },
  destructoDisk: {
    cooldownTicks: 120,
    range: 40,
    speed: 1.4, // blocks per tick
    damage: 20,
    cutRadius: 1.6,
    maxTargets: 8,
  },
  dragonFist: {
    cooldownTicks: 240,
    dashStrength: 3.2,
    dashLift: 0.45,
    windowTicks: 30,
    hitRadius: 3.0,
    damage: 32,
    igniteSeconds: 6,
    explosionRadius: 2,
    breaksBlocks: false,
  },
  solarFlare: {
    cooldownTicks: 300,
    radius: 14,
    blindTicks: 160,
    slowTicks: 160,
    slowAmplifier: 2,
  },
  instantTransmission: {
    cooldownTicks: 100,
    range: 64,
  },
  nimbus: {
    cooldownTicks: 60,
    durationTicks: 2400, // 2 minutes of flight per activation
    riseThreshold: 0.35, // look this far up to climb
    speedAmplifier: 1,
  },
  senzu: {
    healToFull: true,
    absorptionTicks: 600,
    regenerationTicks: 100,
    consume: true,
  },
  powerPole: {
    cooldownTicks: 60,
    range: 14,
    damage: 12,
    knockback: 1.2,
    durabilityCost: 1,
  },
  // Transformations. Only one can be active at a time.
  forms: {
    "goku:kaioken": {
      name: "Kaio-ken",
      colour: "§c",
      durationTicks: 600, // 30s
      effects: [
        ["strength", 1],
        ["speed", 1],
        ["haste", 1],
        ["resistance", 0],
        ["jump_boost", 0],
      ],
      // The classic drawback: it burns the user.
      drainEveryTicks: 40,
      drainAmount: 1,
      particles: ["minecraft:basic_flame_particle", "minecraft:lava_particle"],
      sound: "mob.blaze.shoot",
    },
    "goku:super_saiyan": {
      name: "Super Saiyan",
      colour: "§e",
      durationTicks: 1200, // 60s
      effects: [
        ["strength", 1],
        ["speed", 0],
        ["resistance", 0],
        ["regeneration", 0],
        ["jump_boost", 1],
        ["fire_resistance", 0],
      ],
      particles: ["minecraft:basic_flame_particle", "minecraft:totem_particle"],
      sound: "random.levelup",
    },
    "goku:super_saiyan_blue": {
      name: "Super Saiyan Blue",
      colour: "§b",
      durationTicks: 900, // 45s
      effects: [
        ["strength", 2],
        ["speed", 1],
        ["resistance", 1],
        ["regeneration", 1],
        ["jump_boost", 1],
        ["fire_resistance", 0],
        ["water_breathing", 0],
      ],
      particles: ["minecraft:endrod", "minecraft:electric_spark_particle"],
      sound: "beacon.activate",
    },
    "goku:ultra_instinct": {
      name: "Ultra Instinct",
      colour: "§f",
      durationTicks: 600, // 30s
      effects: [
        ["strength", 1],
        ["speed", 2],
        ["haste", 1],
        ["resistance", 3],
        ["regeneration", 1],
        ["jump_boost", 2],
        ["fire_resistance", 0],
        ["night_vision", 0],
      ],
      // Autonomous dodge: incoming damage is refunded and the body slips aside.
      dodge: true,
      dodgeDistance: 2.5,
      particles: ["minecraft:endrod", "minecraft:villager_happy"],
      sound: "beacon.power",
    },
  },
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

function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function sound(dimension, id, location) {
  safe(() => dimension.playSound(id, location));
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

/** Centre of an entity, roughly chest height. */
function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

function isPlayer(entity) {
  return entity?.typeId === "minecraft:player";
}

/**
 * Is this entity still in the world? `isValid` is a method on some 1.21
 * builds and a plain property on others, so probe both and assume the entity
 * is fine if neither form is available.
 */
function stillThere(entity) {
  try {
    if (typeof entity.isValid === "function") return entity.isValid();
    if (typeof entity.isValid === "boolean") return entity.isValid;
    return entity.location !== undefined;
  } catch {
    return false;
  }
}

function isCreative(player) {
  try {
    // getGameMode() is not present on every 1.21 build, hence the guard.
    return player.getGameMode?.() === "creative";
  } catch {
    return false;
  }
}

function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

function heldItem(entity) {
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    return equippable?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

function heldItemId(entity) {
  return heldItem(entity)?.typeId;
}

function onCooldown(player, category) {
  try {
    return (player.getItemCooldown?.(category) ?? 0) > 0;
  } catch {
    return false;
  }
}

function startCooldown(player, category, ticks) {
  safe(() => player.startItemCooldown(category, ticks));
}

/** Gate an ability behind its own cooldown category. Returns false if blocked. */
function claim(player, key, ticks) {
  const category = `goku_${key}`;
  if (onCooldown(player, category)) return false;
  if (ticks > 0) startCooldown(player, category, ticks);
  return true;
}

function addEffect(entity, id, ticks, amplifier, showParticles = false) {
  safe(() => entity.addEffect(id, ticks, { amplifier, showParticles }));
}

function hurt(entity, amount, cause, attacker) {
  try {
    entity.applyDamage(amount, { cause, damagingEntity: attacker });
  } catch {
    safe(() => entity.applyDamage(amount));
  }
}

/**
 * Knockback, across API generations: 1.11.0 takes four numbers, later
 * versions take a horizontal vector plus a vertical strength.
 */
function push(entity, dirX, dirZ, horizontal, vertical) {
  try {
    entity.applyKnockback(dirX, dirZ, horizontal, vertical);
  } catch {
    safe(() =>
      entity.applyKnockback({ x: dirX * horizontal, z: dirZ * horizontal }, vertical)
    );
  }
}

function nearbyEntities(dimension, location, radius) {
  try {
    return dimension.getEntities({ location, maxDistance: radius });
  } catch {
    return [];
  }
}

/** Everything worth hitting: not the caster, not an item on the floor. */
function hostileTargets(dimension, location, radius, caster) {
  return nearbyEntities(dimension, location, radius).filter((entity) => {
    if (!entity || entity.id === caster.id) return false;
    const type = entity.typeId;
    return (
      type !== "minecraft:item" &&
      type !== "minecraft:xp_orb" &&
      type !== "minecraft:arrow"
    );
  });
}

/** Walk down from `location` until a non-air block is found. */
function groundBelow(dimension, location) {
  let probe = { x: location.x, y: Math.floor(location.y), z: location.z };
  for (let i = 0; i < 64; i++) {
    try {
      const block = dimension.getBlock({
        x: Math.floor(probe.x),
        y: probe.y,
        z: Math.floor(probe.z),
      });
      if (!block) break; // unloaded chunk - use what we have
      if (!block.isAir && !block.isLiquid) {
        return { x: location.x, y: probe.y + 1, z: location.z };
      }
    } catch {
      break;
    }
    probe = { x: probe.x, y: probe.y - 1, z: probe.z };
  }
  return location;
}

/**
 * Where is the player aiming?
 * Prefers an entity, then a block, then falls back to a point in mid-air.
 */
function aimLocation(player, maxDistance) {
  try {
    for (const hit of player.getEntitiesFromViewDirection({ maxDistance })) {
      if (hit.entity && hit.entity.id !== player.id) return bodyLocation(hit.entity);
    }
  } catch {
    /* fall through to block raycast */
  }

  try {
    const blockHit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (blockHit?.block) {
      const b = blockHit.block.location;
      return { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 };
    }
  } catch {
    /* fall through to projected point */
  }

  try {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    return {
      x: head.x + view.x * maxDistance,
      y: head.y + view.y * maxDistance,
      z: head.z + view.z * maxDistance,
    };
  } catch {
    return bodyLocation(player);
  }
}

function headAndView(player) {
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  return { head, view };
}

/** Damage the held item by `amount` durability points. */
function consumeDurability(player, amount) {
  if (isCreative(player)) return;
  try {
    const equippable = player.getComponent("minecraft:equippable");
    const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
    const durability = item?.getComponent("minecraft:durability");
    if (!durability) return;

    if (durability.damage + amount >= durability.maxDurability) {
      equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
      safe(() => player.dimension.playSound("random.break", player.location));
      return;
    }
    durability.damage = durability.damage + amount;
    equippable.setEquipment(EquipmentSlot.Mainhand, item);
  } catch {
    /* durability is a nicety, never fatal */
  }
}

/** Remove one of whatever the player is holding. Used by the Senzu Bean. */
function consumeHeldOne(player) {
  if (isCreative(player)) return;
  try {
    const equippable = player.getComponent("minecraft:equippable");
    const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!item) return;
    if (item.amount > 1) {
      item.amount = item.amount - 1;
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
    } else {
      equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  } catch {
    /* if the stack cannot be edited, the bean is simply free */
  }
}

function healToFull(entity) {
  try {
    const health = entity.getComponent("minecraft:health");
    if (!health) return;
    const max = health.effectiveMax ?? health.defaultValue ?? 20;
    health.setCurrentValue(max);
  } catch {
    /* ignore */
  }
}

function damageSelf(entity, amount) {
  try {
    const health = entity.getComponent("minecraft:health");
    if (!health) return;
    const next = health.currentValue - amount;
    if (next > 0.5) health.setCurrentValue(next);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Beams - Ki Blast and Kamehameha share the same walker
 * ------------------------------------------------------------------ */

/**
 * Walk a straight line from the player's head, stopping at the first solid
 * block, damaging everything within `beamRadius` of the line exactly once.
 */
function fireBeam(player, cfg, look) {
  const dimension = player.dimension;
  const { head, view } = headAndView(player);
  const hit = new Set();
  let end = head;

  for (let step = 1; step <= cfg.range; step++) {
    const point = {
      x: head.x + view.x * step,
      y: head.y + view.y * step,
      z: head.z + view.z * step,
    };
    end = point;

    // Stop at the first solid block so the beam does not shoot through walls.
    let blocked = false;
    try {
      const block = dimension.getBlock({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
        z: Math.floor(point.z),
      });
      if (block && !block.isAir && !block.isLiquid) blocked = true;
    } catch {
      blocked = true; // unloaded chunk - stop here
    }

    for (const id of look.core) particle(dimension, id, point);
    if (step % 2 === 0) {
      for (const id of look.halo) {
        particle(dimension, id, offset(point, 0.35, 0.2, 0));
        particle(dimension, id, offset(point, -0.35, -0.2, 0));
      }
    }

    for (const target of hostileTargets(dimension, point, cfg.beamRadius, player)) {
      if (hit.has(target.id)) continue;
      hit.add(target.id);
      hurt(target, cfg.damage, EntityDamageCause.entityAttack, player);
      push(target, view.x, view.z, cfg.knockback, 0.35);
    }

    if (blocked) break;
  }

  return { end, hitCount: hit.size };
}

const KI_LOOK = {
  core: ["minecraft:basic_flame_particle"],
  halo: ["minecraft:basic_smoke_particle"],
};

const KAME_LOOK = {
  core: ["minecraft:endrod"],
  halo: ["minecraft:basic_flame_particle", "minecraft:electric_spark_particle"],
};

function kiBlast(player) {
  const cfg = CONFIG.kiBlast;
  const dimension = player.dimension;
  sound(dimension, "mob.blaze.shoot", player.location);
  const { end } = fireBeam(player, cfg, KI_LOOK);
  particle(dimension, "minecraft:critical_hit_emitter", end);
}

function kamehameha(player) {
  const cfg = CONFIG.kamehameha;
  const dimension = player.dimension;

  actionBar(player, "§bKA...ME...HA...ME...");
  sound(dimension, "beacon.activate", player.location);

  // Charge: energy gathers in the palms before the beam goes out.
  for (let tick = 0; tick < cfg.chargeTicks; tick += 2) {
    system.runTimeout(() => {
      safe(() => {
        const { head, view } = headAndView(player);
        const palm = offset(head, view.x * 1.2, view.y * 1.2 - 0.2, view.z * 1.2);
        particle(dimension, "minecraft:endrod", palm);
        particle(dimension, "minecraft:electric_spark_particle", palm);
      });
    }, tick);
  }

  system.runTimeout(() => {
    if (!stillThere(player)) return;
    actionBar(player, "§b§lHAAAA!");
    sound(dimension, "mob.enderdragon.growl", player.location);

    const { end, hitCount } = fireBeam(player, cfg, KAME_LOOK);
    particle(dimension, "minecraft:huge_explosion_emitter", end);
    sound(dimension, "random.explode", end);

    // A modest blast where the beam lands, on top of the line damage.
    safe(() =>
      dimension.createExplosion(end, cfg.impactRadius, {
        breaksBlocks: cfg.breaksBlocks,
        causesFire: false,
        allowUnderwater: true,
        source: isPlayer(player) ? player : undefined,
      })
    );
    if (hitCount > 0) actionBar(player, `§bKamehameha hit ${hitCount}`);
  }, cfg.chargeTicks);
}

/* ------------------------------------------------------------------ *
 * Spirit Bomb
 * ------------------------------------------------------------------ */

function spiritBomb(player) {
  const cfg = CONFIG.spiritBomb;
  const dimension = player.dimension;
  const target = groundBelow(dimension, aimLocation(player, cfg.range));

  actionBar(player, "§fLend me your energy...");
  sound(dimension, "beacon.power", player.location);

  // Rooted while gathering energy.
  addEffect(player, "slowness", cfg.chargeTicks, 3);
  addEffect(player, "resistance", cfg.chargeTicks + cfg.fallTicks + 40, 4);

  // Energy spirals up out of the world into the orb above the caster.
  for (let tick = 0; tick < cfg.chargeTicks; tick += 2) {
    system.runTimeout(() => {
      safe(() => {
        const above = offset(player.location, 0, 3.2, 0);
        particle(dimension, "minecraft:endrod", above);
        const angle = (Math.PI * 2 * tick) / 20;
        particle(
          dimension,
          "minecraft:villager_happy",
          offset(player.location, Math.cos(angle) * 4, 0.5, Math.sin(angle) * 4)
        );
      });
    }, tick);
  }

  // Then it launches, arcs over and comes down on the aimed point.
  system.runTimeout(() => {
    if (!stillThere(player)) return;
    const start = offset(target, 0, cfg.fallHeight, 0);
    sound(dimension, "mob.ghast.fireball", start);

    const step = cfg.fallHeight / cfg.fallTicks;
    for (let tick = 0; tick <= cfg.fallTicks; tick++) {
      system.runTimeout(() => {
        const here = { x: target.x, y: start.y - step * tick, z: target.z };
        particle(dimension, "minecraft:endrod", here);
        particle(dimension, "minecraft:huge_explosion_emitter", here);
      }, tick);
    }

    system.runTimeout(() => spiritBombImpact(player, target, dimension), cfg.fallTicks);
  }, cfg.chargeTicks);
}

function spiritBombImpact(caster, impact, dimension) {
  const cfg = CONFIG.spiritBomb;

  safe(() =>
    dimension.createExplosion(impact, cfg.explosionRadius, {
      breaksBlocks: cfg.breaksBlocks,
      causesFire: cfg.causesFire,
      allowUnderwater: true,
      source: isPlayer(caster) ? caster : undefined,
    })
  );

  for (const target of hostileTargets(dimension, impact, cfg.damageRadius, caster)) {
    hurt(target, cfg.damage, EntityDamageCause.entityExplosion, caster);
    push(target, target.location.x - impact.x, target.location.z - impact.z, 2.5, 1.0);
  }

  particle(dimension, "minecraft:huge_explosion_emitter", impact);
  particle(dimension, "minecraft:huge_explosion_emitter", offset(impact, 0, 2, 0));
  sound(dimension, "random.explode", impact);
}

/* ------------------------------------------------------------------ *
 * Destructo Disk - a travelling blade of ki
 * ------------------------------------------------------------------ */

function destructoDisk(player) {
  const cfg = CONFIG.destructoDisk;
  const dimension = player.dimension;
  const { head, view } = headAndView(player);

  sound(dimension, "random.glass", player.location);

  const hit = new Set();
  let travelled = 0;
  let position = offset(head, view.x, view.y, view.z);

  const runner = system.runInterval(() => {
    try {
      for (let sub = 0; sub < 2; sub++) {
        position = {
          x: position.x + view.x * (cfg.speed / 2),
          y: position.y + view.y * (cfg.speed / 2),
          z: position.z + view.z * (cfg.speed / 2),
        };
        travelled += cfg.speed / 2;

        // The disk spins - draw it as a ring perpendicular to travel.
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8;
          particle(
            dimension,
            "minecraft:endrod",
            offset(position, Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0)
          );
        }

        for (const target of hostileTargets(dimension, position, cfg.cutRadius, player)) {
          if (hit.has(target.id)) continue;
          hit.add(target.id);
          hurt(target, cfg.damage, EntityDamageCause.entityAttack, player);
          particle(dimension, "minecraft:critical_hit_emitter", bodyLocation(target));
          sound(dimension, "random.anvil_land", target.location);
        }

        let blocked = false;
        try {
          const block = dimension.getBlock({
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z),
          });
          if (block && !block.isAir && !block.isLiquid) blocked = true;
        } catch {
          blocked = true;
        }

        if (blocked || travelled >= cfg.range || hit.size >= cfg.maxTargets) {
          system.clearRun(runner);
          particle(dimension, "minecraft:critical_hit_emitter", position);
          sound(dimension, "random.glass", position);
          return;
        }
      }
    } catch {
      system.clearRun(runner);
    }
  }, 1);
}

/* ------------------------------------------------------------------ *
 * Dragon Fist - dash forward, then detonate on the first thing touched
 * ------------------------------------------------------------------ */

const dragonFistWindows = new Map(); // player id -> tick the window closes

function dragonFist(player) {
  const cfg = CONFIG.dragonFist;
  const dimension = player.dimension;
  const { view } = headAndView(player);

  sound(dimension, "mob.enderdragon.growl", player.location);
  actionBar(player, "§6DRAGON FIST!");

  push(player, view.x, view.z, cfg.dashStrength, cfg.dashLift);
  addEffect(player, "resistance", cfg.windowTicks + 20, 4);
  dragonFistWindows.set(player.id, system.currentTick + cfg.windowTicks);

  const runner = system.runInterval(() => {
    try {
      const deadline = dragonFistWindows.get(player.id);
      if (deadline === undefined || system.currentTick > deadline) {
        dragonFistWindows.delete(player.id);
        system.clearRun(runner);
        return;
      }

      const at = bodyLocation(player);
      particle(dimension, "minecraft:basic_flame_particle", at);
      particle(dimension, "minecraft:mobflame_emitter", at);

      const targets = hostileTargets(dimension, at, cfg.hitRadius, player);
      if (targets.length === 0) return;

      for (const target of targets) {
        hurt(target, cfg.damage, EntityDamageCause.entityAttack, player);
        safe(() => target.setOnFire(cfg.igniteSeconds, true));
        push(
          target,
          target.location.x - player.location.x,
          target.location.z - player.location.z,
          2.0,
          0.8
        );
      }

      const impact = targets[0].location;
      safe(() =>
        dimension.createExplosion(impact, cfg.explosionRadius, {
          breaksBlocks: cfg.breaksBlocks,
          causesFire: false,
          allowUnderwater: true,
          source: isPlayer(player) ? player : undefined,
        })
      );
      particle(dimension, "minecraft:huge_explosion_emitter", impact);
      sound(dimension, "random.explode", impact);

      dragonFistWindows.delete(player.id);
      system.clearRun(runner);
    } catch {
      system.clearRun(runner);
    }
  }, 1);
}

/* ------------------------------------------------------------------ *
 * Solar Flare, Instant Transmission, Senzu Bean, Power Pole
 * ------------------------------------------------------------------ */

function solarFlare(player) {
  const cfg = CONFIG.solarFlare;
  const dimension = player.dimension;
  const at = bodyLocation(player);

  sound(dimension, "beacon.activate", at);
  particle(dimension, "minecraft:huge_explosion_emitter", at);
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    particle(
      dimension,
      "minecraft:endrod",
      offset(at, Math.cos(angle) * 2.5, 0.6, Math.sin(angle) * 2.5)
    );
  }

  let blinded = 0;
  for (const target of hostileTargets(dimension, at, cfg.radius, player)) {
    addEffect(target, "blindness", cfg.blindTicks, 0, true);
    addEffect(target, "slowness", cfg.slowTicks, cfg.slowAmplifier, false);
    addEffect(target, "weakness", cfg.slowTicks, 1, false);
    blinded++;
  }
  actionBar(player, `§eSolar Flare - ${blinded} blinded`);
}

function instantTransmission(player) {
  const cfg = CONFIG.instantTransmission;
  const dimension = player.dimension;
  const from = player.location;
  const destination = groundBelow(dimension, aimLocation(player, cfg.range));

  particle(dimension, "minecraft:huge_explosion_emitter", bodyLocation(player));
  sound(dimension, "mob.endermen.portal", from);

  try {
    player.teleport(destination, { dimension, keepVelocity: false });
  } catch {
    safe(() => player.teleport(destination));
  }

  addEffect(player, "slow_falling", 60, 0);
  particle(dimension, "minecraft:huge_explosion_emitter", offset(destination, 0, 1, 0));
  sound(dimension, "mob.endermen.portal", destination);
  actionBar(player, "§dInstant Transmission");
}

function senzuBean(player) {
  const cfg = CONFIG.senzu;
  const dimension = player.dimension;

  if (cfg.healToFull) healToFull(player);
  for (const bad of [
    "poison",
    "wither",
    "hunger",
    "nausea",
    "blindness",
    "weakness",
    "slowness",
    "mining_fatigue",
    "fatal_poison",
    "darkness",
  ]) {
    safe(() => player.removeEffect(bad));
  }

  addEffect(player, "absorption", cfg.absorptionTicks, 1);
  addEffect(player, "regeneration", cfg.regenerationTicks, 1, true);
  safe(() => player.extinguishFire?.(true));

  // Top the food bar back up if the API on this build exposes it.
  safe(() => {
    const food = player.getComponent("minecraft:player.saturation");
    if (food) food.setCurrentValue(food.effectiveMax ?? 20);
  });

  sound(dimension, "random.burp", player.location);
  particle(dimension, "minecraft:heart_particle", offset(bodyLocation(player), 0, 0.8, 0));
  particle(dimension, "minecraft:villager_happy", bodyLocation(player));
  actionBar(player, "§aSenzu Bean - fully restored");

  if (cfg.consume) consumeHeldOne(player);
}

function powerPole(player) {
  const cfg = CONFIG.powerPole;
  const dimension = player.dimension;
  const { head, view } = headAndView(player);

  sound(dimension, "random.bow", player.location);
  actionBar(player, "§cPower Pole - extend!");

  const hit = new Set();
  for (let step = 1; step <= cfg.range; step++) {
    const point = {
      x: head.x + view.x * step,
      y: head.y + view.y * step,
      z: head.z + view.z * step,
    };
    particle(dimension, "minecraft:critical_hit_emitter", point);

    for (const target of hostileTargets(dimension, point, 1.5, player)) {
      if (hit.has(target.id)) continue;
      hit.add(target.id);
      hurt(target, cfg.damage, EntityDamageCause.entityAttack, player);
      push(target, view.x, view.z, cfg.knockback, 0.4);
      sound(dimension, "random.anvil_land", target.location);
    }
  }

  consumeDurability(player, cfg.durabilityCost);
}

/* ------------------------------------------------------------------ *
 * Flying Nimbus - ki flight for as long as the cloud lasts
 * ------------------------------------------------------------------ */

const nimbusRiders = new Map(); // player id -> tick the ride ends

function toggleNimbus(player) {
  const cfg = CONFIG.nimbus;
  const dimension = player.dimension;

  if (nimbusRiders.has(player.id)) {
    nimbusRiders.delete(player.id);
    safe(() => player.removeEffect("levitation"));
    safe(() => player.removeEffect("slow_falling"));
    addEffect(player, "slow_falling", 100, 0);
    actionBar(player, "§6Nimbus dismissed");
    sound(dimension, "mob.horse.leather", player.location);
    return;
  }

  nimbusRiders.set(player.id, system.currentTick + cfg.durationTicks);
  addEffect(player, "slow_falling", cfg.durationTicks, 0);
  actionBar(player, "§6Nimbus - look up to climb, sneak to drop");
  sound(dimension, "random.levelup", player.location);
  particle(dimension, "minecraft:villager_happy", player.location);
}

function tickNimbus(player) {
  const cfg = CONFIG.nimbus;
  const deadline = nimbusRiders.get(player.id);
  if (deadline === undefined) return;

  if (system.currentTick > deadline) {
    nimbusRiders.delete(player.id);
    safe(() => player.removeEffect("levitation"));
    addEffect(player, "slow_falling", 120, 0);
    actionBar(player, "§6The Nimbus fades");
    return;
  }

  const dimension = player.dimension;
  const under = offset(player.location, 0, -0.2, 0);
  particle(dimension, "minecraft:villager_happy", under);

  let sneaking = false;
  try {
    sneaking = player.isSneaking === true;
  } catch {
    sneaking = false;
  }

  let lookingUp = false;
  try {
    lookingUp = player.getViewDirection().y > cfg.riseThreshold;
  } catch {
    lookingUp = false;
  }

  if (sneaking) {
    // Drop: cancel lift, keep the landing soft.
    safe(() => player.removeEffect("levitation"));
    addEffect(player, "slow_falling", 40, 0);
  } else if (lookingUp) {
    addEffect(player, "levitation", 20, 1);
  } else {
    safe(() => player.removeEffect("levitation"));
    addEffect(player, "slow_falling", 40, 0);
    addEffect(player, "speed", 40, cfg.speedAmplifier);
  }
}

/* ------------------------------------------------------------------ *
 * Transformations
 * ------------------------------------------------------------------ */

const activeForms = new Map(); // player id -> { id, endTick, nextDrainTick }

function transform(player, formId) {
  const form = CONFIG.forms[formId];
  if (!form) return;

  const dimension = player.dimension;
  const current = activeForms.get(player.id);
  if (current?.id === formId) {
    // Tapping the same form again powers down early.
    clearForm(player, "§7Power down");
    return;
  }
  if (current) clearForm(player, undefined);

  activeForms.set(player.id, {
    id: formId,
    endTick: system.currentTick + form.durationTicks,
    nextDrainTick: form.drainEveryTicks
      ? system.currentTick + form.drainEveryTicks
      : Infinity,
  });

  applyFormEffects(player, form);

  const at = bodyLocation(player);
  particle(dimension, "minecraft:huge_explosion_emitter", at);
  sound(dimension, form.sound, player.location);
  actionBar(player, `${form.colour}${form.name}!`);
  safe(() => player.sendMessage(`${form.colour}${form.name}§r engaged.`));
}

function applyFormEffects(player, form) {
  // Re-applied every second so the effects never lapse mid-transformation.
  for (const [id, amplifier] of form.effects) {
    addEffect(player, id, 60, amplifier, false);
  }
}

function clearForm(player, message) {
  const state = activeForms.get(player.id);
  if (!state) return;
  const form = CONFIG.forms[state.id];
  activeForms.delete(player.id);

  if (form) {
    for (const [id] of form.effects) {
      safe(() => player.removeEffect(id));
    }
  }
  if (message) actionBar(player, message);
  safe(() => player.dimension.playSound("random.fizz", player.location));
}

function tickForm(player) {
  const state = activeForms.get(player.id);
  if (!state) return;
  const form = CONFIG.forms[state.id];
  if (!form) {
    activeForms.delete(player.id);
    return;
  }

  if (system.currentTick >= state.endTick) {
    clearForm(player, `§7${form.name} ends`);
    return;
  }

  applyFormEffects(player, form);

  // Aura.
  const dimension = player.dimension;
  const base = player.location;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 + system.currentTick / 5;
    const at = offset(base, Math.cos(angle) * 0.7, 0.2 + (i % 3) * 0.7, Math.sin(angle) * 0.7);
    for (const id of form.particles) particle(dimension, id, at);
  }

  // Kaio-ken burns the user.
  if (form.drainEveryTicks && system.currentTick >= state.nextDrainTick) {
    state.nextDrainTick = system.currentTick + form.drainEveryTicks;
    damageSelf(player, form.drainAmount);
  }

  const secondsLeft = Math.max(0, Math.ceil((state.endTick - system.currentTick) / 20));
  actionBar(player, `${form.colour}${form.name} §7${secondsLeft}s`);
}

function formOf(player) {
  const state = activeForms.get(player.id);
  return state ? CONFIG.forms[state.id] : undefined;
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

const HANDLERS = {
  [ITEMS.KI_BLAST]: (player) =>
    claim(player, "ki_blast", CONFIG.kiBlast.cooldownTicks) && kiBlast(player),
  [ITEMS.KAMEHAMEHA]: (player) =>
    claim(player, "kamehameha", CONFIG.kamehameha.cooldownTicks) && kamehameha(player),
  [ITEMS.SPIRIT_BOMB]: (player) =>
    claim(player, "spirit_bomb", CONFIG.spiritBomb.cooldownTicks) && spiritBomb(player),
  [ITEMS.DESTRUCTO_DISK]: (player) =>
    claim(player, "destructo_disk", CONFIG.destructoDisk.cooldownTicks) &&
    destructoDisk(player),
  [ITEMS.DRAGON_FIST]: (player) =>
    claim(player, "dragon_fist", CONFIG.dragonFist.cooldownTicks) && dragonFist(player),
  [ITEMS.SOLAR_FLARE]: (player) =>
    claim(player, "solar_flare", CONFIG.solarFlare.cooldownTicks) && solarFlare(player),
  [ITEMS.INSTANT_TRANSMISSION]: (player) =>
    claim(player, "instant_transmission", CONFIG.instantTransmission.cooldownTicks) &&
    instantTransmission(player),
  [ITEMS.FLYING_NIMBUS]: (player) =>
    claim(player, "flying_nimbus", CONFIG.nimbus.cooldownTicks) && toggleNimbus(player),
  [ITEMS.SENZU_BEAN]: (player) => senzuBean(player),
  [ITEMS.POWER_POLE]: (player) =>
    claim(player, "power_pole", CONFIG.powerPole.cooldownTicks) && powerPole(player),
};

for (const formId of Object.keys(CONFIG.forms)) {
  const key = formId.split(":")[1];
  const ticks = {
    kaioken: 500,
    super_saiyan: 900,
    super_saiyan_blue: 1500,
    ultra_instinct: 2400,
  }[key];
  HANDLERS[formId] = (player) =>
    claim(player, key, ticks ?? 600) && transform(player, formId);
}

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack?.typeId;
  if (!player || !used) return;

  const handler = HANDLERS[used];
  if (!handler) return;

  try {
    handler(player);
  } catch (err) {
    console.warn(`[Goku] ${used} failed: ${err}`);
  }
});

// Ultra Instinct: refund the damage and slip aside.
world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damage } = event;
  if (!isPlayer(hurtEntity) || damage <= 0) return;

  const form = formOf(hurtEntity);
  if (!form?.dodge) return;

  try {
    const health = hurtEntity.getComponent("minecraft:health");
    if (health) {
      const max = health.effectiveMax ?? health.defaultValue ?? 20;
      health.setCurrentValue(Math.min(max, health.currentValue + damage));
    }

    const dimension = hurtEntity.dimension;
    const angle = Math.random() * Math.PI * 2;
    push(hurtEntity, Math.cos(angle), Math.sin(angle), form.dodgeDistance / 4, 0.25);
    particle(dimension, "minecraft:endrod", bodyLocation(hurtEntity));
    sound(dimension, "random.orb", hurtEntity.location);
    actionBar(hurtEntity, "§f§lDODGED");
  } catch (err) {
    console.warn(`[Goku] dodge failed: ${err}`);
  }
});

// Power Pole melee bonus: a solid hit staggers whatever it lands on.
world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damageSource } = event;
  const attacker = damageSource?.damagingEntity;
  if (!attacker || !hurtEntity || attacker.id === hurtEntity.id) return;
  if (heldItemId(attacker) !== ITEMS.POWER_POLE) return;

  try {
    push(
      hurtEntity,
      hurtEntity.location.x - attacker.location.x,
      hurtEntity.location.z - attacker.location.z,
      1.1,
      0.35
    );
    particle(hurtEntity.dimension, "minecraft:critical_hit_emitter", bodyLocation(hurtEntity));
  } catch {
    /* cosmetic */
  }
});

// One tick loop drives the transformations and the Nimbus.
system.runInterval(() => {
  let players = [];
  try {
    players = world.getAllPlayers();
  } catch {
    return;
  }
  for (const player of players) {
    try {
      tickForm(player);
      tickNimbus(player);
    } catch (err) {
      console.warn(`[Goku] tick failed: ${err}`);
    }
  }
}, 10);

// Nothing should survive a death or a dimension change.
world.afterEvents.entityDie?.subscribe((event) => {
  const entity = event.deadEntity;
  if (!isPlayer(entity)) return;
  activeForms.delete(entity.id);
  nimbusRiders.delete(entity.id);
  dragonFistWindows.delete(entity.id);
});

// Visible proof the script module actually loaded. If you join a world and do
// NOT see this line in chat, the behaviour pack's scripts are not running and
// no ability will fire - that is the first thing to check.
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      `§6[Goku Abilities]§r v${VERSION} loaded - 14 abilities ready.`
    )
  );
});

console.warn(`[Goku Abilities] v${VERSION} loaded - 14 abilities ready.`);
