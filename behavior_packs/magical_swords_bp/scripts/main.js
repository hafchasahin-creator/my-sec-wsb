/*
 * Magical Swords - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Beta 1.21.0.26, Android / touch friendly)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Every API used here exists in the stable 1.11.0 module that ships with
 * 1.21.0 (verified against Mojang's published script-module metadata).
 * Cosmetic calls are wrapped so a single bad particle or sound id on some
 * device can never take the whole add-on down.
 */

import { world, system, EquipmentSlot, EntityDamageCause } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Swords and tuning
 * ------------------------------------------------------------------ */

const INFERNO = "msword:inferno_sword";
const FROST = "msword:frost_sword";
const THUNDER = "msword:thunder_sword";
const VOID = "msword:void_sword";
const CELESTIAL = "msword:celestial_sword";

const CONFIG = {
  inferno: {
    igniteSeconds: 6,
    cooldown: { category: "msword_inferno", ticks: 160 }, // 8s
    cyclone: {
      rings: [1.5, 2.4, 3.3, 4.2],
      ringDelay: 3, // ticks between rings
      damage: 7,
      igniteSeconds: 6,
      knockback: 1.2,
      knockup: 0.35,
      radiusPad: 1.2,
    },
  },
  frost: {
    hitDamage: 2,
    slowTicks: 80,
    slowAmplifier: 2, // Slowness III
    frozenVisualTicks: 80,
    cooldown: { category: "msword_frost", ticks: 160 }, // 8s
    wave: {
      steps: 9,
      stepTicks: 2,
      stepLength: 1.3,
      damage: 6,
      slowTicks: 100,
      slowAmplifier: 3, // Slowness IV
      hitRadius: 2.2,
      frozenVisualTicks: 100,
    },
  },
  thunder: {
    strikeChance: 0.25,
    minStrikeDistance: 3.0,
    cooldown: { category: "msword_thunder", ticks: 120 }, // 6s
    skyfall: {
      castRange: 40,
      shockDelay: 3,
      shockRadius: 4,
      shockDamage: 8,
    },
  },
  void: {
    hitBonusDamage: 2,
    cooldown: { category: "msword_void", ticks: 100 }, // 5s
    rift: {
      steps: 10,
      stepLength: 1.3,
      damage: 12,
      hitRadius: 2.0,
    },
    blink: {
      maxDistance: 8,
      wallPadding: 0.8,
    },
  },
  celestial: {
    hitBonusDamage: 2,
    cooldown: { category: "msword_celestial", ticks: 200 }, // 10s
    rend: {
      steps: 14,
      stepLength: 1.4,
      damage: 14,
      hitRadius: 2.6,
      knockback: 0.6,
      knockup: 0.6,
    },
    nova: {
      castRange: 30,
      windupTicks: 12,
      damage: 18,
      radius: 6,
      knockback: 1.6,
      knockup: 0.7,
    },
  },
  abilityDurabilityCost: 2,
};

const SWORD_INFO = {
  [INFERNO]: {
    hint: "§6Inferno Sword §7- §fUse§7: Flame Cyclone",
    aura: "msword:inferno_aura",
  },
  [FROST]: {
    hint: "§bFrost Sword §7- §fUse§7: Glacial Wave",
    aura: "msword:frost_aura",
  },
  [THUNDER]: {
    hint: "§eThunder Sword §7- §fUse§7: Skyfall Bolt",
    aura: "msword:thunder_arc",
  },
  [VOID]: {
    hint: "§5Void Sword §7- §fUse§7: Void Rift §8| §fSneak+Use§7: Blink",
    aura: "msword:void_wisp",
  },
  [CELESTIAL]: {
    hint: "§dCelestial Sword §7- §fUse§7: Astral Rend §8| §fSneak+Use§7: Starfall Nova",
    aura: "msword:celestial_star",
  },
};

/* Entities that should never be treated as ability targets. */
const IGNORED_TARGETS = new Set([
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:ender_pearl",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:lightning_bolt",
  "minecraft:falling_block",
  "minecraft:tnt",
  "minecraft:fishing_hook",
  "minecraft:painting",
  "minecraft:leash_knot",
  "minecraft:boat",
  "minecraft:chest_boat",
  "minecraft:minecart",
  "minecraft:chest_minecart",
  "minecraft:hopper_minecart",
  "minecraft:tnt_minecart",
  "minecraft:command_block_minecart",
  "minecraft:area_effect_cloud",
  "minecraft:eye_of_ender_signal",
]);

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

function sound(dimension, id, location, options) {
  safe(() => dimension.playSound(id, location, options));
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

/** Centre of an entity, roughly chest height. */
function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

/** Horizontal (flattened, normalised) view direction. */
function flatView(player) {
  const view = player.getViewDirection();
  const len = Math.sqrt(view.x * view.x + view.z * view.z);
  if (len < 0.001) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: view.x / len, y: 0, z: view.z / len };
}

function heldItemId(entity) {
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    return equippable?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  } catch {
    return undefined;
  }
}

function isPlayer(entity) {
  return entity?.typeId === "minecraft:player";
}

/** Living-ish entities near a point, excluding the caster and junk types. */
function targetsNear(caster, dimension, location, radius) {
  let candidates = [];
  try {
    candidates = dimension.getEntities({ location, maxDistance: radius });
  } catch {
    return [];
  }
  const out = [];
  for (const entity of candidates) {
    try {
      if (!entity || entity.id === caster.id) continue;
      if (IGNORED_TARGETS.has(entity.typeId)) continue;
      out.push(entity);
    } catch {
      /* entity vanished mid-iteration */
    }
  }
  return out;
}

function hurt(entity, amount, cause, attacker) {
  try {
    entity.applyDamage(amount, { cause, damagingEntity: attacker });
  } catch {
    safe(() => entity.applyDamage(amount));
  }
}

function knockAway(entity, from, horizontal, vertical) {
  try {
    const loc = entity.location;
    let dx = loc.x - from.x;
    let dz = loc.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) {
      dx = 1;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    entity.applyKnockback(dx, dz, horizontal, vertical);
  } catch {
    /* knockback is flavour */
  }
}

function isCreative(player) {
  try {
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
      sound(player.dimension, "random.break", player.location);
      return;
    }
    durability.damage = durability.damage + amount;
    equippable.setEquipment(EquipmentSlot.Mainhand, item);
  } catch {
    /* durability is a nicety, never fatal */
  }
}

/*
 * Cooldowns are gated by this script-side map, not by getItemCooldown():
 * depending on the build, the engine may auto-start the item's JSON cooldown
 * the moment the Use press happens, which would make an engine-read gate
 * refuse the very cast that triggered it. startItemCooldown() is still
 * called so the hotbar shows the ender-pearl style radial sweep.
 */
const scriptCooldowns = new Map(); // "<playerId>:<category>" -> ready tick

function cooldownRemaining(player, category) {
  const ready = scriptCooldowns.get(`${player.id}:${category}`) ?? 0;
  return Math.max(0, ready - system.currentTick);
}

function armCooldown(player, category, ticks) {
  scriptCooldowns.set(`${player.id}:${category}`, system.currentTick + ticks);
  safe(() => player.startItemCooldown(category, ticks));
}

function cooldownMessage(player, remainingTicks, label) {
  safe(() => {
    const seconds = (remainingTicks / 20).toFixed(1);
    player.onScreenDisplay.setActionBar(`§7${label} ready in §f${seconds}s`);
  });
}

function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

function cameraShake(dimension, location, intensity, seconds, radius) {
  safe(() =>
    dimension.runCommand(
      `camerashake add @a[x=${location.x.toFixed(1)},y=${location.y.toFixed(1)},z=${location.z.toFixed(1)},r=${radius}] ${intensity} ${seconds} positional`
    )
  );
}

/**
 * Where is the player aiming? Prefers an entity, then a block, then a point
 * projected forward and dropped down onto the first solid surface below it.
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
  let y = Math.floor(location.y);
  for (let i = 0; i < 64; i++) {
    try {
      const block = dimension.getBlock({
        x: Math.floor(location.x),
        y,
        z: Math.floor(location.z),
      });
      if (!block) break;
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
 * Frozen-enemy visual tracking (Frost Sword)
 * ------------------------------------------------------------------ */

const frozenTargets = new Map(); // entity id -> { entity, untilTick }

function markFrozen(entity, ticks) {
  try {
    frozenTargets.set(entity.id, {
      entity,
      untilTick: system.currentTick + ticks,
    });
  } catch {
    /* ignore */
  }
}

system.runInterval(() => {
  if (frozenTargets.size === 0) return;
  const now = system.currentTick;
  for (const [id, entry] of frozenTargets) {
    let alive = false;
    try {
      alive = entry.entity.isValid() && now < entry.untilTick;
      if (alive) {
        particle(entry.entity.dimension, "msword:frozen_shell", bodyLocation(entry.entity));
      }
    } catch {
      alive = false;
    }
    if (!alive) frozenTargets.delete(id);
  }
}, 6);

/* ------------------------------------------------------------------ *
 * Held-sword ambience: equip hints, idle aura, first-person sparkle
 * ------------------------------------------------------------------ */

const lastHeld = new Map(); // player id -> item type id

system.runInterval(() => {
  let players = [];
  try {
    players = world.getAllPlayers();
  } catch {
    return;
  }
  for (const player of players) {
    let held;
    try {
      held = heldItemId(player);
    } catch {
      continue;
    }
    const prev = lastHeld.get(player.id);
    if (held !== prev) {
      lastHeld.set(player.id, held);
      const info = held ? SWORD_INFO[held] : undefined;
      if (info) {
        actionBar(player, info.hint);
        sound(player.dimension, "msword.equip", player.location, { volume: 0.6 });
        particle(player.dimension, info.aura, offset(bodyLocation(player), 0, 0.3, 0));
      }
      continue;
    }
    const info = held ? SWORD_INFO[held] : undefined;
    if (info) {
      // Gentle scripted aura so the magic reads in first person too; the
      // attachable's own animation particles carry the third-person look.
      const view = flatView(player);
      const at = offset(bodyLocation(player), view.x * 0.6, 0.15, view.z * 0.6);
      particle(player.dimension, info.aura, at);
    }
  }
}, 8);

/* ------------------------------------------------------------------ *
 * On-hit effects
 * ------------------------------------------------------------------ */

function infernoHit(attacker, victim) {
  const dimension = victim.dimension;
  const at = bodyLocation(victim);
  safe(() => victim.setOnFire(CONFIG.inferno.igniteSeconds, true));
  particle(dimension, "msword:hit_ember", at);
  particle(dimension, "msword:slash_fire", at);
  sound(dimension, "mob.blaze.shoot", at, { volume: 0.5, pitch: 1.2 });
}

function frostHit(attacker, victim) {
  const cfg = CONFIG.frost;
  const dimension = victim.dimension;
  const at = bodyLocation(victim);
  safe(() =>
    victim.addEffect("slowness", cfg.slowTicks, {
      amplifier: cfg.slowAmplifier,
      showParticles: false,
    })
  );
  safe(() =>
    victim.addEffect("mining_fatigue", cfg.slowTicks, {
      amplifier: 0,
      showParticles: false,
    })
  );
  hurt(victim, cfg.hitDamage, EntityDamageCause.freezing, attacker);
  markFrozen(victim, cfg.frozenVisualTicks);
  particle(dimension, "msword:frost_crystal", at);
  sound(dimension, "random.glass", at, { volume: 0.6, pitch: 1.3 });
}

function thunderHit(attacker, victim) {
  const cfg = CONFIG.thunder;
  const dimension = victim.dimension;
  const at = bodyLocation(victim);
  particle(dimension, "msword:thunder_spark", at);
  sound(dimension, "msword.thunder.crackle", at, { volume: 0.5 });

  if (Math.random() < cfg.strikeChance) {
    const dx = victim.location.x - attacker.location.x;
    const dz = victim.location.z - attacker.location.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance >= cfg.minStrikeDistance) {
      safe(() =>
        attacker.addEffect("resistance", 30, { amplifier: 4, showParticles: false })
      );
      safe(() => dimension.spawnEntity("minecraft:lightning_bolt", victim.location));
    } else {
      // Too close for a full strike - arc damage instead.
      hurt(victim, 3, EntityDamageCause.lightning, attacker);
      particle(dimension, "msword:thunder_strike", at);
      sound(dimension, "item.trident.thunder", at, { volume: 0.4, pitch: 1.5 });
    }
  }
}

function voidHit(attacker, victim) {
  const dimension = victim.dimension;
  const at = bodyLocation(victim);
  hurt(victim, CONFIG.void.hitBonusDamage, EntityDamageCause.magic, attacker);
  particle(dimension, "msword:void_wisp", at);
  sound(dimension, "mob.endermen.portal", at, { volume: 0.3, pitch: 1.6 });
}

function celestialHit(attacker, victim) {
  const dimension = victim.dimension;
  const at = bodyLocation(victim);
  hurt(victim, CONFIG.celestial.hitBonusDamage, EntityDamageCause.magic, attacker);
  particle(dimension, "msword:celestial_star", at);
  sound(dimension, "note.chime", at, {
    volume: 0.5,
    pitch: 1.3 + Math.random() * 0.5,
  });
}

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
      case INFERNO:
        infernoHit(attacker, hurtEntity);
        break;
      case FROST:
        frostHit(attacker, hurtEntity);
        break;
      case THUNDER:
        thunderHit(attacker, hurtEntity);
        break;
      case VOID:
        voidHit(attacker, hurtEntity);
        break;
      case CELESTIAL:
        celestialHit(attacker, hurtEntity);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn(`[Magical Swords] melee effect failed: ${err}`);
  }
});

/* ------------------------------------------------------------------ *
 * Special abilities
 * ------------------------------------------------------------------ */

/** Inferno - expanding circle of fire around the player. */
function flameCyclone(player) {
  const cfg = CONFIG.inferno.cyclone;
  const dimension = player.dimension;
  const centre = { ...player.location };

  sound(dimension, "msword.inferno.cyclone", centre, { volume: 1.0 });
  sound(dimension, "mob.blaze.shoot", centre, { volume: 0.8, pitch: 0.8 });
  cameraShake(dimension, centre, 0.12, 0.4, 8);

  const hitOnce = new Set();
  cfg.rings.forEach((radius, index) => {
    system.runTimeout(() => {
      const points = 8 + index * 2;
      for (let i = 0; i < points; i++) {
        const angle = (Math.PI * 2 * i) / points;
        particle(
          dimension,
          "msword:inferno_ring",
          offset(centre, Math.cos(angle) * radius, 0.15, Math.sin(angle) * radius)
        );
      }
      for (const target of targetsNear(player, dimension, centre, radius + cfg.radiusPad)) {
        if (hitOnce.has(target.id)) continue;
        hitOnce.add(target.id);
        hurt(target, cfg.damage, EntityDamageCause.fire, player);
        safe(() => target.setOnFire(cfg.igniteSeconds, true));
        knockAway(target, centre, cfg.knockback, cfg.knockup);
        particle(dimension, "msword:hit_ember", bodyLocation(target));
      }
    }, index * cfg.ringDelay);
  });
}

/** Frost - a widening wave of ice pushed out in front of the player. */
function glacialWave(player) {
  const cfg = CONFIG.frost.wave;
  const dimension = player.dimension;
  const start = { ...player.location };
  const dir = flatView(player);

  sound(dimension, "msword.frost.wave", start, { volume: 1.0 });

  const hitOnce = new Set();
  for (let step = 1; step <= cfg.steps; step++) {
    system.runTimeout(() => {
      const at = offset(start, dir.x * cfg.stepLength * step, 0.2, dir.z * cfg.stepLength * step);
      const ground = groundBelow(dimension, offset(at, 0, 1, 0));
      const point = { x: at.x, y: Math.max(at.y, ground.y - 0.2), z: at.z };

      particle(dimension, "msword:frost_wave", point);
      // Widen the wave as it travels.
      if (step > 2) {
        const px = -dir.z;
        const pz = dir.x;
        const spread = 0.6 + step * 0.18;
        particle(dimension, "msword:frost_wave", offset(point, px * spread, 0, pz * spread));
        particle(dimension, "msword:frost_wave", offset(point, -px * spread, 0, -pz * spread));
      }
      if (step % 3 === 0) {
        sound(dimension, "random.glass", point, { volume: 0.3, pitch: 1.6 });
      }

      for (const target of targetsNear(player, dimension, point, cfg.hitRadius)) {
        if (hitOnce.has(target.id)) continue;
        hitOnce.add(target.id);
        hurt(target, cfg.damage, EntityDamageCause.freezing, player);
        safe(() =>
          target.addEffect("slowness", cfg.slowTicks, {
            amplifier: cfg.slowAmplifier,
            showParticles: false,
          })
        );
        markFrozen(target, cfg.frozenVisualTicks);
        particle(dimension, "msword:frost_crystal", bodyLocation(target));
        sound(dimension, "random.glass", bodyLocation(target), { volume: 0.5, pitch: 1.2 });
      }
    }, (step - 1) * cfg.stepTicks);
  }
}

/** Thunder - call a lightning strike at the aimed location. */
function skyfallBolt(player) {
  const cfg = CONFIG.thunder.skyfall;
  const dimension = player.dimension;
  const target = aimLocation(player, cfg.castRange);

  safe(() => player.addEffect("resistance", 40, { amplifier: 4, showParticles: false }));
  sound(dimension, "msword.thunder.skyfall", target, { volume: 1.0 });
  particle(dimension, "msword:thunder_strike", target);
  safe(() => dimension.spawnEntity("minecraft:lightning_bolt", target));
  cameraShake(dimension, target, 0.2, 0.4, 10);

  system.runTimeout(() => {
    sound(dimension, "item.trident.thunder", target, { volume: 0.8 });
    particle(dimension, "msword:thunder_strike", offset(target, 0, 0.5, 0));
    for (const victim of targetsNear(player, dimension, target, cfg.shockRadius)) {
      hurt(victim, cfg.shockDamage, EntityDamageCause.lightning, player);
      particle(dimension, "msword:thunder_spark", bodyLocation(victim));
    }
  }, cfg.shockDelay);
}

/** Void - a rift slash that travels forward and shreds what it touches. */
function voidRift(player) {
  const cfg = CONFIG.void.rift;
  const dimension = player.dimension;
  const start = bodyLocation(player);
  const dir = flatView(player);

  sound(dimension, "msword.void.slash", start, { volume: 1.0 });
  sound(dimension, "mob.endermen.portal", start, { volume: 0.5, pitch: 0.7 });

  const hitOnce = new Set();
  for (let step = 1; step <= cfg.steps; step++) {
    system.runTimeout(() => {
      const point = offset(start, dir.x * cfg.stepLength * step, 0, dir.z * cfg.stepLength * step);
      particle(dimension, "msword:void_slash", point);
      if (step % 2 === 0) {
        particle(dimension, "msword:void_wisp", point);
      }
      for (const target of targetsNear(player, dimension, point, cfg.hitRadius)) {
        if (hitOnce.has(target.id)) continue;
        hitOnce.add(target.id);
        hurt(target, cfg.damage, EntityDamageCause.magic, player);
        particle(dimension, "msword:void_wisp", bodyLocation(target));
        sound(dimension, "mob.endermen.portal", bodyLocation(target), { volume: 0.4, pitch: 1.4 });
      }
    }, step - 1);
  }
}

/** Void (sneak) - short forward teleport. */
function voidBlink(player) {
  const cfg = CONFIG.void.blink;
  const dimension = player.dimension;
  const view = player.getViewDirection();
  const origin = { ...player.location };

  let distance = cfg.maxDistance;
  try {
    const blockHit = player.getBlockFromViewDirection({
      maxDistance: cfg.maxDistance + 1,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (blockHit?.block) {
      const b = blockHit.block.location;
      const head = player.getHeadLocation();
      const dx = b.x + 0.5 - head.x;
      const dy = b.y + 0.5 - head.y;
      const dz = b.z + 0.5 - head.z;
      const hitDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      distance = Math.max(1.5, Math.min(distance, hitDistance - cfg.wallPadding));
    }
  } catch {
    /* keep max distance */
  }

  particle(dimension, "msword:void_blink", bodyLocation(player));

  let done = false;
  for (let d = distance; d >= 1.5 && !done; d -= 1) {
    const destination = {
      x: origin.x + view.x * d,
      y: origin.y + view.y * d,
      z: origin.z + view.z * d,
    };
    try {
      done = player.tryTeleport(destination, { checkForBlocks: true });
    } catch {
      done = false;
    }
  }

  const landing = done ? player.location : origin;
  particle(dimension, "msword:void_blink", offset(landing, 0, 1, 0));
  sound(dimension, "mob.shulker.teleport", landing, { volume: 0.9 });
  sound(dimension, "msword.void.blink", landing, { volume: 0.8 });
  if (!done) {
    actionBar(player, "§5No room to blink");
  }
}

/** Celestial - a huge travelling energy slash. */
function astralRend(player) {
  const cfg = CONFIG.celestial.rend;
  const dimension = player.dimension;
  const start = bodyLocation(player);
  const dir = flatView(player);

  sound(dimension, "msword.celestial.slash", start, { volume: 1.0 });
  sound(dimension, "beacon.power", start, { volume: 0.7, pitch: 1.4 });

  const hitOnce = new Set();
  for (let step = 1; step <= cfg.steps; step++) {
    system.runTimeout(() => {
      const point = offset(start, dir.x * cfg.stepLength * step, 0.1, dir.z * cfg.stepLength * step);
      particle(dimension, "msword:celestial_slash", point);
      if (step % 2 === 1) {
        particle(dimension, "msword:celestial_star", offset(point, 0, 0.4, 0));
      }
      for (const target of targetsNear(player, dimension, point, cfg.hitRadius)) {
        if (hitOnce.has(target.id)) continue;
        hitOnce.add(target.id);
        hurt(target, cfg.damage, EntityDamageCause.magic, player);
        try {
          target.applyKnockback(dir.x, dir.z, cfg.knockback, cfg.knockup);
        } catch {
          /* flavour */
        }
        particle(dimension, "msword:celestial_star", bodyLocation(target));
        sound(dimension, "note.chime", bodyLocation(target), { volume: 0.6, pitch: 1.8 });
      }
    }, step - 1);
  }
}

/** Celestial (sneak) - starfall explosion around the aimed target. */
function starfallNova(player) {
  const cfg = CONFIG.celestial.nova;
  const dimension = player.dimension;
  const target = aimLocation(player, cfg.castRange);

  sound(dimension, "beacon.activate", target, { volume: 0.9 });
  // Converging ring during the wind-up.
  const windupSteps = 3;
  for (let i = 0; i < windupSteps; i++) {
    system.runTimeout(() => {
      const radius = 5 - i * 1.6;
      const points = 10;
      for (let p = 0; p < points; p++) {
        const angle = (Math.PI * 2 * p) / points + i * 0.3;
        particle(
          dimension,
          "msword:celestial_star",
          offset(target, Math.cos(angle) * radius, 0.4 + i * 0.3, Math.sin(angle) * radius)
        );
      }
    }, i * Math.floor(CONFIG.celestial.nova.windupTicks / windupSteps));
  }

  system.runTimeout(() => {
    particle(dimension, "msword:celestial_nova", target);
    particle(dimension, "minecraft:huge_explosion_emitter", target);
    sound(dimension, "msword.celestial.nova", target, { volume: 1.0 });
    sound(dimension, "random.explode", target, { volume: 0.8, pitch: 1.2 });
    cameraShake(dimension, target, 0.25, 0.5, 12);

    for (const victim of targetsNear(player, dimension, target, cfg.radius)) {
      hurt(victim, cfg.damage, EntityDamageCause.magic, player);
      knockAway(victim, target, cfg.knockback, cfg.knockup);
      particle(dimension, "msword:celestial_star", bodyLocation(victim));
    }
  }, cfg.windupTicks);
}

/* ------------------------------------------------------------------ *
 * Ability dispatch (Use button / right click; sneak for second ability)
 * ------------------------------------------------------------------ */

const ABILITIES = {
  [INFERNO]: {
    cooldown: CONFIG.inferno.cooldown,
    label: "Flame Cyclone",
    run: (player) => flameCyclone(player),
  },
  [FROST]: {
    cooldown: CONFIG.frost.cooldown,
    label: "Glacial Wave",
    run: (player) => glacialWave(player),
  },
  [THUNDER]: {
    cooldown: CONFIG.thunder.cooldown,
    label: "Skyfall Bolt",
    run: (player) => skyfallBolt(player),
  },
  [VOID]: {
    cooldown: CONFIG.void.cooldown,
    label: "Void Rift",
    sneakLabel: "Blink",
    run: (player) => voidRift(player),
    sneakRun: (player) => voidBlink(player),
  },
  [CELESTIAL]: {
    cooldown: CONFIG.celestial.cooldown,
    label: "Astral Rend",
    sneakLabel: "Starfall Nova",
    run: (player) => astralRend(player),
    sneakRun: (player) => starfallNova(player),
  },
};

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack?.typeId;
  if (!player || !used) return;

  const ability = ABILITIES[used];
  if (!ability) return;

  try {
    let sneaking = false;
    try {
      sneaking = player.isSneaking === true;
    } catch {
      sneaking = false;
    }

    const label = sneaking && ability.sneakRun ? ability.sneakLabel : ability.label;
    const remaining = cooldownRemaining(player, ability.cooldown.category);
    if (remaining > 0) {
      cooldownMessage(player, remaining, label);
      return;
    }
    armCooldown(player, ability.cooldown.category, ability.cooldown.ticks);

    if (sneaking && ability.sneakRun) {
      ability.sneakRun(player);
    } else {
      ability.run(player);
    }
    consumeDurability(player, CONFIG.abilityDurabilityCost);
  } catch (err) {
    console.warn(`[Magical Swords] ability failed: ${err}`);
  }
});

/* ------------------------------------------------------------------ *
 * Load feedback
 * ------------------------------------------------------------------ */

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§d[Magical Swords]§r v1.0.0 loaded - 5 blades in the Creative equipment tab."
    )
  );
});

console.warn("[Magical Swords] script loaded - 5 swords armed.");
