/*
 * Arcane Arsenal - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Everything here is defensive on purpose: a single unsupported particle or
 * sound id on a given device should never take the whole add-on down, so all
 * cosmetic calls are wrapped and all gameplay calls are guarded.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const WEAPONS = {
  FROSTBITE: "arcane:frostbite_blade",
  EMBERFANG: "arcane:emberfang",
  STORMCALLER: "arcane:stormcaller",
  VOIDREAPER: "arcane:voidreaper",
  HAMMER: "arcane:cataclysm_hammer",
  STAFF: "arcane:meteor_staff",
};

const CONFIG = {
  frostbite: {
    slownessTicks: 100, // 5 seconds
    slownessAmplifier: 2, // Slowness III
    freezeDamage: 4,
  },
  emberfang: {
    igniteSeconds: 8,
    burstRadius: 2.5,
    burstIgniteSeconds: 4,
    burstDamage: 2,
  },
  stormcaller: {
    castRange: 40,
    cooldownCategory: "arcane_storm",
    cooldownTicks: 80, // 4 seconds
  },
  voidreaper: {
    lifestealRatio: 0.35,
    minHeal: 1,
  },
  hammer: {
    explosionRadius: 4,
    breaksBlocks: true,
    causesFire: false,
    selfProtectTicks: 40,
  },
  staff: {
    castRange: 48,
    cooldownCategory: "arcane_meteor",
    cooldownTicks: 120, // 6 seconds
    fallHeight: 18,
    fallTicks: 10,
    impactRadius: 4,
    impactDamage: 20,
    impactDamageRadius: 5.5,
    breaksBlocks: true,
    causesFire: true,
    durabilityCost: 4,
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

/** Identifier of whatever the entity is holding in its main hand. */
function heldItem(entity) {
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    if (!equippable) return undefined;
    return equippable.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

function heldItemId(entity) {
  return heldItem(entity)?.typeId;
}

function isPlayer(entity) {
  return entity?.typeId === "minecraft:player";
}

function isCreative(player) {
  try {
    // getGameMode() is not present on every 1.21 build, hence the guard.
    return player.getGameMode?.() === "creative";
  } catch {
    return false;
  }
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

/**
 * Where is the player aiming?
 * Prefers an entity, then a block, then falls back to a point in mid-air
 * that is dropped down onto the first solid surface below it.
 */
function aimLocation(player, maxDistance) {
  try {
    const entityHits = player.getEntitiesFromViewDirection({ maxDistance });
    for (const hit of entityHits) {
      if (hit.entity && hit.entity.id !== player.id) {
        return bodyLocation(hit.entity);
      }
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

  // Nothing was hit - project forward and drop to the ground.
  try {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const projected = {
      x: head.x + view.x * maxDistance,
      y: head.y + view.y * maxDistance,
      z: head.z + view.z * maxDistance,
    };
    return groundBelow(player.dimension, projected);
  } catch {
    return bodyLocation(player);
  }
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

function nearbyEntities(dimension, location, radius) {
  try {
    return dimension.getEntities({ location, maxDistance: radius });
  } catch {
    return [];
  }
}

function hurt(entity, amount, cause, attacker) {
  try {
    entity.applyDamage(amount, {
      cause,
      damagingEntity: attacker,
    });
  } catch {
    safe(() => entity.applyDamage(amount));
  }
}

/* ------------------------------------------------------------------ *
 * Weapon effects - melee
 * ------------------------------------------------------------------ */

function frostbiteHit(attacker, victim) {
  const cfg = CONFIG.frostbite;
  const dimension = victim.dimension;
  const at = bodyLocation(victim);

  safe(() =>
    victim.addEffect("slowness", cfg.slownessTicks, {
      amplifier: cfg.slownessAmplifier,
      showParticles: true,
    })
  );
  safe(() =>
    victim.addEffect("mining_fatigue", cfg.slownessTicks, {
      amplifier: 0,
      showParticles: false,
    })
  );

  hurt(victim, cfg.freezeDamage, EntityDamageCause.freezing, attacker);

  particle(dimension, "minecraft:ice_evaporation_emitter", at);
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    particle(
      dimension,
      "minecraft:snowflake_particle",
      offset(at, Math.cos(angle), 0.2, Math.sin(angle))
    );
  }
  sound(dimension, "random.glass", at);
}

function emberfangHit(attacker, victim) {
  const cfg = CONFIG.emberfang;
  const dimension = victim.dimension;
  const at = bodyLocation(victim);

  safe(() => victim.setOnFire(cfg.igniteSeconds, true));

  // Small flame burst around the point of impact.
  for (const other of nearbyEntities(dimension, at, cfg.burstRadius)) {
    if (other.id === victim.id || other.id === attacker.id) continue;
    safe(() => other.setOnFire(cfg.burstIgniteSeconds, true));
    hurt(other, cfg.burstDamage, EntityDamageCause.fire, attacker);
  }

  particle(dimension, "minecraft:mobflame_emitter", at);
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    particle(
      dimension,
      "minecraft:basic_flame_particle",
      offset(at, Math.cos(angle) * 1.2, 0.3, Math.sin(angle) * 1.2)
    );
  }
  sound(dimension, "mob.blaze.shoot", at);
}

function stormcallerStrike(caster, at, dimension) {
  // Brief resistance so the caster is not fried by their own storm.
  safe(() =>
    caster.addEffect("resistance", 40, { amplifier: 4, showParticles: false })
  );
  safe(() => dimension.spawnEntity("minecraft:lightning_bolt", at));
  sound(dimension, "ambient.weather.thunder", at);
  particle(dimension, "minecraft:critical_hit_emitter", at);
}

function voidreaperHit(attacker, damageDealt) {
  const cfg = CONFIG.voidreaper;
  const heal = Math.max(cfg.minHeal, Math.round(damageDealt * cfg.lifestealRatio));

  try {
    const health = attacker.getComponent("minecraft:health");
    if (!health) return;
    const max = health.effectiveMax ?? health.defaultValue ?? 20;
    const next = Math.min(max, health.currentValue + heal);
    if (next > health.currentValue) health.setCurrentValue(next);
  } catch {
    return;
  }

  const dimension = attacker.dimension;
  const at = bodyLocation(attacker);
  particle(dimension, "minecraft:heart_particle", offset(at, 0, 0.8, 0));
  particle(dimension, "minecraft:villager_happy", at);
  sound(dimension, "random.orb", at);
}

function cataclysmHit(attacker, victim) {
  const cfg = CONFIG.hammer;
  const dimension = victim.dimension;
  const at = victim.location;

  // Shield the wielder from their own blast before it goes off.
  safe(() =>
    attacker.addEffect("resistance", cfg.selfProtectTicks, {
      amplifier: 4,
      showParticles: false,
    })
  );

  system.run(() => {
    safe(() =>
      dimension.createExplosion(at, cfg.explosionRadius, {
        breaksBlocks: cfg.breaksBlocks,
        causesFire: cfg.causesFire,
        allowUnderwater: true,
        source: isPlayer(attacker) ? attacker : undefined,
      })
    );
    particle(dimension, "minecraft:huge_explosion_emitter", at);
  });
}

/* ------------------------------------------------------------------ *
 * Weapon effects - ranged
 * ------------------------------------------------------------------ */

function summonMeteor(caster, target) {
  const cfg = CONFIG.staff;
  const dimension = caster.dimension;
  const impact = groundBelow(dimension, target);
  const start = offset(impact, 0, cfg.fallHeight, 0);

  sound(dimension, "mob.ghast.fireball", start);

  const step = cfg.fallHeight / cfg.fallTicks;
  for (let tick = 0; tick <= cfg.fallTicks; tick++) {
    const y = start.y - step * tick;
    system.runTimeout(() => {
      const here = { x: impact.x, y, z: impact.z };
      particle(dimension, "minecraft:basic_flame_particle", here);
      particle(dimension, "minecraft:basic_smoke_particle", offset(here, 0, 0.5, 0));
      particle(dimension, "minecraft:lava_particle", here);
    }, tick);
  }

  system.runTimeout(() => meteorImpact(caster, impact, dimension), cfg.fallTicks);
}

function meteorImpact(caster, impact, dimension) {
  const cfg = CONFIG.staff;

  safe(() =>
    dimension.createExplosion(impact, cfg.impactRadius, {
      breaksBlocks: cfg.breaksBlocks,
      causesFire: cfg.causesFire,
      allowUnderwater: true,
      source: isPlayer(caster) ? caster : undefined,
    })
  );

  // Guaranteed heavy area damage on top of the explosion falloff.
  for (const entity of nearbyEntities(dimension, impact, cfg.impactDamageRadius)) {
    if (entity.id === caster.id) continue;
    hurt(entity, cfg.impactDamage, EntityDamageCause.entityExplosion, caster);
    safe(() => entity.setOnFire(5, true));
  }

  particle(dimension, "minecraft:huge_explosion_emitter", impact);
  sound(dimension, "random.explode", impact);
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

const MELEE_CAUSES = new Set([
  EntityDamageCause.entityAttack,
  "entityAttack",
  "entity_attack",
]);

world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damage, damageSource } = event;
  if (!hurtEntity || !damageSource || damage <= 0) return;

  const attacker = damageSource.damagingEntity;
  if (!attacker || attacker.id === hurtEntity.id) return;
  if (!MELEE_CAUSES.has(damageSource.cause)) return;

  const weapon = heldItemId(attacker);
  if (!weapon) return;

  try {
    switch (weapon) {
      case WEAPONS.FROSTBITE:
        frostbiteHit(attacker, hurtEntity);
        break;
      case WEAPONS.EMBERFANG:
        emberfangHit(attacker, hurtEntity);
        break;
      case WEAPONS.STORMCALLER:
        stormcallerStrike(attacker, bodyLocation(hurtEntity), hurtEntity.dimension);
        break;
      case WEAPONS.VOIDREAPER:
        voidreaperHit(attacker, damage);
        break;
      case WEAPONS.HAMMER:
        cataclysmHit(attacker, hurtEntity);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn(`[Arcane Arsenal] melee effect failed: ${err}`);
  }
});

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack?.typeId;
  if (!player || !used) return;

  try {
    if (used === WEAPONS.STAFF) {
      const cfg = CONFIG.staff;
      if (onCooldown(player, cfg.cooldownCategory)) return;
      startCooldown(player, cfg.cooldownCategory, cfg.cooldownTicks);

      const target = aimLocation(player, cfg.castRange);
      summonMeteor(player, target);
      consumeDurability(player, cfg.durabilityCost);
      return;
    }

    if (used === WEAPONS.STORMCALLER) {
      const cfg = CONFIG.stormcaller;
      if (onCooldown(player, cfg.cooldownCategory)) return;
      startCooldown(player, cfg.cooldownCategory, cfg.cooldownTicks);

      const target = aimLocation(player, cfg.castRange);
      stormcallerStrike(player, target, player.dimension);
      consumeDurability(player, 2);
    }
  } catch (err) {
    console.warn(`[Arcane Arsenal] item use failed: ${err}`);
  }
});

// Visible proof the script module actually loaded. If you join a world and do
// NOT see this line in chat, the behaviour pack's scripts are not running and
// no weapon effect will fire - that is the first thing to check.
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  try {
    event.player.sendMessage("§b[Arcane Arsenal]§r v1.0.1 loaded - 6 weapons armed.");
  } catch {
    /* ignore */
  }
});

console.warn("[Arcane Arsenal] loaded - 6 weapons armed.");
