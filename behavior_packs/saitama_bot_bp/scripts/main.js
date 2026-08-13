/*
 * Saitama Bot - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * The bot walks with you. Anything that damages you gets one punch, and that
 * punch is not a hit box - it is a shockwave corridor plus a crater that keeps
 * widening until it has erased CONFIG.serious.targetBlocks (99,000 by default)
 * blocks of world.
 *
 * The demolition is the whole engineering problem here. Roughly a quarter of a
 * million cells cannot be touched in one tick, so the punch is a generator:
 * it yields cells in blast order, and a tick loop pulls a fixed budget from it
 * each tick. That keeps a phone at a steady frame rate and makes the
 * destruction visibly travel outward instead of appearing all at once.
 */

import { world, system, EntityDamageCause } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const BOT = "saitama:hero";

const CONFIG = {
  updateTicks: 2,

  // Walking with you.
  followDistance: 2.6, // where he stands relative to you
  followSpeed: 0.6, // blocks per update
  maxFollowSpeed: 3.0, // he is faster than you, always
  catchUp: 0.4, // extra speed per block of lag
  chaseSpeed: 2.2,
  maxChaseSpeed: 6.0, // "he got there before you saw him move"
  recallDistance: 32,
  groundScan: 6, // how far to look down for footing
  bindRadius: 24,
  resummonAfter: 3,

  // The punch.
  punchRange: 3.0, // how close he gets before swinging
  punchWindupTicks: 6, // animation lead-in before the hit lands
  seriousOnEveryHit: true, // every avenge punch is a Serious Punch
  seriousCooldownTicks: 200, // 10s between world-enders

  serious: {
    targetBlocks: 99000, // keep widening the crater until this many are gone
    // Cells examined per tick. Most are air and cost only a read, so this sits
    // near the villa builder's load. Lower it on an old phone; the punch just
    // takes longer.
    blocksPerTick: 1500,
    corridorRadius: 10, // the shockwave lane he punches down
    corridorLength: 140,
    craterRadius: 52, // hard cap on the crater
    protectRadius: 12, // blocks this close to the owner are spared
    killRadius: 60, // hostiles caught in the blast die with it
    unbreakable: [
      "minecraft:bedrock",
      "minecraft:barrier",
      "minecraft:command_block",
      "minecraft:chain_command_block",
      "minecraft:repeating_command_block",
      "minecraft:structure_block",
      "minecraft:jigsaw",
      "minecraft:end_portal",
      "minecraft:end_portal_frame",
      "minecraft:end_gateway",
      "minecraft:light_block",
    ],
  },

  // The gentler option, if you turn seriousOnEveryHit off.
  casualCraterRadius: 5,
};

/* Never a target. */
const NEVER_TARGET = new Set([
  BOT,
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

const UNBREAKABLE = new Set(CONFIG.serious.unbreakable);

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

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

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
 * Bot state
 * ------------------------------------------------------------------ */

const state = new Map(); // bot id -> { targetId, animation, punchAt, lastSerious }

function stateOf(bot) {
  let value = state.get(bot.id);
  if (!value) {
    value = { targetId: undefined, animation: "idle", punchAt: 0, lastSerious: -9999 };
    state.set(bot.id, value);
  }
  return value;
}

/** Push an animation state to the client through minecraft:variant. */
function setAnimation(bot, name) {
  const botState = stateOf(bot);
  if (botState.animation === name) return;
  botState.animation = name;
  safe(() => bot.triggerEvent(`saitama:set_${name}`));
}

function ownerOf(bot) {
  const ownerId = recall(bot, "saitama:owner");
  if (!ownerId) return undefined;
  return world.getAllPlayers().find((player) => player.id === ownerId);
}

function bindTo(bot, player) {
  remember(bot, "saitama:owner", player.id);
  remember(bot, "saitama:mode", "serious");
  safe(() => world.setDynamicProperty(`saitama:bound:${player.id}`, true));
  safe(() => (bot.nameTag = "§eSaitama"));
  player.sendMessage("§e[Saitama]§r Hero for fun. Nothing is going to touch you now.");
  playSound(player.dimension, "random.levelup", player.location);
}

function isValidTarget(entity, owner) {
  if (!entity || !isAlive(entity)) return false;
  if (NEVER_TARGET.has(entity.typeId)) return false;
  if (isPlayer(entity)) return false; // he does not hit people
  if (owner && entity.id === owner.id) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

function speedFor(gap, base, cap) {
  return Math.min(cap, base + gap * CONFIG.catchUp);
}

/** Highest solid block at or below `location`, so he stands on terrain. */
function footing(dimension, location) {
  const startY = Math.floor(location.y) + 2;
  for (let step = 0; step <= CONFIG.groundScan + 2; step += 1) {
    const y = startY - step;
    const solid = attempt(() => {
      const block = dimension.getBlock({ x: location.x, y, z: location.z });
      return block && !block.isAir && !block.isLiquid;
    }, false);
    if (solid) return y + 1;
  }
  return location.y;
}

function glide(bot, goal, speed, lookAt) {
  const here = bot.location;
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
  destination = {
    ...destination,
    y: footing(bot.dimension, destination),
  };

  safe(() =>
    bot.teleport(destination, {
      dimension: bot.dimension,
      facingLocation: lookAt ?? offset(destination, 0, 0, 1),
      keepVelocity: false,
    })
  );
  return gap;
}

/** A spot just behind the owner's shoulder. */
function escortPoint(owner) {
  const view = attempt(() => owner.getViewDirection(), { x: 0, y: 0, z: 1 });
  const behind = normalize({ x: -view.x, y: 0, z: -view.z });
  return {
    x: owner.location.x + behind.x * CONFIG.followDistance + behind.z * 1.2,
    y: owner.location.y,
    z: owner.location.z + behind.z * CONFIG.followDistance - behind.x * 1.2,
  };
}

/* ------------------------------------------------------------------ *
 * The demolition job
 * ------------------------------------------------------------------ */

/* Only one world-ending punch runs at a time. A second would double the block
 * budget and there is no frame rate left to pay for it. */
let job = undefined;

/** Offsets of a filled disc of `radius`, computed once per radius. */
const discCache = new Map();

function discOffsets(radius) {
  const cached = discCache.get(radius);
  if (cached) return cached;
  const offsets = [];
  for (let a = -radius; a <= radius; a += 1) {
    for (let b = -radius; b <= radius; b += 1) {
      if (a * a + b * b <= radius * radius) offsets.push([a, b]);
    }
  }
  discCache.set(radius, offsets);
  return offsets;
}

/**
 * Cells of the cube shell at Chebyshev distance `k`, enumerated directly.
 * Walking the shell rather than scanning the solid cube is what keeps the
 * crater O(radius^3) overall instead of O(radius^4).
 */
function* cubeShell(k) {
  if (k === 0) {
    yield [0, 0, 0];
    return;
  }
  for (const dy of [-k, k]) {
    for (let dx = -k; dx <= k; dx += 1) {
      for (let dz = -k; dz <= k; dz += 1) yield [dx, dy, dz];
    }
  }
  for (let dy = -k + 1; dy <= k - 1; dy += 1) {
    for (const dx of [-k, k]) {
      for (let dz = -k; dz <= k; dz += 1) yield [dx, dy, dz];
    }
    for (const dz of [-k, k]) {
      for (let dx = -k + 1; dx <= k - 1; dx += 1) yield [dx, dy, dz];
    }
  }
}

/** Every cell of the punch, in the order the blast reaches them. */
function* punchCells(origin, direction, cfg) {
  const forward = normalize(direction);
  // Any two vectors perpendicular to the punch will do for the lane's cross
  // section; guard against the degenerate case of punching straight up.
  const reference = Math.abs(forward.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalize({
    x: forward.y * reference.z - forward.z * reference.y,
    y: forward.z * reference.x - forward.x * reference.z,
    z: forward.x * reference.y - forward.y * reference.x,
  });
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };

  // 1. The shockwave lane, one disc at a time so it travels outward.
  const disc = discOffsets(cfg.corridorRadius);
  for (let step = 1; step <= cfg.corridorLength; step += 1) {
    const centre = {
      x: origin.x + forward.x * step,
      y: origin.y + forward.y * step,
      z: origin.z + forward.z * step,
    };
    for (const [a, b] of disc) {
      yield {
        x: Math.floor(centre.x + right.x * a + up.x * b),
        y: Math.floor(centre.y + right.y * a + up.y * b),
        z: Math.floor(centre.z + right.z * a + up.z * b),
        wave: step,
        phase: "corridor",
      };
    }
  }

  // 2. The crater, growing outward from the impact until the count is met.
  // Its centre is sunk below the impact point: a sphere centred at head height
  // is half sky, and sweeping empty air is what makes the punch take a minute
  // instead of a few seconds.
  const reach = cfg.corridorLength * 0.45;
  const impact = {
    x: Math.floor(origin.x + forward.x * reach),
    y: Math.floor(origin.y + forward.y * reach - cfg.craterRadius * 0.35),
    z: Math.floor(origin.z + forward.z * reach),
  };
  for (let k = 1; k <= cfg.craterRadius; k += 1) {
    for (const [dx, dy, dz] of cubeShell(k)) {
      // Clip the boxy shell back to a sphere.
      if (dx * dx + dy * dy + dz * dz > cfg.craterRadius * cfg.craterRadius) continue;
      yield { x: impact.x + dx, y: impact.y + dy, z: impact.z + dz, wave: k, phase: "crater" };
    }
  }
}

function startSeriousPunch(bot, owner, origin, direction) {
  if (job) return false;

  const cfg = CONFIG.serious;
  const dimension = bot.dimension;
  const air = attempt(() => {
    const block = dimension.getBlock(offset(origin, 0, 40, 0));
    return block?.permutation;
  });

  job = {
    cells: punchCells(origin, direction, cfg),
    dimension,
    owner,
    ownerId: owner?.id,
    destroyed: 0,
    scanned: 0,
    wave: 0,
    phase: "corridor",
  };

  playSound(dimension, "random.explode", origin);
  playSound(dimension, "ambient.weather.thunder", origin);
  spawnParticle(dimension, "minecraft:huge_explosion_emitter", origin);

  // Everything hostile in the blast goes with the terrain.
  for (const entity of attempt(
    () => dimension.getEntities({ location: origin, maxDistance: cfg.killRadius }),
    []
  )) {
    if (!isValidTarget(entity, owner)) continue;
    safe(() =>
      entity.applyDamage(1000000, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: owner ?? bot,
      })
    );
    if (isAlive(entity)) safe(() => entity.kill());
  }

  void air;
  return true;
}

/** Pull one tick's worth of cells out of the running punch. */
function advanceJob() {
  if (!job) return;
  const cfg = CONFIG.serious;
  const { dimension } = job;
  const owner = job.ownerId
    ? world.getAllPlayers().find((player) => player.id === job.ownerId)
    : undefined;

  // The stop condition has to be phase-aware. The corridor and the crater both
  // count their waves from 1, so comparing a wave number against the corridor
  // length can never be true once the crater starts, and the punch would grind
  // through its entire million-cell sweep every time.
  const quotaMet = () => job.destroyed >= cfg.targetBlocks && job.phase === "crater";

  let budget = cfg.blocksPerTick;
  let exhausted = false;
  while (budget > 0) {
    if (quotaMet()) break; // enough world has been erased, stop mid-crater

    const next = job.cells.next();
    if (next.done) {
      exhausted = true;
      break;
    }
    budget -= 1;
    job.scanned += 1;

    const cell = next.value;
    job.phase = cell.phase;
    if (cell.wave !== job.wave) {
      job.wave = cell.wave;
      // A ring of debris at the leading edge, so the wave is visible.
      if (job.wave % 6 === 0) {
        spawnParticle(dimension, "minecraft:huge_explosion_emitter", cell);
        if (job.wave % 24 === 0) playSound(dimension, "random.explode", cell);
      }
    }

    if (owner && distance(cell, owner.location) < cfg.protectRadius) continue;

    const block = attempt(() => dimension.getBlock(cell));
    if (!block) continue;
    if (attempt(() => block.isAir, true)) continue;
    if (UNBREAKABLE.has(attempt(() => block.typeId, ""))) continue;

    safe(() => block.setType("minecraft:air"));
    job.destroyed += 1;
  }

  const finished = exhausted || quotaMet();

  if (owner) {
    safe(() =>
      owner.onScreenDisplay.setActionBar(
        `§eSERIOUS PUNCH §f${job.destroyed.toLocaleString?.() ?? job.destroyed}§7 blocks`
      )
    );
  }

  if (!finished) return;

  const total =
    (attempt(() => world.getDynamicProperty(`saitama:destroyed:${job.ownerId}`), 0) ?? 0) +
    job.destroyed;
  safe(() => world.setDynamicProperty(`saitama:destroyed:${job.ownerId}`, total));

  if (owner) {
    owner.sendMessage(
      `§e[Saitama]§r Serious punch: §f${job.destroyed}§r blocks erased ` +
        `(§7${job.scanned} swept§r). Career total: §f${total}§r.`
    );
  }
  job = undefined;
}

/* ------------------------------------------------------------------ *
 * Punching
 * ------------------------------------------------------------------ */

// Our own killing blow raises entityHurt again; without this the avenge
// handler would treat the victim as a fresh attacker.
const executing = new Set();

function onePunch(bot, target, owner) {
  if (!isValidTarget(target, owner)) return false;
  if (executing.has(target.id)) return false;
  executing.add(target.id);
  const release = target.id;
  system.run(() => executing.delete(release));

  const dimension = bot.dimension;
  const where = bodyLocation(target);
  const direction = normalize({
    x: where.x - bot.location.x,
    y: 0,
    z: where.z - bot.location.z,
  });

  setAnimation(bot, "punch");
  playSound(dimension, "mob.irongolem.throw", bot.location);

  system.runTimeout(() => {
    if (!isAlive(bot)) return;

    spawnParticle(dimension, "minecraft:huge_explosion_emitter", where);
    playSound(dimension, "random.explode", where);

    safe(() =>
      target.applyDamage(1000000, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: owner ?? bot,
      })
    );
    if (isAlive(target)) safe(() => target.kill());

    const botState = stateOf(bot);
    const serious =
      CONFIG.seriousOnEveryHit &&
      (recall(bot, "saitama:mode") ?? "serious") === "serious" &&
      system.currentTick - botState.lastSerious >= CONFIG.seriousCooldownTicks;

    if (serious) {
      botState.lastSerious = system.currentTick;
      startSeriousPunch(bot, owner, offset(bot.location, 0, 1, 0), direction);
    } else {
      casualShockwave(bot, owner, where);
    }

    system.runTimeout(() => setAnimation(bot, "idle"), 8);
  }, CONFIG.punchWindupTicks);

  return true;
}

/** The restrained version: a modest crater, for when the world has to survive. */
function casualShockwave(bot, owner, centre) {
  const dimension = bot.dimension;
  const radius = CONFIG.casualCraterRadius;
  let removed = 0;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const cell = offset(centre, dx, dy, dz);
        if (owner && distance(cell, owner.location) < 3) continue;
        const block = attempt(() => dimension.getBlock(cell));
        if (!block || attempt(() => block.isAir, true)) continue;
        if (UNBREAKABLE.has(attempt(() => block.typeId, ""))) continue;
        safe(() => block.setType("minecraft:air"));
        removed += 1;
      }
    }
  }
  spawnParticle(dimension, "minecraft:huge_explosion_emitter", centre);
  void removed;
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

function updateBot(bot, owner) {
  const botState = stateOf(bot);

  if (!owner || !isAlive(owner)) {
    setAnimation(bot, "idle");
    return;
  }

  if (
    bot.dimension.id !== owner.dimension.id ||
    distance(bot.location, owner.location) > CONFIG.recallDistance
  ) {
    const point = escortPoint(owner);
    safe(() =>
      bot.teleport(
        { ...point, y: footing(owner.dimension, point) },
        { dimension: owner.dimension, facingLocation: bodyLocation(owner) }
      )
    );
    botState.targetId = undefined;
    setAnimation(bot, "idle");
    return;
  }

  let target = botState.targetId
    ? attempt(() => bot.dimension.getEntities({ location: bot.location, maxDistance: 96 }), [])
        .find((entity) => entity.id === botState.targetId)
    : undefined;
  if (target && !isValidTarget(target, owner)) target = undefined;
  botState.targetId = target?.id;

  if (target) {
    const aim = bodyLocation(target);
    const gap = distance(bot.location, aim);
    if (gap > CONFIG.punchRange) {
      glide(bot, aim, speedFor(gap, CONFIG.chaseSpeed, CONFIG.maxChaseSpeed), aim);
      setAnimation(bot, "run");
      return;
    }
    if (botState.animation !== "punch" && onePunch(bot, target, owner)) {
      botState.targetId = undefined;
    }
    return;
  }

  const station = escortPoint(owner);
  const gap = glide(
    bot,
    station,
    speedFor(distance(bot.location, station), CONFIG.followSpeed, CONFIG.maxFollowSpeed),
    bodyLocation(owner)
  );
  if (botState.animation !== "punch") {
    setAnimation(bot, gap > 1.2 ? "run" : "idle");
  }
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

const missing = new Map();

function summonFor(player) {
  const bot = attempt(() => player.dimension.spawnEntity(BOT, offset(player.location, 0, 0, 1)));
  if (!bot) return undefined;
  remember(bot, "saitama:owner", player.id);
  remember(bot, "saitama:mode", "serious");
  safe(() => (bot.nameTag = "§eSaitama"));
  player.sendMessage("§e[Saitama]§r Sorry, got lost looking for a sale. Back now.");
  return bot;
}

// The demolition gets its own every-tick interval. Sharing the bot's slower
// update loop halved its throughput for no benefit.
system.runInterval(advanceJob, 1);

system.runInterval(() => {
  const players = attempt(() => world.getAllPlayers(), []);
  const byOwner = new Map();
  const unbound = [];

  for (const dimension of loadedDimensions()) {
    for (const bot of attempt(() => dimension.getEntities({ type: BOT }), [])) {
      const ownerId = recall(bot, "saitama:owner");
      if (!ownerId) {
        unbound.push(bot);
        continue;
      }
      if (byOwner.has(ownerId)) {
        safe(() => (typeof bot.remove === "function" ? bot.remove() : bot.kill()));
        continue;
      }
      byOwner.set(ownerId, bot);
    }
  }

  for (const bot of unbound) {
    let closest;
    let best = CONFIG.bindRadius;
    for (const player of players) {
      if (player.dimension.id !== bot.dimension.id) continue;
      const away = distance(player.location, bot.location);
      if (away <= best && !byOwner.has(player.id)) {
        best = away;
        closest = player;
      }
    }
    if (closest) {
      bindTo(bot, closest);
      byOwner.set(closest.id, bot);
    }
  }

  for (const player of players) {
    const bot = byOwner.get(player.id);
    if (!bot) {
      if (attempt(() => world.getDynamicProperty(`saitama:bound:${player.id}`), false)) {
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
      updateBot(bot, player);
    } catch (error) {
      console.warn(`[Saitama Bot] update failed: ${error}`);
    }
  }
}, CONFIG.updateTicks);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damage, damageSource } = event;
  if (!hurtEntity || !isPlayer(hurtEntity) || damage <= 0) return;

  const attacker = damageSource?.damagingEntity;
  if (!attacker || executing.has(attacker.id)) return;
  if (!isValidTarget(attacker, hurtEntity)) return;

  const bots = attempt(
    () =>
      hurtEntity.dimension.getEntities({
        type: BOT,
        location: hurtEntity.location,
        maxDistance: 64,
      }),
    []
  );

  for (const bot of bots) {
    if (recall(bot, "saitama:owner") !== hurtEntity.id) continue;
    const botState = stateOf(bot);
    if (botState.targetId === attacker.id) continue;
    botState.targetId = attacker.id;
    playSound(bot.dimension, "mob.irongolem.crack", bot.location);
  }
});

world.afterEvents.entitySpawn.subscribe((event) => {
  const bot = event.entity;
  if (!bot || bot.typeId !== BOT) return;
  if (recall(bot, "saitama:owner")) return;

  system.run(() => {
    if (!isAlive(bot)) return;
    let closest;
    let best = CONFIG.bindRadius;
    for (const player of attempt(() => world.getAllPlayers(), [])) {
      if (player.dimension.id !== bot.dimension.id) continue;
      const away = distance(player.location, bot.location);
      if (away <= best) {
        best = away;
        closest = player;
      }
    }
    if (closest) bindTo(bot, closest);
  });
});

/** Tap for a status report; sneak-tap to cycle serious -> casual -> dismissed. */
world.afterEvents.playerInteractWithEntity?.subscribe((event) => {
  const bot = event.target;
  const player = event.player;
  if (!bot || bot.typeId !== BOT || !player) return;

  const ownerId = recall(bot, "saitama:owner");
  if (ownerId && ownerId !== player.id) {
    player.sendMessage("§e[Saitama]§r He is somebody else's hero.");
    return;
  }
  if (!ownerId) {
    bindTo(bot, player);
    return;
  }

  if (player.isSneaking) {
    const mode = recall(bot, "saitama:mode") ?? "serious";
    if (mode === "serious") {
      remember(bot, "saitama:mode", "casual");
      player.sendMessage(
        "§e[Saitama]§r Casual mode: still one punch, but only a small crater."
      );
      return;
    }
    remember(bot, "saitama:mode", "serious");
    safe(() => world.setDynamicProperty(`saitama:bound:${player.id}`, false));
    spawnParticle(bot.dimension, "minecraft:huge_explosion_emitter", bodyLocation(bot));
    safe(() => (typeof bot.remove === "function" ? bot.remove() : bot.kill()));
    player.sendMessage("§e[Saitama]§r Off to the sale. Use the spawn egg to call him back.");
    return;
  }

  const destroyed =
    attempt(() => world.getDynamicProperty(`saitama:destroyed:${player.id}`), 0) ?? 0;
  player.sendMessage(
    `§e[Saitama]§r Mode: §f${recall(bot, "saitama:mode") ?? "serious"}§e. ` +
      `Blocks erased for you: §f${destroyed}§e.`
  );
});

/** /function saitama_serious - punch wherever the player is looking. */
system.afterEvents.scriptEventReceive?.subscribe((event) => {
  if (event.id !== "saitama:serious") return;
  const player = event.sourceEntity;
  if (!isPlayer(player)) return;

  const bots = attempt(
    () =>
      player.dimension.getEntities({ type: BOT, location: player.location, maxDistance: 64 }),
    []
  );
  const bot = bots.find((candidate) => recall(candidate, "saitama:owner") === player.id);
  if (!bot) {
    player.sendMessage("§e[Saitama]§r He is not with you right now.");
    return;
  }
  if (job) {
    player.sendMessage("§e[Saitama]§r Still cleaning up the last one.");
    return;
  }

  const direction = attempt(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  setAnimation(bot, "punch");
  playSound(bot.dimension, "mob.irongolem.throw", bot.location);
  system.runTimeout(() => {
    if (!isAlive(bot)) return;
    stateOf(bot).lastSerious = system.currentTick;
    startSeriousPunch(bot, player, offset(bot.location, 0, 1, 0), direction);
    system.runTimeout(() => setAnimation(bot, "idle"), 8);
  }, CONFIG.punchWindupTicks);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§e[Saitama Bot]§r v1.0.0 loaded - spawn egg, or /function saitama_summon."
    )
  );
});
