/*
 * DON'T LOOK BEHIND YOU - The Follower
 *
 * Targets Minecraft Bedrock 1.21.0.26 (Android) using @minecraft/server 1.10.0,
 * which is the newest API version guaranteed to be present in that build. Every
 * engine call is funnelled through the T() guard below so that a signature that
 * shifted between point releases degrades to a no-op instead of killing the
 * whole stalking loop.
 *
 * The one rule the whole addon exists to serve: THE FOLLOWER MOVES ONLY WHILE
 * NO PLAYER CAN SEE IT. Freezing is therefore authoritative - it is applied by
 * swapping to a behaviour-pack component group that has no movement and no AI
 * goals at all, not by asking a goal politely to stop.
 */

import { world, system } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

const TICK_STEP = 2;          // main loop cadence, in ticks (10 Hz)
const HOUSEKEEP_TICKS = 100;  // slow janitor loop, in ticks (0.2 Hz)

const FIRST_CONTACT_MIN = 5000;   // ms after entering the world
const FIRST_CONTACT_MAX = 15000;
const SPAWN_DIST_MIN = 25;        // blocks
const SPAWN_DIST_MAX = 40;

const SEE_MAX = 64;           // beyond this nobody can see it, skip all maths
const RAY_MAX_STEPS = 26;     // hard cap on line-of-sight samples per ray

const LEASH_MAX = 58;         // farther than this and it repositions instead of wandering
const ATTACK_RANGE = 3.4;
const ATTACK_UNSEEN_MS = 2200;  // must go unwatched this long before it may strike
const ATTACK_DAMAGE = 9;        // 4.5 hearts - heavy, never lethal from full health
const ATTACK_DARKNESS_TICKS = 140;

const RESPAWN_AFTER_DEATH_MIN = 90000;   // another Follower eventually takes over
const RESPAWN_AFTER_DEATH_MAX = 150000;
const RESPAWN_AFTER_ATTACK_MIN = 10000;
const RESPAWN_AFTER_ATTACK_MAX = 18000;
const RESPAWN_AFTER_PLAYER_DEATH_MIN = 20000;
const RESPAWN_AFTER_PLAYER_DEATH_MAX = 40000;

const EYE_WARD_MS = 30000;      // Follower's Eye holds it still, even unwatched
const EYE_COOLDOWN_MS = 180000;

const MAX_FOLLOWERS = 4;        // mobile budget

const FOLLOWER_ID = "dlby:follower";
const EYE_ID = "dlby:followers_eye";
const HUNTED_TAG = "dlby_hunted";

/*
 * Sound design.
 *
 * No .ogg files ship with this pack; every cue is a stack of vanilla sound
 * EVENTS layered at custom pitch and volume, which is why the pack is a few KB
 * and why nothing can silently fail to resolve on a phone. Each entry is a list
 * of [event, pitch, volume]. To swap in your own recordings later, drop .ogg
 * files into the resource pack, register them in sounds/sound_definitions.json
 * and change only the event names here - see resource_packs/dlby_rp/sounds/.
 */
const SFX = {
  step:        [["step.stone", 0.52, 1.0]],
  stepSprint:  [["step.stone", 0.44, 1.0]],
  breathMid:   [["random.breath", 0.70, 0.35]],
  breathClose: [["random.breath", 0.50, 0.85], ["mob.endermen.idle", 0.35, 0.30]],
  farAmbient:  [["ambient.cave", 0.70, 0.25]],
  spotted:     [["mob.endermen.stare", 0.75, 0.45]],
  attack:      [["mob.endermen.scream", 0.55, 1.0],
                ["mob.wither.spawn", 0.45, 0.55],
                ["random.breath", 0.30, 1.0]],
  vanish:      [["mob.endermen.portal", 0.55, 0.35]],
  eye:         [["mob.endermen.stare", 0.40, 0.70]]
};

/*
 * Moods. Re-rolled every 20-45s so that turning around never teaches you what
 * happens next. Each one bends speed, footstep noise and preferred range.
 */
const MOODS = [
  "creep",   // never sprints; walks in deliberately
  "rush",    // sprints from much further out
  "silent",  // makes no footstep noise at all
  "distant", // hangs back at 22-34 blocks and just watches
  "lurk",    // stays frozen for seconds at a time even when unwatched
  "haunt",   // parks itself just outside your view - outside the door, at the window
  "creep",
  "rush",
  "haunt"
];

/* ------------------------------------------------------------------ *
 * Guards and small helpers
 * ------------------------------------------------------------------ */

/** Run an engine call, swallowing version drift and stale-handle throws. */
function T(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
}

function rnd(a, b) { return a + Math.random() * (b - a); }
function rndInt(a, b) { return Math.floor(rnd(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Entity.isValid is a method on older API versions and a property on newer. */
function alive(e) {
  if (!e) return false;
  return T(() => {
    const v = e.isValid;
    if (typeof v === "function") return v.call(e) === true;
    if (typeof v === "boolean") return v;
    return e.location !== undefined;
  }, false);
}

function playSfx(player, stack, loc) {
  for (let i = 0; i < stack.length; i++) {
    const s = stack[i];
    T(() => player.playSound(s[0], { location: loc, pitch: s[1], volume: s[2] }));
  }
}

/** Minecraft yaw: 0 faces +Z, and increases counter-clockwise. */
function yawTowards(fromX, fromZ, toX, toZ) {
  return -Math.atan2(toX - fromX, toZ - fromZ) * (180 / Math.PI);
}

/* ------------------------------------------------------------------ *
 * Block sight rules
 * ------------------------------------------------------------------ */

// Non-full blocks you can plainly see through. Doors and trapdoors are listed
// deliberately: mis-classifying a closed door as transparent only ever makes
// The Follower freeze when it did not strictly have to, which is the harmless
// direction to be wrong in.
const SEE_THROUGH_EXACT = new Set([
  "minecraft:air", "minecraft:cave_air", "minecraft:void_air",
  "minecraft:tallgrass", "minecraft:short_grass", "minecraft:tall_grass",
  "minecraft:fern", "minecraft:large_fern", "minecraft:double_plant",
  "minecraft:deadbush", "minecraft:snow_layer", "minecraft:web",
  "minecraft:vine", "minecraft:ladder", "minecraft:scaffolding",
  "minecraft:water", "minecraft:flowing_water", "minecraft:bamboo",
  "minecraft:sugar_cane", "minecraft:nether_sprouts", "minecraft:hanging_roots"
]);

const SEE_THROUGH_PARTS = [
  "glass", "leaves", "fence", "torch", "sign", "carpet", "bars",
  "sapling", "flower", "rail", "button", "pressure_plate", "lever",
  "door", "banner", "candle", "lantern", "chain", "coral", "kelp",
  "seagrass", "sprouts", "roots", "amethyst_cluster", "bud", "pane",
  "wire", "tripwire", "cobweb", "mushroom", "azalea"
];

/** Some API versions expose Block.isSolid as a property, some as a method. */
function solidFlag(block) {
  return T(() => {
    const s = block.isSolid;
    if (typeof s === "boolean") return s;
    if (typeof s === "function") return s.call(block) === true;
    return undefined;
  }, undefined);
}

function blocksSight(block) {
  if (!block) return false;                 // unloaded: assume visible, so it freezes
  const id = T(() => block.typeId, undefined);
  if (!id) return false;
  if (SEE_THROUGH_EXACT.has(id)) return false;
  // grass_block is opaque and must not be caught by a loose "grass" match, so
  // the plant ids above are matched exactly and never by substring.
  for (let i = 0; i < SEE_THROUGH_PARTS.length; i++) {
    if (id.indexOf(SEE_THROUGH_PARTS[i]) !== -1) return false;
  }
  const solid = solidFlag(block);
  if (solid !== undefined) return solid;
  return true;                              // unknown, non-air: treat as a wall
}

// Things a 2.4-block-tall body can stand inside of. Note the priority is the
// reverse of blocksSight(): glass is see-through but you cannot stand in it, so
// the solidity flag is consulted BEFORE any name matching.
const PASSABLE_PARTS = [
  "torch", "sign", "carpet", "sapling", "flower", "rail", "button",
  "pressure_plate", "lever", "banner", "candle", "sprouts", "roots",
  "web", "vine", "tripwire", "snow_layer", "bud", "seagrass", "coral_fan"
];

function isPassable(block) {
  if (!block) return false;
  const id = T(() => block.typeId, undefined);
  if (!id) return false;
  if (id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air") {
    return true;
  }
  // Never place it in fluid - navigation.walk avoids water, and lava kills it.
  if (id.indexOf("water") !== -1 || id.indexOf("lava") !== -1) return false;

  const solid = solidFlag(block);
  if (solid !== undefined) return !solid;

  if (SEE_THROUGH_EXACT.has(id)) return true;
  for (let i = 0; i < PASSABLE_PARTS.length; i++) {
    if (id.indexOf(PASSABLE_PARTS[i]) !== -1) return true;
  }
  return false;
}

function blockAt(dim, x, y, z) {
  return T(() => dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }), undefined);
}

/* ------------------------------------------------------------------ *
 * Visibility
 * ------------------------------------------------------------------ */

/**
 * Walk the ray from the eye toward a point, one block per sample.
 *
 * Sampling can slip past a wall corner on a long diagonal. That failure lands
 * on "we think it is visible", which freezes The Follower - never the reverse -
 * so the core rule is never broken by a missed sample.
 */
function rayBlocked(dim, ox, oy, oz, dx, dy, dz, dist) {
  const steps = Math.min(Math.ceil(dist / 0.9), RAY_MAX_STEPS);
  if (steps <= 1) return false;
  const stride = dist / steps;
  for (let i = 1; i < steps; i++) {
    const t = i * stride;
    if (blocksSight(blockAt(dim, ox + dx * t, oy + dy * t, oz + dz * t))) return true;
  }
  return false;
}

/**
 * Can this player see this world point right now?
 *
 * Two cheap gates before the expensive one: distance, then a dot product
 * against the player's view vector. The cone widens as the target gets closer
 * because a three-block-tall figure at five blocks fills most of a phone
 * screen even when it is well off-centre. Only survivors of both gates pay for
 * a line-of-sight walk.
 */
function canSeePoint(player, eye, view, dim, px, py, pz) {
  let dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.001 || d > SEE_MAX) return false;

  const inv = 1 / d;
  dx *= inv; dy *= inv; dz *= inv;

  const dot = dx * view.x + dy * view.y + dz * view.z;
  const threshold = d < 6 ? 0.15 : (d < 14 ? 0.38 : 0.47);
  if (dot < threshold) return false;

  if (d < 2.5) return true;                 // point blank: no wall can be between you
  return !rayBlocked(dim, eye.x, eye.y, eye.z, dx, dy, dz, d);
}

/**
 * Is The Follower visible to ANY nearby player?
 *
 * Checking every player, not just the owner, is what stops one person's camera
 * from being the only thing that matters in multiplayer: whoever happens to be
 * looking at it pins it in place.
 */
function seenByAnyone(follower, players) {
  const loc = T(() => follower.location, undefined);
  const dim = T(() => follower.dimension, undefined);
  if (!loc || !dim) return true;            // no idea: freeze, the safe answer

  const dimId = T(() => dim.id, "");
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (T(() => p.dimension.id, "") !== dimId) continue;

    const ploc = T(() => p.location, undefined);
    if (!ploc) continue;
    const ddx = loc.x - ploc.x, ddy = loc.y - ploc.y, ddz = loc.z - ploc.z;
    const rough = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (rough > SEE_MAX) continue;

    const eye = T(() => p.getHeadLocation(), undefined);
    const view = T(() => p.getViewDirection(), undefined);
    if (!eye || !view) continue;

    // Head first - it is the pale part and the part that clears low cover.
    if (canSeePoint(p, eye, view, dim, loc.x, loc.y + 2.75, loc.z)) return true;
    // Chest as well once it is close enough for the body to matter.
    if (rough < 16 && canSeePoint(p, eye, view, dim, loc.x, loc.y + 1.6, loc.z)) return true;
  }
  return false;
}

function pointSeenByAnyone(players, dim, px, py, pz) {
  const dimId = T(() => dim.id, "");
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (T(() => p.dimension.id, "") !== dimId) continue;
    const eye = T(() => p.getHeadLocation(), undefined);
    const view = T(() => p.getViewDirection(), undefined);
    if (!eye || !view) continue;
    if (canSeePoint(p, eye, view, dim, px, py, pz)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

/**
 * Find standing room at a column: a solid floor with `clearance` passable
 * blocks on top of it. Scans down from above the player's feet so that indoors
 * and underground it lands on the player's own floor rather than the surface.
 */
function findGround(dim, bx, bz, baseY, clearance) {
  for (let dy = 8; dy >= -12; dy--) {
    const y = Math.floor(baseY) + dy;
    const floor = blockAt(dim, bx, y, bz);
    if (!floor || isPassable(floor)) continue;
    let clear = true;
    for (let c = 1; c <= clearance; c++) {
      if (!isPassable(blockAt(dim, bx, y + c, bz))) { clear = false; break; }
    }
    if (clear) return y + 1;
  }
  return undefined;
}

/**
 * Pick a spot behind the player at roughly `desired` blocks, out of everyone's
 * sight. Tries a few random rear bearings, then relaxes the headroom
 * requirement so that cave ceilings do not make it give up.
 */
function findRearSpot(player, players, desired, spread) {
  const dim = T(() => player.dimension, undefined);
  const ploc = T(() => player.location, undefined);
  const view = T(() => player.getViewDirection(), undefined);
  if (!dim || !ploc || !view) return undefined;

  let vx = view.x, vz = view.z;
  const hl = Math.hypot(vx, vz);
  if (hl < 0.0001) { vx = 0; vz = 1; } else { vx /= hl; vz /= hl; }

  for (let clearance = 3; clearance >= 2; clearance--) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = rnd(-spread, spread);
      const ca = Math.cos(a), sa = Math.sin(a);
      // Rotate the view vector, then face the opposite way: directly behind.
      const bx = -(vx * ca - vz * sa);
      const bz = -(vx * sa + vz * ca);
      const dist = desired * rnd(0.88, 1.12);

      const tx = Math.floor(ploc.x + bx * dist);
      const tz = Math.floor(ploc.z + bz * dist);
      const gy = findGround(dim, tx, tz, ploc.y, clearance);
      if (gy === undefined) continue;
      if (pointSeenByAnyone(players, dim, tx + 0.5, gy + 2.75, tz + 0.5)) continue;
      return { x: tx + 0.5, y: gy, z: tz + 0.5, dim };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Hunter bookkeeping - one record per player
 * ------------------------------------------------------------------ */

const hunters = new Map();

function newHunter(playerId, now) {
  return {
    playerId,
    follower: undefined,
    followerId: undefined,
    spawnAt: now + rnd(FIRST_CONTACT_MIN, FIRST_CONTACT_MAX),
    state: "frozen",
    wasSeen: true,
    unseenSince: now,
    mood: pick(MOODS),
    moodUntil: now + rnd(20000, 45000),
    lurkUntil: 0,
    nextStepAt: 0,
    nextBreathAt: 0,
    nextAmbientAt: now + rnd(20000, 50000),
    nextDarknessAt: now + 30000,
    nextReposAt: now + rnd(4000, 9000),
    attackReadyAt: now + 15000,
    spottedSfxAt: 0,
    despawnAt: 0,
    greetAt: now + 3000,
    eyeWardUntil: 0,
    eyeCooldownUntil: 0
  };
}

function setState(h, next) {
  if (h.state === next) return;             // component-group swaps only on change
  h.state = next;
  const ev = next === "frozen" ? "dlby:freeze"
    : next === "stalk" ? "dlby:stalk"
    : next === "sprint" ? "dlby:sprint"
    : "dlby:attack";
  T(() => h.follower.triggerEvent(ev));
}

function dropFollower(h, player, delayMin, delayMax, now, withSound) {
  if (alive(h.follower)) {
    if (withSound && player) {
      const loc = T(() => h.follower.location, undefined);
      if (loc) playSfx(player, SFX.vanish, loc);
    }
    T(() => h.follower.triggerEvent("dlby:vanish"));
  }
  h.follower = undefined;
  h.followerId = undefined;
  h.state = "frozen";
  h.despawnAt = 0;
  h.spawnAt = now + rnd(delayMin, delayMax);
}

function countFollowers() {
  let n = 0;
  hunters.forEach((h) => { if (h.followerId) n++; });
  return n;
}

/* ------------------------------------------------------------------ *
 * Spawning
 * ------------------------------------------------------------------ */

function trySpawn(h, player, players, now) {
  if (countFollowers() >= MAX_FOLLOWERS) { h.spawnAt = now + 5000; return; }

  const spot = findRearSpot(player, players, rnd(SPAWN_DIST_MIN, SPAWN_DIST_MAX), 1.7);
  if (!spot) { h.spawnAt = now + 2000; return; }   // no room yet, try again shortly

  const ent = T(() => spot.dim.spawnEntity(FOLLOWER_ID, { x: spot.x, y: spot.y, z: spot.z }), undefined);
  if (!ent) { h.spawnAt = now + 3000; return; }

  T(() => ent.addTag("dlby_follower"));
  T(() => ent.addTag("dlby_o_" + h.playerId));
  T(() => player.addTag(HUNTED_TAG));

  h.follower = ent;
  h.followerId = T(() => ent.id, undefined);
  h.state = "frozen";
  h.wasSeen = false;
  h.unseenSince = now;
  h.spawnAt = 0;
  h.despawnAt = 0;
  h.attackReadyAt = now + rnd(12000, 20000);
  T(() => ent.triggerEvent("dlby:freeze"));
}

/* ------------------------------------------------------------------ *
 * Atmosphere - the distance tiers
 * ------------------------------------------------------------------ */

function tension(h, player, dist, loc, now, moving, sprinting) {
  // 30+ : almost silent. A rare swell of cave tone and nothing else.
  if (dist > 30) {
    if (now >= h.nextAmbientAt) {
      h.nextAmbientAt = now + rnd(45000, 90000);
      if (Math.random() < 0.5) playSfx(player, SFX.farAmbient, loc);
    }
    return;
  }

  // Footsteps, if this mood is making any at all.
  if (moving && h.mood !== "silent" && now >= h.nextStepAt) {
    const far = dist > 15;
    h.nextStepAt = now + (sprinting ? rnd(260, 360) : rnd(440, 620)) * (far ? 1.7 : 1.0);
    const vol = dist > 15 ? 0.16 : (dist > 5 ? 0.34 : 0.55);
    const stack = sprinting ? SFX.stepSprint : SFX.step;
    // Distant steps are intermittent, so you are never quite sure you heard one.
    if (!far || Math.random() < 0.45) {
      for (let i = 0; i < stack.length; i++) {
        const s = stack[i];
        T(() => player.playSound(s[0], {
          location: loc,
          pitch: s[1] * rnd(0.94, 1.07),
          volume: vol
        }));
      }
    }
  }

  if (dist > 15) return;

  // 5-15 : breathing becomes audible, and the lights occasionally fail.
  if (dist > 5) {
    if (now >= h.nextBreathAt) {
      h.nextBreathAt = now + rnd(6000, 11000);
      playSfx(player, SFX.breathMid, loc);
    }
    if (now >= h.nextDarknessAt) {
      h.nextDarknessAt = now + rnd(20000, 34000);
      if (Math.random() < 0.28) {
        T(() => player.addEffect("darkness", 40, { amplifier: 0, showParticles: false }));
      }
    }
    return;
  }

  // Under 5 : it is breathing on the back of your neck.
  if (now >= h.nextBreathAt) {
    h.nextBreathAt = now + rnd(3500, 6000);
    playSfx(player, SFX.breathClose, loc);
  }
}

/* ------------------------------------------------------------------ *
 * Attack
 * ------------------------------------------------------------------ */

function doAttack(h, player, loc, now) {
  setState(h, "attack");
  playSfx(player, SFX.attack, loc);

  const attacker = h.follower;
  const dealt = T(() => {
    player.applyDamage(ATTACK_DAMAGE, { cause: "entityAttack", damagingEntity: attacker });
    return true;
  }, false);
  if (!dealt) T(() => player.applyDamage(ATTACK_DAMAGE));

  T(() => player.addEffect("darkness", ATTACK_DARKNESS_TICKS, {
    amplifier: 0, showParticles: false
  }));

  h.attackReadyAt = now + rnd(22000, 35000);
  // Let the lunge animation finish, then it is simply not there any more.
  // Driven by the main loop rather than system.runTimeout so the retreat cannot
  // be lost to a scheduler difference between point releases.
  h.despawnAt = now + 900;
}

/* ------------------------------------------------------------------ *
 * Per-player update
 * ------------------------------------------------------------------ */

function updateHunter(h, player, players, now) {
  // Lost the entity (killed, unloaded, or removed) - schedule a successor.
  if (h.followerId && !alive(h.follower)) {
    h.follower = undefined;
    h.followerId = undefined;
    h.state = "frozen";
    if (!h.spawnAt) h.spawnAt = now + rnd(RESPAWN_AFTER_DEATH_MIN, RESPAWN_AFTER_DEATH_MAX);
  }

  if (!h.followerId) {
    // The dlby_hunted tag is reconciled by the janitor loop, not here - this
    // path runs at 10 Hz and must stay free of engine calls.
    if (h.spawnAt && now >= h.spawnAt) trySpawn(h, player, players, now);
    return;
  }

  // Mid-retreat after a strike: hold still, then leave.
  if (h.despawnAt) {
    if (now >= h.despawnAt) {
      dropFollower(h, player, RESPAWN_AFTER_ATTACK_MIN, RESPAWN_AFTER_ATTACK_MAX, now, true);
    }
    return;
  }

  const loc = T(() => h.follower.location, undefined);
  const ploc = T(() => player.location, undefined);
  if (!loc || !ploc) return;

  // Different dimension, or it has fallen too far behind: bring it back rather
  // than letting it wander off. It should always be somewhere near you.
  const sameDim = T(() => h.follower.dimension.id, "a") === T(() => player.dimension.id, "b");
  const dx = loc.x - ploc.x, dy = loc.y - ploc.y, dz = loc.z - ploc.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!sameDim || dist > LEASH_MAX) {
    dropFollower(h, player, 6000, 12000, now, false);
    return;
  }

  if (now >= h.moodUntil) {
    h.mood = pick(MOODS);
    h.moodUntil = now + rnd(20000, 45000);
    h.lurkUntil = h.mood === "lurk" ? now + rnd(3000, 9000) : 0;
  }

  const seen = seenByAnyone(h.follower, players);

  if (seen) {
    // Freeze on the very first tick of being seen, and snap it round to face
    // its target once. It is never re-aimed while you keep watching, so
    // circling it will not make it track you - it just stands there, wrong.
    if (!h.wasSeen) {
      setState(h, "frozen");
      T(() => h.follower.clearVelocity());
      const yaw = yawTowards(loc.x, loc.z, ploc.x, ploc.z);
      T(() => h.follower.teleport(
        { x: loc.x, y: loc.y, z: loc.z },
        { dimension: h.follower.dimension, rotation: { x: 0, y: yaw } }
      ));
      if (dist < 26 && now >= h.spottedSfxAt) {
        h.spottedSfxAt = now + rnd(12000, 25000);
        playSfx(player, SFX.spotted, loc);
      }
    } else {
      setState(h, "frozen");
    }
    h.wasSeen = true;
    h.unseenSince = now;
    tension(h, player, dist, loc, now, false, false);
    return;
  }

  // ---- unwatched ----
  if (h.wasSeen) {
    h.wasSeen = false;
    h.unseenSince = now;
    // Sometimes it simply is not there when you look back.
    if (h.mood === "haunt" && dist > 22 && Math.random() < 0.25) {
      dropFollower(h, player, 8000, 16000, now, true);
      return;
    }
    if (h.mood === "lurk") h.lurkUntil = now + rnd(3000, 9000);
  }

  const unseenMs = now - h.unseenSince;
  const warded = now < h.eyeWardUntil;

  if (warded || (h.mood === "lurk" && now < h.lurkUntil)) {
    setState(h, "frozen");
    tension(h, player, dist, loc, now, false, false);
    return;
  }

  // Attack: extremely close, and it has gone unwatched long enough to earn it.
  if (dist < ATTACK_RANGE && unseenMs > ATTACK_UNSEEN_MS && now >= h.attackReadyAt) {
    doAttack(h, player, loc, now);
    return;
  }

  // The closer it gets, the faster it is allowed to move.
  let sprinting;
  if (h.mood === "creep") sprinting = false;
  else if (h.mood === "rush") sprinting = dist < 26;
  else if (h.mood === "distant") sprinting = false;
  else sprinting = dist < 12;

  setState(h, sprinting ? "sprint" : "stalk");
  maybeReposition(h, player, players, dist, now);
  tension(h, player, dist, loc, now, true, sprinting);
}

/**
 * The behind-you jump. While nothing can see it, relocate it to a spot out of
 * view - closer than it was, unless the mood says otherwise. This is what makes
 * turning around genuinely unpredictable, and it is far cheaper than asking
 * pathfinding to circle around you.
 */
function maybeReposition(h, player, players, dist, now) {
  if (now < h.nextReposAt) return;

  const mood = h.mood;
  h.nextReposAt = now + (mood === "haunt" ? rnd(3000, 6500) : rnd(4500, 9500));

  let desired;
  if (mood === "distant") desired = rnd(22, 34);
  else if (mood === "haunt") desired = rnd(6, 14);
  else desired = Math.max(5, dist * rnd(0.5, 0.72));

  // Close in on foot rather than blinking when it is already near - footsteps
  // approaching are scarier than a silent relocation.
  if (dist < 16 && mood !== "haunt" && Math.random() < 0.6) return;
  if (desired > dist + 2 && mood !== "distant") return;

  const spot = findRearSpot(player, players, desired, mood === "haunt" ? 1.15 : 1.5);
  if (!spot) return;

  const ploc = T(() => player.location, undefined);
  const yaw = ploc ? yawTowards(spot.x, spot.z, ploc.x, ploc.z) : 0;
  T(() => h.follower.teleport(
    { x: spot.x, y: spot.y, z: spot.z },
    { dimension: spot.dim, rotation: { x: 0, y: yaw } }
  ));
}

/* ------------------------------------------------------------------ *
 * Loops
 * ------------------------------------------------------------------ */

system.runInterval(() => {
  const now = Date.now();
  const players = T(() => world.getAllPlayers(), []);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const id = T(() => p.id, undefined);
    if (!id) continue;

    let h = hunters.get(id);
    if (!h) { h = newHunter(id, now); hunters.set(id, h); }

    if (h.greetAt && now >= h.greetAt) {
      h.greetAt = 0;
      T(() => p.onScreenDisplay.setActionBar("Something is already here."));
    }

    try {
      updateHunter(h, p, players, now);
    } catch (e) {
      // One bad tick must never stop the hunt.
    }
  }
}, TICK_STEP);

/*
 * Janitor: prunes records for players who left, and removes any Follower that
 * is no longer tracked - a leftover from a crash, a chunk reload, or the pack
 * being toggled off and on. Without this they would accumulate, because the
 * entity is marked persistent and will never despawn on its own.
 */
system.runInterval(() => {
  const players = T(() => world.getAllPlayers(), []);

  const online = new Set();
  for (let i = 0; i < players.length; i++) {
    const id = T(() => players[i].id, undefined);
    if (id) online.add(id);
  }
  hunters.forEach((h, id) => {
    if (!online.has(id)) {
      if (alive(h.follower)) T(() => h.follower.triggerEvent("dlby:vanish"));
      hunters.delete(id);
    }
  });

  const tracked = new Set();
  hunters.forEach((h) => { if (h.followerId) tracked.add(h.followerId); });

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const near = T(() => p.dimension.getEntities({
      type: FOLLOWER_ID,
      location: T(() => p.location, { x: 0, y: 0, z: 0 }),
      maxDistance: 80
    }), []);
    for (let j = 0; j < near.length; j++) {
      const e = near[j];
      const eid = T(() => e.id, undefined);
      if (eid && !tracked.has(eid)) T(() => e.triggerEvent("dlby:vanish"));
    }
  }

  // Keep the target tag in step so the pathfinding goal always has something
  // legal to walk toward.
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const h = hunters.get(T(() => p.id, ""));
    const want = !!(h && h.followerId);
    const has = T(() => p.hasTag(HUNTED_TAG), false);
    if (want && !has) T(() => p.addTag(HUNTED_TAG));
    if (!want && has) T(() => p.removeTag(HUNTED_TAG));
  }
}, HOUSEKEEP_TICKS);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

T(() => world.afterEvents.playerSpawn.subscribe((ev) => {
  const now = Date.now();
  const id = T(() => ev.player.id, undefined);
  if (!id) return;

  let h = hunters.get(id);
  if (!h) { h = newHunter(id, now); hunters.set(id, h); }

  if (ev.initialSpawn) {
    // First contact: it is already out there within seconds of loading in.
    h.spawnAt = now + rnd(FIRST_CONTACT_MIN, FIRST_CONTACT_MAX);
  } else {
    // Respawned after dying - give them a moment before it starts again.
    dropFollower(h, ev.player, RESPAWN_AFTER_PLAYER_DEATH_MIN, RESPAWN_AFTER_PLAYER_DEATH_MAX, now, false);
  }
}));

T(() => world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  const id = T(() => dead.id, undefined);
  const type = T(() => dead.typeId, undefined);
  if (type !== FOLLOWER_ID || !id) return;

  hunters.forEach((h) => {
    if (h.followerId !== id) return;
    h.follower = undefined;
    h.followerId = undefined;
    h.state = "frozen";
    h.spawnAt = Date.now() + rnd(RESPAWN_AFTER_DEATH_MIN, RESPAWN_AFTER_DEATH_MAX);
  });
}));

/*
 * Follower's Eye: look back at it. For half a minute it cannot move even while
 * unwatched, which is the only real reprieve the addon offers.
 */
T(() => world.afterEvents.itemUse.subscribe((ev) => {
  const item = T(() => ev.itemStack.typeId, undefined);
  if (item !== EYE_ID) return;

  const player = ev.source;
  const id = T(() => player.id, undefined);
  if (!id) return;
  const h = hunters.get(id);
  if (!h) return;

  const now = Date.now();
  if (now < h.eyeCooldownUntil) {
    const left = Math.ceil((h.eyeCooldownUntil - now) / 1000);
    T(() => player.onScreenDisplay.setActionBar("The eye is dull. (" + left + "s)"));
    return;
  }

  h.eyeWardUntil = now + EYE_WARD_MS;
  h.eyeCooldownUntil = now + EYE_COOLDOWN_MS;
  T(() => player.onScreenDisplay.setActionBar("The eye watches back."));
  const loc = T(() => player.location, undefined);
  if (loc) playSfx(player, SFX.eye, loc);
}));
