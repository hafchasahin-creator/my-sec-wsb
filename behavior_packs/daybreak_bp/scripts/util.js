/*
 * Daybreak - shared helpers.
 *
 * Everything that touches the script API goes through here so that a build
 * with a slightly different API surface degrades one feature instead of
 * killing the whole add-on. Anything cosmetic is wrapped in `safe`.
 */

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

/* ----------------------------------------------------------------- basics */

export function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function chance(probability) {
  return Math.random() < probability;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function weightedPick(entries) {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

export function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/* -------------------------------------------------------------- cosmetics */

export function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

export function sound(dimension, id, location, volume = 1, pitch = 1) {
  safe(() => dimension.playSound(id, location, { volume, pitch }));
}

export function playerSound(player, id, volume = 1, pitch = 1) {
  safe(() => player.playSound(id, { volume, pitch }));
}

export function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

export function title(player, text, subtitle, fadeIn = 5, stay = 40, fadeOut = 10) {
  safe(() =>
    player.onScreenDisplay.setTitle(text, {
      subtitle,
      fadeInDuration: fadeIn,
      stayDuration: stay,
      fadeOutDuration: fadeOut,
    })
  );
}

export function tell(player, text) {
  safe(() => player.sendMessage(text));
}

export function broadcast(text) {
  safe(() => world.sendMessage(text));
}

export function runCommand(dimension, command) {
  try {
    dimension.runCommand(command);
    return true;
  } catch {
    return false;
  }
}

export function addEffect(entity, id, ticks, amplifier = 0, particles = false) {
  const applied = safe(() => {
    entity.addEffect(id, ticks, { amplifier, showParticles: particles });
    return true;
  }, false);
  if (!applied) {
    safe(() =>
      entity.addEffect(`minecraft:${id}`, ticks, { amplifier, showParticles: particles })
    );
  }
}

/** Run a command as the player, falling back to a name-targeted command. */
export function playerCommand(player, command) {
  try {
    player.runCommand(command);
    return true;
  } catch {
    /* fall through */
  }
  return safe(() => {
    player.dimension.runCommand(command.replace(/@s/g, `"${player.name}"`));
    return true;
  }, false);
}

export function shake(player, intensity, seconds) {
  playerCommand(player, `camerashake add @s ${intensity} ${seconds} positional`);
}

export function pushFog(player, fogId, tag) {
  playerCommand(player, `fog @s push ${fogId} ${tag}`);
}

export function popFog(player, tag) {
  playerCommand(player, `fog @s remove ${tag}`);
}

/* ------------------------------------------------------------- inventory */

export const ARMOUR_SLOTS = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
];

export function equipment(entity) {
  return safe(() => entity.getComponent("minecraft:equippable"));
}

export function wornId(entity, slot) {
  const gear = equipment(entity);
  if (!gear) return undefined;
  return safe(() => gear.getEquipment(slot)?.typeId);
}

export function heldStack(player) {
  const gear = equipment(player);
  if (!gear) return undefined;
  return safe(() => gear.getEquipment(EquipmentSlot.Mainhand));
}

/** Burn durability off a worn item; unequips it when it breaks. */
export function wearDown(entity, slot, amount) {
  const gear = equipment(entity);
  if (!gear) return;
  safe(() => {
    const stack = gear.getEquipment(slot);
    if (!stack) return;
    const durability = stack.getComponent("minecraft:durability");
    if (!durability) return;
    const next = durability.damage + amount;
    if (next >= durability.maxDurability) {
      gear.setEquipment(slot, undefined);
      playerSound(entity, "random.break", 1, 1);
      return;
    }
    durability.damage = next;
    gear.setEquipment(slot, stack);
  });
}

/** Remove `count` of whatever the player is holding. */
export function consumeHeld(player, count = 1) {
  const gear = equipment(player);
  if (!gear) return;
  safe(() => {
    const stack = gear.getEquipment(EquipmentSlot.Mainhand);
    if (!stack) return;
    if (stack.amount <= count) {
      gear.setEquipment(EquipmentSlot.Mainhand, undefined);
    } else {
      stack.amount -= count;
      gear.setEquipment(EquipmentSlot.Mainhand, stack);
    }
  });
}

export function inventoryOf(player) {
  return safe(() => player.getComponent("minecraft:inventory")?.container);
}

/** True when the player is carrying any of the given item ids. */
export function carriesAny(player, ids) {
  const container = inventoryOf(player);
  if (!container) return false;
  return safe(() => {
    for (let slot = 0; slot < container.size; slot++) {
      const stack = container.getItem(slot);
      if (stack && ids.includes(stack.typeId)) return true;
    }
    return false;
  }, false);
}

/** Highest access level the player is carrying, or 0. */
export function bestCardLevel(player, cardTable) {
  const container = inventoryOf(player);
  if (!container) return 0;
  return safe(() => {
    let best = 0;
    for (let slot = 0; slot < container.size; slot++) {
      const stack = container.getItem(slot);
      if (!stack) continue;
      const level = cardTable[stack.typeId];
      if (level && level > best) best = level;
    }
    return best;
  }, 0);
}

export function give(player, id, amount = 1) {
  const container = inventoryOf(player);
  if (!container) return false;
  return safe(() => {
    container.addItem(new ItemStack(id, amount));
    return true;
  }, false);
}

export function dropItem(dimension, id, location, amount = 1) {
  safe(() => dimension.spawnItem(new ItemStack(id, amount), location));
}

/* --------------------------------------------------------------- entities */

export function spawn(dimension, id, location) {
  return safe(() => dimension.spawnEntity(id, location));
}

export function despawn(entity) {
  const removed = safe(() => {
    entity.remove();
    return true;
  }, false);
  if (!removed) safe(() => entity.kill());
}

export function nearbyEntities(dimension, location, options) {
  return safe(() => dimension.getEntities({ location, ...options }), []);
}

/** Push `target` towards `puller` - used when a Melted Survivor grabs. */
export function dragTowards(target, puller, strength) {
  const dx = puller.location.x - target.location.x;
  const dz = puller.location.z - target.location.z;
  const length = Math.hypot(dx, dz) || 1;
  const nx = dx / length;
  const nz = dz / length;
  const pulled = safe(() => {
    target.applyKnockback(nx, nz, strength, 0.28);
    return true;
  }, false);
  if (!pulled) {
    safe(() => target.applyKnockback({ x: nx * strength, z: nz * strength }, 0.28));
  }
}

/* ---------------------------------------------------------------- storage */

export function worldFlag(key, value) {
  if (value === undefined) {
    return safe(() => world.getDynamicProperty(key));
  }
  safe(() => world.setDynamicProperty(key, value));
  return value;
}

/* ------------------------------------------------------------- scheduling */

export function later(fn, ticks) {
  safe(() => system.runTimeout(fn, ticks));
}
