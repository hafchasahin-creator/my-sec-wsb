/*
 * Sakura Bodyguard - "Aya" flavour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android, RenderDragon)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * ============================================================================
 * THIS SCRIPT IS PURELY OPTIONAL.
 * ----------------------------------------------------------------------------
 * Every piece of actual gameplay - taming, following, sitting, combat, healing,
 * damage immunity - lives in behavior_packs/bodyguard_bp/entities/bodyguard_girl.json.
 * If this module fails to load, or if a phone build is missing one of the APIs
 * used below, the add-on still plays exactly as designed; you simply lose the
 * chat lines, the petal bursts and the sakura charm's recall convenience.
 *
 * Because of that, EVERY single engine call in this file is inside a try/catch
 * (usually via the safe() helper), and every event subscription is itself
 * feature-detected and wrapped. The worst possible outcome is "no flavour".
 * ============================================================================
 */

import { world, system } from "@minecraft/server";

/* ------------------------------------------------------------------ *
 * Identifiers + tuning
 * ------------------------------------------------------------------ */

const AYA = "bg:bodyguard_girl";
const ITEM_CHARM = "bg:sakura_charm";
const ITEM_ONIGIRI = "bg:onigiri";

/** Items the entity JSON accepts as tame_items - kept in sync by hand. */
const TAME_ITEMS = new Set([
  ITEM_ONIGIRI,
  "minecraft:poppy",
  "minecraft:cookie",
  "minecraft:golden_apple",
]);

const CONFIG = {
  charm: {
    searchRadius: 64, // bounded query - never scans the whole dimension
    cooldownCategory: "bg_charm", // only shows on the hotbar if the item JSON
    cooldownTicks: 60, // declares a matching minecraft:cooldown
  },
  lowHealth: {
    ratio: 0.25, // warn below 25% health
    cooldownTicks: 200, // 10s between warnings for the same Aya
  },
  // Custom particle from the resource pack, with a vanilla fallback in case the
  // RP is not applied (BP-only worlds are a real thing players create).
  petal: "bg:sakura_petal",
  petalFallback: "minecraft:heart_particle",
};

/** Dynamic property used to remember who tamed her. */
const PROP_OWNER = "bg:owner_id";
const PROP_OWNER_NAME = "bg:owner_name";

/* ------------------------------------------------------------------ *
 * Defensive helpers (house style: swallow platform differences)
 * ------------------------------------------------------------------ */

/** Run a cosmetic call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Subscribe to an event only if it exists on this build. */
function subscribe(getEvent, handler, label) {
  try {
    const ev = getEvent();
    if (!ev || typeof ev.subscribe !== "function") {
      console.warn(`[Sakura Bodyguard] event unavailable, skipping: ${label}`);
      return;
    }
    ev.subscribe((e) => {
      try {
        handler(e);
      } catch (err) {
        console.warn(`[Sakura Bodyguard] ${label} handler failed: ${err}`);
      }
    });
  } catch (err) {
    console.warn(`[Sakura Bodyguard] could not subscribe to ${label}: ${err}`);
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

/** Roughly chest height on a 2-block-tall mob. */
function bodyLocation(entity) {
  const loc = entity.location;
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

function message(player, text) {
  safe(() => player.sendMessage(text));
}

/** system.currentTick is not guaranteed on every build - fall back to Date. */
function now() {
  const tick = safe(() => system.currentTick);
  if (typeof tick === "number") return tick;
  return Math.floor(Date.now() / 50); // 20 ticks per second
}

function distanceTo(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* ------------------------------------------------------------------ *
 * Aya helpers
 * ------------------------------------------------------------------ */

function isAya(entity) {
  return safe(() => entity?.typeId) === AYA;
}

/** True once the entity JSON has swapped her into the bg:tamed group. */
function isTamed(entity) {
  // getComponent throws on a dead/unloaded entity, hence the guard.
  const tamed = safe(() => entity.getComponent("minecraft:is_tamed"));
  return tamed !== undefined && tamed !== null;
}

/**
 * Who owns this Aya?
 *
 * Primary source is a dynamic property we write ourselves the moment she is
 * tamed - that is the only thing we can fully trust on 1.21.0, because the
 * tamedToPlayer / tamedToPlayerId fields of EntityTameableComponent were not
 * present in @minecraft/server 1.11.0. The component read is attempted anyway
 * (guarded) so this keeps working if a newer runtime does expose it.
 *
 * Returns undefined when ownership cannot be established - callers MUST treat
 * that as "not mine" and refuse to act.
 */
function ownerIdOf(entity) {
  const stored = safe(() => entity.getDynamicProperty(PROP_OWNER));
  if (typeof stored === "string" && stored.length > 0) return stored;

  const tameable = safe(() => entity.getComponent("minecraft:tameable"));
  if (tameable) {
    const viaId = safe(() => tameable.tamedToPlayerId);
    if (typeof viaId === "string" && viaId.length > 0) return viaId;
    const viaPlayer = safe(() => tameable.tamedToPlayer?.id);
    if (typeof viaPlayer === "string" && viaPlayer.length > 0) return viaPlayer;
  }

  return undefined;
}

function rememberOwner(entity, player) {
  safe(() => entity.setDynamicProperty(PROP_OWNER, player.id));
  safe(() => entity.setDynamicProperty(PROP_OWNER_NAME, player.name));
}

/** Her custom name if she has been renamed, otherwise "Aya". */
function ayaName(entity) {
  const custom = safe(() => entity.nameTag);
  return typeof custom === "string" && custom.length > 0 ? custom : "Aya";
}

/** Bounded, type-filtered query - never a whole-dimension scan. */
function nearbyAya(player, radius) {
  const found = safe(() =>
    player.dimension.getEntities({
      type: AYA,
      location: player.location,
      maxDistance: radius,
    })
  );
  return Array.isArray(found) ? found : [];
}

/** Find a player object by id without iterating anything unbounded. */
function playerById(id) {
  const players = safe(() => world.getAllPlayers());
  if (!Array.isArray(players)) return undefined;
  return players.find((p) => safe(() => p.id) === id);
}

/* ------------------------------------------------------------------ *
 * Cosmetics
 * ------------------------------------------------------------------ */

/** A small ring of sakura petals, with a vanilla fallback particle. */
function petalBurst(dimension, at, count = 6, radius = 0.7) {
  particle(dimension, CONFIG.petal, at);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const spot = offset(
      at,
      Math.cos(angle) * radius,
      0.2 + (i % 3) * 0.25,
      Math.sin(angle) * radius
    );
    particle(dimension, CONFIG.petal, spot);
    particle(dimension, CONFIG.petalFallback, spot);
  }
}

function heartBurst(dimension, at) {
  particle(dimension, "minecraft:heart_particle", offset(at, 0, 0.8, 0));
  particle(dimension, "minecraft:villager_happy", at);
  petalBurst(dimension, at, 5, 0.6);
}

/* ------------------------------------------------------------------ *
 * Feature 1 - the sakura charm recalls your own Aya
 * ------------------------------------------------------------------ */

/** Script-side cooldown, so the feature behaves even without item cooldown UI. */
const charmCooldown = new Map(); // player id -> tick the charm becomes usable

function charmOnCooldown(player) {
  const ready = charmCooldown.get(safe(() => player.id));
  return typeof ready === "number" && now() < ready;
}

function startCharmCooldown(player) {
  const id = safe(() => player.id);
  if (id) charmCooldown.set(id, now() + CONFIG.charm.cooldownTicks);
  // Visible hotbar cooldown - only renders if the item JSON declares
  // "minecraft:cooldown" with this same category. Harmless if it does not.
  safe(() =>
    player.startItemCooldown(CONFIG.charm.cooldownCategory, CONFIG.charm.cooldownTicks)
  );
}

function useCharm(player) {
  if (charmOnCooldown(player)) return;

  const candidates = nearbyAya(player, CONFIG.charm.searchRadius);

  let best;
  let bestDistance = Infinity;
  let sawSomeoneElses = false;

  for (const aya of candidates) {
    if (!isTamed(aya)) continue;

    const owner = ownerIdOf(aya);
    // Ownership must be positively confirmed. Unknown owner == not yours.
    if (owner !== safe(() => player.id)) {
      if (owner !== undefined) sawSomeoneElses = true;
      continue;
    }

    const d = distanceTo(player.location, aya.location);
    if (d < bestDistance) {
      bestDistance = d;
      best = aya;
    }
  }

  if (!best) {
    // Gentle hint instead of silence - a phone player has no console.
    if (sawSomeoneElses) {
      message(
        player,
        "§d[Sakura Charm]§r That bodyguard belongs to someone else. The charm stays quiet."
      );
    } else {
      message(
        player,
        "§d[Sakura Charm]§r No bond answers... Tame a bodyguard with an §fOnigiri§r first, and stay within 64 blocks."
      );
    }
    safe(() => player.playSound("note.bass", { location: player.location }));
    startCharmCooldown(player);
    return;
  }

  startCharmCooldown(player);
  recall(player, best);
}

function recall(player, aya) {
  const dimension = safe(() => player.dimension);
  const from = safe(() => bodyLocation(aya));
  const name = ayaName(aya);

  // Farewell puff at her old position so the teleport reads as intentional.
  const fromDim = safe(() => aya.dimension) ?? dimension;
  if (fromDim && from) petalBurst(fromDim, from, 6, 0.8);

  // Land her just behind/beside the player rather than inside them.
  const to = safe(() => {
    const view = player.getViewDirection?.();
    const p = player.location;
    if (!view) return { x: p.x + 1, y: p.y, z: p.z };
    return { x: p.x - view.x * 1.4, y: p.y, z: p.z - view.z * 1.4 };
  }) ?? safe(() => player.location);

  const moved = safe(() => {
    aya.teleport(to, { dimension: player.dimension });
    return true;
  });

  if (!moved) {
    // Older/reduced teleport signature.
    safe(() => aya.teleport(to));
  }

  // Heal her back to full - the charm is a recall AND a mend.
  safe(() => {
    const health = aya.getComponent("minecraft:health");
    if (!health) return;
    const max = health.effectiveMax ?? health.defaultValue ?? 40;
    if (health.currentValue < max) health.setCurrentValue(max);
  });

  const at = safe(() => bodyLocation(aya)) ?? to;
  const dim = safe(() => aya.dimension) ?? dimension;
  if (dim) {
    heartBurst(dim, at);
    petalBurst(dim, at, 8, 0.9);
    sound(dim, "random.orb", at);
    sound(dim, "beacon.activate", at);
  }

  message(player, `§d[Sakura Charm]§r §f${name}§r flickers back to your side, unhurt. §d*`);
}

/* ------------------------------------------------------------------ *
 * Feature 2 - petal burst when Aya lands a hit
 * ------------------------------------------------------------------ */

function ayaLandedHit(aya, victim) {
  const dimension = safe(() => victim.dimension);
  if (!dimension) return;
  const at = bodyLocation(victim);

  petalBurst(dimension, at, 7, 0.55);
  particle(dimension, "minecraft:critical_hit_emitter", at);
  sound(dimension, "random.orb", at);
}

/* ------------------------------------------------------------------ *
 * Feature 3 - low health warning for her owner
 * ------------------------------------------------------------------ */

const lastWarn = new Map(); // aya entity id -> tick of last warning

function maybeWarnOwner(aya) {
  const health = safe(() => aya.getComponent("minecraft:health"));
  if (!health) return;

  const current = safe(() => health.currentValue);
  const max = safe(() => health.effectiveMax ?? health.defaultValue) ?? 40;
  if (typeof current !== "number" || typeof max !== "number" || max <= 0) return;
  if (current <= 0) return;
  if (current / max > CONFIG.lowHealth.ratio) return;

  const id = safe(() => aya.id);
  if (!id) return;

  const t = now();
  const last = lastWarn.get(id);
  if (typeof last === "number" && t - last < CONFIG.lowHealth.cooldownTicks) return;
  // Keep the map from growing without bound over a very long session.
  if (lastWarn.size > 64) lastWarn.clear();
  lastWarn.set(id, t);

  const ownerId = ownerIdOf(aya);
  if (!ownerId) return;
  const owner = playerById(ownerId);
  if (!owner) return;

  const pct = Math.max(1, Math.round((current / max) * 100));
  message(
    owner,
    `§c[!]§r §f${ayaName(aya)}§r is hurt badly (§c${pct}%§r). Feed her an §fOnigiri§r or use the §dSakura Charm§r!`
  );
  safe(() => owner.playSound("random.anvil_land", { location: owner.location }));
  safe(() => petalBurst(aya.dimension, bodyLocation(aya), 4, 0.5));
}

/* ------------------------------------------------------------------ *
 * Feature 4 - tame confirmation
 * ------------------------------------------------------------------ */

/**
 * The engine does the taming (minecraft:tameable in the entity JSON); we only
 * watch for the interaction and check a few ticks later whether it took. That
 * keeps the script entirely off the critical path.
 */
function watchForTame(player, aya) {
  const wasTamed = isTamed(aya);
  if (wasTamed) return;

  // ~0.5s later the component group swap has definitely resolved.
  safe(() =>
    system.runTimeout(() => {
      try {
        if (!isTamed(aya)) return;
        if (ownerIdOf(aya) !== undefined) return; // already recorded

        rememberOwner(aya, player);

        const name = ayaName(aya);
        message(
          player,
          `§d* §f${name}§r bows to you. §7"I'll protect you from now on!"§r §d*`
        );
        message(
          player,
          "§7Tip: tap her to sit/stand, feed §fOnigiri§7 to heal, use the §dSakura Charm§7 to call her back."
        );

        const dimension = safe(() => aya.dimension);
        if (dimension) {
          const at = bodyLocation(aya);
          heartBurst(dimension, at);
          heartBurst(dimension, offset(at, 0, 0.4, 0));
          sound(dimension, "random.levelup", at);
        }
      } catch (err) {
        console.warn(`[Sakura Bodyguard] tame confirmation failed: ${err}`);
      }
    }, 10)
  );
}

/* ------------------------------------------------------------------ *
 * Event wiring - each subscription is feature-detected and wrapped
 * ------------------------------------------------------------------ */

// Charm use.
subscribe(
  () => world.afterEvents.itemUse,
  (event) => {
    const player = event.source;
    const used = event.itemStack?.typeId;
    if (!player || used !== ITEM_CHARM) return;
    useCharm(player);
  },
  "itemUse"
);

// Aya hits something / Aya gets hurt. One event covers both directions.
subscribe(
  () => world.afterEvents.entityHurt,
  (event) => {
    const { hurtEntity, damage, damageSource } = event;
    if (!hurtEntity || damage <= 0) return;

    const attacker = damageSource?.damagingEntity;
    if (attacker && isAya(attacker) && attacker.id !== hurtEntity.id) {
      ayaLandedHit(attacker, hurtEntity);
    }

    if (isAya(hurtEntity)) {
      maybeWarnOwner(hurtEntity);
    }
  },
  "entityHurt"
);

// Taming. playerInteractWithEntity is the clean signal; if this build does not
// have it we simply never print the confirmation (and ownerIdOf stays unknown,
// which makes the charm politely refuse rather than teleport the wrong mob).
subscribe(
  () => world.afterEvents.playerInteractWithEntity,
  (event) => {
    const player = event.player;
    const target = event.target;
    if (!player || !isAya(target)) return;

    const held = event.itemStack?.typeId;
    if (!held || !TAME_ITEMS.has(held)) return;

    watchForTame(player, target);
  },
  "playerInteractWithEntity"
);

// Belt-and-braces: if she is spawned already tamed (creative /summon with an
// event, or a re-load), and the owning player is standing right there, we do
// NOT guess. Ownership is only ever recorded at the moment of taming, above.

// One-time proof the script module actually loaded. If you join a world and do
// not see this line, the scripts are not running - which is fine, the add-on
// still works, but none of the flavour above will fire.
subscribe(
  () => world.afterEvents.playerSpawn,
  (event) => {
    if (!event.initialSpawn) return;
    message(
      event.player,
      "§d[Sakura Bodyguard]§r v1.0.0 loaded - §fAya§r is ready. Craft an §fOnigiri§r to find a friend. §d*"
    );
  },
  "playerSpawn"
);

console.warn("[Sakura Bodyguard] script loaded - flavour layer active (optional).");
