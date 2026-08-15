/*
 * God Eye Guardian - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * The God Eye is deliberately idle. It follows its owner, watches, and costs
 * almost nothing per tick. Everything expensive - threat scanning, particle
 * storms, extra entities - only happens for the few seconds after something
 * attacks the owner, and it is capped so a phone never has more than a couple
 * of executions running at once.
 *
 * Every cosmetic call is wrapped so one unsupported particle or sound id on a
 * given device degrades that single effect instead of breaking the add-on.
 */

import { world, system } from "@minecraft/server";

const VERSION = "1.0.0";

const EYE = "god_eye:god_eye";
const SWARM = "god_eye:swarm_eye";
const PLAYER = "minecraft:player";

/* Dynamic property keys. */
const DP_OWNER = "ge:owner"; // on the eye    -> owner player id
const DP_EYE = "ge:eye"; // on the player -> eye entity id
const DP_HAS = "ge:has"; // on the player -> has ever bonded an eye
const DP_MODE = "ge:mode"; // on the player -> "normal" | "aggressive"

const FOG_ID = "ge_erase";

/* ------------------------------------------------------------------ *
 * Tuning - everything worth changing lives here
 * ------------------------------------------------------------------ */

const CONFIG = {
  follow: {
    height: 6.0, // blocks above the owner
    heightSway: 1.1, // ... drifting between 4.9 and 7.1
    behind: 3.2, // blocks behind the owner's facing
    behindSway: 0.6,
    driftSide: 1.3, // slow sideways orbit
    lerp: 0.16, // how hard it chases the anchor each tick
    blinkDistance: 22, // further than this and it teleports instead
    anchorCheckEvery: 8, // ticks between "is my anchor inside a wall" checks
  },

  idle: {
    ambientEvery: 260, // ticks between ambient sound rolls
    ambientChance: 0.5,
    blinkEvery: 700, // ticks between spontaneous blink rolls
    blinkChance: 0.35,
  },

  shy: {
    checkEvery: 5,
    dotThreshold: 0.988, // how dead-on the owner has to be looking
    chance: 0.5, // ... and even then it only sometimes reacts
    holdTicks: 70,
    cooldownTicks: 260,
  },

  response: {
    windupTicks: 3, // eye locks on this fast after the owner is hurt
    perTargetCooldown: 60, // don't re-execute the same attacker instantly
    recoverTicks: 40, // ticks spent still glaring after a kill
  },

  aggressive: {
    scanEvery: 20,
    radius: 14,
    cooldown: 70,
  },

  limits: {
    maxConcurrent: 2, // executions running at once, world-wide
    eyeHealth: 500,
    sweepEvery: 600, // duplicate / stray cleanup
  },

  beam: {
    samples: 10,
    pulses: 6,
    pulseEvery: 2,
  },

  smite: {
    strikes: 4,
    strikeEvery: 8,
    pushAway: 5.5, // shove the target this far from the owner first
    ownerFireResistTicks: 160,
  },

  voidExec: {
    steps: 6,
    stepEvery: 6,
  },

  crush: {
    liftSpeed: 2.3,
    hangTicks: 18,
    slamSpeed: 3.4,
    impactTicks: 9,
  },

  swarm: {
    count: 5,
    radius: 2.2,
    orbitEvery: 4,
    steps: 15, // 15 * 4 = 60 ticks
    strikeEvery: 3, // every 3rd orbit step
  },

  erase: {
    steps: 5,
    stepEvery: 5,
    fogRadius: 20,
    shakeIntensity: 0.28,
    shakeSeconds: 1.6,
  },
};

/* Deep, slow, wrong-sounding. All vanilla ids, pitched down. */
const AMBIENT = [
  { id: "mob.warden.heartbeat", pitch: 0.45, volume: 0.55 },
  { id: "ambient.cave", pitch: 0.4, volume: 0.4 },
  { id: "mob.endermen.portal", pitch: 0.35, volume: 0.35 },
  { id: "mob.wither.ambient", pitch: 0.3, volume: 0.25 },
  { id: "mob.enderdragon.growl", pitch: 0.35, volume: 0.2 },
  { id: "beacon.ambient", pitch: 0.4, volume: 0.35 },
];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Run a cosmetic call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * `Entity.isValid` is a method on @minecraft/server 1.x and a property on
 * later modules. Accept either so the pack survives a module bump.
 */
function alive(entity) {
  if (!entity) return false;
  try {
    return typeof entity.isValid === "function" ? entity.isValid() : !!entity.isValid;
  } catch {
    return false;
  }
}

function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function sound(dimension, id, location, options) {
  safe(() => dimension.playSound(id, location, options));
}

function lift(location, dy) {
  return { x: location.x, y: location.y + dy, z: location.z };
}

/** Roughly the middle of an entity - where beams and particles should land. */
function centre(entity) {
  const l = entity.location;
  return { x: l.x, y: l.y + 0.9, z: l.z };
}

/** The owner's eye level, which is what the God Eye actually stares at. */
function headOf(player) {
  const l = player.location;
  return { x: l.x, y: l.y + 1.62, z: l.z };
}

/** Where the God Eye's pupil sits. */
function muzzle(eye) {
  return lift(eye.location, 0.62);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Run `step(i)` every `every` ticks, `steps` times, then `done()`.
 * Returning false from `step` ends the sequence early.
 */
function sequence(every, steps, step, done) {
  let i = 0;
  let handle;
  const finish = () => {
    if (handle !== undefined) system.clearRun(handle);
    if (done) {
      try {
        done();
      } catch (err) {
        console.warn(`[God Eye] sequence cleanup failed: ${err}`);
      }
    }
  };
  handle = system.runInterval(() => {
    let keep = true;
    try {
      keep = step(i) !== false;
    } catch (err) {
      console.warn(`[God Eye] sequence step failed: ${err}`);
      keep = false;
    }
    i += 1;
    if (!keep || i >= steps) finish();
  }, every);
  return handle;
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const bonds = new Map(); // playerId -> eyeId
const gaze = new Map(); // eyeId    -> { entityId, until }
const blinking = new Map(); // eyeId -> tick the blink ends
const busy = new Set(); // eyeIds mid-execution
const shyUntil = new Map(); // eyeId -> tick
const shyReady = new Map(); // eyeId -> tick the next shy reaction is allowed
const anchorBump = new Map(); // playerId -> extra height to clear terrain
const lastHunt = new Map(); // playerId -> tick
const missingSince = new Map(); // playerId -> tick the eye stopped resolving
const threatCooldown = new Map(); // "owner|attacker" -> tick

let activeExecutions = 0;

/* ------------------------------------------------------------------ *
 * Bonding
 * ------------------------------------------------------------------ */

function bond(player, eye) {
  safe(() => eye.setDynamicProperty(DP_OWNER, player.id));
  safe(() => eye.addTag("ge_bound"));
  safe(() => player.setDynamicProperty(DP_EYE, eye.id));
  safe(() => player.setDynamicProperty(DP_HAS, true));
  bonds.set(player.id, eye.id);
  missingSince.delete(player.id);
}

function unbond(player) {
  bonds.delete(player.id);
  safe(() => player.setDynamicProperty(DP_EYE, undefined));
  safe(() => player.setDynamicProperty(DP_HAS, false));
  missingSince.delete(player.id);
}

/** The player's eye, if it exists and is currently loaded. */
function eyeOf(player) {
  let id = bonds.get(player.id);
  if (id === undefined) {
    id = safe(() => player.getDynamicProperty(DP_EYE));
    if (typeof id === "string") bonds.set(player.id, id);
  }
  if (typeof id !== "string") return undefined;

  const entity = safe(() => world.getEntity(id));
  if (alive(entity)) return entity;

  bonds.delete(player.id);
  return undefined;
}

function anchorFor(player, tick, focus) {
  const loc = player.location;

  // Locked on to something: hang above it instead, so the execution reads as
  // the eye personally coming for the target.
  if (focus) {
    return {
      x: focus.x + (loc.x - focus.x) * 0.25,
      y: focus.y + 4.5,
      z: focus.z + (loc.z - focus.z) * 0.25,
    };
  }

  const view = safe(() => player.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
  let hx = view.x;
  let hz = view.z;
  const len = Math.hypot(hx, hz);
  if (len < 1e-4) {
    hx = 0;
    hz = 1;
  } else {
    hx /= len;
    hz /= len;
  }

  const cfg = CONFIG.follow;
  const back = cfg.behind + Math.sin(tick * 0.017) * cfg.behindSway;
  const height =
    cfg.height + Math.sin(tick * 0.013) * cfg.heightSway + (anchorBump.get(player.id) ?? 0);
  const side = Math.sin(tick * 0.011) * cfg.driftSide;

  return {
    x: loc.x - hx * back - hz * side,
    y: loc.y + height,
    z: loc.z - hz * back + hx * side,
  };
}

/** Nudge the anchor upward if it would park the eye inside terrain. */
function updateAnchorBump(player, anchor) {
  const dimension = player.dimension;
  for (let up = 0; up <= 4; up += 1) {
    const probe = lift(anchor, up - (anchorBump.get(player.id) ?? 0));
    const block = safe(() => dimension.getBlock(probe));
    if (block === undefined) return; // chunk not loaded - leave it alone
    if (block.isAir || block.isLiquid) {
      anchorBump.set(player.id, up);
      return;
    }
  }
  anchorBump.set(player.id, 0);
}

/** What the eye should currently be staring at. */
function gazeTarget(eye, player) {
  const g = gaze.get(eye.id);
  if (!g) return undefined;
  if (g.until <= system.currentTick) {
    gaze.delete(eye.id);
    return undefined;
  }
  const target = safe(() => world.getEntity(g.entityId));
  if (!alive(target)) {
    gaze.delete(eye.id);
    return undefined;
  }
  return target;
}

function gazeAt(eye, target, ticks) {
  gaze.set(eye.id, { entityId: target.id, until: system.currentTick + ticks });
}

/* ------------------------------------------------------------------ *
 * Motion
 * ------------------------------------------------------------------ */

function blink(eye, player, destination) {
  const from = eye.location;
  blinking.set(eye.id, system.currentTick + 10);

  particle(eye.dimension, "god_eye:blink", lift(from, 0.6));
  sound(eye.dimension, "mob.shulker.teleport", from, { pitch: 0.5, volume: 0.7 });
  safe(() => eye.addEffect("invisibility", 10, { showParticles: false }));

  system.runTimeout(() => {
    if (!alive(eye) || !alive(player)) return;
    safe(() =>
      eye.teleport(destination, {
        dimension: player.dimension,
        checkForBlocks: false,
      }),
    );
    particle(player.dimension, "god_eye:blink", lift(destination, 0.6));
    sound(player.dimension, "mob.endermen.portal", destination, {
      pitch: 0.6,
      volume: 0.6,
    });
  }, 5);
}

function moveEye(player, eye, tick) {
  const until = blinking.get(eye.id);
  if (until !== undefined) {
    if (until > tick) return;
    blinking.delete(eye.id);
  }

  const target = gazeTarget(eye, player);
  const focus = target ? centre(target) : undefined;
  const anchor = anchorFor(player, tick, focus);

  if (tick % CONFIG.follow.anchorCheckEvery === 0 && !focus) {
    updateAnchorBump(player, anchor);
  }

  const here = eye.location;
  const sameDimension = eye.dimension.id === player.dimension.id;
  const gap = sameDimension ? distance(here, anchor) : Infinity;

  if (gap > CONFIG.follow.blinkDistance) {
    blink(eye, player, anchor);
    return;
  }

  const k = CONFIG.follow.lerp;
  const next = {
    x: here.x + (anchor.x - here.x) * k,
    y: here.y + (anchor.y - here.y) * k,
    z: here.z + (anchor.z - here.z) * k,
  };

  const face = focus ?? headOf(player);
  const options = { dimension: player.dimension, checkForBlocks: false };
  if (distance(next, face) > 0.4) options.facingLocation = face;

  safe(() => eye.teleport(next, options));
}

/* ------------------------------------------------------------------ *
 * Presence - states, ambience, the "you looked at me" reaction
 * ------------------------------------------------------------------ */

const STATE_EVENTS = [
  "god_eye:set_idle",
  "god_eye:set_shy",
  "god_eye:set_alert",
  "god_eye:set_execute",
];

/**
 * Client animations key off query.mark_variant. Set the component directly
 * where the module allows it, and fall back to the data-driven events so the
 * look still works if that setter is unavailable.
 */
function setState(eye, value) {
  const applied = safe(() => {
    const component = eye.getComponent("minecraft:mark_variant");
    if (!component) return false;
    if (component.value === value) return true;
    component.value = value;
    return true;
  });
  if (applied) return;
  safe(() => eye.triggerEvent(STATE_EVENTS[value] ?? STATE_EVENTS[0]));
}

function ambient(eye) {
  const choice = pick(AMBIENT);
  sound(eye.dimension, choice.id, eye.location, {
    pitch: choice.pitch,
    volume: choice.volume,
  });
}

/** True when the owner is looking more or less straight at the eye. */
function ownerIsStaring(player, eye) {
  const view = safe(() => player.getViewDirection());
  if (!view) return false;
  const head = headOf(player);
  const target = lift(eye.location, 0.6);
  const dx = target.x - head.x;
  const dy = target.y - head.y;
  const dz = target.z - head.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.6) return false;
  return (dx * view.x + dy * view.y + dz * view.z) / d > CONFIG.shy.dotThreshold;
}

function updateShy(player, eye, tick) {
  if (busy.has(eye.id)) return;

  const holding = shyUntil.get(eye.id);
  if (holding !== undefined) {
    if (holding > tick) return;
    shyUntil.delete(eye.id);
    setState(eye, 0);
    return;
  }

  if ((shyReady.get(eye.id) ?? 0) > tick) return;
  if (!ownerIsStaring(player, eye)) return;
  if (Math.random() > CONFIG.shy.chance) {
    shyReady.set(eye.id, tick + CONFIG.shy.cooldownTicks);
    return;
  }

  setState(eye, 1);
  shyUntil.set(eye.id, tick + CONFIG.shy.holdTicks);
  shyReady.set(eye.id, tick + CONFIG.shy.holdTicks + CONFIG.shy.cooldownTicks);
  sound(eye.dimension, "mob.endermen.stare", eye.location, { pitch: 0.4, volume: 0.35 });
}

/* ------------------------------------------------------------------ *
 * Executions
 * ------------------------------------------------------------------ */

function annihilate(entity) {
  if (!alive(entity)) return;
  safe(() => entity.kill());
  if (alive(entity)) safe(() => entity.remove());
}

function vanish(entity) {
  if (!alive(entity)) return;
  safe(() => entity.remove());
}

/** Shove a target away from the owner so collateral effects miss the owner. */
function shove(target, from, blocks) {
  const l = target.location;
  let dx = l.x - from.x;
  let dz = l.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) {
    dx = 1;
    dz = 0;
  } else {
    dx /= len;
    dz /= len;
  }
  const destination = { x: l.x + dx * blocks, y: l.y + 0.5, z: l.z + dz * blocks };
  safe(() => target.teleport(destination, { checkForBlocks: true }));
}

function push(target, x, y, z) {
  const impulsed = safe(() => {
    target.applyImpulse({ x, y, z });
    return true;
  });
  if (impulsed) return;

  // Players reject applyImpulse, and applyKnockback has shipped with two
  // different signatures across module versions. Try both.
  const horizontal = Math.hypot(x, z);
  const knocked = safe(() => {
    target.applyKnockback(x, z, horizontal, y);
    return true;
  });
  if (knocked) return;
  safe(() => target.applyKnockback({ x, z }, y));
}

function drawBeam(dimension, from, to, samples) {
  const dx = (to.x - from.x) / samples;
  const dy = (to.y - from.y) / samples;
  const dz = (to.z - from.z) / samples;
  for (let i = 1; i <= samples; i += 1) {
    particle(dimension, "god_eye:beam", {
      x: from.x + dx * i,
      y: from.y + dy * i,
      z: from.z + dz * i,
    });
  }
}

function announce(owner, text) {
  safe(() => owner.onScreenDisplay.setActionBar(text));
}

/* --- 1. Judgement Beam ------------------------------------------- */

function judgementBeam(eye, owner, target, done) {
  announce(owner, "§5Judgement Beam");
  sound(eye.dimension, "mob.guardian.curse", eye.location, { pitch: 0.5, volume: 1.0 });

  sequence(
    CONFIG.beam.pulseEvery,
    CONFIG.beam.pulses,
    () => {
      if (!alive(eye) || !alive(target)) return false;
      drawBeam(eye.dimension, muzzle(eye), centre(target), CONFIG.beam.samples);
      particle(eye.dimension, "god_eye:wisp", muzzle(eye));
      return true;
    },
    () => {
      if (alive(target)) {
        const impact = centre(target);
        const dimension = target.dimension;
        particle(dimension, "god_eye:crush", impact);
        particle(dimension, "minecraft:huge_explosion_emitter", impact);
        sound(dimension, "random.explode", impact, { pitch: 0.6, volume: 1.0 });
        sound(dimension, "mob.warden.sonic_boom", impact, { pitch: 0.7, volume: 0.9 });
        annihilate(target);
      }
      done();
    },
  );
}

/* --- 2. Sky Smite ------------------------------------------------- */

function skySmite(eye, owner, target, done) {
  announce(owner, "§5Sky Smite");
  // Lightning starts fires and hurts bystanders, so the target is moved off
  // the owner first and the owner is given fire resistance for the duration.
  shove(target, owner.location, CONFIG.smite.pushAway);
  safe(() =>
    owner.addEffect("fire_resistance", CONFIG.smite.ownerFireResistTicks, {
      amplifier: 0,
      showParticles: false,
    }),
  );

  sequence(
    CONFIG.smite.strikeEvery,
    CONFIG.smite.strikes,
    () => {
      if (!alive(target)) return false;
      const at = target.location;
      safe(() => target.dimension.spawnEntity("minecraft:lightning_bolt", at));
      particle(target.dimension, "god_eye:smite", at);
      sound(target.dimension, "ambient.weather.thunder", at, {
        pitch: 0.85,
        volume: 0.7,
      });
      return true;
    },
    () => {
      if (alive(target)) {
        const impact = centre(target);
        particle(target.dimension, "god_eye:crush", impact);
        sound(target.dimension, "item.trident.thunder", impact, {
          pitch: 0.6,
          volume: 1.0,
        });
        annihilate(target);
      }
      done();
    },
  );
}

/* --- 3. Void Execution -------------------------------------------- */

function voidExecution(eye, owner, target, done) {
  announce(owner, "§5Void Execution");
  safe(() =>
    target.addEffect("levitation", CONFIG.voidExec.steps * CONFIG.voidExec.stepEvery + 10, {
      amplifier: 4,
      showParticles: false,
    }),
  );
  sound(eye.dimension, "mob.shulker.teleport", eye.location, { pitch: 0.4, volume: 0.9 });

  sequence(
    CONFIG.voidExec.stepEvery,
    CONFIG.voidExec.steps,
    () => {
      if (!alive(target)) return false;
      const at = centre(target);
      particle(target.dimension, "god_eye:void", at);
      if (Math.random() < 0.5) {
        sound(target.dimension, "mob.endermen.portal", at, { pitch: 0.4, volume: 0.4 });
      }
      return true;
    },
    () => {
      if (alive(target)) {
        const at = centre(target);
        const dimension = target.dimension;
        particle(dimension, "god_eye:erase", at);
        particle(dimension, "god_eye:void", at);
        sound(dimension, "mob.endermen.portal", at, { pitch: 0.3, volume: 1.0 });
        vanish(target);
      }
      done();
    },
  );
}

/* --- 4. Crush ------------------------------------------------------ */

function crush(eye, owner, target, done) {
  announce(owner, "§5Crush");
  sound(eye.dimension, "mob.ravager.roar", eye.location, { pitch: 0.4, volume: 0.9 });
  push(target, 0, CONFIG.crush.liftSpeed, 0);
  particle(target.dimension, "god_eye:void", centre(target));

  system.runTimeout(() => {
    if (!alive(target)) {
      done();
      return;
    }
    push(target, 0, -CONFIG.crush.slamSpeed, 0);
    particle(target.dimension, "god_eye:swarm", centre(target));
    sound(target.dimension, "mob.wither.shoot", centre(target), {
      pitch: 0.5,
      volume: 0.8,
    });

    system.runTimeout(() => {
      if (alive(target)) {
        const at = target.location;
        const dimension = target.dimension;
        particle(dimension, "god_eye:crush", at);
        particle(dimension, "minecraft:knockback_roar_particle", at);
        sound(dimension, "random.explode", at, { pitch: 0.5, volume: 1.0 });
        annihilate(target);
      }
      done();
    }, CONFIG.crush.impactTicks);
  }, CONFIG.crush.hangTicks);
}

/* --- 5. Eye Swarm --------------------------------------------------- */

function eyeSwarm(eye, owner, target, done) {
  announce(owner, "§5Eye Swarm");
  sound(eye.dimension, "mob.endermen.scream", eye.location, { pitch: 0.5, volume: 0.8 });

  const dimension = target.dimension;
  const spawned = [];
  const cfg = CONFIG.swarm;

  for (let i = 0; i < cfg.count; i += 1) {
    const angle = (Math.PI * 2 * i) / cfg.count;
    const at = {
      x: target.location.x + Math.cos(angle) * cfg.radius,
      y: target.location.y + 1.4,
      z: target.location.z + Math.sin(angle) * cfg.radius,
    };
    const minion = safe(() => dimension.spawnEntity(SWARM, at));
    if (minion) {
      spawned.push(minion);
      particle(dimension, "god_eye:blink", at);
    }
  }

  const cleanup = () => {
    for (const minion of spawned) {
      if (!alive(minion)) continue;
      particle(dimension, "god_eye:blink", lift(minion.location, 0.2));
      vanish(minion);
    }
  };

  sequence(
    cfg.orbitEvery,
    cfg.steps,
    (step) => {
      if (!alive(target)) return false;
      const base = target.location;
      const spin = step * 0.55;
      const strike = step > 0 && step % cfg.strikeEvery === 0;

      for (let i = 0; i < spawned.length; i += 1) {
        const minion = spawned[i];
        if (!alive(minion)) continue;
        const angle = spin + (Math.PI * 2 * i) / spawned.length;
        // Tighten the ring as the swarm closes in.
        const radius = cfg.radius * (1 - step / (cfg.steps * 1.4));
        const at = {
          x: base.x + Math.cos(angle) * radius,
          y: base.y + 1.4 + Math.sin(spin * 2 + i) * 0.35,
          z: base.z + Math.sin(angle) * radius,
        };
        safe(() =>
          minion.teleport(at, {
            checkForBlocks: false,
            facingLocation: centre(target),
          }),
        );
        if (strike) drawBeam(dimension, lift(at, 0.1), centre(target), 3);
      }

      if (strike) {
        particle(dimension, "god_eye:swarm", centre(target));
        sound(dimension, "mob.guardian.curse", base, { pitch: 1.4, volume: 0.5 });
      }
      return true;
    },
    () => {
      if (alive(target)) {
        const at = centre(target);
        particle(dimension, "god_eye:swarm", at);
        particle(dimension, "god_eye:crush", at);
        sound(dimension, "mob.guardian.death", at, { pitch: 0.7, volume: 0.9 });
        annihilate(target);
      }
      cleanup();
      done();
    },
  );
}

/* --- 6. Erase -------------------------------------------------------- */

function nearbyPlayers(dimension, location, radius) {
  return safe(() => dimension.getPlayers({ location, maxDistance: radius })) ?? [];
}

function erase(eye, owner, target, done) {
  announce(owner, "§5Erase");
  const dimension = target.dimension;
  const witnesses = nearbyPlayers(dimension, target.location, CONFIG.erase.fogRadius);

  for (const witness of witnesses) {
    safe(() => witness.runCommand(`fog @s push god_eye:void_fog ${FOG_ID}`));
    safe(() =>
      witness.runCommand(
        `camerashake add @s ${CONFIG.erase.shakeIntensity} ${CONFIG.erase.shakeSeconds} positional`,
      ),
    );
  }

  sound(dimension, "mob.endermen.scream", centre(target), { pitch: 0.3, volume: 0.9 });
  sound(dimension, "ambient.cave", centre(target), { pitch: 0.2, volume: 0.8 });
  gazeAt(eye, target, 120);

  sequence(
    CONFIG.erase.stepEvery,
    CONFIG.erase.steps,
    () => {
      if (!alive(target)) return false;
      const at = centre(target);
      particle(dimension, "god_eye:erase", at);
      safe(() => target.addEffect("slowness", 20, { amplifier: 5, showParticles: false }));
      return true;
    },
    () => {
      if (alive(target)) {
        const at = centre(target);
        particle(dimension, "god_eye:erase", at);
        particle(dimension, "minecraft:portal_reverse_particle", at);
        sound(dimension, "mob.endermen.portal", at, { pitch: 0.25, volume: 1.0 });
        vanish(target);
      }
      for (const witness of witnesses) {
        if (!alive(witness)) continue;
        safe(() => witness.runCommand(`fog @s remove ${FOG_ID}`));
      }
      done();
    },
  );
}

const EXECUTIONS = [judgementBeam, skySmite, voidExecution, crush, eyeSwarm, erase];

/* ------------------------------------------------------------------ *
 * Threat handling
 * ------------------------------------------------------------------ */

function modeOf(player) {
  const mode = safe(() => player.getDynamicProperty(DP_MODE));
  return mode === "aggressive" ? "aggressive" : "normal";
}

function beginExecution(eye, owner, target) {
  if (activeExecutions >= CONFIG.limits.maxConcurrent) return;
  if (busy.has(eye.id)) return;

  busy.add(eye.id);
  activeExecutions += 1;
  shyUntil.delete(eye.id);

  setState(eye, 2);
  gazeAt(eye, target, 300);
  sound(eye.dimension, "mob.wither.shoot", eye.location, {
    pitch: 0.4,
    volume: 0.8,
  });

  const release = () => {
    activeExecutions = Math.max(0, activeExecutions - 1);
    system.runTimeout(() => {
      busy.delete(eye.id);
      gaze.delete(eye.id);
      if (alive(eye)) setState(eye, 0);
    }, CONFIG.response.recoverTicks);
  };

  const chosen = pick(EXECUTIONS);
  system.runTimeout(() => {
    if (!alive(eye) || !alive(target)) {
      release();
      return;
    }
    setState(eye, 3);
    try {
      chosen(eye, owner, target, release);
    } catch (err) {
      console.warn(`[God Eye] execution failed: ${err}`);
      release();
    }
  }, CONFIG.response.windupTicks);
}

function onThreat(owner, attacker) {
  if (!alive(owner) || !alive(attacker)) return;
  if (attacker.id === owner.id) return;

  const type = attacker.typeId;
  if (type === EYE || type === SWARM) return;

  const mode = modeOf(owner);
  // Players are only answered once the owner has asked for aggressive mode -
  // otherwise a single PvP hit would wipe someone out.
  if (type === PLAYER && mode !== "aggressive") return;

  const eye = eyeOf(owner);
  if (!eye) return;

  const key = `${owner.id}|${attacker.id}`;
  const now = system.currentTick;
  if ((threatCooldown.get(key) ?? -99999) + CONFIG.response.perTargetCooldown > now) return;
  threatCooldown.set(key, now);

  beginExecution(eye, owner, attacker);
}

/** Something swung at the eye itself. That also counts. */
function onEyeAttacked(eye, attacker) {
  if (!alive(attacker) || attacker.typeId === PLAYER) return;
  restoreEye(eye);
  const ownerId = safe(() => eye.getDynamicProperty(DP_OWNER));
  if (typeof ownerId !== "string") return;
  const owner = safe(() => world.getEntity(ownerId));
  if (!alive(owner)) return;
  onThreat(owner, attacker);
}

function restoreEye(eye) {
  safe(() => {
    const health = eye.getComponent("minecraft:health");
    if (!health) return;
    const max = health.effectiveMax ?? health.defaultValue ?? CONFIG.limits.eyeHealth;
    health.setCurrentValue(max);
  });
}

function aggressiveScan(player, eye, tick) {
  if (busy.has(eye.id)) return;
  if ((lastHunt.get(player.id) ?? -99999) + CONFIG.aggressive.cooldown > tick) return;

  const found =
    safe(() =>
      player.dimension.getEntities({
        location: player.location,
        maxDistance: CONFIG.aggressive.radius,
        families: ["monster"],
        closest: 3,
      }),
    ) ?? [];

  const target = found.find(
    (candidate) =>
      alive(candidate) && candidate.typeId !== EYE && candidate.typeId !== SWARM,
  );
  if (!target) return;

  lastHunt.set(player.id, tick);
  beginExecution(eye, player, target);
}

/* ------------------------------------------------------------------ *
 * Commands (driven by tags the .mcfunction files add)
 * ------------------------------------------------------------------ */

function summonFor(player) {
  const anchor = anchorFor(player, system.currentTick);
  const eye = safe(() => player.dimension.spawnEntity(EYE, anchor));
  if (!eye) return undefined;
  bond(player, eye);
  particle(player.dimension, "god_eye:blink", lift(anchor, 0.6));
  sound(player.dimension, "mob.enderdragon.growl", anchor, { pitch: 0.4, volume: 0.7 });
  return eye;
}

function cmdSpawn(player) {
  const existing = eyeOf(player);
  if (existing) {
    player.sendMessage("§8Your God Eye is already watching.");
    return;
  }
  if (summonFor(player)) {
    player.sendMessage("§5The God Eye opens. §8You are under its protection.");
  } else {
    player.sendMessage("§cThe God Eye could not manifest here.");
  }
}

function cmdRemove(player) {
  const eye = eyeOf(player);
  if (!eye) {
    unbond(player);
    player.sendMessage("§8You have no God Eye.");
    return;
  }
  const at = eye.location;
  particle(eye.dimension, "god_eye:blink", lift(at, 0.6));
  sound(eye.dimension, "mob.endermen.portal", at, { pitch: 0.4, volume: 0.7 });
  busy.delete(eye.id);
  gaze.delete(eye.id);
  blinking.delete(eye.id);
  vanish(eye);
  unbond(player);
  player.sendMessage("§8The God Eye closes.");
}

function cmdMode(player, mode) {
  safe(() => player.setDynamicProperty(DP_MODE, mode));
  if (mode === "aggressive") {
    player.sendMessage(
      "§5God Eye: §caggressive§r §8- it hunts hostiles near you and answers players who strike you.",
    );
  } else {
    player.sendMessage(
      "§5God Eye: §anormal§r §8- it does nothing until something attacks you.",
    );
  }
}

function cmdHelp(player) {
  const eye = eyeOf(player);
  player.sendMessage("§5=== God Eye Guardian ===");
  player.sendMessage("§7/function god_eye_spawn §8- call your eye");
  player.sendMessage("§7/function god_eye_remove §8- dismiss it");
  player.sendMessage("§7/function god_eye_mode_normal §8- retaliate only");
  player.sendMessage("§7/function god_eye_mode_aggressive §8- hunt nearby hostiles");
  player.sendMessage(
    `§8bond: ${eye ? "§aactive" : "§cnone"}§8   mode: §f${modeOf(player)}`,
  );
}

const COMMAND_TAGS = [
  ["ge_cmd_spawn", cmdSpawn],
  ["ge_cmd_remove", cmdRemove],
  ["ge_cmd_normal", (player) => cmdMode(player, "normal")],
  ["ge_cmd_aggressive", (player) => cmdMode(player, "aggressive")],
  ["ge_cmd_help", cmdHelp],
];

function pollCommands(player) {
  for (const [tag, handler] of COMMAND_TAGS) {
    if (!safe(() => player.hasTag(tag))) continue;
    safe(() => player.removeTag(tag));
    try {
      handler(player);
    } catch (err) {
      console.warn(`[God Eye] command ${tag} failed: ${err}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */

/** Remove strays and duplicates so a player never ends up with two eyes. */
function sweep(player) {
  const keep = bonds.get(player.id);
  const near =
    safe(() =>
      player.dimension.getEntities({
        type: EYE,
        location: player.location,
        maxDistance: 40,
      }),
    ) ?? [];

  for (const other of near) {
    if (other.id === keep) continue;
    const ownerId = safe(() => other.getDynamicProperty(DP_OWNER));
    if (typeof ownerId !== "string") {
      vanish(other); // never bonded to anyone - a bare /summon
    } else if (ownerId === player.id) {
      vanish(other); // a second eye of mine, from a reload race
    }
  }
}

/** The bonded eye stopped resolving for a while - call a fresh one. */
function recoverMissingEye(player, tick) {
  const everHad = safe(() => player.getDynamicProperty(DP_HAS));
  if (!everHad) return;

  const since = missingSince.get(player.id);
  if (since === undefined) {
    missingSince.set(player.id, tick);
    return;
  }
  if (tick - since < 60) return;
  missingSince.delete(player.id);
  summonFor(player);
}

function prune(map, tick, maxAge) {
  if (map.size < 64) return;
  for (const [key, stamp] of map) {
    if (tick - stamp > maxAge) map.delete(key);
  }
}

/* ------------------------------------------------------------------ *
 * Main loop
 * ------------------------------------------------------------------ */

let players = [];

system.runInterval(() => {
  const tick = system.currentTick;

  if (tick % 10 === 0) {
    players = safe(() => world.getAllPlayers()) ?? [];
  }

  for (const player of players) {
    if (!alive(player)) continue;

    try {
      if (tick % 4 === 0) pollCommands(player);

      const eye = eyeOf(player);
      if (!eye) {
        if (tick % 20 === 0) recoverMissingEye(player, tick);
        continue;
      }
      missingSince.delete(player.id);

      moveEye(player, eye, tick);

      if (tick % CONFIG.shy.checkEvery === 0) updateShy(player, eye, tick);

      if (tick % CONFIG.idle.ambientEvery === 0 && Math.random() < CONFIG.idle.ambientChance) {
        ambient(eye);
      }

      if (
        tick % CONFIG.idle.blinkEvery === 0 &&
        !busy.has(eye.id) &&
        !blinking.has(eye.id) &&
        Math.random() < CONFIG.idle.blinkChance
      ) {
        blink(eye, player, anchorFor(player, tick));
      }

      if (
        tick % CONFIG.aggressive.scanEvery === 0 &&
        modeOf(player) === "aggressive"
      ) {
        aggressiveScan(player, eye, tick);
      }

      if (tick % CONFIG.limits.sweepEvery === 0) sweep(player);
    } catch (err) {
      console.warn(`[God Eye] tick failed for a player: ${err}`);
    }
  }

  if (tick % 1200 === 0) {
    prune(threatCooldown, tick, 1200);
    prune(shyReady, tick, 2400);
    prune(lastHunt, tick, 2400);
  }
}, 1);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

world.afterEvents.entityHurt.subscribe((event) => {
  const hurt = event.hurtEntity;
  if (!hurt) return;

  if (hurt.typeId === EYE || hurt.typeId === SWARM) {
    restoreEye(hurt);
    return;
  }
  if (hurt.typeId !== PLAYER) return;

  const attacker = event.damageSource?.damagingEntity;
  if (!attacker) return;
  system.run(() => onThreat(hurt, attacker));
});

// Catches swings the owner shrugged off - a blocked hit or one absorbed by
// armour still counts as intentionally attacking them.
world.afterEvents.entityHitEntity.subscribe((event) => {
  const hit = event.hitEntity;
  const attacker = event.damagingEntity;
  if (!hit || !attacker) return;

  if (hit.typeId === EYE) {
    system.run(() => onEyeAttacked(hit, attacker));
    return;
  }
  if (hit.typeId !== PLAYER) return;
  if (attacker.typeId === PLAYER) return; // handled by entityHurt, mode-gated
  system.run(() => onThreat(hit, attacker));
});

// Spawn eggs: the eye bonds to whoever was standing there when it appeared.
world.afterEvents.entitySpawn.subscribe((event) => {
  const entity = event.entity;
  if (!entity || entity.typeId !== EYE) return;
  if (safe(() => entity.getDynamicProperty(DP_OWNER))) return; // already ours

  system.run(() => {
    if (!alive(entity)) return;
    const found =
      safe(() =>
        entity.dimension.getPlayers({
          location: entity.location,
          maxDistance: 16,
          closest: 1,
        }),
      ) ?? [];
    const owner = found[0];
    if (!owner) return;

    const previous = eyeOf(owner);
    if (previous && previous.id !== entity.id) vanish(previous);

    bond(owner, entity);
    sound(entity.dimension, "mob.enderdragon.growl", entity.location, {
      pitch: 0.4,
      volume: 0.8,
    });
    owner.sendMessage("§5The God Eye has chosen you. §8It is watching now.");
  });
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  safe(() => {
    player.sendMessage(
      `§5[God Eye Guardian]§r v${VERSION} §8- /function god_eye_help`,
    );
  });
  // Re-resolve the bond after a reload before the first follow tick runs.
  system.runTimeout(() => {
    if (alive(player)) eyeOf(player);
  }, 20);
});

console.warn(`[God Eye Guardian] v${VERSION} loaded.`);
