/*
 * Natural Disasters - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Beta 1.21.0.26, Android / touch friendly)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Every disaster is an item in the creative inventory. Hold it and tap a
 * block (itemUseOn) or tap while aiming (itemUse) and the disaster spawns at
 * the tapped spot. No /function commands, no chat commands.
 *
 * Defensive by design: any cosmetic call (particles, sounds, camera shake)
 * is wrapped so a single unsupported id on a given device can never take the
 * whole add-on down, and block edits go through async commands so a failed
 * fill in unloaded chunks is silently dropped instead of crashing the tick.
 */

import { world, system } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function safe(fn) {
  try {
    fn();
  } catch {
    /* cosmetic only - ignore */
  }
}

/** Fire-and-forget command; errors (unloaded chunks, missing targets) are dropped. */
function cmd(dim, command) {
  try {
    dim.runCommandAsync(command).catch(() => {});
  } catch {
    /* ignore */
  }
}

function ff(n) {
  return n.toFixed(2);
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function irand(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function particle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {
    cmd(dim, `particle ${id} ${ff(loc.x)} ${ff(loc.y)} ${ff(loc.z)}`);
  }
}

function sound(dim, id, loc, volume, pitch) {
  const v = volume ?? 1;
  const p = pitch ?? 1;
  try {
    dim.playSound(id, loc, { volume: v, pitch: p });
  } catch {
    cmd(dim, `playsound ${id} @a ${ff(loc.x)} ${ff(loc.y)} ${ff(loc.z)} ${ff(v)} ${ff(p)}`);
  }
}

function boom(dim, loc, radius, fire) {
  try {
    dim.createExplosion(loc, radius, { breaksBlocks: true, causesFire: !!fire });
    return;
  } catch {
    /* fall back to TNT, which needs no API support at all */
  }
  cmd(dim, `summon tnt ${ff(loc.x)} ${ff(loc.y + 0.5)} ${ff(loc.z)}`);
}

function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x, y, z }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Y of the first air block above solid ground near yHint, or null when the
 * chunk is not loaded. Water counts as ground so disasters ride the surface
 * of oceans instead of sinking.
 */
function surfaceY(dim, x, yHint, z) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  let y = Math.floor(yHint);
  if (y < -59) y = -59;
  if (y > 315) y = 315;
  let b = blockAt(dim, bx, y, bz);
  if (b === null) return null;
  if (b.typeId === "minecraft:air") {
    for (let i = 0; i < 30; i++) {
      const below = blockAt(dim, bx, y - 1, bz);
      if (below === null) return null;
      if (below.typeId !== "minecraft:air") return y;
      y--;
      if (y < -59) return -59;
    }
    return y;
  }
  for (let i = 0; i < 30; i++) {
    y++;
    if (y > 318) return null;
    b = blockAt(dim, bx, y, bz);
    if (b === null) return null;
    if (b.typeId === "minecraft:air") return y;
  }
  return null;
}

const UNBREAKABLE = new Set([
  "minecraft:air",
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:obsidian",
  "minecraft:crying_obsidian",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:portal",
  "minecraft:command_block",
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:lava",
  "minecraft:flowing_lava",
]);

function breakable(block) {
  return block !== null && !UNBREAKABLE.has(block.typeId);
}

/** Entities near a point, excluding our own marker entities. */
function targetsNear(dim, loc, radius) {
  try {
    return dim.getEntities({ location: loc, maxDistance: radius }).filter((e) => {
      try {
        return !e.typeId.startsWith("nd:");
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Knockback with an impulse fallback for entities that reject knockback. */
function shove(entity, dx, dz, horizontal, vertical) {
  try {
    entity.applyKnockback(dx, dz, horizontal, vertical);
    return;
  } catch {
    /* fall through */
  }
  try {
    if (entity.typeId !== "minecraft:player") {
      entity.applyImpulse({ x: dx * horizontal, y: vertical, z: dz * horizontal });
    }
  } catch {
    /* ignore */
  }
}

function hurt(entity, amount) {
  try {
    entity.applyDamage(amount);
  } catch {
    /* ignore */
  }
}

function ignite(entity, seconds) {
  try {
    entity.setOnFire(seconds, true);
  } catch {
    /* ignore */
  }
}

function effect(entity, name, ticks, amplifier) {
  try {
    entity.addEffect(name, ticks, { amplifier: amplifier ?? 0, showParticles: false });
  } catch {
    /* ignore */
  }
}

function actionbar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

/* Shared weather handle so overlapping storms do not clear each other early. */
let weatherRefs = 0;

function weatherOn(dim, kind) {
  weatherRefs++;
  cmd(dim, `weather ${kind}`);
}

function weatherOff(dim) {
  weatherRefs = Math.max(0, weatherRefs - 1);
  if (weatherRefs === 0) cmd(dim, "weather clear");
}

/* ------------------------------------------------------------------ *
 * Disaster: Tornado
 * ------------------------------------------------------------------ */

function startTornado(player, dim, pos) {
  let x = pos.x;
  let z = pos.z;
  let gy = surfaceY(dim, x, pos.y, z) ?? Math.floor(pos.y);
  let heading = Math.random() * Math.PI * 2;
  const origin = { x: pos.x, z: pos.z };
  let funnel = null;
  try {
    funnel = dim.spawnEntity("nd:tornado", { x, y: gy, z });
  } catch {
    funnel = null;
  }

  return {
    duration: 1200,
    tick(t) {
      // Wander, steering back when too far from the spawn point.
      heading += (Math.random() - 0.5) * 0.35;
      const ox = x - origin.x;
      const oz = z - origin.z;
      if (ox * ox + oz * oz > 1600) heading = Math.atan2(-oz, -ox);
      x += Math.cos(heading) * 0.12;
      z += Math.sin(heading) * 0.12;
      if (t % 4 === 0) {
        const g = surfaceY(dim, x, gy + 2, z);
        if (g === null) heading += Math.PI;
        else gy = g;
      }
      if (funnel !== null) {
        try {
          if (funnel.isValid()) funnel.teleport({ x, y: gy, z });
          else funnel = null;
        } catch {
          funnel = null;
        }
      }

      // Suction: pull far entities in, spin and launch the close ones.
      if (t % 2 === 0) {
        for (const e of targetsNear(dim, { x, y: gy + 4, z }, 20)) {
          let loc;
          try {
            loc = e.location;
          } catch {
            continue;
          }
          const dx = x - loc.x;
          const dz = z - loc.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.01 || d > 20) continue;
          const nx = dx / d;
          const nz = dz / d;
          const tx = -nz;
          const tz = nx;
          if (d < 4.5) {
            shove(e, tx * 0.85 + nx * 0.15, tz * 0.85 + nz * 0.15, 0.9, 0.75);
          } else {
            shove(e, nx * 0.8 + tx * 0.45, nz * 0.8 + tz * 0.45, Math.min(0.7, 6 / d), 0.12);
          }
        }
      }
      if (t % 10 === 0) {
        for (const e of targetsNear(dim, { x, y: gy + 3, z }, 5)) hurt(e, 2);
      }

      // Rip up the ground under the funnel; drops become flying debris.
      if (t % 6 === 0) {
        for (let i = 0; i < 2; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * 3.5;
          const bx = Math.floor(x + Math.cos(ang) * r);
          const bz = Math.floor(z + Math.sin(ang) * r);
          const by = gy + irand(-1, 3);
          if (breakable(blockAt(dim, bx, by, bz))) {
            cmd(dim, `setblock ${bx} ${by} ${bz} air [] destroy`);
          }
        }
      }

      // Swirling dust climbing the funnel + wind streaks + wind roar.
      if (t % 2 === 0) {
        for (let k = 0; k < 3; k++) {
          const ang = t * 0.33 + k * 2.1;
          const h = ((t * 2 + k * 37) % 26) / 26;
          const r = 1.2 + h * 4.5;
          particle(dim, "nd:dust_puff", {
            x: x + Math.cos(ang) * r,
            y: gy + h * 12,
            z: z + Math.sin(ang) * r,
          });
        }
      }
      if (t % 9 === 0) {
        particle(dim, "nd:wind_streak", { x: x + rand(-6, 6), y: gy + rand(2, 9), z: z + rand(-6, 6) });
      }
      if (t % 55 === 0) sound(dim, "nd.wind", { x, y: gy + 1, z }, 4, rand(0.8, 1.0));
      if (t % 160 === 20) sound(dim, "nd.wind", { x, y: gy + 8, z }, 3, 1.25);
    },
    end() {
      if (funnel !== null) safe(() => funnel.triggerEvent("nd:despawn"));
      for (let i = 0; i < 6; i++) {
        particle(dim, "nd:dust_puff", { x: x + rand(-2, 2), y: gy + rand(0, 6), z: z + rand(-2, 2) });
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Tsunami
 * ------------------------------------------------------------------ */

function startTsunami(player, dim, pos) {
  let vx = 1;
  let vz = 0;
  try {
    const view = player.getViewDirection();
    const len = Math.hypot(view.x, view.z);
    if (len > 0.05) {
      vx = view.x / len;
      vz = view.z / len;
    }
  } catch {
    /* default east */
  }
  const px = -vz;
  const pz = vx;
  const STEPS = 32;
  const boxes = [];
  let step = 0;
  let gy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  let cleanupIndex = 0;

  return {
    duration: STEPS * 3 + 200 + STEPS * 2 + 20,
    tick(t) {
      if (t % 3 === 0 && step < STEPS) {
        step++;
        const dist = step * 2;
        const cx = pos.x + vx * dist;
        const cz = pos.z + vz * dist;
        const g = surfaceY(dim, cx, gy + 2, cz);
        if (g !== null) gy = Math.max(g, gy - 2);
        // Build the wall as overlapping 2x2 columns so it works at any angle.
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let s = -7; s <= 7; s++) {
          const wx = Math.floor(cx + px * s);
          const wz = Math.floor(cz + pz * s);
          cmd(dim, `fill ${wx} ${gy} ${wz} ${wx + 1} ${gy + 3} ${wz + 1} water`);
          minX = Math.min(minX, wx);
          maxX = Math.max(maxX, wx + 1);
          minZ = Math.min(minZ, wz);
          maxZ = Math.max(maxZ, wz + 1);
        }
        boxes.push({ x1: minX, y1: gy, z1: minZ, x2: maxX, y2: gy + 3, z2: maxZ });

        particle(dim, "nd:splash", { x: cx, y: gy + 4, z: cz });
        particle(dim, "nd:splash", { x: cx + px * 4, y: gy + 4, z: cz + pz * 4 });
        particle(dim, "nd:splash", { x: cx - px * 4, y: gy + 4, z: cz - pz * 4 });
        if (step % 3 === 1) sound(dim, "nd.wave", { x: cx, y: gy + 2, z: cz }, 4, rand(0.85, 1.1));

        for (const e of targetsNear(dim, { x: cx, y: gy + 2, z: cz }, 9)) {
          shove(e, vx, vz, 1.2, 0.55);
          hurt(e, 1);
        }
      }

      // Drain phase: remove the water sources; the flow decays on its own.
      const drainStart = STEPS * 3 + 200;
      if (t >= drainStart && t % 2 === 0 && cleanupIndex < boxes.length) {
        const b = boxes[cleanupIndex++];
        cmd(dim, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} air [] replace water`);
        cmd(dim, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} air [] replace flowing_water`);
      }
    },
    end() {},
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Earthquake
 * ------------------------------------------------------------------ */

function startEarthquake(player, dim, pos) {
  const cy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const center = { x: pos.x, y: cy, z: pos.z };
  const CARDINALS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  return {
    duration: 500,
    tick(t) {
      if (t % 20 === 0) {
        cmd(dim, `camerashake add @a[x=${ff(pos.x)},y=${cy},z=${ff(pos.z)},r=45] 0.6 1.2 positional`);
      }

      // Fissures: thin trenches torn into the ground, some with lava below.
      if (t % 18 === 4) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 22;
        const fx = Math.floor(pos.x + Math.cos(ang) * r);
        const fz = Math.floor(pos.z + Math.sin(ang) * r);
        const g = surfaceY(dim, fx, cy + 4, fz);
        if (g !== null) {
          const [ux, uz] = pick(CARDINALS);
          const len = irand(4, 8);
          const depth = irand(6, 10);
          const x2 = fx + ux * len;
          const z2 = fz + uz * len;
          cmd(
            dim,
            `fill ${Math.min(fx, x2)} ${g - depth} ${Math.min(fz, z2)} ` +
              `${Math.max(fx, x2)} ${g - 1} ${Math.max(fz, z2)} air`
          );
          if (Math.random() < 0.3) {
            const mx = fx + ux * Math.floor(len / 2);
            const mz = fz + uz * Math.floor(len / 2);
            cmd(dim, `setblock ${mx} ${g - depth} ${mz} lava`);
          }
          // Kick some rubble loose along the rim.
          cmd(dim, `setblock ${fx + uz} ${g - 1} ${fz + ux} air [] destroy`);
          for (let i = 0; i < 3; i++) {
            particle(dim, "nd:dust_puff", {
              x: fx + ux * rand(0, len),
              y: g + 0.5,
              z: fz + uz * rand(0, len),
            });
          }
          sound(dim, "nd.rumble", { x: fx, y: g, z: fz }, 3, rand(0.9, 1.2));
        }
      }

      // Shake everything standing in the area.
      if (t % 12 === 0) {
        for (const e of targetsNear(dim, center, 26)) {
          shove(e, rand(-1, 1), rand(-1, 1), 0.25, 0.3);
          if (t % 24 === 0) effect(e, "slowness", 40, 1);
        }
      }
      if (t % 40 === 8) {
        for (const e of targetsNear(dim, center, 26)) {
          if (Math.random() < 0.3) hurt(e, 1);
        }
      }

      if (t % 25 === 0) sound(dim, "nd.rumble", center, 5, rand(0.7, 1.0));
      if (t % 8 === 0) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 20;
        particle(dim, "nd:dust_puff", {
          x: pos.x + Math.cos(ang) * r,
          y: cy + rand(0, 2),
          z: pos.z + Math.sin(ang) * r,
        });
      }
    },
    end() {
      cmd(dim, "camerashake stop @a");
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Meteor Strike
 * ------------------------------------------------------------------ */

function startMeteor(player, dim, pos) {
  const ty = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const meteors = [];
  const mainAngle = Math.random() * Math.PI * 2;

  function addMeteor(tx, tz, targetY, delay, radius) {
    const sy = Math.min(targetY + 55, 314);
    meteors.push({
      sx: tx + Math.cos(mainAngle) * 45,
      sy,
      sz: tz + Math.sin(mainAngle) * 45,
      tx,
      ty: targetY,
      tz,
      delay,
      flight: 55,
      radius,
      exploded: false,
    });
  }

  addMeteor(pos.x, pos.z, ty, 0, 6);
  addMeteor(pos.x + rand(-12, 12), pos.z + rand(-12, 12), ty, 18, 3);
  addMeteor(pos.x + rand(-12, 12), pos.z + rand(-12, 12), ty, 32, 3);

  function explode(m) {
    m.exploded = true;
    const g = surfaceY(dim, m.tx, m.ty + 2, m.tz) ?? m.ty;
    const at = { x: m.tx, y: g, z: m.tz };
    boom(dim, at, m.radius, true);
    safe(() => dim.spawnParticle("minecraft:huge_explosion_emitter", at));
    for (let i = 0; i < 6; i++) {
      particle(dim, "nd:ember", { x: at.x + rand(-3, 3), y: at.y + rand(0, 3), z: at.z + rand(-3, 3) });
    }
    sound(dim, "random.explode", at, 5, rand(0.8, 1.0));
    sound(dim, "nd.rumble", at, 4, 1.1);

    // Scorched crater dressing: magma, fire and a little obsidian.
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * (m.radius + 2);
      const bx = Math.floor(at.x + Math.cos(ang) * r);
      const bz = Math.floor(at.z + Math.sin(ang) * r);
      const g2 = surfaceY(dim, bx, at.y + 2, bz);
      if (g2 === null) continue;
      const roll = Math.random();
      if (roll < 0.4) cmd(dim, `setblock ${bx} ${g2 - 1} ${bz} magma`);
      else if (roll < 0.7) cmd(dim, `setblock ${bx} ${g2} ${bz} fire`);
      else if (roll < 0.85) cmd(dim, `setblock ${bx} ${g2 - 1} ${bz} obsidian`);
    }

    for (const e of targetsNear(dim, at, m.radius * 2)) {
      let loc;
      try {
        loc = e.location;
      } catch {
        continue;
      }
      const dx = loc.x - at.x;
      const dz = loc.z - at.z;
      const d = Math.max(0.5, Math.hypot(dx, dz));
      hurt(e, Math.max(3, Math.round(12 - d)));
      shove(e, dx / d, dz / d, 1.4, 0.8);
      ignite(e, 4);
    }
  }

  return {
    duration: 32 + 55 + 25,
    tick(t) {
      for (const m of meteors) {
        if (t < m.delay || m.exploded) continue;
        const k = t - m.delay;
        if (k >= m.flight) {
          explode(m);
          continue;
        }
        const f = k / m.flight;
        const mx = m.sx + (m.tx - m.sx) * f;
        const my = m.sy + (m.ty - m.sy) * f;
        const mz = m.sz + (m.tz - m.sz) * f;
        particle(dim, "nd:ember", { x: mx, y: my, z: mz });
        if (k % 2 === 0) particle(dim, "nd:dust_puff", { x: mx + rand(-0.6, 0.6), y: my + 0.4, z: mz + rand(-0.6, 0.6) });
        if (k % 14 === 1) sound(dim, "nd.whoosh", { x: mx, y: my, z: mz }, 3, rand(0.8, 1.1));
      }
    },
    end() {
      for (const m of meteors) {
        if (!m.exploded) explode(m);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Volcano
 * ------------------------------------------------------------------ */

function startVolcano(player, dim, pos) {
  const bx = Math.floor(pos.x);
  const bz = Math.floor(pos.z);
  const gy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const HEIGHT = 12;
  const LAYER_TICKS = 14;
  const ERUPT_AT = HEIGHT * LAYER_TICKS + 40;
  const ROCKS = ["stone", "cobblestone", "blackstone", "tuff"];
  const bombs = [];

  return {
    duration: ERUPT_AT + 1400,
    tick(t) {
      // Phase 1: raise the cone layer by layer.
      if (t < HEIGHT * LAYER_TICKS && t % LAYER_TICKS === 0) {
        const layer = t / LAYER_TICKS;
        const r = Math.max(1, Math.round(9 * (1 - layer / HEIGHT)));
        const y = gy + layer;
        const rock = layer < 2 ? "stone" : pick(ROCKS);
        cmd(dim, `fill ${bx - r} ${y} ${bz - r} ${bx + r} ${y} ${bz + r} ${rock}`);
        for (let i = 0; i < 3; i++) {
          const ang = Math.random() * Math.PI * 2;
          particle(dim, "nd:dust_puff", {
            x: bx + Math.cos(ang) * r,
            y: y + 1,
            z: bz + Math.sin(ang) * r,
          });
        }
        if (layer % 3 === 0) {
          sound(dim, "nd.rumble", { x: bx, y, z: bz }, 4, 0.8);
          cmd(dim, `camerashake add @a[x=${bx},y=${gy},z=${bz},r=50] 0.3 0.8 positional`);
        }
      }

      // Phase 2: carve the crater and fill the throat with lava.
      if (t === HEIGHT * LAYER_TICKS + 10) {
        cmd(dim, `fill ${bx - 1} ${gy + 9} ${bz - 1} ${bx + 1} ${gy + HEIGHT - 1} ${bz + 1} air`);
      }
      if (t === HEIGHT * LAYER_TICKS + 20) {
        cmd(dim, `fill ${bx - 1} ${gy + 8} ${bz - 1} ${bx + 1} ${gy + 8} ${bz + 1} lava`);
        sound(dim, "nd.rumble", { x: bx, y: gy + 10, z: bz }, 5, 0.7);
      }

      // Phase 3: eruption.
      if (t >= ERUPT_AT) {
        if (t % 34 === 0) {
          const n = irand(2, 4);
          for (let i = 0; i < n; i++) {
            bombs.push({
              x: bx + 0.5,
              y: gy + HEIGHT + 0.5,
              z: bz + 0.5,
              vx: rand(-0.5, 0.5),
              vy: rand(0.85, 1.35),
              vz: rand(-0.5, 0.5),
              life: 0,
            });
          }
          sound(dim, "nd.rumble", { x: bx, y: gy + HEIGHT, z: bz }, 5, rand(0.65, 0.85));
        }

        for (let i = bombs.length - 1; i >= 0; i--) {
          const b = bombs[i];
          b.life++;
          b.x += b.vx;
          b.y += b.vy;
          b.z += b.vz;
          b.vy -= 0.055;
          particle(dim, "nd:ember", { x: b.x, y: b.y, z: b.z });
          const hitBlock = blockAt(dim, Math.floor(b.x), Math.floor(b.y), Math.floor(b.z));
          const landed = b.life > 4 && hitBlock !== null && hitBlock.typeId !== "minecraft:air";
          if (landed || b.life > 90 || hitBlock === null) {
            if (landed) {
              if (Math.random() < 0.55) {
                boom(dim, { x: b.x, y: b.y, z: b.z }, 2, true);
                sound(dim, "random.explode", { x: b.x, y: b.y, z: b.z }, 3, rand(0.9, 1.2));
              } else {
                const fx = Math.floor(b.x);
                const fy = Math.floor(b.y);
                const fz = Math.floor(b.z);
                cmd(dim, `setblock ${fx} ${fy} ${fz} magma`);
                cmd(dim, `setblock ${fx} ${fy + 1} ${fz} fire`);
              }
            }
            bombs.splice(i, 1);
          }
        }

        // Crater fireworks and the rising ash column.
        if (t % 12 === 0) {
          particle(dim, "nd:ember", { x: bx + rand(-1, 1), y: gy + HEIGHT + rand(0, 2), z: bz + rand(-1, 1) });
          safe(() => dim.spawnParticle("minecraft:lava_particle", { x: bx + 0.5, y: gy + HEIGHT, z: bz + 0.5 }));
        }
        if (t % 24 === 0) {
          particle(dim, "nd:dust_puff", {
            x: bx + rand(-1.5, 1.5),
            y: gy + HEIGHT + 2 + ((t / 24) % 6),
            z: bz + rand(-1.5, 1.5),
          });
        }

        // Occasional lava spill down a random flank.
        if (t % 140 === 60) {
          const [dx, dz] = pick([
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2],
          ]);
          cmd(dim, `setblock ${bx + dx} ${gy + 10} ${bz + dz} lava`);
        }

        // The slopes are not a safe place to stand.
        if (t % 60 === 0) {
          for (const e of targetsNear(dim, { x: bx, y: gy + 6, z: bz }, 11)) {
            let loc;
            try {
              loc = e.location;
            } catch {
              continue;
            }
            if (loc.y >= gy - 1 && Math.random() < 0.5) {
              ignite(e, 2);
              hurt(e, 1);
            }
          }
        }
      }
    },
    end() {
      sound(dim, "nd.rumble", { x: bx, y: gy + HEIGHT, z: bz }, 4, 1.2);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Flash Flood
 * ------------------------------------------------------------------ */

function startFlashFlood(player, dim, pos) {
  const R = 12;
  const bx = Math.floor(pos.x);
  const bz = Math.floor(pos.z);
  const gy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const layers = [];
  let risen = 0;
  let swirl = 0;
  let started = false;
  let receded = 0;

  return {
    duration: 780,
    tick(t) {
      if (!started) {
        started = true;
        weatherOn(dim, "rain");
        sound(dim, "nd.wave", { x: bx, y: gy, z: bz }, 4, 0.9);
      }

      // Water rises one layer at a time, only filling air so builds survive.
      if (t >= 20 && risen < 4 && (t - 20) % 140 === 0) {
        const y = gy + risen;
        cmd(dim, `fill ${bx - R} ${y} ${bz - R} ${bx + R} ${y} ${bz + R} water [] replace air`);
        layers.push(y);
        risen++;
        sound(dim, "nd.wave", { x: bx, y, z: bz }, 4, rand(0.85, 1.05));
      }

      // Churning current drags everything in a slow circle.
      if (t % 8 === 0 && risen > 0) {
        swirl += 0.22;
        for (const e of targetsNear(dim, { x: bx, y: gy + 1, z: bz }, R + 2)) {
          let loc;
          try {
            loc = e.location;
          } catch {
            continue;
          }
          if (loc.y < gy - 2 || loc.y > gy + risen + 3) continue;
          shove(e, Math.cos(swirl), Math.sin(swirl), 0.4, 0.12);
          if (t % 32 === 0) effect(e, "slowness", 50, 0);
        }
      }
      if (t % 60 === 30 && risen > 0) {
        for (const e of targetsNear(dim, { x: bx, y: gy + 1, z: bz }, R)) {
          let loc;
          try {
            loc = e.location;
          } catch {
            continue;
          }
          if (loc.y < gy + risen && Math.random() < 0.4) hurt(e, 1);
        }
      }

      if (t % 6 === 0 && risen > 0) {
        particle(dim, "nd:splash", {
          x: bx + rand(-R, R),
          y: gy + risen + 0.3,
          z: bz + rand(-R, R),
        });
      }
      if (t % 90 === 45) sound(dim, "nd.wave", { x: bx, y: gy + risen, z: bz }, 3, rand(0.8, 1.1));

      // Recede from the top down, catching stray flowing water too.
      if (t >= 620 && receded < layers.length && (t - 620) % 30 === 0) {
        const y = layers[layers.length - 1 - receded];
        receded++;
        cmd(dim, `fill ${bx - R} ${y} ${bz - R} ${bx + R} ${y} ${bz + R} air [] replace water`);
        cmd(dim, `fill ${bx - R} ${y} ${bz - R} ${bx + R} ${y} ${bz + R} air [] replace flowing_water`);
      }
    },
    end() {
      for (let i = receded; i < layers.length; i++) {
        const y = layers[layers.length - 1 - i];
        cmd(dim, `fill ${bx - R} ${y} ${bz - R} ${bx + R} ${y} ${bz + R} air [] replace water`);
        cmd(dim, `fill ${bx - R} ${y} ${bz - R} ${bx + R} ${y} ${bz + R} air [] replace flowing_water`);
      }
      weatherOff(dim);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Hurricane
 * ------------------------------------------------------------------ */

function startHurricane(player, dim, pos) {
  const R = 30;
  const cy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const center = { x: pos.x, y: cy + 6, z: pos.z };
  const VEG = /leaves|grass|flower|fern|sapling|vine|wheat|carrot|potato|beetroot|melon|pumpkin|sugar|bamboo|azalea|petals|deadbush|double_plant/;
  let started = false;

  return {
    duration: 1200,
    tick(t) {
      if (!started) {
        started = true;
        weatherOn(dim, "thunder");
      }

      // Cyclonic wind: calm eye, violent eyewall, wide rotating field.
      if (t % 2 === 0) {
        for (const e of targetsNear(dim, center, R + 6)) {
          let loc;
          try {
            loc = e.location;
          } catch {
            continue;
          }
          const dx = loc.x - pos.x;
          const dz = loc.z - pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 3 || d > R) continue;
          const nx = dx / d;
          const nz = dz / d;
          const tx = -nz;
          const tz = nx;
          if (d < 9) {
            shove(e, tx * 0.9 + -nx * 0.1, tz * 0.9 + -nz * 0.1, 0.85, 0.5);
          } else {
            const strength = 0.55 * (1 - (d - 9) / (R - 9));
            shove(e, tx * 0.9 - nx * 0.25, tz * 0.9 - nz * 0.25, Math.max(0.15, strength), 0.08);
          }
        }
      }

      // Storm damage: shred vegetation and light blocks across the area.
      if (t % 28 === 0) {
        for (let i = 0; i < 4; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = rand(4, 28);
          const wx = Math.floor(pos.x + Math.cos(ang) * r);
          const wz = Math.floor(pos.z + Math.sin(ang) * r);
          const g = surfaceY(dim, wx, cy + 6, wz);
          if (g === null) continue;
          for (const dy of [1, 2]) {
            const b = blockAt(dim, wx, g - dy, wz);
            if (b !== null && VEG.test(b.typeId)) {
              cmd(dim, `setblock ${wx} ${g - dy} ${wz} air [] destroy`);
              break;
            }
          }
        }
      }

      if (t % 44 === 0) {
        const ang = Math.random() * Math.PI * 2;
        const r = rand(10, 28);
        const lx = Math.floor(pos.x + Math.cos(ang) * r);
        const lz = Math.floor(pos.z + Math.sin(ang) * r);
        const g = surfaceY(dim, lx, cy + 6, lz);
        if (g !== null) cmd(dim, `summon lightning_bolt ${lx} ${g} ${lz}`);
      }

      if (t % 6 === 0) {
        for (let i = 0; i < 2; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = rand(5, 26);
          particle(dim, "nd:wind_streak", {
            x: pos.x + Math.cos(ang) * r,
            y: cy + rand(1, 14),
            z: pos.z + Math.sin(ang) * r,
          });
        }
        const ang2 = Math.random() * Math.PI * 2;
        particle(dim, "nd:dust_puff", {
          x: pos.x + Math.cos(ang2) * rand(0, 8),
          y: cy + rand(1, 10),
          z: pos.z + Math.sin(ang2) * rand(0, 8),
        });
      }

      if (t % 50 === 0) sound(dim, "nd.wind", center, 6, 0.7);
      if (t % 120 === 30) sound(dim, "ambient.weather.thunder", { x: pos.x + rand(-20, 20), y: cy + 10, z: pos.z + rand(-20, 20) }, 3, 1);
    },
    end() {
      weatherOff(dim);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Super Thunderstorm
 * ------------------------------------------------------------------ */

function startThunderstorm(player, dim, pos) {
  const R = 24;
  const cy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const center = { x: pos.x, y: cy + 2, z: pos.z };
  let strikeIn = 12;
  let started = false;

  return {
    duration: 800,
    tick(t) {
      if (!started) {
        started = true;
        weatherOn(dim, "thunder");
      }

      strikeIn--;
      if (strikeIn <= 0) {
        strikeIn = irand(22, 48);
        // Prefer striking near a mob for maximum drama.
        let sx = pos.x + rand(-R, R);
        let sz = pos.z + rand(-R, R);
        const ents = targetsNear(dim, center, R);
        if (ents.length > 0 && Math.random() < 0.65) {
          try {
            const loc = pick(ents).location;
            sx = loc.x + rand(-3, 3);
            sz = loc.z + rand(-3, 3);
          } catch {
            /* keep random point */
          }
        }
        const g = surfaceY(dim, sx, cy + 4, sz);
        if (g !== null) {
          const at = { x: sx, y: g, z: sz };
          cmd(dim, `summon lightning_bolt ${ff(sx)} ${g} ${ff(sz)}`);
          if (Math.random() < 0.3) boom(dim, at, 2.2, true);
          for (const e of targetsNear(dim, at, 4.5)) {
            let loc;
            try {
              loc = e.location;
            } catch {
              continue;
            }
            const dx = loc.x - sx;
            const dz = loc.z - sz;
            const d = Math.max(0.5, Math.hypot(dx, dz));
            hurt(e, 4);
            shove(e, dx / d, dz / d, 0.9, 0.5);
          }
        }
      }

      if (t % 70 === 10) sound(dim, "nd.rumble", center, 4, 1.1);
      if (t % 90 === 40) {
        sound(dim, "ambient.weather.thunder", { x: pos.x + rand(-R, R), y: cy + 12, z: pos.z + rand(-R, R) }, 4, 1);
      }
      if (t % 10 === 0) {
        particle(dim, "nd:wind_streak", {
          x: pos.x + rand(-R, R),
          y: cy + rand(4, 14),
          z: pos.z + rand(-R, R),
        });
      }
    },
    end() {
      weatherOff(dim);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Blizzard
 * ------------------------------------------------------------------ */

function startBlizzard(player, dim, pos) {
  const R = 25;
  const cy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const center = { x: pos.x, y: cy + 2, z: pos.z };
  let started = false;

  return {
    duration: 1000,
    tick(t) {
      if (!started) {
        started = true;
        weatherOn(dim, "rain");
        cmd(dim, "fog @a push nd:fog_blizzard ndblizzard");
      }

      // Snow squall around every player caught in the storm.
      if (t % 6 === 0) {
        try {
          for (const p of dim.getPlayers({ location: center, maxDistance: R + 12 })) {
            const loc = p.location;
            for (let i = 0; i < 2; i++) {
              particle(dim, "nd:snowfall", {
                x: loc.x + rand(-9, 9),
                y: loc.y + rand(4, 9),
                z: loc.z + rand(-9, 9),
              });
            }
          }
        } catch {
          /* ignore */
        }
        particle(dim, "nd:snowfall", { x: pos.x + rand(-R, R), y: cy + rand(4, 10), z: pos.z + rand(-R, R) });
      }

      // The world ices over: snow layers pile up, open water freezes.
      if (t % 10 === 0) {
        for (let i = 0; i < 3; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * R;
          const wx = Math.floor(pos.x + Math.cos(ang) * r);
          const wz = Math.floor(pos.z + Math.sin(ang) * r);
          const g = surfaceY(dim, wx, cy + 4, wz);
          if (g === null) continue;
          const below = blockAt(dim, wx, g - 1, wz);
          if (below === null) continue;
          if (below.typeId === "minecraft:water") {
            cmd(dim, `setblock ${wx} ${g - 1} ${wz} ice`);
          } else if (below.typeId !== "minecraft:snow_layer" && below.typeId !== "minecraft:ice") {
            cmd(dim, `setblock ${wx} ${g} ${wz} snow_layer`);
          }
        }
      }

      if (t % 30 === 0) {
        for (const e of targetsNear(dim, center, R)) {
          effect(e, "slowness", 70, 2);
          if (Math.random() < 0.5) effect(e, "weakness", 70, 1);
        }
      }
      if (t % 90 === 20) {
        for (const e of targetsNear(dim, center, R)) {
          if (Math.random() < 0.5) hurt(e, 1);
        }
      }

      if (t % 55 === 0) sound(dim, "nd.wind", center, 5, 1.25);
    },
    end() {
      cmd(dim, "fog @a remove ndblizzard");
      weatherOff(dim);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Wildfire
 * ------------------------------------------------------------------ */

function startWildfire(player, dim, pos) {
  const FLAMMABLE = /log|leaves|planks|grass|fern|flower|wool|hay|vine|sapling|bamboo|azalea|roots|deadbush|tallgrass|double_plant|wood|fence/;
  const gy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const frontier = [{ x: Math.floor(pos.x), y: gy, z: Math.floor(pos.z) }];
  let burned = 0;
  cmd(dim, `setblock ${Math.floor(pos.x)} ${gy} ${Math.floor(pos.z)} fire`);

  return {
    duration: 900,
    tick(t) {
      // Creep outward from already-burning spots.
      if (t % 8 === 0 && burned < 260) {
        for (let i = 0; i < 3; i++) {
          const p = pick(frontier);
          const nx = p.x + irand(-4, 4);
          const nz = p.z + irand(-4, 4);
          const g = surfaceY(dim, nx, p.y + 3, nz);
          if (g === null) continue;
          const below = blockAt(dim, nx, g - 1, nz);
          if (below === null) continue;
          if (FLAMMABLE.test(below.typeId) || Math.random() < 0.2) {
            cmd(dim, `setblock ${nx} ${g} ${nz} fire`);
            frontier.push({ x: nx, y: g, z: nz });
            if (frontier.length > 70) frontier.shift();
            burned++;
          }
        }
      }

      if (t % 12 === 0) {
        const p = pick(frontier);
        particle(dim, "nd:ember", { x: p.x + rand(0, 1), y: p.y + rand(0.5, 2), z: p.z + rand(0, 1) });
        particle(dim, "nd:dust_puff", { x: p.x + rand(0, 1), y: p.y + rand(2, 5), z: p.z + rand(0, 1) });
      }

      // Anything wandering through the burn zone catches fire.
      if (t % 20 === 0) {
        const radius = Math.min(26, 6 + t / 40);
        for (const e of targetsNear(dim, { x: pos.x, y: gy + 2, z: pos.z }, radius)) {
          let loc;
          try {
            loc = e.location;
          } catch {
            continue;
          }
          for (const p of frontier) {
            const dx = loc.x - p.x;
            const dz = loc.z - p.z;
            if (dx * dx + dz * dz < 20) {
              ignite(e, 4);
              break;
            }
          }
        }
      }

      if (t % 60 === 0) {
        const p = pick(frontier);
        sound(dim, "nd.fire_crackle", { x: p.x, y: p.y, z: p.z }, 4, rand(0.9, 1.1));
      }
    },
    end() {},
  };
}

/* ------------------------------------------------------------------ *
 * Disaster: Sandstorm
 * ------------------------------------------------------------------ */

function startSandstorm(player, dim, pos) {
  const R = 25;
  const cy = surfaceY(dim, pos.x, pos.y, pos.z) ?? Math.floor(pos.y);
  const center = { x: pos.x, y: cy + 2, z: pos.z };
  const windAngle = Math.random() * Math.PI * 2;
  const wx = Math.cos(windAngle);
  const wz = Math.sin(windAngle);
  let started = false;

  return {
    duration: 900,
    tick(t) {
      if (!started) {
        started = true;
        cmd(dim, "fog @a push nd:fog_sandstorm ndsandstorm");
      }

      // Driving sand around every player plus ambient gusts.
      if (t % 3 === 0) {
        try {
          for (const p of dim.getPlayers({ location: center, maxDistance: R + 12 })) {
            const loc = p.location;
            for (let i = 0; i < 2; i++) {
              particle(dim, "nd:sand_gust", {
                x: loc.x + rand(-10, 10),
                y: loc.y + rand(0.5, 6),
                z: loc.z + rand(-10, 10),
              });
            }
          }
        } catch {
          /* ignore */
        }
        particle(dim, "nd:sand_gust", { x: pos.x + rand(-R, R), y: cy + rand(1, 8), z: pos.z + rand(-R, R) });
      }

      // A steady gale shoves everything downwind.
      if (t % 16 === 0) {
        for (const e of targetsNear(dim, center, R)) {
          shove(e, wx, wz, 0.35, 0.06);
          effect(e, "slowness", 50, 1);
        }
      }
      if (t % 70 === 30) {
        for (const e of targetsNear(dim, center, R)) {
          if (Math.random() < 0.25) hurt(e, 1);
          try {
            if (e.typeId === "minecraft:player" && Math.random() < 0.4) {
              effect(e, "blindness", 50, 0);
            }
          } catch {
            /* ignore */
          }
        }
      }

      // Dunes creep in: the storm buries the area under scattered sand.
      if (t % 30 === 0) {
        for (let i = 0; i < 2; i++) {
          if (Math.random() > 0.2) continue;
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * R;
          const sx = Math.floor(pos.x + Math.cos(ang) * r);
          const sz = Math.floor(pos.z + Math.sin(ang) * r);
          const g = surfaceY(dim, sx, cy + 4, sz);
          if (g !== null) cmd(dim, `setblock ${sx} ${g} ${sz} sand`);
        }
      }

      if (t % 55 === 0) sound(dim, "nd.wind", center, 5, 0.55);
    },
    end() {
      cmd(dim, "fog @a remove ndsandstorm");
    },
  };
}

/* ------------------------------------------------------------------ *
 * Registry + activation
 * ------------------------------------------------------------------ */

const DISASTERS = {
  "nd:tornado": { flash: "§bTornado §7touches down!", cooldownTicks: 60, start: startTornado },
  "nd:tsunami": { flash: "§3Tsunami §7incoming!", cooldownTicks: 60, start: startTsunami },
  "nd:earthquake": { flash: "§6Earthquake! §7The ground splits open!", cooldownTicks: 60, start: startEarthquake },
  "nd:meteor": { flash: "§cMeteors §7are falling from the sky!", cooldownTicks: 60, start: startMeteor },
  "nd:volcano": { flash: "§4A volcano §7rises and erupts!", cooldownTicks: 100, start: startVolcano },
  "nd:flash_flood": { flash: "§9Flash flood! §7The water is rising!", cooldownTicks: 60, start: startFlashFlood },
  "nd:hurricane": { flash: "§3Hurricane §7winds tear through the area!", cooldownTicks: 60, start: startHurricane },
  "nd:thunderstorm": { flash: "§eSuper thunderstorm §7overhead!", cooldownTicks: 60, start: startThunderstorm },
  "nd:blizzard": { flash: "§fBlizzard! §7A whiteout sweeps in!", cooldownTicks: 60, start: startBlizzard },
  "nd:wildfire": { flash: "§6Wildfire! §7The land is burning!", cooldownTicks: 60, start: startWildfire },
  "nd:sandstorm": { flash: "§eSandstorm! §7The desert swallows everything!", cooldownTicks: 60, start: startSandstorm },
};

const MAX_ACTIVE = 5;
const active = [];
const lastUse = new Map();
let tickCounter = 0;

function activate(player, itemStack, pos) {
  if (!player || !itemStack) return;
  let key;
  try {
    key = itemStack.typeId;
  } catch {
    return;
  }
  const def = DISASTERS[key];
  if (!def) return;

  // Touch controls can fire itemUse and itemUseOn for the same tap.
  const now = typeof system.currentTick === "number" ? system.currentTick : tickCounter;
  const last = lastUse.get(player.id) ?? -100;
  if (now - last < 10) return;
  lastUse.set(player.id, now);

  if (active.length >= MAX_ACTIVE) {
    actionbar(player, "§cToo many disasters active - wait for one to end!");
    return;
  }

  const dim = player.dimension;
  let task = null;
  try {
    task = def.start(player, dim, pos);
  } catch {
    return;
  }
  if (!task) return;
  task.age = 0;
  task.errors = 0;
  active.push(task);

  safe(() => player.startItemCooldown(`nd_${key.slice(3)}`, def.cooldownTicks));
  sound(dim, "random.orb", pos, 2, 0.8);
  actionbar(player, def.flash);
  safe(() => player.sendMessage(`§8[§6Disasters§8] ${def.flash}`));
}

/* Tap a block while holding a disaster item: spawn it on top of that block. */
world.afterEvents.itemUseOn.subscribe((ev) => {
  try {
    const loc = ev.block.location;
    activate(ev.source, ev.itemStack, { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 });
  } catch {
    /* ignore */
  }
});

/* Use in the air: spawn at the block you are aiming at (or 24 blocks ahead). */
world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  let key;
  try {
    key = ev.itemStack?.typeId;
  } catch {
    return;
  }
  if (!player || !key || !DISASTERS[key]) return;
  const dim = player.dimension;
  let head;
  let dir;
  try {
    head = player.getHeadLocation();
    dir = player.getViewDirection();
  } catch {
    return;
  }
  let hit = null;
  for (let i = 2; i <= 64; i++) {
    const p = { x: head.x + dir.x * i, y: head.y + dir.y * i, z: head.z + dir.z * i };
    if (p.y < -60 || p.y > 318) break;
    const b = blockAt(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    if (b === null) break;
    if (b.typeId !== "minecraft:air") {
      hit = p;
      break;
    }
  }
  const p = hit ?? { x: head.x + dir.x * 24, y: head.y, z: head.z + dir.z * 24 };
  const g = surfaceY(dim, p.x, p.y + 1, p.z);
  activate(player, ev.itemStack, { x: p.x, y: g ?? p.y, z: p.z });
});

/*
 * On join: confirm the scripts are alive and clear any fog a player kept in
 * their save after quitting mid-storm.
 */
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  safe(() => {
    ev.player.runCommandAsync("fog @s remove ndblizzard").catch(() => {});
    ev.player.runCommandAsync("fog @s remove ndsandstorm").catch(() => {});
  });
  safe(() =>
    ev.player.sendMessage(
      "§8[§6Disasters§8]§r v1.0.0 loaded - 11 disasters armed. " +
        "§7Hold a disaster item and tap a block!"
    )
  );
});

/* ------------------------------------------------------------------ *
 * Main loop: one interval drives every active disaster.
 * ------------------------------------------------------------------ */

system.runInterval(() => {
  tickCounter++;
  for (let i = active.length - 1; i >= 0; i--) {
    const task = active[i];
    try {
      task.tick(task.age);
    } catch {
      task.errors++;
    }
    task.age++;
    if (task.age >= task.duration || task.errors > 8) {
      try {
        if (task.end) task.end();
      } catch {
        /* ignore */
      }
      active.splice(i, 1);
    }
  }
}, 1);
