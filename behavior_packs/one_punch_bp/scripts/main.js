/*
 * One Punch Man - Serious Series: Serious Punch
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * The punch is a directional cataclysm: a trench of chained explosions fired
 * along the player's view, followed by an expanding shockwave of rings around
 * the impact point. Every detonation goes through one shared, budgeted queue
 * (see "Detonation queue" below) so the destruction is spread across ticks
 * instead of being attempted in a single frame - that is the only reason the
 * lower tiers stay playable on a phone.
 *
 * Power is a per-world setting with four tiers. The top tier is deliberately
 * far past what a mobile device can survive; see TIERS for the numbers.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";

const ITEM = "opm:serious_punch";
const VERSION = "1.0.0";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/**
 * Tier fields:
 *   reach            length of the punch trench, in blocks
 *   beamStep         distance between detonations along the trench
 *   beamBlast        explosion radius of each trench detonation
 *   shockwave        radius of the ring shockwave at the impact point (0 = none)
 *   ringStep         distance between shockwave rings
 *   ringSpacing      arc distance between detonations within one ring
 *   ringBlast        explosion radius of each shockwave detonation
 *   layers           vertical offsets each ring is repeated at
 *   blastsPerTick    detonation budget per tick - the anti-freeze valve
 *   maxDetonations   hard cap on a single punch
 *   cooldownTicks    item cooldown after a punch
 *   durability       durability spent per punch
 *   killRadius       everything this close to the trench line is deleted
 */
const TIERS = [
  {
    key: "normal",
    name: "Normal Punch",
    colour: "§a",
    reach: 24,
    beamStep: 4,
    beamBlast: 4,
    shockwave: 0,
    ringStep: 8,
    ringSpacing: 8,
    ringBlast: 4,
    layers: [0],
    blastsPerTick: 4,
    maxDetonations: 64,
    cooldownTicks: 20,
    durability: 1,
    killRadius: 8,
    warning: undefined,
  },
  {
    key: "serious",
    name: "Serious Punch",
    colour: "§e",
    reach: 96,
    beamStep: 6,
    beamBlast: 9,
    shockwave: 48,
    ringStep: 8,
    ringSpacing: 9,
    ringBlast: 8,
    layers: [0],
    blastsPerTick: 12,
    maxDetonations: 1200,
    cooldownTicks: 100,
    durability: 4,
    killRadius: 20,
    warning: "Expect a few seconds of heavy lag.",
  },
  {
    key: "killer",
    name: "Serious Series: Killer Move",
    colour: "§6",
    reach: 192,
    beamStep: 8,
    beamBlast: 13,
    shockwave: 128,
    ringStep: 10,
    ringSpacing: 11,
    ringBlast: 11,
    layers: [-10, 0, 10],
    blastsPerTick: 24,
    maxDetonations: 6000,
    cooldownTicks: 200,
    durability: 16,
    killRadius: 48,
    warning: "The game will freeze for a while. Save first.",
  },
  {
    key: "apocalypse",
    name: "APOCALYPSE",
    colour: "§c",
    reach: 384,
    beamStep: 8,
    beamBlast: 17,
    shockwave: 320,
    ringStep: 10,
    ringSpacing: 11,
    ringBlast: 14,
    layers: [-24, 0, 24],
    blastsPerTick: 48,
    maxDetonations: 20000,
    cooldownTicks: 400,
    durability: 64,
    killRadius: 128,
    warning: "THIS WILL HANG AND MAY CRASH THE GAME. BACK UP THE WORLD.",
  },
];

const CONFIG = {
  // Ticks of wind-up between the tap and the punch landing.
  windupTicks: 16,
  // The trench starts this far in front of the player so they are not inside
  // the first detonation.
  standoff: 5,
  // Ticks of Resistance V the puncher gets. Covers wind-up plus the whole
  // shockwave at the top tier.
  selfProtectTicks: 1200,
  // Only every Nth detonation also spawns particles/sound. At the top tiers
  // the cosmetics cost more than the explosions do.
  cosmeticEvery: 12,
  // Terrain destruction. Set to false for a non-griefing "damage only" punch.
  breaksBlocks: true,
  causesFire: false,
  // Melee: hitting a mob with the glove deletes it outright.
  meleeOneShot: true,
  meleeRingBlast: 3,
  cooldownCategory: "opm_serious",
  // Dynamic property the chosen tier is stored in, per world.
  tierProperty: "opm:tier",
};

/* ------------------------------------------------------------------ *
 * Small helpers - all cosmetic and optional calls are swallowed so that a
 * device missing one particle or sound id degrades that effect alone.
 * ------------------------------------------------------------------ */

function safe(fn) {
  try {
    fn();
  } catch {
    /* cosmetic or optional - ignore */
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

function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
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

function heldItemId(entity) {
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    return equippable?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  } catch {
    return undefined;
  }
}

function tell(player, message) {
  safe(() => player.sendMessage(message));
}

function shake(player, intensity, seconds) {
  safe(() =>
    player.runCommand(`camerashake add @s ${intensity} ${seconds} positional`)
  );
}

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

/* ------------------------------------------------------------------ *
 * Power tier, stored per world so it survives a rejoin
 * ------------------------------------------------------------------ */

function tierIndex() {
  try {
    const stored = world.getDynamicProperty(CONFIG.tierProperty);
    if (typeof stored === "number" && TIERS[stored]) return stored;
  } catch {
    /* fall through to the default */
  }
  return 0;
}

function currentTier() {
  return TIERS[tierIndex()];
}

function setTier(index) {
  const next = Math.max(0, Math.min(TIERS.length - 1, index));
  safe(() => world.setDynamicProperty(CONFIG.tierProperty, next));
  return TIERS[next];
}

function announceTier(player, tier) {
  tell(player, `${tier.colour}[Serious Punch]§r power: ${tier.colour}${tier.name}§r`);
  tell(
    player,
    `§7reach ${tier.reach} blocks · shockwave ${tier.shockwave || "none"} · up to ${tier.maxDetonations} detonations§r`
  );
  if (tier.warning) tell(player, `§c! ${tier.warning}§r`);
}

/* ------------------------------------------------------------------ *
 * Detonation queue
 *
 * Every explosion a punch wants goes in here, and a single interval drains it
 * at `blastsPerTick`. Without this the whole punch would run inside one tick
 * and the game would stop responding until it finished (or die trying). It
 * also gives us exactly one place to cancel from.
 * ------------------------------------------------------------------ */

let queue = [];
let runner = undefined;

function detonate(job) {
  const { dimension, at, radius, source, cosmetic } = job;

  safe(() =>
    dimension.createExplosion(at, radius, {
      breaksBlocks: CONFIG.breaksBlocks,
      causesFire: CONFIG.causesFire,
      allowUnderwater: true,
      source: source && isPlayer(source) ? source : undefined,
    })
  );

  if (cosmetic) {
    particle(dimension, "minecraft:huge_explosion_emitter", at);
    sound(dimension, "random.explode", at);
  }
}

function drain() {
  const budget = currentTier().blastsPerTick;
  for (let n = 0; n < budget && queue.length; n++) {
    detonate(queue.shift());
  }
  if (!queue.length) stopRunner();
}

function startRunner() {
  if (runner !== undefined) return;
  runner = system.runInterval(drain, 1);
}

function stopRunner() {
  if (runner === undefined) return;
  safe(() => system.clearRun(runner));
  runner = undefined;
}

function enqueue(jobs) {
  queue = queue.concat(jobs);
  startRunner();
}

function abort() {
  const dropped = queue.length;
  queue = [];
  stopRunner();
  return dropped;
}

/* ------------------------------------------------------------------ *
 * Building a punch
 * ------------------------------------------------------------------ */

/** Detonations along the trench, from the fist outwards. */
function trenchJobs(dimension, origin, view, tier, source) {
  const jobs = [];
  let index = 0;
  for (let d = 0; d <= tier.reach; d += tier.beamStep) {
    jobs.push({
      dimension,
      at: {
        x: origin.x + view.x * d,
        y: origin.y + view.y * d,
        z: origin.z + view.z * d,
      },
      radius: tier.beamBlast,
      source,
      cosmetic: index % 3 === 0,
    });
    index++;
  }
  return jobs;
}

/** Expanding rings around the impact point, innermost first. */
function shockwaveJobs(dimension, impact, tier, source) {
  const jobs = [];
  if (tier.shockwave <= 0) return jobs;

  let index = 0;
  for (let r = tier.ringStep; r <= tier.shockwave; r += tier.ringStep) {
    const count = Math.max(6, Math.round((2 * Math.PI * r) / tier.ringSpacing));
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      for (const dy of tier.layers) {
        jobs.push({
          dimension,
          at: {
            x: impact.x + Math.cos(angle) * r,
            y: impact.y + dy,
            z: impact.z + Math.sin(angle) * r,
          },
          radius: tier.ringBlast,
          source,
          cosmetic: index % CONFIG.cosmeticEvery === 0,
        });
        index++;
      }
    }
  }
  return jobs;
}

/**
 * Delete every entity within `radius` of the impact, except the puncher.
 * One sweep rather than a per-detonation check, because getEntities is far
 * more expensive than an explosion is.
 */
function annihilate(dimension, at, radius, puncher) {
  let entities = [];
  try {
    entities = dimension.getEntities({ location: at, maxDistance: radius });
  } catch {
    return 0;
  }

  let hit = 0;
  for (const entity of entities) {
    if (entity.id === puncher.id) continue;
    hit++;
    if (isPlayer(entity)) {
      // Players are damaged, not deleted - kill() on a player is rude and
      // some builds ignore it anyway.
      safe(() =>
        entity.applyDamage(1000, {
          cause: EntityDamageCause.entityExplosion,
          damagingEntity: puncher,
        })
      );
      shake(entity, 3, 4);
    } else {
      safe(() => entity.kill());
    }
  }
  return hit;
}

function windup(player, tier) {
  const dimension = player.dimension;
  const at = bodyLocation(player);

  safe(() =>
    player.addEffect("resistance", CONFIG.selfProtectTicks, {
      amplifier: 4,
      showParticles: false,
    })
  );
  safe(() =>
    player.addEffect("fire_resistance", CONFIG.selfProtectTicks, {
      amplifier: 0,
      showParticles: false,
    })
  );

  sound(dimension, "mob.wither.spawn", at);
  // Bigger tiers get a heavier wind-up so you can feel what you set it to.
  shake(player, tier.shockwave > 0 ? 2.5 : 1.2, CONFIG.windupTicks / 20);

  for (let tick = 0; tick < CONFIG.windupTicks; tick++) {
    system.runTimeout(() => {
      const angle = (Math.PI * 2 * tick) / 8;
      const ring = 1.6 - (1.2 * tick) / CONFIG.windupTicks;
      particle(
        dimension,
        "minecraft:critical_hit_emitter",
        offset(at, Math.cos(angle) * ring, 0.2, Math.sin(angle) * ring)
      );
      particle(dimension, "minecraft:basic_smoke_particle", at);
    }, tick);
  }
}

function seriousPunch(player) {
  const tier = currentTier();
  const dimension = player.dimension;

  let head;
  let view;
  try {
    head = player.getHeadLocation();
    view = player.getViewDirection();
  } catch {
    return;
  }

  const origin = {
    x: head.x + view.x * CONFIG.standoff,
    y: head.y + view.y * CONFIG.standoff,
    z: head.z + view.z * CONFIG.standoff,
  };
  const impact = {
    x: origin.x + view.x * tier.reach,
    y: origin.y + view.y * tier.reach,
    z: origin.z + view.z * tier.reach,
  };

  let jobs = trenchJobs(dimension, origin, view, tier, player).concat(
    shockwaveJobs(dimension, impact, tier, player)
  );

  // Hard cap. Past this the queue would take minutes to drain and the world
  // would be unplayable for the whole time.
  const capped = jobs.length > tier.maxDetonations;
  if (capped) jobs = jobs.slice(0, tier.maxDetonations);

  windup(player, tier);

  system.runTimeout(() => {
    tell(
      player,
      `${tier.colour}${tier.name}§r — §f${jobs.length}§r detonations queued` +
        (capped ? " §7(capped)§r" : "")
    );

    sound(dimension, "ambient.weather.thunder", origin);
    particle(dimension, "minecraft:huge_explosion_emitter", origin);
    shake(player, 4, 6);

    enqueue(jobs);

    // Wipe out everything along the punch, then everything the shockwave
    // reaches once it has had time to travel.
    annihilate(dimension, origin, tier.killRadius, player);
    annihilate(dimension, impact, Math.max(tier.killRadius, tier.shockwave), player);
    system.runTimeout(
      () =>
        annihilate(
          dimension,
          impact,
          Math.max(tier.killRadius, tier.shockwave),
          player
        ),
      40
    );

    consumeDurability(player, tier.durability);
  }, CONFIG.windupTicks);
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

// itemUse and itemUseOn can both fire for a single tap on touch controls, so
// one punch per player per tick at most.
const lastUse = new Map();

function debounced(player) {
  const tick = system.currentTick;
  if (lastUse.get(player.id) === tick) return true;
  lastUse.set(player.id, tick);
  return false;
}

function handleUse(player, itemId) {
  if (!player || itemId !== ITEM) return;
  if (debounced(player)) return;

  try {
    // Sneak + tap cycles the power tier instead of punching. This is the
    // control that always works: no chat, no commands, no keyboard. It wraps,
    // so there is always a way back down off APOCALYPSE.
    if (player.isSneaking) {
      const tier = setTier((tierIndex() + 1) % TIERS.length);
      announceTier(player, tier);
      sound(player.dimension, "random.orb", player.location);
      return;
    }

    if (queue.length) {
      tell(player, `§7[Serious Punch] still detonating (${queue.length} left)§r`);
      return;
    }

    if (onCooldown(player, CONFIG.cooldownCategory)) return;
    safe(() =>
      player.startItemCooldown(CONFIG.cooldownCategory, currentTier().cooldownTicks)
    );

    seriousPunch(player);
  } catch (err) {
    console.warn(`[One Punch Man] punch failed: ${err}`);
  }
}

world.afterEvents.itemUse.subscribe((event) => {
  handleUse(event.source, event.itemStack?.typeId);
});

safe(() =>
  world.afterEvents.itemUseOn.subscribe((event) => {
    handleUse(event.source, event.itemStack?.typeId);
  })
);

// Melee: a normal swing with the glove on is still a one punch kill.
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
  if (heldItemId(attacker) !== ITEM) return;

  try {
    const dimension = hurtEntity.dimension;
    const at = bodyLocation(hurtEntity);

    particle(dimension, "minecraft:huge_explosion_emitter", at);
    sound(dimension, "random.explode", at);

    if (CONFIG.meleeOneShot && !isPlayer(hurtEntity)) {
      safe(() => hurtEntity.kill());
    } else {
      safe(() =>
        hurtEntity.applyDamage(1000, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: attacker,
        })
      );
    }

    // Small courtesy blast so the ground remembers it happened.
    if (CONFIG.meleeRingBlast > 0) {
      safe(() =>
        attacker.addEffect("resistance", 40, { amplifier: 4, showParticles: false })
      );
      enqueue([
        {
          dimension,
          at,
          radius: CONFIG.meleeRingBlast,
          source: attacker,
          cosmetic: false,
        },
      ]);
    }
  } catch (err) {
    console.warn(`[One Punch Man] melee failed: ${err}`);
  }
});

/* ------------------------------------------------------------------ *
 * Chat control - a convenience on top of sneak+tap. Wrapped because
 * beforeEvents.chatSend is not exposed on every 1.21 build.
 * ------------------------------------------------------------------ */

safe(() =>
  world.beforeEvents.chatSend.subscribe((event) => {
    const message = event.message.trim();
    if (!message.startsWith("!punch")) return;
    event.cancel = true;

    const player = event.sender;
    const argument = message.slice("!punch".length).trim().toLowerCase();

    system.run(() => {
      if (!argument || argument === "status") {
        announceTier(player, currentTier());
        tell(player, "§7!punch <normal|serious|killer|apocalypse> · !punch stop§r");
        return;
      }
      if (argument === "stop") {
        const dropped = abort();
        tell(player, `§7[Serious Punch] cancelled ${dropped} pending detonations§r`);
        return;
      }
      const index = TIERS.findIndex((tier) => tier.key === argument);
      if (index < 0) {
        tell(player, "§c[Serious Punch] unknown power. Try: normal, serious, killer, apocalypse§r");
        return;
      }
      announceTier(player, setTier(index));
    });
  })
);

/* ------------------------------------------------------------------ *
 * Load confirmation
 * ------------------------------------------------------------------ */

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const tier = currentTier();
  tell(event.player, `§c[Serious Punch]§r v${VERSION} loaded — power: ${tier.colour}${tier.name}§r`);
  tell(event.player, "§7Sneak + tap the use button to change power. Tap to punch.§r");
});

console.warn(`[One Punch Man] loaded - Serious Punch armed (v${VERSION}).`);
