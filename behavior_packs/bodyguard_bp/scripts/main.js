/*
 * Bodyguard - companion logic.
 *
 * Target: Minecraft Bedrock 1.21.0 (@minecraft/server 1.11.0,
 * @minecraft/server-ui 1.1.0).  Only stable APIs that exist in those exact
 * module versions are used - see README "Compatibility notes".
 *
 * Division of labour:
 *   The entity JSON owns pathfinding, target selection and melee.  Native AI
 *   goals are far cheaper than anything a script can do per tick, and they are
 *   what make the movement look natural instead of teleport-y.
 *   This file owns everything the data pack cannot express: who the owner is,
 *   which mode is active, the command UI, combat flourishes, recovery from
 *   pathing failures, and gear.
 *
 * Performance budget (this is a phone):
 *   - one 5 Hz interval, which processes at most BUDGET.perTick bodyguards
 *   - the registry is maintained by events; a full re-scan runs every 10 s
 *   - no entity search runs on a timer; searches happen only on a hit, on a
 *     special attack, or during the 10 s reconcile
 */

import {
  world,
  system,
  GameMode,
  EquipmentSlot,
  EntityDamageCause,
  EntityComponentTypes,
} from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

// --------------------------------------------------------------------------
// Tuning - everything a server owner might want to change lives here.
// --------------------------------------------------------------------------
const CONFIG = {
  /** Bodyguards a single player may summon with a Contract. */
  maxPerPlayer: 3,
  /** Seconds between Contract summons. */
  summonCooldown: 4,

  follow: {
    /** Blocks past which the script hard-teleports the bodyguard back. */
    teleportDistance: 38,
    /** Blocks past which a bodyguard that has stopped moving is rescued. */
    stuckDistance: 6,
    /** Consecutive checks without movement before a rescue teleport. */
    stuckChecks: 3,
  },

  guard: {
    /** Default radius of a GUARD post, in blocks. */
    defaultRadius: 12,
    /** Extra drift allowed before the script walks it home. */
    leash: 10,
  },

  combat: {
    /** Seconds after the last hit that still counts as "in combat". */
    memory: 6,
    /** Base critical chance, plus critPerTier for each gear tier. */
    critChance: 0.12,
    critPerTier: 0.04,
    critMultiplier: 0.55,
    /** Hits on the same target inside comboWindow ticks build a combo. */
    comboWindow: 60,
    comboFinisher: 3,
    comboBonus: 0.35,
    knockbackBase: 0.45,
    knockbackPerTier: 0.12,
    /** Guard Breaker: cooldown in seconds, radius and damage. */
    specialCooldown: 14,
    specialRadius: 3.6,
    specialDamage: 6,
    specialMinTargets: 2,
    /** Below this fraction of max health the bodyguard raises its guard. */
    defendHealth: 0.38,
    /** A single hit this large makes it dodge sideways. */
    dodgeDamage: 6,
    /** Blocks at which a bodyguard holding a bow switches to it. */
    rangedSwapDistance: 7,
  },

  regen: {
    /** Seconds out of combat before regeneration starts. */
    delay: 8,
    /** Health restored per regeneration pulse (~1 pulse every 3 s). */
    amount: 1,
  },
};

const BUDGET = {
  /** Ticks between main-loop runs. */
  interval: 4,
  /** Bodyguards updated per main-loop run. */
  perTick: 4,
  /** Ticks between full registry reconciles. */
  reconcile: 200,
};

const ENTITY_ID = "bg:bodyguard";
const CONTRACT_ID = "bg:contract";

const MODES = [
  { key: "follow", label: "FOLLOW", event: "bg:set_follow", color: "§a" },
  { key: "stay", label: "STAY", event: "bg:set_stay", color: "§e" },
  { key: "guard", label: "GUARD", event: "bg:set_guard", color: "§6" },
  { key: "passive", label: "PASSIVE", event: "bg:set_passive", color: "§b" },
  { key: "aggressive", label: "AGGRESSIVE", event: "bg:set_aggressive", color: "§c" },
];
const MODE_FOLLOW = 0;
const MODE_STAY = 1;
const MODE_GUARD = 2;
const MODE_PASSIVE = 3;
const MODE_AGGRESSIVE = 4;
/** Modes in which the bodyguard trails the owner rather than holding a post. */
const ESCORT_MODES = [MODE_FOLLOW, MODE_PASSIVE, MODE_AGGRESSIVE];

const CODENAMES = [
  "Kane", "Vault", "Onyx", "Harker", "Bishop", "Slate", "Corbin", "Rook",
  "Marlow", "Drexel", "Sable", "Quill", "Rhodes", "Vega", "Ashford", "Cobalt",
  "Tallis", "Redgrave", "Mercer", "Halloran", "Steele", "Voss", "Bran", "Larkin",
];

// Weapons the bodyguard understands, and the damage they add on top of its
// tier damage.  Mirrors vanilla weapon damage closely enough to feel right.
const WEAPON_BONUS = {
  "minecraft:wooden_sword": 1,
  "minecraft:golden_sword": 1,
  "minecraft:stone_sword": 2,
  "minecraft:iron_sword": 3,
  "minecraft:diamond_sword": 4,
  "minecraft:netherite_sword": 5,
  "minecraft:wooden_axe": 1,
  "minecraft:golden_axe": 1,
  "minecraft:stone_axe": 2,
  "minecraft:iron_axe": 3,
  "minecraft:diamond_axe": 4,
  "minecraft:netherite_axe": 5,
  "minecraft:trident": 4,
};
const RANGED_WEAPONS = ["minecraft:bow", "minecraft:crossbow"];

// Armour points, matching vanilla values, used to derive the gear tier.
const ARMOR_POINTS = {
  leather: { Head: 1, Chest: 3, Legs: 2, Feet: 1 },
  chainmail: { Head: 2, Chest: 5, Legs: 4, Feet: 1 },
  golden: { Head: 2, Chest: 5, Legs: 3, Feet: 1 },
  iron: { Head: 2, Chest: 6, Legs: 5, Feet: 2 },
  diamond: { Head: 3, Chest: 8, Legs: 6, Feet: 3 },
  netherite: { Head: 3, Chest: 8, Legs: 6, Feet: 3 },
  turtle: { Head: 2 },
};
const TIER_NAMES = ["Recruit", "Leather", "Iron", "Diamond", "Netherite"];
const TIER_THRESHOLDS = [0, 1, 7, 13, 19];

const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
/** /replaceitem slot names, used as a fallback if setEquipment is unavailable. */
const SLOT_COMMAND = {
  [EquipmentSlot.Mainhand]: "slot.weapon.mainhand",
  [EquipmentSlot.Offhand]: "slot.weapon.offhand",
  [EquipmentSlot.Head]: "slot.armor.head",
  [EquipmentSlot.Chest]: "slot.armor.chest",
  [EquipmentSlot.Legs]: "slot.armor.legs",
  [EquipmentSlot.Feet]: "slot.armor.feet",
};
const SLOT_FOR_ARMOR = {
  helmet: EquipmentSlot.Head,
  cap: EquipmentSlot.Head,
  chestplate: EquipmentSlot.Chest,
  tunic: EquipmentSlot.Chest,
  leggings: EquipmentSlot.Legs,
  pants: EquipmentSlot.Legs,
  boots: EquipmentSlot.Feet,
};

// --------------------------------------------------------------------------
// Small helpers.  Every game call that can throw when a chunk unloads or an
// entity dies mid-frame goes through one of these.
// --------------------------------------------------------------------------
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_err) {
    return fallback;
  }
}

function alive(entity) {
  return !!entity && safe(() => entity.isValid(), false);
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function playSound(entity, id, volume, pitch) {
  safe(() => entity.dimension.playSound(id, entity.location, { volume, pitch }));
}

function particle(entity, id, offsetY) {
  safe(() =>
    entity.dimension.spawnParticle(id, {
      x: entity.location.x,
      y: entity.location.y + (offsetY || 0),
      z: entity.location.z,
    })
  );
}

function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

function getHealth(entity) {
  return safe(() => entity.getComponent(EntityComponentTypes.Health), undefined);
}

function getEquippable(entity) {
  return safe(() => entity.getComponent(EntityComponentTypes.Equippable), undefined);
}

/**
 * Put an item in one of the bodyguard's equipment slots.
 *
 * setEquipment is the API path and keeps enchantments, durability and custom
 * names intact.  /replaceitem is the fallback for the case where the component
 * is unavailable; it can only place a plain item, so it is a last resort.
 * Returns true if the slot ended up holding what was asked for.
 */
function setEquipment(guard, slot, stack) {
  const equippable = getEquippable(guard);
  if (equippable) {
    const ok = safe(() => equippable.setEquipment(slot, stack), false);
    if (ok) return true;
  }
  const slotName = SLOT_COMMAND[slot];
  if (!slotName) return false;
  const command = stack
    ? "replaceitem entity @s " + slotName + " 0 " + stack.typeId + " 1"
    : "replaceitem entity @s " + slotName + " 0 air";
  return safe(() => {
    guard.runCommand(command);
    return true;
  }, false);
}

function itemName(stack) {
  if (!stack) return "empty";
  const raw = stack.nameTag || stack.typeId.replace(/^minecraft:/, "").replace(/_/g, " ");
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

// --------------------------------------------------------------------------
// Registry.  Entity references are cheap to hold but go stale, so the registry
// stores ids and re-resolves through world.getEntity each time it is used.
// --------------------------------------------------------------------------
/** @type {Map<string, object>} entity id -> volatile per-bodyguard state */
const guards = new Map();
/** Round-robin cursor over guards.keys(). */
let cursor = 0;
/** player id -> last tick they summoned from a Contract. */
const summonCooldowns = new Map();
/** entity id -> tick of the last low-health warning sent to the owner. */
const warnedAt = new Map();
/** owner name -> Set of bodyguard entity ids.  Keeps hot events O(detail). */
const ownerIndex = new Map();
/** player id -> tick of their last squad-wide reaction, to throttle hot events. */
const reactionAt = new Map();
/** player id -> tick of the last Contract action, to de-duplicate double fires. */
const contractAt = new Map();
/** player id -> tick they last used a gold ingot; a strong hint about who hired. */
const goldUseAt = new Map();

function state(id) {
  let entry = guards.get(id);
  if (!entry) {
    entry = {
      id,
      lastLocation: undefined,
      stuckCount: 0,
      combatUntil: 0,
      lastMeleeHit: 0,
      comboTarget: undefined,
      comboCount: 0,
      comboAt: 0,
      specialReadyAt: 0,
      regenCounter: 0,
      gearCounter: 0,
      victoryPending: false,
      killedAt: 0,
      ranged: false,
      alertedAt: 0,
      rangedCheckAt: 0,
      defendUntil: 0,
    };
    guards.set(id, entry);
  }
  return entry;
}

function forget(id) {
  guards.delete(id);
  warnedAt.delete(id);
  for (const set of ownerIndex.values()) set.delete(id);
}

function indexOwner(name, id) {
  if (!name) return;
  let set = ownerIndex.get(name);
  if (!set) {
    set = new Set();
    ownerIndex.set(name, set);
  }
  set.add(id);
}

/** True at most once per `ticks`; used to de-duplicate and throttle events. */
function gate(map, key, ticks) {
  const now = system.currentTick;
  const last = map.get(key);
  if (last !== undefined && now - last < ticks) return false;
  map.set(key, now);
  return true;
}

function resolve(id) {
  const entity = safe(() => world.getEntity(id), undefined);
  return alive(entity) ? entity : undefined;
}

function track(entity) {
  if (!alive(entity) || entity.typeId !== ENTITY_ID) return;
  state(entity.id);
  indexOwner(safe(() => entity.getDynamicProperty("bg:ownerName"), undefined), entity.id);
}

// --------------------------------------------------------------------------
// Ownership.  1.21.0 has no scripting API for an entity's engine-side owner,
// so the engine owner is established by a real tame interaction (gold ingot)
// and the script records the same player at that moment.  Player entity ids
// are not stable between sessions, so the name is the durable key and the id
// is a fast path that is refreshed whenever it goes stale.
// --------------------------------------------------------------------------
function setOwner(guard, player) {
  safe(() => guard.setDynamicProperty("bg:ownerId", player.id));
  safe(() => guard.setDynamicProperty("bg:ownerName", player.name));
  indexOwner(player.name, guard.id);
}

function ownerNameOf(guard) {
  return safe(() => guard.getDynamicProperty("bg:ownerName"), undefined);
}

function ownerOf(guard) {
  const name = ownerNameOf(guard);
  if (!name) return undefined;
  const id = safe(() => guard.getDynamicProperty("bg:ownerId"), undefined);
  const players = world.getAllPlayers();
  if (id) {
    for (const player of players) {
      if (player.id === id) return player;
    }
  }
  for (const player of players) {
    if (player.name === name) {
      safe(() => guard.setDynamicProperty("bg:ownerId", player.id));
      return player;
    }
  }
  return undefined;
}

function isOwner(guard, player) {
  return ownerNameOf(guard) === player.name;
}

function guardsOf(player) {
  const owned = [];
  const ids = ownerIndex.get(player.name);
  if (!ids || !ids.size) return owned;
  for (const id of Array.from(ids)) {
    const guard = resolve(id);
    if (!guard) {
      ids.delete(id);
      continue;
    }
    if (isOwner(guard, player)) owned.push(guard);
    else ids.delete(id);
  }
  return owned;
}

// --------------------------------------------------------------------------
// Mode / tier / name
// --------------------------------------------------------------------------
function modeOf(guard) {
  const value = safe(() => guard.getDynamicProperty("bg:mode"), MODE_FOLLOW);
  return typeof value === "number" && value >= 0 && value < MODES.length ? value : MODE_FOLLOW;
}

function tierOf(guard) {
  const value = safe(() => guard.getDynamicProperty("bg:tier"), 0);
  return typeof value === "number" && value >= 0 && value < TIER_NAMES.length ? value : 0;
}

function codenameOf(guard) {
  let name = safe(() => guard.getDynamicProperty("bg:codename"), undefined);
  if (typeof name === "string" && name.length) return name;
  // Deterministic pick so the same bodyguard keeps its name across reloads
  // even if the property write failed.
  let hash = 0;
  for (const ch of guard.id) hash = (hash * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  name = CODENAMES[hash % CODENAMES.length];
  safe(() => guard.setDynamicProperty("bg:codename", name));
  return name;
}

function refreshName(guard) {
  const mode = MODES[modeOf(guard)];
  const tier = tierOf(guard);
  const badge = tier > 0 ? " §8[" + TIER_NAMES[tier] + "]" : "";
  safe(() => {
    guard.nameTag = "§f" + codenameOf(guard) + badge + " §8| " + mode.color + mode.label;
  });
}

function setMode(guard, index, player) {
  const mode = MODES[index];
  if (!mode) return;
  safe(() => guard.triggerEvent(mode.event));
  safe(() => guard.setDynamicProperty("bg:mode", index));

  if (index === MODE_STAY || index === MODE_GUARD) {
    safe(() => guard.setDynamicProperty("bg:anchor", { ...guard.location }));
    if (index === MODE_GUARD && safe(() => guard.getDynamicProperty("bg:radius"), undefined) === undefined) {
      safe(() => guard.setDynamicProperty("bg:radius", CONFIG.guard.defaultRadius));
    }
  }

  refreshName(guard);
  particle(guard, "bg:alert_ping", 2.1);
  playSound(guard, "random.orb", 0.5, index === MODE_AGGRESSIVE ? 0.8 : 1.4);
  if (player) actionBar(player, "§7" + codenameOf(guard) + ": " + mode.color + mode.label);
}

function anchorOf(guard) {
  const anchor = safe(() => guard.getDynamicProperty("bg:anchor"), undefined);
  if (anchor && typeof anchor === "object" && typeof anchor.x === "number") return anchor;
  return undefined;
}

function radiusOf(guard) {
  const value = safe(() => guard.getDynamicProperty("bg:radius"), CONFIG.guard.defaultRadius);
  return typeof value === "number" ? value : CONFIG.guard.defaultRadius;
}

// --------------------------------------------------------------------------
// Gear
// --------------------------------------------------------------------------
function armorPoints(stack) {
  if (!stack) return 0;
  const id = stack.typeId.replace(/^minecraft:/, "");
  const parts = id.split("_");
  if (parts.length < 2) return 0;
  const material = parts[0];
  const piece = parts[parts.length - 1];
  const table = ARMOR_POINTS[material];
  if (!table) return 0;
  const slot =
    piece === "helmet" || piece === "cap"
      ? "Head"
      : piece === "chestplate" || piece === "tunic"
      ? "Chest"
      : piece === "leggings" || piece === "pants"
      ? "Legs"
      : piece === "boots"
      ? "Feet"
      : undefined;
  return slot && table[slot] ? table[slot] : 0;
}

function recomputeTier(guard) {
  const equippable = getEquippable(guard);
  let points = 0;
  if (equippable) {
    for (const slot of ARMOR_SLOTS) {
      points += armorPoints(safe(() => equippable.getEquipment(slot), undefined));
    }
  }
  let tier = 0;
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (points >= TIER_THRESHOLDS[i]) {
      tier = i;
      break;
    }
  }
  const previous = tierOf(guard);
  if (tier !== previous) {
    // Preserve the health fraction so a gear upgrade never heals to full and
    // a downgrade never instantly kills.
    const health = getHealth(guard);
    const fraction = health && health.effectiveMax > 0 ? health.currentValue / health.effectiveMax : 1;
    safe(() => guard.triggerEvent("bg:set_tier_" + tier));
    safe(() => guard.setDynamicProperty("bg:tier", tier));
    system.runTimeout(() => {
      if (!alive(guard)) return;
      const updated = getHealth(guard);
      if (updated) {
        safe(() => updated.setCurrentValue(Math.max(1, Math.round(updated.effectiveMax * fraction))));
      }
      refreshName(guard);
    }, 2);
    playSound(guard, "armor.equip_generic", 0.8, 1);
  }
  return tier;
}

function weaponBonus(guard) {
  const equippable = getEquippable(guard);
  if (!equippable) return 0;
  const held = safe(() => equippable.getEquipment(EquipmentSlot.Mainhand), undefined);
  if (!held) return 0;
  return WEAPON_BONUS[held.typeId] || 0;
}

function heldIsRanged(guard) {
  const equippable = getEquippable(guard);
  if (!equippable) return false;
  const held = safe(() => equippable.getEquipment(EquipmentSlot.Mainhand), undefined);
  return !!held && RANGED_WEAPONS.indexOf(held.typeId) >= 0;
}

function offhandIsRanged(guard) {
  const equippable = getEquippable(guard);
  if (!equippable) return false;
  const off = safe(() => equippable.getEquipment(EquipmentSlot.Offhand), undefined);
  return !!off && RANGED_WEAPONS.indexOf(off.typeId) >= 0;
}

/** Swap main hand and off hand.  Used to draw or holster a bow. */
function swapHands(guard) {
  const equippable = getEquippable(guard);
  if (!equippable) return false;
  const main = safe(() => equippable.getEquipment(EquipmentSlot.Mainhand), undefined);
  const off = safe(() => equippable.getEquipment(EquipmentSlot.Offhand), undefined);
  const ok =
    setEquipment(guard, EquipmentSlot.Mainhand, off) &&
    setEquipment(guard, EquipmentSlot.Offhand, main);
  if (ok) playSound(guard, "armor.equip_generic", 0.6, 1.3);
  return ok;
}

function setRanged(guard, on) {
  const entry = state(guard.id);
  if (entry.ranged === on) return;
  entry.ranged = on;
  safe(() => guard.triggerEvent(on ? "bg:ranged_on" : "bg:ranged_off"));
}

/**
 * Keep the ranged component group in sync with what is actually in the
 * bodyguard's hands.  A bow in the main hand means it should be allowed to
 * shoot; anything else means melee only.
 */
function syncRangedGroup(guard) {
  setRanged(guard, heldIsRanged(guard));
}

// --------------------------------------------------------------------------
// Combat
// --------------------------------------------------------------------------
function markCombat(guard, entry) {
  entry.combatUntil = system.currentTick + CONFIG.combat.memory * 20;
  entry.victoryPending = true;
}

function inCombat(entry) {
  return entry.combatUntil > system.currentTick;
}

function hostilesNear(entity, radius) {
  return safe(
    () =>
      entity.dimension.getEntities({
        location: entity.location,
        maxDistance: radius,
        families: ["monster"],
        excludeFamilies: ["player", "bodyguard", "villager", "irongolem"],
      }),
    []
  );
}

function knockback(target, from, strength, lift) {
  const dx = target.location.x - from.location.x;
  const dz = target.location.z - from.location.z;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  safe(() => target.applyKnockback(dx / length, dz / length, strength, lift));
}

function onMeleeLanded(guard, victim) {
  const entry = state(guard.id);
  const tier = tierOf(guard);
  const now = system.currentTick;
  markCombat(guard, entry);
  entry.lastMeleeHit = now;

  // Combo tracking: consecutive hits on the same victim escalate.
  if (entry.comboTarget === victim.id && now - entry.comboAt <= CONFIG.combat.comboWindow) {
    entry.comboCount += 1;
  } else {
    entry.comboTarget = victim.id;
    entry.comboCount = 1;
  }
  entry.comboAt = now;

  const base = 5 + tier * 1.75 + weaponBonus(guard);
  let bonus = 0;

  const critChance = CONFIG.combat.critChance + tier * CONFIG.combat.critPerTier;
  const crit = Math.random() < critChance;
  if (crit) {
    bonus += base * CONFIG.combat.critMultiplier;
    particle(victim, "minecraft:critical_hit_emitter", 1.0);
    playSound(guard, "random.anvil_land", 0.35, 1.9);
  }

  const finisher = entry.comboCount >= CONFIG.combat.comboFinisher;
  if (finisher) {
    bonus += base * CONFIG.combat.comboBonus;
    entry.comboCount = 0;
    particle(victim, "bg:guard_slam", 0.1);
    playSound(guard, "mob.irongolem.throw", 0.7, 1.1);
  }

  if (bonus > 0) {
    safe(() =>
      victim.applyDamage(Math.max(1, Math.round(bonus)), {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: guard,
      })
    );
  }

  const strength =
    CONFIG.combat.knockbackBase + tier * CONFIG.combat.knockbackPerTier + (finisher ? 0.45 : 0);
  knockback(victim, guard, strength, finisher ? 0.42 : 0.16);

  playSound(guard, "mob.villager.hit", 0.4, 1.35 + Math.random() * 0.2);
}

function tryGuardBreaker(guard, entry) {
  const now = system.currentTick;
  if (now < entry.specialReadyAt) return;
  if (!inCombat(entry)) return;

  const nearby = hostilesNear(guard, CONFIG.combat.specialRadius);
  if (nearby.length < CONFIG.combat.specialMinTargets) return;

  entry.specialReadyAt = now + CONFIG.combat.specialCooldown * 20;
  safe(() => guard.triggerEvent("bg:special_start"));
  playSound(guard, "mob.evocation_illager.prepare_attack", 0.8, 1.2);

  // The windup is 0.6 s of animation; the blow lands 12 ticks in.
  system.runTimeout(() => {
    if (!alive(guard)) return;
    const tier = tierOf(guard);
    const damage = CONFIG.combat.specialDamage + tier * 2;
    particle(guard, "bg:guard_slam", 0.15);
    playSound(guard, "mob.irongolem.throw", 1, 0.85);
    for (const victim of hostilesNear(guard, CONFIG.combat.specialRadius)) {
      safe(() =>
        victim.applyDamage(damage, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: guard,
        })
      );
      knockback(victim, guard, 1.1, 0.55);
    }
  }, 12);
}

function raiseGuard(guard, entry) {
  const now = system.currentTick;
  if (entry.defendUntil && now < entry.defendUntil) return;
  entry.defendUntil = now + 40;
  safe(() => guard.triggerEvent("bg:defend_start"));
  safe(() => guard.addEffect("resistance", 40, { amplifier: 1, showParticles: false }));
  playSound(guard, "armor.equip_iron", 0.6, 0.9);
}

function dodge(guard, attacker) {
  // Step sideways relative to the attacker - reads as a dodge and often breaks
  // the attacker's swing arc.
  const dx = guard.location.x - attacker.location.x;
  const dz = guard.location.z - attacker.location.z;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  const side = Math.random() < 0.5 ? 1 : -1;
  safe(() => guard.applyKnockback((-dz / length) * side, (dx / length) * side, 0.55, 0.12));
  playSound(guard, "mob.wolf.step", 0.5, 1.6);
}

// --------------------------------------------------------------------------
// Recovery: teleport-back, un-stick, return to post
// --------------------------------------------------------------------------
function escortSpot(owner) {
  // A step behind the owner, so it never lands on top of them.
  const view = safe(() => owner.getViewDirection(), { x: 0, y: 0, z: 1 });
  return {
    x: owner.location.x - view.x * 1.6 + (Math.random() - 0.5),
    y: owner.location.y,
    z: owner.location.z - view.z * 1.6 + (Math.random() - 0.5),
  };
}

function recall(guard, owner, quiet) {
  const target = escortSpot(owner);
  const moved = safe(
    () => guard.tryTeleport(target, { dimension: owner.dimension, checkForBlocks: true }),
    false
  );
  if (!moved) {
    safe(() => guard.teleport(owner.location, { dimension: owner.dimension }));
  }
  if (!quiet) {
    particle(guard, "bg:alert_ping", 1.0);
    playSound(guard, "mob.endermen.portal", 0.35, 1.4);
  }
  const entry = state(guard.id);
  entry.stuckCount = 0;
  entry.lastLocation = { ...guard.location };
}

function returnToPost(guard, anchor) {
  const moved = safe(() => guard.tryTeleport(anchor, { checkForBlocks: true }), false);
  if (!moved) safe(() => guard.teleport(anchor));
  particle(guard, "bg:alert_ping", 1.0);
  const entry = state(guard.id);
  entry.stuckCount = 0;
  entry.lastLocation = { ...guard.location };
}

// --------------------------------------------------------------------------
// Per-bodyguard update.  Runs at roughly 1.25 Hz per bodyguard.
// --------------------------------------------------------------------------
function updateGuard(guard) {
  // An unhired recruit has no owner and no orders - leave it alone.
  if (!ownerNameOf(guard)) return;

  const entry = state(guard.id);
  const now = system.currentTick;
  const mode = modeOf(guard);
  const owner = ownerOf(guard);

  // Keep the name badge in sync; a reload or a name tag can clear it.
  if (!guard.nameTag || guard.nameTag.indexOf("§8|") < 0) refreshName(guard);

  syncRangedGroup(guard);

  // Gear can also change outside the command panel - a command, another
  // add-on, or a pickup - so the tier is re-derived on a slow cadence rather
  // than only when the panel is used.
  entry.gearCounter = (entry.gearCounter + 1) % 8;
  if (entry.gearCounter === 0) recomputeTier(guard);

  // --- Movement watchdog -------------------------------------------------
  const here = guard.location;
  const moved = entry.lastLocation ? dist(entry.lastLocation, here) : 99;
  entry.lastLocation = { ...here };

  if (owner && ESCORT_MODES.indexOf(mode) >= 0) {
    const sameDimension = owner.dimension.id === guard.dimension.id;
    const away = sameDimension ? dist(owner.location, here) : Infinity;

    if (away > CONFIG.follow.teleportDistance) {
      recall(guard, owner, false);
    } else if (away > CONFIG.follow.stuckDistance && moved < 0.4) {
      // It should be closing the gap but has not moved: pathing is blocked.
      entry.stuckCount += 1;
      if (entry.stuckCount >= CONFIG.follow.stuckChecks) recall(guard, owner, true);
    } else {
      entry.stuckCount = 0;
    }
  } else if (mode === MODE_STAY || mode === MODE_GUARD) {
    const anchor = anchorOf(guard);
    if (anchor) {
      const leash = (mode === MODE_GUARD ? radiusOf(guard) : 3) + CONFIG.guard.leash;
      const drift = dist2d(anchor, here);
      if (drift > leash * 2) {
        returnToPost(guard, anchor);
      } else if (drift > leash && !inCombat(entry)) {
        // Out of position after a fight: walk it back rather than snapping.
        entry.stuckCount += 1;
        if (entry.stuckCount >= CONFIG.follow.stuckChecks) returnToPost(guard, anchor);
      } else {
        entry.stuckCount = 0;
      }
    }
  }

  // --- Combat beats ------------------------------------------------------
  if (inCombat(entry)) {
    tryGuardBreaker(guard, entry);

    // A melee bodyguard carrying a bow in its off hand draws it when the fight
    // has stalled out of reach, and holsters it again once things close in.
    if (offhandIsRanged(guard) && now - entry.lastMeleeHit > 100 && now >= entry.rangedCheckAt) {
      entry.rangedCheckAt = now + 40;
      const targets = hostilesNear(guard, 16);
      let nearest = Infinity;
      for (const target of targets) nearest = Math.min(nearest, dist(target.location, here));
      if (nearest > CONFIG.combat.rangedSwapDistance && nearest < Infinity) {
        if (swapHands(guard)) syncRangedGroup(guard);
      }
    } else if (heldIsRanged(guard) && now - entry.lastMeleeHit < 40) {
      if (swapHands(guard)) syncRangedGroup(guard);
    }
  } else {
    // --- Out of combat ---------------------------------------------------
    if (entry.victoryPending && now - entry.killedAt < 200 && entry.killedAt > 0) {
      entry.victoryPending = false;
      safe(() => guard.triggerEvent("bg:victory_start"));
      playSound(guard, "random.levelup", 0.4, 1.6);
    } else if (entry.victoryPending) {
      entry.victoryPending = false;
    }

    // A drawn bow goes back to the off hand once the fight is over, but only
    // if there is a melee weapon waiting there to take its place.
    if (heldIsRanged(guard)) {
      const equippable = getEquippable(guard);
      const off = equippable && safe(() => equippable.getEquipment(EquipmentSlot.Offhand), undefined);
      if (off && WEAPON_BONUS[off.typeId] && swapHands(guard)) syncRangedGroup(guard);
    }

    // Slow regeneration, roughly one point every three seconds.
    entry.regenCounter = (entry.regenCounter + 1) % 4;
    if (entry.regenCounter === 0 && now > entry.combatUntil + CONFIG.regen.delay * 20) {
      const health = getHealth(guard);
      if (health && health.currentValue < health.effectiveMax) {
        safe(() =>
          health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + CONFIG.regen.amount))
        );
      }
    }
  }
}

// --------------------------------------------------------------------------
// Main loop
// --------------------------------------------------------------------------
let reconcileAt = 0;

function reconcile() {
  const seen = new Set();
  ownerIndex.clear();
  const dimensions = new Set();
  for (const player of world.getAllPlayers()) dimensions.add(player.dimension);
  for (const dimension of dimensions) {
    const found = safe(() => dimension.getEntities({ type: ENTITY_ID }), []);
    for (const guard of found) {
      seen.add(guard.id);
      state(guard.id);
      indexOwner(safe(() => guard.getDynamicProperty("bg:ownerName"), undefined), guard.id);
    }
  }
  // Drop entries whose entity is gone; anything in an unloaded chunk is kept
  // because world.getEntity still resolves it and it may simply be far away.
  for (const id of Array.from(guards.keys())) {
    if (seen.has(id)) continue;
    const guard = resolve(id);
    if (!guard) forget(id);
    else indexOwner(safe(() => guard.getDynamicProperty("bg:ownerName"), undefined), id);
  }
}

system.runInterval(() => {
  const now = system.currentTick;
  if (now >= reconcileAt) {
    reconcileAt = now + BUDGET.reconcile;
    safe(reconcile);
  }

  const ids = Array.from(guards.keys());
  if (!ids.length) return;
  if (cursor >= ids.length) cursor = 0;

  const count = Math.min(BUDGET.perTick, ids.length);
  for (let i = 0; i < count; i++) {
    const id = ids[(cursor + i) % ids.length];
    const guard = resolve(id);
    if (!guard) {
      forget(id);
      continue;
    }
    safe(() => updateGuard(guard));
  }
  cursor = (cursor + count) % ids.length;
}, BUDGET.interval);

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------
world.afterEvents.entitySpawn.subscribe((event) => {
  track(event.entity);
});

world.afterEvents.entityLoad.subscribe((event) => {
  track(event.entity);
});

world.afterEvents.entityRemove.subscribe((event) => {
  if (event.typeId === ENTITY_ID) forget(event.removedEntityId);
});

/** Hiring: minecraft:tameable fires bg:on_bind once the engine sets the owner. */
world.afterEvents.dataDrivenEntityTrigger.subscribe(
  (event) => {
    const guard = event.entity;
    if (!alive(guard) || guard.typeId !== ENTITY_ID) return;

    if (event.eventId === "bg:on_bind") {
      system.run(() => safe(() => completeHire(guard)));
      return;
    }

    if (event.eventId === "bg:command_panel") {
      const player = commandingPlayer(guard, 8);
      if (!player) return;
      if (!isOwner(guard, player)) {
        actionBar(
          player,
          "§c" + codenameOf(guard) + " only takes orders from " + (ownerNameOf(guard) || "someone else") + "."
        );
        return;
      }
      if (!gate(contractAt, player.id, 10)) return;
      system.run(() => openGuardPanel(player, guard));
    }
  },
  { entityTypes: [ENTITY_ID] }
);

/**
 * Runs the moment minecraft:tameable reports a successful hire.  The engine
 * has already set its own owner reference by this point; this records the same
 * player script-side and puts the bodyguard into service.
 */
function completeHire(guard) {
  if (!alive(guard)) return;
  const hirer = resolveHirer(guard);
  if (hirer) setOwner(guard, hirer);
  safe(() => guard.setDynamicProperty("bg:summonedBy", undefined));
  state(guard.id);
  safe(() => guard.setDynamicProperty("bg:mode", MODE_FOLLOW));
  recomputeTier(guard);
  refreshName(guard);
  particle(guard, "bg:oath_seal", 1.0);
  playSound(guard, "random.levelup", 0.7, 1.2);
  if (!hirer) return;
  actionBar(hirer, "§6" + codenameOf(guard) + " §7is now your bodyguard.");
  safe(() =>
    hirer.sendMessage(
      "§6[Bodyguard] §f" +
        codenameOf(guard) +
        " §7reporting for duty. Hold a §eBodyguard Contract§7 and tap them to give orders."
    )
  );
}

/**
 * Work out which player just hired this recruit.
 *
 * In order of confidence:
 *   1. the player who summoned it with a Contract (recorded at spawn time)
 *   2. a player who used a gold ingot nearby in the last second
 *   3. the nearest player who is facing it
 *
 * Only 3 applies to a recruit spawned from a creative spawn egg, which is why
 * the Contract is the recommended route in multiplayer.
 */
function resolveHirer(guard) {
  const nearby = safe(
    () => guard.dimension.getPlayers({ location: guard.location, maxDistance: 8 }),
    []
  );
  if (!nearby.length) return undefined;

  const summoner = safe(() => guard.getDynamicProperty("bg:summonedBy"), undefined);
  if (summoner) {
    for (const player of nearby) {
      if (player.id === summoner) return player;
    }
  }

  const now = system.currentTick;
  let recent;
  let recentAt = -Infinity;
  for (const player of nearby) {
    const used = goldUseAt.get(player.id);
    if (used !== undefined && now - used <= 20 && used > recentAt) {
      recentAt = used;
      recent = player;
    }
  }
  if (recent) return recent;

  return nearestLookingPlayer(guard, 6);
}

/** The player giving orders: the owner if they are in range, else whoever is. */
function commandingPlayer(guard, radius) {
  const nearby = safe(
    () => guard.dimension.getPlayers({ location: guard.location, maxDistance: radius }),
    []
  );
  const name = ownerNameOf(guard);
  if (name) {
    let best;
    let bestDistance = Infinity;
    for (const player of nearby) {
      if (player.name !== name) continue;
      const away = dist(player.location, guard.location);
      if (away < bestDistance) {
        bestDistance = away;
        best = player;
      }
    }
    if (best) return best;
  }
  return nearestLookingPlayer(guard, radius);
}

function nearestLookingPlayer(entity, radius) {
  const candidates = safe(
    () => entity.dimension.getPlayers({ location: entity.location, maxDistance: radius }),
    []
  );
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Prefer whoever is actually facing the bodyguard - that is the one who
  // interacted with it.
  let best;
  let bestScore = -Infinity;
  for (const player of candidates) {
    const view = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 0 });
    const dx = entity.location.x - player.location.x;
    const dy = entity.location.y - player.location.y;
    const dz = entity.location.z - player.location.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const dot = (view.x * dx + view.y * dy + view.z * dz) / length;
    const score = dot * 2 - length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

world.afterEvents.entityHitEntity.subscribe((event) => {
  const attacker = event.damagingEntity;
  const victim = event.hitEntity;
  if (!alive(attacker) || !alive(victim)) return;

  if (attacker.typeId === ENTITY_ID) {
    // Absolute guarantee: a bodyguard never damages its own owner.  The AI
    // filters already prevent it from targeting players, this is the backstop.
    if (victim.typeId === "minecraft:player" && isOwner(attacker, victim)) {
      const health = getHealth(victim);
      if (health) {
        safe(() => health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 4)));
      }
      return;
    }
    safe(() => onMeleeLanded(attacker, victim));
    return;
  }

  // The owner punching a hostile: the escort joins in.
  if (attacker.typeId === "minecraft:player") {
    if (!gate(reactionAt, attacker.id, 10)) return;
    for (const guard of guardsOf(attacker)) {
      markCombat(guard, state(guard.id));
    }
  }
});

world.afterEvents.entityHurt.subscribe((event) => {
  const victim = event.hurtEntity;
  if (!alive(victim)) return;
  const source = event.damageSource;
  const attacker = source ? source.damagingEntity : undefined;

  if (victim.typeId === ENTITY_ID) {
    const entry = state(victim.id);
    markCombat(victim, entry);

    const health = getHealth(victim);
    if (health && health.effectiveMax > 0) {
      const fraction = health.currentValue / health.effectiveMax;
      if (fraction <= CONFIG.combat.defendHealth) raiseGuard(victim, entry);

      if (fraction <= 0.3 && gate(warnedAt, victim.id, 200)) {
        const owner = ownerOf(victim);
        if (owner) actionBar(owner, "§c" + codenameOf(victim) + " is badly hurt!");
      }
    }

    if (attacker && alive(attacker) && event.damage >= CONFIG.combat.dodgeDamage) {
      safe(() => dodge(victim, attacker));
    }
    return;
  }

  // The owner is under attack: every bodyguard reacts, and any that has fallen
  // behind is pulled back into the fight.
  if (victim.typeId === "minecraft:player") {
    if (!gate(reactionAt, victim.id, 10)) return;
    const owned = guardsOf(victim);
    if (!owned.length) return;
    for (const guard of owned) {
      const entry = state(guard.id);
      markCombat(guard, entry);
      if (modeOf(guard) === MODE_PASSIVE) continue;

      const now = system.currentTick;
      if (now - entry.alertedAt > 40) {
        entry.alertedAt = now;
        particle(guard, "bg:alert_ping", 2.1);
        playSound(guard, "mob.wolf.growl", 0.55, 0.85);
      }
      // Close the gap fast - this is what makes it feel like a bodyguard.
      safe(() => guard.addEffect("speed", 80, { amplifier: 1, showParticles: false }));
      if (
        guard.dimension.id !== victim.dimension.id ||
        dist(guard.location, victim.location) > 14
      ) {
        if (ESCORT_MODES.indexOf(modeOf(guard)) >= 0) recall(guard, victim, false);
      }
    }
  }
});

world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  const killer = event.damageSource ? event.damageSource.damagingEntity : undefined;

  if (alive(killer) && killer.typeId === ENTITY_ID) {
    const entry = state(killer.id);
    entry.killedAt = system.currentTick;
    entry.comboTarget = undefined;
    entry.comboCount = 0;
  }

  if (!dead || dead.typeId !== ENTITY_ID) return;

  // Hand the gear back to the world rather than deleting it.
  const equippable = getEquippable(dead);
  if (equippable) {
    const slots = [EquipmentSlot.Mainhand, EquipmentSlot.Offhand].concat(ARMOR_SLOTS);
    for (const slot of slots) {
      const stack = safe(() => equippable.getEquipment(slot), undefined);
      if (stack) safe(() => dead.dimension.spawnItem(stack, dead.location));
    }
  }
  safe(() => dead.dimension.spawnParticle("bg:guard_slam", dead.location));

  const name = safe(() => dead.getDynamicProperty("bg:codename"), "Your bodyguard");
  const ownerName = ownerNameOf(dead);
  if (ownerName) {
    for (const player of world.getAllPlayers()) {
      if (player.name === ownerName) {
        safe(() => player.sendMessage("§c[Bodyguard] §f" + name + " §7has fallen."));
      }
    }
  }
  forget(dead.id);
});

world.afterEvents.playerLeave.subscribe((event) => {
  summonCooldowns.delete(event.playerId);
  reactionAt.delete(event.playerId);
  contractAt.delete(event.playerId);
  goldUseAt.delete(event.playerId);
});

// --- Contract: summon a recruit on a block, open the squad panel in the air --
world.afterEvents.itemUseOn.subscribe((event) => {
  const player = event.source;
  const stack = event.itemStack;
  if (!player || !stack || stack.typeId !== CONTRACT_ID) return;
  if (!gate(contractAt, player.id, 10)) return;
  const block = event.block;
  const face = event.blockFace;
  system.run(() => safe(() => summonRecruit(player, block, face)));
});

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const stack = event.itemStack;
  if (!player || !stack) return;
  if (stack.typeId === "minecraft:gold_ingot") {
    goldUseAt.set(player.id, system.currentTick);
    return;
  }
  if (stack.typeId !== CONTRACT_ID) return;
  if (!gate(contractAt, player.id, 10)) return;
  // Looking straight at one of your own bodyguards opens its panel; otherwise
  // the squad overview.  minecraft:interact covers the direct-tap case, this
  // covers tapping from a short distance.
  const hit = safe(() => player.getEntitiesFromViewDirection({ maxDistance: 10 }), []);
  for (const entry of hit) {
    const target = entry.entity;
    if (alive(target) && target.typeId === ENTITY_ID && isOwner(target, player)) {
      system.run(() => openGuardPanel(player, target));
      return;
    }
  }
  system.run(() => openSquadPanel(player));
});

const FACE_OFFSET = {
  Up: { x: 0, y: 1, z: 0 },
  Down: { x: 0, y: -1, z: 0 },
  North: { x: 0, y: 0, z: -1 },
  South: { x: 0, y: 0, z: 1 },
  East: { x: 1, y: 0, z: 0 },
  West: { x: -1, y: 0, z: 0 },
};

function summonRecruit(player, block, face) {
  const now = system.currentTick;
  const last = summonCooldowns.get(player.id) || -99999;
  if (now - last < CONFIG.summonCooldown * 20) return;

  const owned = guardsOf(player);
  if (owned.length >= CONFIG.maxPerPlayer) {
    actionBar(player, "§cYou already command " + owned.length + " bodyguards.");
    playSound(player, "note.bass", 0.6, 0.7);
    return;
  }
  summonCooldowns.set(player.id, now);

  const offset = FACE_OFFSET[face] || FACE_OFFSET.Up;
  const spot = {
    x: block.location.x + 0.5 + offset.x,
    y: block.location.y + (offset.y >= 0 ? offset.y : 0),
    z: block.location.z + 0.5 + offset.z,
  };
  const recruit = safe(() => player.dimension.spawnEntity(ENTITY_ID, spot), undefined);
  if (!recruit) return;
  state(recruit.id);
  safe(() => recruit.setDynamicProperty("bg:summonedBy", player.id));
  safe(() => {
    recruit.nameTag = "§7Bodyguard Recruit";
  });
  particle(recruit, "bg:oath_seal", 1.0);
  playSound(recruit, "random.orb", 0.6, 1.0);
  safe(() =>
    player.sendMessage(
      "§6[Bodyguard] §7A recruit is waiting. Hold a §egold ingot§7 and tap them to hire."
    )
  );
  actionBar(player, "§7Tap the recruit with a §egold ingot§7 to hire.");
}

// --------------------------------------------------------------------------
// UI
// --------------------------------------------------------------------------
function statusLines(guard) {
  const health = getHealth(guard);
  const equippable = getEquippable(guard);
  const mode = MODES[modeOf(guard)];
  const tier = tierOf(guard);
  const main = equippable && safe(() => equippable.getEquipment(EquipmentSlot.Mainhand), undefined);
  const off = equippable && safe(() => equippable.getEquipment(EquipmentSlot.Offhand), undefined);
  return [
    "§7Mode: " + mode.color + mode.label,
    "§7Gear: §f" + TIER_NAMES[tier],
    "§7Health: §f" +
      (health ? Math.ceil(health.currentValue) + " / " + Math.ceil(health.effectiveMax) : "?"),
    "§7Main hand: §f" + itemName(main),
    "§7Off hand: §f" + itemName(off),
  ].join("\n");
}

function openGuardPanel(player, guard) {
  if (!alive(guard)) return;
  const form = new ActionFormData()
    .title("§l" + codenameOf(guard))
    .body(statusLines(guard) + "\n");

  for (const mode of MODES) {
    form.button(mode.color + mode.label);
  }
  form.button("§9Equipment");
  form.button("§9Rename");
  form.button("§9Come Here");
  form.button("§cDismiss");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (!alive(guard)) return;
      const index = response.selection;
      if (index < MODES.length) {
        setMode(guard, index, player);
        return;
      }
      switch (index - MODES.length) {
        case 0:
          openEquipmentPanel(player, guard);
          break;
        case 1:
          openRenamePanel(player, guard);
          break;
        case 2:
          recall(guard, player, false);
          actionBar(player, "§7" + codenameOf(guard) + " is on you.");
          break;
        case 3:
          openDismissPanel(player, guard);
          break;
      }
    })
    .catch(() => {});
}

function openSquadPanel(player) {
  const owned = guardsOf(player);
  if (!owned.length) {
    actionBar(player, "§7No bodyguards. Tap a block with the Contract to summon a recruit.");
    return;
  }
  const form = new ActionFormData()
    .title("§lYour Detail")
    .body("§7" + owned.length + " of " + CONFIG.maxPerPlayer + " bodyguards active.\n");

  for (const guard of owned) {
    const health = getHealth(guard);
    const mode = MODES[modeOf(guard)];
    const away =
      guard.dimension.id === player.dimension.id
        ? Math.round(dist(guard.location, player.location)) + "m"
        : "another dimension";
    form.button(
      "§f" +
        codenameOf(guard) +
        "\n" +
        mode.color +
        mode.label +
        " §8- §f" +
        (health ? Math.ceil(health.currentValue) : "?") +
        "hp §8- §7" +
        away
    );
  }
  form.button("§9Recall All");
  form.button("§9Set All Modes");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      const index = response.selection;
      if (index < owned.length) {
        openGuardPanel(player, owned[index]);
        return;
      }
      if (index === owned.length) {
        for (const guard of owned) {
          if (alive(guard)) recall(guard, player, true);
        }
        particle(player, "bg:alert_ping", 1.0);
        actionBar(player, "§7Detail recalled.");
        return;
      }
      openSquadModePanel(player, owned);
    })
    .catch(() => {});
}

function openSquadModePanel(player, owned) {
  const form = new ActionFormData().title("§lSet All Modes").body("§7Applies to every bodyguard.\n");
  for (const mode of MODES) form.button(mode.color + mode.label);
  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      for (const guard of owned) {
        if (alive(guard)) setMode(guard, response.selection, undefined);
      }
      actionBar(player, "§7Detail set to " + MODES[response.selection].label + ".");
    })
    .catch(() => {});
}

function slotForItem(stack) {
  if (!stack) return undefined;
  const id = stack.typeId.replace(/^minecraft:/, "");
  if (WEAPON_BONUS["minecraft:" + id] || RANGED_WEAPONS.indexOf("minecraft:" + id) >= 0) {
    return EquipmentSlot.Mainhand;
  }
  if (id === "shield") return EquipmentSlot.Offhand;
  const piece = id.split("_").pop();
  return SLOT_FOR_ARMOR[piece];
}

function openEquipmentPanel(player, guard) {
  const equippable = getEquippable(guard);
  if (!equippable) {
    actionBar(player, "§cEquipment is not available on this build.");
    return;
  }
  const held = safe(
    () => player.getComponent(EntityComponentTypes.Equippable).getEquipment(EquipmentSlot.Mainhand),
    undefined
  );
  const target = slotForItem(held);

  const form = new ActionFormData()
    .title("§lEquipment")
    .body(
      statusLines(guard) +
        "\n§7Head: §f" +
        itemName(equippable && safe(() => equippable.getEquipment(EquipmentSlot.Head), undefined)) +
        "\n§7Chest: §f" +
        itemName(equippable && safe(() => equippable.getEquipment(EquipmentSlot.Chest), undefined)) +
        "\n§7Legs: §f" +
        itemName(equippable && safe(() => equippable.getEquipment(EquipmentSlot.Legs), undefined)) +
        "\n§7Feet: §f" +
        itemName(equippable && safe(() => equippable.getEquipment(EquipmentSlot.Feet), undefined)) +
        "\n"
    );

  form.button(
    target ? "§aGive " + itemName(held) : "§8Hold gear to give it",
    undefined
  );
  form.button("§9Return All Gear");
  form.button("§9Back");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) {
        if (!target || !held) {
          actionBar(player, "§7Hold a sword, axe, bow, shield or armour piece first.");
          return;
        }
        giveGear(player, guard, held, target);
        openEquipmentPanel(player, guard);
      } else if (response.selection === 1) {
        returnGear(player, guard);
        openEquipmentPanel(player, guard);
      } else {
        openGuardPanel(player, guard);
      }
    })
    .catch(() => {});
}

function playerInventory(player) {
  return safe(() => player.getComponent(EntityComponentTypes.Inventory)?.container, undefined);
}

function giveGear(player, guard, stack, slot) {
  const equippable = getEquippable(guard);
  if (!equippable) return;

  const single = safe(() => {
    const copy = stack.clone();
    copy.amount = 1;
    return copy;
  }, undefined);
  if (!single) return;

  const previous = safe(() => equippable.getEquipment(slot), undefined);
  if (!setEquipment(guard, slot, single)) {
    actionBar(player, "§cThat does not fit there.");
    return;
  }

  // Take exactly one from the player, and hand back whatever was displaced.
  const inventory = playerInventory(player);
  const creative = safe(() => player.getGameMode(), undefined) === GameMode.creative;
  if (inventory && !creative) {
    safe(() => {
      const equip = player.getComponent(EntityComponentTypes.Equippable);
      const inHand = equip.getEquipment(EquipmentSlot.Mainhand);
      if (inHand && inHand.typeId === stack.typeId) {
        if (inHand.amount > 1) {
          inHand.amount -= 1;
          equip.setEquipment(EquipmentSlot.Mainhand, inHand);
        } else {
          equip.setEquipment(EquipmentSlot.Mainhand, undefined);
        }
      }
    });
  }
  if (previous) {
    if (inventory) {
      const leftover = safe(() => inventory.addItem(previous), previous);
      if (leftover) safe(() => player.dimension.spawnItem(leftover, player.location));
    } else {
      safe(() => player.dimension.spawnItem(previous, player.location));
    }
  }

  recomputeTier(guard);
  syncRangedGroup(guard);
  refreshName(guard);
  playSound(guard, "armor.equip_generic", 0.9, 1);
  particle(guard, "bg:oath_seal", 1.2);
  actionBar(player, "§a" + codenameOf(guard) + " equipped " + itemName(single) + ".");
}

function returnGear(player, guard) {
  const equippable = getEquippable(guard);
  if (!equippable) return;
  const inventory = playerInventory(player);
  let returned = 0;
  const slots = [EquipmentSlot.Mainhand, EquipmentSlot.Offhand].concat(ARMOR_SLOTS);
  for (const slot of slots) {
    const stack = safe(() => equippable.getEquipment(slot), undefined);
    if (!stack) continue;
    setEquipment(guard, slot, undefined);
    returned += 1;
    const leftover = inventory ? safe(() => inventory.addItem(stack), stack) : stack;
    if (leftover) safe(() => player.dimension.spawnItem(leftover, player.location));
  }
  recomputeTier(guard);
  syncRangedGroup(guard);
  refreshName(guard);
  actionBar(player, returned ? "§7Returned " + returned + " item(s)." : "§7Nothing to return.");
}

function openRenamePanel(player, guard) {
  new ModalFormData()
    .title("§lRename")
    .textField("§7Codename", codenameOf(guard), codenameOf(guard))
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const raw = String(response.formValues[0] || "").trim().slice(0, 24);
      if (!raw.length) return;
      safe(() => guard.setDynamicProperty("bg:codename", raw));
      refreshName(guard);
      actionBar(player, "§7Renamed to §f" + raw + "§7.");
    })
    .catch(() => {});
}

function openDismissPanel(player, guard) {
  new MessageFormData()
    .title("§lDismiss")
    .body("§7Dismiss " + codenameOf(guard) + "? Their gear is returned to you.")
    .button1("§cDismiss")
    .button2("§7Cancel")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection !== 0) return;
      if (!alive(guard)) return;
      returnGear(player, guard);
      particle(guard, "bg:oath_seal", 1.0);
      playSound(guard, "random.orb", 0.5, 0.7);
      const name = codenameOf(guard);
      forget(guard.id);
      safe(() => guard.remove());
      actionBar(player, "§7" + name + " has been dismissed.");
    })
    .catch(() => {});
}

// --------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      "§6[Bodyguard] §7v2.0.0 ready. Craft a §eBodyguard Contract§7 or grab the spawn egg from Creative."
    )
  );
});
