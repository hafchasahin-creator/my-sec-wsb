/*
 * Super Powers - helpers
 *
 * Anything cosmetic is wrapped: a device or build missing one particle or
 * sound id loses that single effect instead of the whole add-on.
 */

export function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function say(player, text) {
  safe(() => player.sendMessage(text));
}

export function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}

export function title(player, text, subtitle) {
  const options = { fadeInDuration: 3, stayDuration: 20, fadeOutDuration: 8 };
  if (subtitle !== undefined) options.subtitle = subtitle;
  try {
    player.onScreenDisplay.setTitle(text, options);
  } catch {
    safe(() => player.onScreenDisplay.setTitle(text));
  }
}

export function sound(player, id, pitch) {
  safe(() => player.playSound(id, { location: player.location, pitch: pitch ?? 1 }));
}

/** Heard by everyone nearby, not just the player using the power. */
export function worldSound(dimension, id, location, pitch) {
  safe(() => dimension.playSound(id, location, { pitch: pitch ?? 1 }));
}

export function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

/**
 * Effects are always applied in short bursts and refreshed while a power is
 * running. That way a power ends simply by stopping the refresh - no reliance
 * on an effect-removal API that older builds may not have.
 */
export function effect(entity, id, ticks, amplifier, showParticles) {
  safe(() =>
    entity.addEffect(id, ticks, {
      amplifier: amplifier ?? 0,
      showParticles: showParticles ?? false,
    })
  );
}

/* ------------------------------------------------------------------ *
 * Vectors
 * ------------------------------------------------------------------ */

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v, factor) {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function length(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v) {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function distance(a, b) {
  return length({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

export function blockAt(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

export function headLocation(player) {
  return safe(() => player.getHeadLocation()) ?? player.location;
}

export function viewDirection(player) {
  return safe(() => player.getViewDirection()) ?? { x: 0, y: 0, z: 1 };
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** Ticks as seconds with one decimal, for the action bar. */
export function seconds(ticks) {
  return (Math.max(0, ticks) / 20).toFixed(1);
}

/** A ten-segment bar, so a countdown reads at a glance on a phone. */
export function bar(remaining, total, colour) {
  const filled = clamp(Math.round((remaining / Math.max(1, total)) * 10), 0, 10);
  return `${colour}${"|".repeat(filled)}§8${"|".repeat(10 - filled)}`;
}

/* ------------------------------------------------------------------ *
 * The world
 * ------------------------------------------------------------------ */

export function isPlayer(entity) {
  return safe(() => entity?.typeId) === "minecraft:player";
}

export function nearbyEntities(dimension, location, radius) {
  return safe(() => dimension.getEntities({ location, maxDistance: radius })) ?? [];
}

/** First solid block below `location`, or undefined if there is nothing. */
export function groundBelow(dimension, location, maxDrop) {
  let y = Math.floor(location.y);
  for (let step = 0; step < maxDrop; step++) {
    const block = safe(() =>
      dimension.getBlock({ x: Math.floor(location.x), y, z: Math.floor(location.z) })
    );
    if (!block) return undefined;
    if (safe(() => block.isAir) === false && safe(() => block.isLiquid) !== true) {
      return { x: Math.floor(location.x) + 0.5, y: y + 1, z: Math.floor(location.z) + 0.5 };
    }
    y -= 1;
  }
  return undefined;
}

/** Is there room for a player to stand here? */
export function hasHeadroom(dimension, location, blocks) {
  for (let step = 0; step < blocks; step++) {
    const block = safe(() =>
      dimension.getBlock({
        x: Math.floor(location.x),
        y: Math.floor(location.y) + step,
        z: Math.floor(location.z),
      })
    );
    if (!block) return false;
    if (safe(() => block.isAir) !== true) return false;
  }
  return true;
}

/**
 * Heal an entity, coping with the health component having been spelled two
 * different ways across script API versions.
 */
export function heal(entity, amount) {
  const health = safe(() => entity.getComponent("minecraft:health"));
  if (!health) return;
  const current = safe(() => health.currentValue) ?? safe(() => health.current) ?? 0;
  const max =
    safe(() => health.effectiveMax) ?? safe(() => health.value) ?? current + amount;
  const target = Math.min(max, current + amount);
  try {
    health.setCurrentValue(target);
  } catch {
    safe(() => health.setCurrent(target));
  }
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export function container(player) {
  return safe(() => player.getComponent("minecraft:inventory")?.container);
}

export function hasItem(player, typeId) {
  const inventory = container(player);
  if (!inventory) return false;
  for (let slot = 0; slot < inventory.size; slot++) {
    if (safe(() => inventory.getItem(slot)?.typeId) === typeId) return true;
  }
  return false;
}

export function giveItem(player, ItemStack, typeId, amount) {
  return safe(() => {
    const inventory = container(player);
    if (!inventory) return false;
    inventory.addItem(new ItemStack(typeId, amount ?? 1));
    return true;
  });
}
