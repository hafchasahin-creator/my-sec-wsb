/*
 * Anaconda - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * The entity JSON gives the anaconda its body, stats and vanilla AI. This file
 * adds the part vanilla components cannot do: constricting nearby creatures,
 * swallowing them whole, and growing every time it does.
 *
 * Everything cosmetic is wrapped in safe() and every gameplay call is guarded,
 * so one unsupported sound or particle id on a given device can never take the
 * whole add-on down.
 */

import { world, system, GameMode, EntityDamageCause } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const ANACONDA = "anaconda:anaconda";

/** How often the hunting loop runs, in ticks (20 ticks = 1 second). */
const TICK_INTERVAL = 5;

/** Tag prefixes used as persistent per-entity storage. */
const STAGE_TAG = "anaconda_stage:";
const MEALS_TAG = "anaconda_meals:";

/** Anything carrying this tag is never eaten. Set it with /tag @e add anaconda_safe */
const SAFE_TAG = "anaconda_safe";

const STAGES = {
  juvenile: {
    name: "juvenile",
    maxHealth: 60,
    lure: 6.5, // constriction radius
    gulp: 2.6, // swallow radius
    crush: 5, // damage per pass while constricting
    pull: 0.32, // constriction drag strength
    swallowHealth: 14, // victims at or under this health go down whole
    heal: 8,
    mealsToGrow: 8,
    growEvent: "anaconda:grow_adult",
  },
  adult: {
    name: "adult",
    maxHealth: 120,
    lure: 9,
    gulp: 3.4,
    crush: 8,
    pull: 0.42,
    swallowHealth: 24,
    heal: 14,
    mealsToGrow: 16,
    growEvent: "anaconda:grow_titan",
  },
  titan: {
    name: "titan",
    maxHealth: 220,
    lure: 12,
    gulp: 4.4,
    crush: 12,
    pull: 0.55,
    swallowHealth: 40,
    heal: 22,
    mealsToGrow: Infinity,
    growEvent: null,
  },
};

/**
 * Things the snake will not put in its mouth. Everything else - mobs, players,
 * animals, dropped items, boats, minecarts, armour stands, other add-ons' mobs -
 * is fair game.
 */
const NEVER_EAT = new Set([
  ANACONDA,
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:ender_pearl",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:dragon_fireball",
  "minecraft:wither_skull",
  "minecraft:wither_skull_dangerous",
  "minecraft:shulker_bullet",
  "minecraft:llama_spit",
  "minecraft:splash_potion",
  "minecraft:lingering_potion",
  "minecraft:area_effect_cloud",
  "minecraft:lightning_bolt",
  "minecraft:tnt",
  "minecraft:falling_block",
  "minecraft:eye_of_ender_signal",
  "minecraft:fishing_hook",
  "minecraft:evocation_fang",
  "minecraft:fireworks_rocket",
  "minecraft:command_block_minecart",
]);

/** Small snacks: no health bar, so they are simply removed. */
const SNACK_VALUE = 0.34;

const DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end",
];

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

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isPlayer(entity) {
  return entity.typeId === "minecraft:player";
}

/** Health component, or undefined for things that do not have one. */
function healthOf(entity) {
  try {
    return entity.getComponent("minecraft:health");
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Per-snake state, stored in entity tags so it survives world reloads
 * ------------------------------------------------------------------ */

function readTagNumber(entity, prefix) {
  try {
    for (const tag of entity.getTags()) {
      if (tag.startsWith(prefix)) {
        const value = Number.parseFloat(tag.slice(prefix.length));
        return Number.isFinite(value) ? value : undefined;
      }
    }
  } catch {
    /* entity went away mid-pass */
  }
  return undefined;
}

function readTagString(entity, prefix) {
  try {
    for (const tag of entity.getTags()) {
      if (tag.startsWith(prefix)) return tag.slice(prefix.length);
    }
  } catch {
    /* entity went away mid-pass */
  }
  return undefined;
}

function writeTag(entity, prefix, value) {
  try {
    for (const tag of entity.getTags()) {
      if (tag.startsWith(prefix)) entity.removeTag(tag);
    }
    entity.addTag(`${prefix}${value}`);
  } catch {
    /* entity went away mid-pass */
  }
}

/**
 * Which size the snake currently is. The entity JSON picks a size at random on
 * spawn, so the first time we see a snake we work the stage out from its max
 * health and remember it in a tag.
 */
function stageOf(snake) {
  const stored = readTagString(snake, STAGE_TAG);
  if (stored && STAGES[stored]) return STAGES[stored];

  const health = healthOf(snake);
  const max = health?.effectiveMax ?? STAGES.juvenile.maxHealth;
  let name = "juvenile";
  if (max >= STAGES.titan.maxHealth - 1) name = "titan";
  else if (max >= STAGES.adult.maxHealth - 1) name = "adult";

  writeTag(snake, STAGE_TAG, name);
  return STAGES[name];
}

function mealsOf(snake) {
  return readTagNumber(snake, MEALS_TAG) ?? 0;
}

/* ------------------------------------------------------------------ *
 * Eating
 * ------------------------------------------------------------------ */

function isEdible(target, snake, protectedPlayers) {
  if (target.id === snake.id) return false;
  if (NEVER_EAT.has(target.typeId)) return false;

  try {
    if (target.hasTag(SAFE_TAG)) return false;
  } catch {
    return false;
  }

  // Creative and spectator players are left alone entirely.
  if (isPlayer(target) && protectedPlayers.has(target.id)) return false;

  return true;
}

/**
 * The hunting loop runs 4x a second, which is far too often to drag or damage
 * anything on every pass. These counters slow the two effects down to a steady
 * pull twice a second and a squeeze once a second.
 */
let passIndex = 0;
const PULL_EVERY = 2;
const CRUSH_EVERY = 4;

/** Drag a victim towards the snake and squeeze it. */
function constrict(snake, target, stage) {
  if (passIndex % PULL_EVERY !== 0) return;

  const from = target.location;
  const to = snake.location;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  const nx = dx / length;
  const nz = dz / length;

  try {
    // @minecraft/server 1.11.0 signature.
    target.applyKnockback(nx, nz, stage.pull, 0.08);
  } catch {
    // Newer runtimes take a vector plus a vertical strength.
    safe(() =>
      target.applyKnockback({ x: nx * stage.pull, z: nz * stage.pull }, 0.08)
    );
  }

  safe(() =>
    target.addEffect("slowness", 40, { amplifier: 1, showParticles: false })
  );
}

/**
 * Try to eat the target.
 * @returns how much of a meal it was worth (0 if it only got bitten).
 */
function devour(snake, target, stage) {
  const dimension = snake.dimension;
  const where = target.location;
  const health = healthOf(target);

  // No health bar at all: dropped items, boats, minecarts, item frames and the
  // like. Straight down the hatch.
  if (!health) {
    if (isPlayer(target)) return 0;
    try {
      target.remove();
    } catch {
      return 0;
    }
    sound(dimension, "random.eat", where);
    return SNACK_VALUE;
  }

  const current = health.currentValue;

  // Weak enough to be swallowed whole.
  if (current <= stage.swallowHealth) {
    if (isPlayer(target)) {
      // Players cannot be removed from the world, so they are finished off with
      // damage instead - which also gives the normal death message and drops.
      safe(() =>
        target.applyDamage(current + 10, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: snake,
        })
      );
    } else {
      try {
        target.remove(); // eaten whole - no drops, it is inside the snake now
      } catch {
        safe(() => target.kill());
      }
    }

    sound(dimension, "mob.ravager.bite", where);
    sound(dimension, "random.eat", where);
    particle(dimension, "minecraft:villager_happy", where);
    return 1;
  }

  // Too big to swallow yet: crush it and try again next pass.
  if (passIndex % CRUSH_EVERY !== 0) return 0;
  safe(() =>
    target.applyDamage(stage.crush, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: snake,
    })
  );
  return 0;
}

function feed(snake, stage, amount) {
  // Heal up.
  const health = healthOf(snake);
  if (health) {
    safe(() => {
      const max = health.effectiveMax ?? stage.maxHealth;
      health.setCurrentValue(
        Math.min(max, health.currentValue + stage.heal * amount)
      );
    });
  }

  // Visible bulge travelling down the body (see anaconda.animation.json).
  safe(() => snake.triggerEvent("anaconda:ate"));

  const meals = mealsOf(snake) + amount;
  if (stage.growEvent && meals >= stage.mealsToGrow) {
    grow(snake, stage);
  } else {
    writeTag(snake, MEALS_TAG, Math.round(meals * 100) / 100);
  }
}

function grow(snake, stage) {
  const next = stage.growEvent === "anaconda:grow_titan" ? "titan" : "adult";

  safe(() => snake.triggerEvent(stage.growEvent));
  writeTag(snake, STAGE_TAG, next);
  writeTag(snake, MEALS_TAG, 0);

  // Grown snakes stop despawning - they earned their place in the world.
  safe(() => snake.triggerEvent("anaconda:make_persistent"));

  const dimension = snake.dimension;
  const where = snake.location;
  sound(dimension, "mob.ravager.roar", where);
  sound(dimension, "random.levelup", where);
  particle(dimension, "minecraft:knockback_roar_particle", where);
}

/* ------------------------------------------------------------------ *
 * Hunting loop
 * ------------------------------------------------------------------ */

function protectedPlayerIds() {
  const ids = new Set();
  safe(() => {
    for (const mode of [GameMode.creative, GameMode.spectator]) {
      for (const player of world.getPlayers({ gameMode: mode })) {
        ids.add(player.id);
      }
    }
  });
  return ids;
}

function huntOnce() {
  passIndex += 1;
  const protectedPlayers = protectedPlayerIds();

  for (const dimensionId of DIMENSION_IDS) {
    let dimension;
    let snakes;
    try {
      dimension = world.getDimension(dimensionId);
      snakes = dimension.getEntities({ type: ANACONDA });
    } catch {
      continue; // dimension not loaded on this device
    }

    for (const snake of snakes) {
      let stage;
      let nearby;
      try {
        stage = stageOf(snake);
        nearby = dimension.getEntities({
          location: snake.location,
          maxDistance: stage.lure,
        });
      } catch {
        continue; // snake unloaded between calls
      }

      // Ambient hiss, roughly once every eight seconds per snake.
      if (Math.random() < 0.02) {
        sound(dimension, "random.fizz", snake.location);
      }

      let eaten = 0;
      for (const target of nearby) {
        if (!isEdible(target, snake, protectedPlayers)) continue;

        let gap;
        try {
          gap = distance(snake.location, target.location);
        } catch {
          continue;
        }

        if (gap <= stage.gulp) {
          eaten += devour(snake, target, stage);
        } else if (healthOf(target)) {
          // Only living things get dragged in; loose items just wait to be
          // hoovered up when the snake happens to slither over them.
          constrict(snake, target, stage);
        }
      }

      if (eaten > 0) feed(snake, stage, eaten);
    }
  }
}

system.runInterval(() => {
  try {
    huntOnce();
  } catch (err) {
    console.warn(`[Anaconda] hunt pass failed: ${err}`);
  }
}, TICK_INTERVAL);

// Visible proof the script module actually loaded. If you join a world and do
// NOT see this line in chat, the behaviour pack's scripts are not running, and
// the snake will still spawn and bite but will not swallow anything.
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§a[Anaconda]§r v1.0.0 loaded - something is hungry in the jungle."
    )
  );
});

console.warn("[Anaconda] loaded - constriction and swallowing active.");
