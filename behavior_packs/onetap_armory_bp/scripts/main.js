/*
 * Onetap Armory - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Five weapons. Any melee hit from one of them kills the target outright, no
 * matter what it is or how much health it has, and each weapon has its own
 * first-person animation, its own kill flourish, and its own ability on Use.
 *
 * The kill goes through applyDamage first, with the wielder as the source, so
 * loot and XP are credited to the player the way a normal kill would be. Only
 * if something survives that (resistance, immunity) does it fall back to
 * kill(). Every cosmetic call is wrapped, so a missing particle or sound id on
 * one device degrades that one effect instead of breaking the weapon.
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

const W = {
  REAPER: "onetap:reapers_edge",
  LANCE: "onetap:void_lance",
  HAMMER: "onetap:judgment_hammer",
  DAGGER: "onetap:whisper_dagger",
  CANNON: "onetap:doom_cannon",
};

const CONFIG = {
  // Enough to go through any armour or damage reduction in the game.
  damage: 1000000,

  // Who the weapons are allowed to delete.
  killPlayers: true, // set false for a mob-only armoury
  killTamed: true, // set false to spare your own pets and horses
  killNamed: true, // set false to spare name-tagged mobs

  reaper: {
    radius: 14, // Soul Harvest reach
    waveTicks: 14, // how long the wave takes to reach full radius
    healPerSoul: 2, // absorption hearts, capped below
    maxAbsorption: 4, // amplifier cap (level 5)
  },
  lance: {
    range: 48,
    blocksPerTick: 4, // how fast the beam travels
    width: 2.2, // kill radius around the beam
  },
  hammer: {
    radius: 16,
    waveTicks: 10,
    launch: 1.6, // upward kick given to everything caught
  },
  dagger: {
    range: 40,
    stepTicks: 5, // blink, after-image, strike
    invisibilitySeconds: 4,
  },
  cannon: {
    range: 64,
    blocksPerTick: 5,
    blastRadius: 5, // everything this close to the impact dies too
  },

  // Ability cooldowns in ticks. These mirror the cooldown components on the
  // items; the script enforces them too so a tap can never double-fire.
  cooldowns: {
    [W.REAPER]: 240,
    [W.LANCE]: 160,
    [W.HAMMER]: 280,
    [W.DAGGER]: 120,
    [W.CANNON]: 200,
  },
  cooldownCategories: {
    [W.REAPER]: "onetap_harvest",
    [W.LANCE]: "onetap_beam",
    [W.HAMMER]: "onetap_slam",
    [W.DAGGER]: "onetap_step",
    [W.CANNON]: "onetap_bolt",
  },
};

/* Entities that are scenery rather than targets. */
const NON_TARGETS = new Set([
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:painting",
  "minecraft:leash_knot",
  "minecraft:area_effect_cloud",
  "minecraft:lightning_bolt",
  "minecraft:eye_of_ender_signal",
  "minecraft:fishing_hook",
  "minecraft:tnt",
  "minecraft:falling_block",
  "minecraft:armor_stand",
  "minecraft:boat",
  "minecraft:chest_boat",
  "minecraft:minecart",
  "minecraft:chest_minecart",
  "minecraft:hopper_minecart",
  "minecraft:tnt_minecart",
  "minecraft:command_block_minecart",
  "minecraft:xp_bottle",
  "minecraft:ender_crystal",
]);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Run a cosmetic or optional call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    fn();
  } catch (error) {
    /* ignored on purpose */
  }
}

/** Same, but for calls whose return value we want. */
function attempt(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function spawn(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function sound(dimension, id, location) {
  safe(() => dimension.playSound(id, location));
}

function offset(location, dx, dy, dz) {
  return { x: location.x + dx, y: location.y + dy, z: location.z + dz };
}

function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

function eyeLocation(player) {
  const head = attempt(() => player.getHeadLocation());
  if (head) return head;
  return offset(player.location, 0, 1.6, 0);
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

function isCreative(player) {
  return attempt(() => player.getGameMode?.() === "creative", false);
}

function heldItemId(entity) {
  return attempt(() => {
    const equippable = entity.getComponent("minecraft:equippable");
    return equippable?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  });
}

/** Run `fn(step)` once per tick for `ticks` ticks - our stand-in for animation. */
function animate(ticks, fn) {
  let step = 0;
  const tick = () => {
    safe(() => fn(step));
    step += 1;
    if (step < ticks) system.runTimeout(tick, 1);
  };
  system.run(tick);
}

/** A horizontal circle of particles - the building block of every wave. */
function ring(dimension, center, radius, particle, points = 20, dy = 0.3) {
  if (radius <= 0) return;
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    spawn(
      dimension,
      particle,
      offset(center, Math.cos(angle) * radius, dy, Math.sin(angle) * radius)
    );
  }
}

function isSolid(dimension, location) {
  return attempt(() => {
    const block = dimension.getBlock(location);
    if (!block) return false;
    if (block.isAir) return false;
    if (block.isLiquid) return false;
    return true;
  }, false);
}

/** Everything killable within `radius` of a point, wielder excluded. */
function targetsNear(dimension, location, radius, wielder) {
  const found = attempt(
    () => dimension.getEntities({ location, maxDistance: Math.max(0.5, radius) }),
    []
  );
  return found.filter((entity) => isTarget(entity, wielder));
}

function isTarget(entity, wielder) {
  if (!entity || !isAlive(entity)) return false;
  if (wielder && entity.id === wielder.id) return false;
  if (NON_TARGETS.has(entity.typeId)) return false;

  if (isPlayer(entity)) {
    if (!CONFIG.killPlayers) return false;
    if (isCreative(entity)) return false; // creative players cannot be hurt anyway
    return true;
  }
  if (!CONFIG.killTamed && attempt(() => !!entity.getComponent("minecraft:is_tamed"), false)) {
    return false;
  }
  if (!CONFIG.killNamed && attempt(() => !!entity.nameTag, false)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * The kill itself
 * ------------------------------------------------------------------ */

// Our own applyDamage raises entityHurt again, which would land straight back
// in the melee handler. Entities in here are already being dealt with.
const executing = new Set();

/**
 * Delete one entity. Returns true if this call is what finished it off.
 */
function annihilate(target, wielder) {
  if (!isTarget(target, wielder)) return false;
  if (executing.has(target.id)) return false;

  executing.add(target.id);
  const release = target.id;
  system.run(() => executing.delete(release));

  // Damage first, credited to the wielder, so loot, XP and looting all behave
  // like a normal kill. kill() is only the backstop for anything immune.
  safe(() =>
    target.applyDamage(CONFIG.damage, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: wielder,
    })
  );
  if (isAlive(target)) safe(() => target.kill());

  return true;
}

/** Per-weapon flourish played where the target died. */
function killFlourish(weapon, dimension, location) {
  switch (weapon) {
    case W.REAPER: {
      // A soul torn upward out of the body.
      for (let height = 0; height < 6; height += 1) {
        spawn(dimension, "minecraft:endrod", offset(location, 0, height * 0.4, 0));
      }
      ring(dimension, location, 1.2, "minecraft:basic_smoke_particle", 10);
      sound(dimension, "mob.wither.death", location);
      break;
    }
    case W.LANCE: {
      // Void implosion: particles collapsing into the wound.
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        spawn(
          dimension,
          "minecraft:dragon_breath_trail",
          offset(location, Math.cos(angle) * 1.4, 0.6, Math.sin(angle) * 1.4)
        );
      }
      spawn(dimension, "minecraft:endrod", location);
      sound(dimension, "mob.endermen.portal", location);
      break;
    }
    case W.HAMMER: {
      ring(dimension, location, 2.2, "minecraft:basic_flame_particle", 18, 0.1);
      spawn(dimension, "minecraft:knockback_roar_particle", location);
      sound(dimension, "random.anvil_land", location);
      break;
    }
    case W.DAGGER: {
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        spawn(
          dimension,
          "minecraft:basic_smoke_particle",
          offset(location, Math.cos(angle) * 0.8, 0.8, Math.sin(angle) * 0.8)
        );
      }
      sound(dimension, "mob.endermen.portal", location);
      break;
    }
    case W.CANNON: {
      spawn(dimension, "minecraft:huge_explosion_emitter", location);
      sound(dimension, "random.explode", location);
      break;
    }
    default:
      break;
  }
  spawn(dimension, "minecraft:critical_hit_emitter", location);
}

/* ------------------------------------------------------------------ *
 * Abilities
 * ------------------------------------------------------------------ */

/** Reaper's Edge - an expanding wave that harvests everything it touches. */
function soulHarvest(player) {
  const dimension = player.dimension;
  const center = bodyLocation(player);
  const cfg = CONFIG.reaper;
  const claimed = new Set();
  let souls = 0;

  sound(dimension, "mob.evocation_illager.prepare_attack", center);
  spawn(dimension, "minecraft:knockback_roar_particle", player.location);

  animate(cfg.waveTicks, (step) => {
    const radius = ((step + 1) / cfg.waveTicks) * cfg.radius;
    ring(dimension, player.location, radius, "minecraft:endrod", 24, 0.4);
    ring(dimension, player.location, radius * 0.75, "minecraft:basic_smoke_particle", 12, 0.9);

    for (const target of targetsNear(dimension, center, radius, player)) {
      if (claimed.has(target.id)) continue;
      claimed.add(target.id);
      const where = bodyLocation(target);
      if (annihilate(target, player)) {
        souls += 1;
        killFlourish(W.REAPER, dimension, where);
      }
    }

    if (step === cfg.waveTicks - 1) {
      if (souls > 0) {
        const level = Math.min(cfg.maxAbsorption, Math.ceil(souls / cfg.healPerSoul));
        safe(() => player.addEffect("absorption", 600, { amplifier: level, showParticles: true }));
        safe(() => player.addEffect("regeneration", 200, { amplifier: 1 }));
        spawn(dimension, "minecraft:totem_particle", bodyLocation(player));
        sound(dimension, "random.totem", player.location);
      }
      player.sendMessage(
        souls > 0
          ? `§5[Soul Harvest]§r ${souls} soul${souls === 1 ? "" : "s"} taken.`
          : "§5[Soul Harvest]§r Nothing within reach."
      );
    }
  });
}

/** Void Lance - a beam that travels out and erases whatever it passes through. */
function voidBeam(player) {
  const dimension = player.dimension;
  const origin = eyeLocation(player);
  const direction = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const cfg = CONFIG.lance;
  let travelled = 0;
  let stopped = false;
  let kills = 0;

  sound(dimension, "item.trident.throw", player.location);

  animate(Math.ceil(cfg.range / cfg.blocksPerTick) + 1, (step) => {
    if (stopped) return;

    for (let index = 0; index < cfg.blocksPerTick; index += 1) {
      travelled += 1;
      if (travelled > cfg.range) {
        stopped = true;
        return;
      }

      const point = offset(
        origin,
        direction.x * travelled,
        direction.y * travelled,
        direction.z * travelled
      );

      if (isSolid(dimension, point)) {
        spawn(dimension, "minecraft:huge_explosion_emitter", point);
        sound(dimension, "mob.endermen.portal", point);
        stopped = true;
        return;
      }

      spawn(dimension, "minecraft:dragon_breath_trail", point);
      if (travelled % 2 === 0) spawn(dimension, "minecraft:endrod", point);

      for (const target of targetsNear(dimension, point, cfg.width, player)) {
        const where = bodyLocation(target);
        if (annihilate(target, player)) {
          kills += 1;
          killFlourish(W.LANCE, dimension, where);
        }
      }
    }

    if (stopped || travelled >= cfg.range) {
      player.sendMessage(`§b[Void Beam]§r ${kills} erased.`);
    }
  });
}

/** Judgment Hammer - three shockwaves rolling outward across the ground. */
function judgmentSlam(player) {
  const dimension = player.dimension;
  const center = { ...player.location };
  const cfg = CONFIG.hammer;
  const claimed = new Set();
  let kills = 0;

  spawn(dimension, "minecraft:huge_explosion_emitter", center);
  sound(dimension, "random.explode", center);
  sound(dimension, "random.anvil_land", center);

  animate(cfg.waveTicks, (step) => {
    const radius = ((step + 1) / cfg.waveTicks) * cfg.radius;
    ring(dimension, center, radius, "minecraft:basic_flame_particle", 30, 0.1);
    ring(dimension, center, radius * 0.6, "minecraft:basic_smoke_particle", 16, 0.4);
    if (step % 3 === 0) spawn(dimension, "minecraft:knockback_roar_particle", center);

    for (const target of targetsNear(dimension, center, radius, player)) {
      if (claimed.has(target.id)) continue;
      claimed.add(target.id);
      const where = bodyLocation(target);
      // Kicked into the air first, so the wave visibly throws things.
      safe(() =>
        target.applyKnockback(
          target.location.x - center.x,
          target.location.z - center.z,
          1.2,
          cfg.launch
        )
      );
      if (annihilate(target, player)) {
        kills += 1;
        killFlourish(W.HAMMER, dimension, where);
      }
    }

    if (step === cfg.waveTicks - 1) {
      player.sendMessage(`§6[Judgment]§r ${kills} flattened.`);
    }
  });
}

/** Whisper Dagger - blink to whatever you are looking at and take it out. */
function shadowStep(player) {
  const dimension = player.dimension;
  const cfg = CONFIG.dagger;
  const hits = attempt(
    () => player.getEntitiesFromViewDirection({ maxDistance: cfg.range }),
    []
  );
  const target = hits
    .map((hit) => hit?.entity ?? hit)
    .find((entity) => isTarget(entity, player));

  if (!target) {
    player.sendMessage("§8[Shadow Step]§r Nothing in your sights.");
    sound(dimension, "note.bass", player.location);
    return;
  }

  const start = { ...player.location };
  const direction = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const destination = offset(
    target.location,
    -direction.x * 1.6,
    0,
    -direction.z * 1.6
  );

  sound(dimension, "mob.endermen.portal", start);

  animate(cfg.stepTicks, (step) => {
    if (step === 0) {
      // Smoke where the player was, then the blink itself.
      for (let height = 0; height < 4; height += 1) {
        spawn(dimension, "minecraft:basic_smoke_particle", offset(start, 0, height * 0.5, 0));
      }
      safe(() => player.teleport(destination, { dimension }));
      return;
    }

    if (step < cfg.stepTicks - 1) {
      // After-image strung along the path travelled.
      const progress = step / (cfg.stepTicks - 1);
      spawn(
        dimension,
        "minecraft:basic_smoke_particle",
        {
          x: start.x + (destination.x - start.x) * progress,
          y: start.y + (destination.y - start.y) * progress + 1,
          z: start.z + (destination.z - start.z) * progress,
        }
      );
      return;
    }

    const where = bodyLocation(target);
    if (annihilate(target, player)) {
      killFlourish(W.DAGGER, dimension, where);
      sound(dimension, "mob.endermen.portal", where);
      player.sendMessage(`§8[Shadow Step]§r ${target.typeId.replace("minecraft:", "")} removed.`);
    } else {
      player.sendMessage("§8[Shadow Step]§r Target slipped away.");
    }
    safe(() =>
      player.addEffect("invisibility", cfg.invisibilitySeconds * 20, { showParticles: false })
    );
    safe(() => player.addEffect("speed", cfg.invisibilitySeconds * 20, { amplifier: 1 }));
  });
}

/** Doom Cannon - a bolt that flies out and detonates on the first thing it meets. */
function annihilationBolt(player) {
  const dimension = player.dimension;
  const origin = eyeLocation(player);
  const direction = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const cfg = CONFIG.cannon;
  let travelled = 0;
  let done = false;

  sound(dimension, "mob.blaze.shoot", player.location);
  spawn(dimension, "minecraft:basic_flame_particle", origin);

  const detonate = (point) => {
    done = true;
    spawn(dimension, "minecraft:huge_explosion_emitter", point);
    ring(dimension, point, cfg.blastRadius * 0.6, "minecraft:basic_flame_particle", 24, 0.4);
    sound(dimension, "random.explode", point);

    let kills = 0;
    for (const target of targetsNear(dimension, point, cfg.blastRadius, player)) {
      const where = bodyLocation(target);
      if (annihilate(target, player)) {
        kills += 1;
        killFlourish(W.CANNON, dimension, where);
      }
    }
    player.sendMessage(`§c[Annihilation]§r ${kills} vaporised.`);
  };

  animate(Math.ceil(cfg.range / cfg.blocksPerTick) + 1, () => {
    if (done) return;

    for (let index = 0; index < cfg.blocksPerTick; index += 1) {
      travelled += 1;
      if (travelled > cfg.range) {
        const end = offset(
          origin,
          direction.x * cfg.range,
          direction.y * cfg.range,
          direction.z * cfg.range
        );
        detonate(end);
        return;
      }

      const point = offset(
        origin,
        direction.x * travelled,
        direction.y * travelled,
        direction.z * travelled
      );

      spawn(dimension, "minecraft:basic_flame_particle", point);
      if (travelled % 3 === 0) spawn(dimension, "minecraft:basic_smoke_particle", point);

      if (isSolid(dimension, point)) {
        detonate(point);
        return;
      }
      if (targetsNear(dimension, point, 1.8, player).length > 0) {
        detonate(point);
        return;
      }
    }
  });
}

const ABILITIES = {
  [W.REAPER]: soulHarvest,
  [W.LANCE]: voidBeam,
  [W.HAMMER]: judgmentSlam,
  [W.DAGGER]: shadowStep,
  [W.CANNON]: annihilationBolt,
};

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

const MELEE_CAUSES = new Set([
  EntityDamageCause.entityAttack,
  "entityAttack",
  "entity_attack",
]);

world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damage, damageSource } = event;
  if (!hurtEntity || !damageSource || damage <= 0) return;
  if (!MELEE_CAUSES.has(damageSource.cause)) return;

  const attacker = damageSource.damagingEntity;
  if (!attacker || attacker.id === hurtEntity.id) return;

  const weapon = heldItemId(attacker);
  if (!weapon || !ABILITIES[weapon]) return;

  const where = bodyLocation(hurtEntity);
  try {
    killFlourish(weapon, hurtEntity.dimension, where);
    annihilate(hurtEntity, attacker);
  } catch (error) {
    console.warn(`[Onetap Armory] melee kill failed: ${error}`);
  }
});

// Touch controls can raise both itemUse and itemUseOn for a single tap, so the
// ability is gated on the tick it last fired as well as on the cooldown.
const lastUseTick = new Map();

function triggerAbility(player, weapon) {
  if (!player || !ABILITIES[weapon]) return;

  const tick = system.currentTick;
  if (lastUseTick.get(player.id) === tick) return;
  lastUseTick.set(player.id, tick);

  const category = CONFIG.cooldownCategories[weapon];
  const remaining = attempt(() => player.getItemCooldown(category), 0);
  if (remaining > 0) {
    safe(() =>
      player.onScreenDisplay.setActionBar(`§7Ready in ${Math.ceil(remaining / 20)}s`)
    );
    return;
  }
  safe(() => player.startItemCooldown(category, CONFIG.cooldowns[weapon]));

  try {
    ABILITIES[weapon](player);
  } catch (error) {
    console.warn(`[Onetap Armory] ability failed: ${error}`);
    player.sendMessage(`§c[Onetap Armory]§r Ability failed: ${error}`);
  }
}

world.afterEvents.itemUse.subscribe((event) => {
  triggerAbility(event.source, event.itemStack?.typeId);
});

world.afterEvents.itemUseOn?.subscribe((event) => {
  triggerAbility(event.source, event.itemStack?.typeId);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§c[Onetap Armory]§r v1.0.0 loaded - 5 weapons armed. Try /function onetap_kit"
    )
  );
});
