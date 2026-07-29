/*
 * One Punch Man - Serious Series
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Seven selectable moves, cycled with sneak + tap. Every move is built out of
 * three primitives that all go through one budgeted queue:
 *
 *   carve  - a /fill of air over a 32x32x32 box. This is what actually makes
 *            the punch feel heavy: explosions alone pockmark terrain and leave
 *            floating debris, while a fill deletes 32768 blocks outright.
 *   blast  - a createExplosion for the ragged edges, the sound and the shove.
 *   launch - upward impulse on everything in a radius.
 *
 * The queue is drained at a fixed budget per tick (`perTick`), so a move plays
 * out over time instead of being attempted in a single frame. That is the only
 * reason the small moves stay smooth on a phone - and the reason the big ones
 * can be cancelled halfway with !punch stop.
 */

import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";

const ITEM = "opm:serious_punch";
const VERSION = "1.1.0";

/* ------------------------------------------------------------------ *
 * Moves
 *
 * Shared fields:
 *   kind         line | barrage | star | flip | sphere
 *   reach        length of a punch line, in blocks
 *   step         distance between detonations along a line
 *   blast        explosion power of each line detonation
 *   carve        edge length of the /fill boxes (max 32 - a 32^3 box is
 *                exactly the 32768-block limit of one fill command)
 *   crater       radius of the solid sphere carved out at the impact point
 *   shockwave    radius of the ring detonations around the impact point
 *   ringStep     distance between shockwave rings
 *   ringSpacing  arc distance between detonations within one ring
 *   ringBlast    explosion power of each shockwave detonation
 *   layers       vertical offsets each ring is repeated at
 *   killRadius   everything this close to the punch is deleted
 *   perTick      queue budget per tick - the anti-freeze valve
 *   maxJobs      hard cap on a single activation
 * ------------------------------------------------------------------ */

const MOVES = [
  {
    key: "normal",
    name: "Normal Punch",
    colour: "§a",
    blurb: "A tap. Still deletes anything alive in front of you.",
    kind: "line",
    reach: 40,
    step: 5,
    blast: 7,
    carve: 16,
    crater: 12,
    shockwave: 0,
    killRadius: 14,
    perTick: 8,
    maxJobs: 300,
    cooldownTicks: 20,
    durability: 1,
  },
  {
    key: "consecutive",
    name: "Consecutive Normal Punches",
    colour: "§b",
    blurb: "Fourteen punches in about a second, fanned across your view.",
    kind: "barrage",
    volleys: 14,
    spread: 0.16,
    reach: 96,
    step: 6,
    blast: 9,
    carve: 16,
    crater: 14,
    shockwave: 0,
    killRadius: 32,
    perTick: 14,
    maxJobs: 2000,
    cooldownTicks: 120,
    durability: 6,
  },
  {
    key: "serious",
    name: "Serious Punch",
    colour: "§e",
    blurb: "The one from the manga: a trench to the horizon, a crater at the end.",
    kind: "line",
    reach: 224,
    step: 6,
    blast: 18,
    carve: 32,
    crater: 80,
    shockwave: 112,
    ringStep: 10,
    ringSpacing: 11,
    ringBlast: 14,
    layers: [-16, 0, 16],
    killRadius: 112,
    // 14 fills a tick is roughly 450k blocks a tick - heavy, but it keeps the
    // default move to a few seconds of stutter instead of a hard freeze.
    perTick: 14,
    maxJobs: 6000,
    cooldownTicks: 160,
    durability: 12,
  },
  {
    key: "tableflip",
    name: "Serious Series: Table Flip",
    colour: "§6",
    blurb: "Flips the ground itself. Everything standing on it goes up with it.",
    kind: "flip",
    radius: 96,
    thickness: 32,
    launchPower: 8,
    blast: 12,
    carve: 32,
    ringStep: 12,
    ringSpacing: 12,
    ringBlast: 12,
    layers: [0],
    killRadius: 80,
    perTick: 24,
    maxJobs: 4000,
    cooldownTicks: 200,
    durability: 16,
  },
  {
    key: "sideways",
    name: "Serious Series: Sideways Jumps",
    colour: "§d",
    blurb: "Eight punches at once, one down every compass line.",
    kind: "star",
    arms: 8,
    reach: 144,
    step: 6,
    blast: 14,
    carve: 24,
    crater: 24,
    shockwave: 0,
    killRadius: 96,
    perTick: 26,
    maxJobs: 7000,
    cooldownTicks: 220,
    durability: 20,
  },
  {
    key: "deathcounter",
    name: "Killer Move: Serious Series",
    colour: "§c",
    blurb: "A 340-block sphere of nothing. Expect the game to stall for a while.",
    kind: "sphere",
    reach: 112,
    step: 8,
    blast: 20,
    carve: 32,
    crater: 170,
    shockwave: 190,
    ringStep: 10,
    ringSpacing: 11,
    ringBlast: 17,
    layers: [-48, -24, 0, 24, 48],
    killRadius: 220,
    perTick: 40,
    maxJobs: 14000,
    cooldownTicks: 300,
    durability: 32,
  },
  {
    key: "apocalypse",
    name: "APOCALYPSE",
    colour: "§4",
    blurb: "800 blocks across. THIS WILL HANG THE GAME AND MAY CRASH IT.",
    kind: "sphere",
    reach: 192,
    step: 8,
    blast: 24,
    carve: 32,
    crater: 400,
    shockwave: 400,
    ringStep: 10,
    ringSpacing: 11,
    ringBlast: 20,
    layers: [-96, -48, 0, 48, 96],
    killRadius: 512,
    perTick: 64,
    maxJobs: 60000,
    cooldownTicks: 600,
    durability: 96,
    warning: true,
  },
];

// Serious Punch is the default - the point of the item is that it hits hard
// out of the box, without anyone having to find the tier control first.
const DEFAULT_MOVE = MOVES.findIndex((move) => move.key === "serious");

const CONFIG = {
  // Ticks of wind-up between the tap and the punch landing.
  windupTicks: 14,
  // The punch starts this far in front of the player so they are not standing
  // inside the first detonation.
  standoff: 6,
  // Ticks of Resistance V / Fire Resistance the puncher gets.
  selfProtectTicks: 1800,
  // Only every Nth queued job also spawns particles/sound. At the big moves
  // the cosmetics cost more than the destruction does.
  cosmeticEvery: 14,
  // Terrain destruction. Set both to false for a "damage only" punch that
  // leaves the world intact.
  carveTerrain: true,
  breaksBlocks: true,
  causesFire: false,
  // Melee: hitting a mob with the glove deletes it outright.
  meleeOneShot: true,
  meleeBlast: 5,
  cooldownCategory: "opm_serious",
  moveProperty: "opm:move",
};

/* ------------------------------------------------------------------ *
 * Small helpers - every cosmetic and optional call is swallowed so that a
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

function actionBar(player, message) {
  safe(() => player.onScreenDisplay.setActionBar(message));
}

function shake(player, intensity, seconds) {
  safe(() =>
    player.runCommand(`camerashake add @s ${intensity} ${seconds} positional`)
  );
}

/** Build height limits, so a /fill never runs off the top or bottom. */
function heightLimits(dimension) {
  try {
    const range = dimension.heightRange;
    if (range) return { min: range.min, max: range.max - 1 };
  } catch {
    /* older builds do not expose heightRange */
  }
  return { min: -64, max: 319 };
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
 * Selected move, stored per world so it survives a rejoin
 * ------------------------------------------------------------------ */

function moveIndex() {
  try {
    const stored = world.getDynamicProperty(CONFIG.moveProperty);
    if (typeof stored === "number" && MOVES[stored]) return stored;
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_MOVE;
}

function currentMove() {
  return MOVES[moveIndex()];
}

function setMove(index) {
  const next = ((index % MOVES.length) + MOVES.length) % MOVES.length;
  safe(() => world.setDynamicProperty(CONFIG.moveProperty, next));
  return MOVES[next];
}

function announceMove(player, move) {
  const position = MOVES.indexOf(move) + 1;
  tell(
    player,
    `${move.colour}[${position}/${MOVES.length}] ${move.name}§r`
  );
  tell(player, `§7${move.blurb}§r`);
  if (move.warning) tell(player, "§4! BACK UP THE WORLD BEFORE USING THIS.§r");
  actionBar(player, `${move.colour}${move.name}§r`);
}

/* ------------------------------------------------------------------ *
 * Job queue
 *
 * Every carve, blast and launch a move wants goes in here, and one interval
 * drains it at `perTick`. Without this the whole move would run inside a
 * single tick and the game would stop responding until it finished. It also
 * gives us exactly one place to cancel from.
 * ------------------------------------------------------------------ */

let queue = [];
let runner = undefined;
let budget = 16;

function carveBox(job) {
  const { dimension, from, to } = job;
  // Bedrock caps one /fill at 32768 blocks, which is why the boxes are 32^3.
  safe(() =>
    dimension.runCommand(
      `fill ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} air`
    )
  );
}

function detonate(job) {
  const { dimension, at, radius, source } = job;
  safe(() =>
    dimension.createExplosion(at, radius, {
      breaksBlocks: CONFIG.breaksBlocks,
      causesFire: CONFIG.causesFire,
      allowUnderwater: true,
      source: source && isPlayer(source) ? source : undefined,
    })
  );
}

function launch(job) {
  const { dimension, at, radius, power, source } = job;
  let entities = [];
  try {
    entities = dimension.getEntities({ location: at, maxDistance: radius });
  } catch {
    return;
  }
  for (const entity of entities) {
    if (source && entity.id === source.id) continue;
    const dx = entity.location.x - at.x;
    const dz = entity.location.z - at.z;
    const length = Math.hypot(dx, dz) || 1;
    // The 4-argument form is what 1.11.0 exposes; newer builds take vectors,
    // so try both before giving up.
    try {
      entity.applyKnockback(dx / length, dz / length, power, power);
    } catch {
      safe(() =>
        entity.applyKnockback({ x: dx / length, z: dz / length }, power)
      );
    }
  }
}

function runJob(job) {
  if (job.kind === "carve") carveBox(job);
  else if (job.kind === "launch") launch(job);
  else detonate(job);

  if (job.cosmetic) {
    particle(job.dimension, "minecraft:huge_explosion_emitter", job.at ?? job.from);
    sound(job.dimension, "random.explode", job.at ?? job.from);
  }
}

function drain() {
  for (let n = 0; n < budget && queue.length; n++) {
    runJob(queue.shift());
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

function enqueue(jobs, perTick) {
  budget = perTick ?? budget;
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
 * Destruction primitives
 * ------------------------------------------------------------------ */

/**
 * Carve a solid sphere out of the world as a grid of /fill boxes, nearest the
 * centre first so the hole opens outwards. A box is kept when its centre is
 * inside the sphere, which leaves a blocky rim - the ring blasts then chew
 * that rim into something that looks like an impact crater.
 */
function sphereCarve(dimension, centre, radius, box, out) {
  if (!CONFIG.carveTerrain || radius <= 0) return;
  const limits = heightLimits(dimension);
  const half = box / 2;
  const r2 = radius * radius;
  const boxes = [];

  for (let dx = -radius; dx < radius; dx += box) {
    for (let dz = -radius; dz < radius; dz += box) {
      for (let dy = -radius; dy < radius; dy += box) {
        const cx = dx + half;
        const cy = dy + half;
        const cz = dz + half;
        const distance2 = cx * cx + cy * cy + cz * cz;
        if (distance2 > r2) continue;

        const y1 = Math.max(limits.min, Math.floor(centre.y + dy));
        const y2 = Math.min(limits.max, Math.floor(centre.y + dy + box - 1));
        if (y2 < y1) continue;

        boxes.push({
          distance2,
          job: {
            kind: "carve",
            dimension,
            from: {
              x: Math.floor(centre.x + dx),
              y: y1,
              z: Math.floor(centre.z + dz),
            },
            to: {
              x: Math.floor(centre.x + dx + box - 1),
              y: y2,
              z: Math.floor(centre.z + dz + box - 1),
            },
          },
        });
      }
    }
  }

  boxes.sort((a, b) => a.distance2 - b.distance2);
  for (const entry of boxes) out.push(entry.job);
}

/** Carve a flat slab - a disc of `radius` and `thickness` blocks deep. */
function slabCarve(dimension, centre, radius, thickness, box, out) {
  if (!CONFIG.carveTerrain || radius <= 0) return;
  const limits = heightLimits(dimension);
  const half = box / 2;
  const r2 = radius * radius;
  const boxes = [];

  for (let dx = -radius; dx < radius; dx += box) {
    for (let dz = -radius; dz < radius; dz += box) {
      const cx = dx + half;
      const cz = dz + half;
      const distance2 = cx * cx + cz * cz;
      if (distance2 > r2) continue;

      const y1 = Math.max(limits.min, Math.floor(centre.y - thickness));
      const y2 = Math.min(limits.max, Math.floor(centre.y));
      if (y2 < y1) continue;

      boxes.push({
        distance2,
        job: {
          kind: "carve",
          dimension,
          from: { x: Math.floor(centre.x + dx), y: y1, z: Math.floor(centre.z + dz) },
          to: {
            x: Math.floor(centre.x + dx + box - 1),
            y: y2,
            z: Math.floor(centre.z + dz + box - 1),
          },
        },
      });
    }
  }

  boxes.sort((a, b) => a.distance2 - b.distance2);
  for (const entry of boxes) out.push(entry.job);
}

/** A punch line: carve a square tunnel and detonate along it. */
function punchLine(dimension, origin, view, move, source, out) {
  const box = Math.min(move.carve ?? 16, 32);
  const half = box / 2;
  const limits = heightLimits(dimension);
  let index = 0;

  for (let d = 0; d <= move.reach; d += move.step) {
    const at = {
      x: origin.x + view.x * d,
      y: origin.y + view.y * d,
      z: origin.z + view.z * d,
    };

    if (CONFIG.carveTerrain) {
      const y1 = Math.max(limits.min, Math.floor(at.y - half));
      const y2 = Math.min(limits.max, Math.floor(at.y + half - 1));
      if (y2 >= y1) {
        out.push({
          kind: "carve",
          dimension,
          from: { x: Math.floor(at.x - half), y: y1, z: Math.floor(at.z - half) },
          to: {
            x: Math.floor(at.x + half - 1),
            y: y2,
            z: Math.floor(at.z + half - 1),
          },
        });
      }
    }

    out.push({
      kind: "blast",
      dimension,
      at,
      radius: move.blast,
      source,
      cosmetic: index % 3 === 0,
    });
    index++;
  }
}

/** Expanding rings of detonations around a point, innermost first. */
function shockwave(dimension, centre, move, source, out) {
  if (!move.shockwave) return;
  const layers = move.layers ?? [0];
  let index = 0;

  for (let r = move.ringStep; r <= move.shockwave; r += move.ringStep) {
    const count = Math.max(6, Math.round((2 * Math.PI * r) / move.ringSpacing));
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      for (const dy of layers) {
        out.push({
          kind: "blast",
          dimension,
          at: {
            x: centre.x + Math.cos(angle) * r,
            y: centre.y + dy,
            z: centre.z + Math.sin(angle) * r,
          },
          radius: move.ringBlast,
          source,
          cosmetic: index % CONFIG.cosmeticEvery === 0,
        });
        index++;
      }
    }
  }
}

/**
 * Delete every entity within `radius`, except the puncher. One sweep rather
 * than a per-detonation check, because getEntities costs far more than an
 * explosion does.
 */
function annihilate(dimension, at, radius, puncher) {
  let entities = [];
  try {
    entities = dimension.getEntities({ location: at, maxDistance: radius });
  } catch {
    return;
  }

  for (const entity of entities) {
    if (entity.id === puncher.id) continue;
    if (isPlayer(entity)) {
      // Players are damaged, not deleted - kill() on a player is rude and some
      // builds ignore it anyway.
      safe(() =>
        entity.applyDamage(2000, {
          cause: EntityDamageCause.entityExplosion,
          damagingEntity: puncher,
        })
      );
      shake(entity, 4, 5);
    } else {
      safe(() => entity.kill());
    }
  }
}

/* ------------------------------------------------------------------ *
 * Move builders - each returns the list of jobs to queue
 * ------------------------------------------------------------------ */

function rotate(view, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: view.x * cos - view.z * sin,
    y: view.y,
    z: view.x * sin + view.z * cos,
  };
}

function buildJobs(player, move, origin, view, impact) {
  const dimension = player.dimension;
  const jobs = [];

  switch (move.kind) {
    case "barrage": {
      // Consecutive punches: a fan of lines. The queue budget spaces them out
      // in time on its own, which is exactly the machine-gun cadence we want.
      for (let i = 0; i < move.volleys; i++) {
        const angle = (i - (move.volleys - 1) / 2) * move.spread;
        punchLine(dimension, origin, rotate(view, angle), move, player, jobs);
      }
      break;
    }

    case "star": {
      // Eight arms on the horizontal plane, starting with the one you aimed at.
      for (let i = 0; i < move.arms; i++) {
        const angle = (Math.PI * 2 * i) / move.arms;
        punchLine(dimension, origin, rotate(view, angle), move, player, jobs);
      }
      sphereCarve(dimension, origin, move.crater, move.carve, jobs);
      break;
    }

    case "flip": {
      // Table Flip: the slab of ground goes first, then everything that was
      // standing on it gets thrown skyward, then the rim is blown out.
      // Anchored to the player's feet rather than the aim point, so looking up
      // still flips the ground instead of a slab of empty sky.
      const ground = { x: impact.x, y: player.location.y, z: impact.z };
      slabCarve(dimension, ground, move.radius, move.thickness, move.carve, jobs);
      jobs.push({
        kind: "launch",
        dimension,
        at: ground,
        radius: move.radius,
        power: move.launchPower,
        source: player,
      });
      shockwave(
        dimension,
        ground,
        Object.assign({}, move, { shockwave: move.radius }),
        player,
        jobs
      );
      break;
    }

    case "sphere": {
      punchLine(dimension, origin, view, move, player, jobs);
      sphereCarve(dimension, impact, move.crater, move.carve, jobs);
      shockwave(dimension, impact, move, player, jobs);
      break;
    }

    case "line":
    default: {
      punchLine(dimension, origin, view, move, player, jobs);
      sphereCarve(dimension, impact, move.crater, move.carve, jobs);
      shockwave(dimension, impact, move, player, jobs);
      break;
    }
  }

  return jobs;
}

/* ------------------------------------------------------------------ *
 * Firing a move
 * ------------------------------------------------------------------ */

function windup(player, move) {
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
  // Bigger moves get a heavier wind-up so you can feel which one is selected.
  shake(player, move.maxJobs > 3000 ? 4 : 2, CONFIG.windupTicks / 20);

  for (let tick = 0; tick < CONFIG.windupTicks; tick++) {
    system.runTimeout(() => {
      const angle = (Math.PI * 2 * tick) / 7;
      const ring = 1.8 - (1.4 * tick) / CONFIG.windupTicks;
      particle(
        dimension,
        "minecraft:critical_hit_emitter",
        offset(at, Math.cos(angle) * ring, 0.2, Math.sin(angle) * ring)
      );
      particle(dimension, "minecraft:basic_smoke_particle", at);
    }, tick);
  }
}

function fire(player) {
  const move = currentMove();
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
  const distance = move.reach ?? move.radius ?? 0;
  const impact = {
    x: origin.x + view.x * distance,
    y: origin.y + view.y * distance,
    z: origin.z + view.z * distance,
  };

  windup(player, move);

  system.runTimeout(() => {
    let jobs = buildJobs(player, move, origin, view, impact);

    // Hard cap. Past this the queue would take minutes to drain and the world
    // would be unplayable for the whole time.
    const capped = jobs.length > move.maxJobs;
    if (capped) jobs = jobs.slice(0, move.maxJobs);

    // Plain arithmetic only: Bedrock's script engine ships without full Intl,
    // so toLocaleString here would throw outside any guard and kill the punch.
    const carves = jobs.filter((job) => job.kind === "carve").length;
    const thousands = Math.round((carves * 32768) / 1000);
    tell(
      player,
      `${move.colour}${move.name}§r — §f${jobs.length}§r jobs ` +
        `(§f${carves}§r fills ≈ §f${thousands}k§r blocks)` +
        (capped ? " §7capped§r" : "")
    );

    sound(dimension, "ambient.weather.thunder", origin);
    particle(dimension, "minecraft:huge_explosion_emitter", origin);
    shake(player, 4, 8);

    enqueue(jobs, move.perTick);

    // Wipe out everything along the punch, then everything the shockwave
    // reaches once it has had time to travel.
    annihilate(dimension, origin, move.killRadius, player);
    annihilate(dimension, impact, move.killRadius, player);
    system.runTimeout(
      () => annihilate(dimension, impact, move.killRadius, player),
      40
    );

    consumeDurability(player, move.durability);
  }, CONFIG.windupTicks);
}

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */

// itemUse and itemUseOn can both fire for a single tap on touch controls, so
// allow at most one activation per player per tick.
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
    // Sneak + tap cycles the move. This is the control that always works: no
    // chat, no commands, no keyboard. It wraps, so there is always a way back
    // down off APOCALYPSE.
    if (player.isSneaking) {
      announceMove(player, setMove(moveIndex() + 1));
      sound(player.dimension, "random.orb", player.location);
      return;
    }

    if (queue.length) {
      actionBar(player, `§7still working — ${queue.length} jobs left§r`);
      return;
    }

    if (onCooldown(player, CONFIG.cooldownCategory)) return;
    safe(() =>
      player.startItemCooldown(CONFIG.cooldownCategory, currentMove().cooldownTicks)
    );

    fire(player);
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
        hurtEntity.applyDamage(2000, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: attacker,
        })
      );
    }

    safe(() =>
      attacker.addEffect("resistance", 60, { amplifier: 4, showParticles: false })
    );
    enqueue(
      [{ kind: "blast", dimension, at, radius: CONFIG.meleeBlast, source: attacker }],
      budget
    );
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
      if (argument === "stop") {
        tell(player, `§7[Serious Punch] cancelled ${abort()} pending jobs§r`);
        return;
      }
      if (!argument || argument === "list" || argument === "status") {
        tell(player, `§c[Serious Punch]§r moves — §7!punch <name>§r`);
        for (const move of MOVES) {
          const marker = move === currentMove() ? "§f>§r " : "  ";
          tell(player, `${marker}${move.colour}${move.key}§r — ${move.name}`);
        }
        tell(player, "§7!punch stop cancels a punch that is still running.§r");
        return;
      }
      const index = MOVES.findIndex((move) => move.key === argument);
      if (index < 0) {
        tell(player, "§c[Serious Punch] no such move. !punch list§r");
        return;
      }
      announceMove(player, setMove(index));
    });
  })
);

/* ------------------------------------------------------------------ *
 * Load confirmation
 * ------------------------------------------------------------------ */

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const move = currentMove();
  tell(
    event.player,
    `§c[Serious Punch]§r v${VERSION} loaded — ${MOVES.length} moves, selected: ${move.colour}${move.name}§r`
  );
  tell(event.player, "§7Sneak + tap to change move. Tap to punch. !punch list§r");
});

console.warn(
  `[One Punch Man] loaded - ${MOVES.length} moves armed (v${VERSION}).`
);
