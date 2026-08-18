/*
 * Daybreak - card operated doors.
 *
 * Bedrock has no data-driven "locked door" block, so a Daybreak door is an
 * ordinary solid custom block and the lock lives in script: tap the door with
 * an access card of the right level and the whole panel is removed for a few
 * seconds, then put back.
 *
 * Using `itemUseOn` (the after event) rather than a block interaction keeps
 * this on API surface that has been stable for years, and it reads naturally
 * on a touchscreen: hold the card, tap the door.
 */

import { ACCESS_CARDS, BUNKER_KEY, CONFIG, DOOR_LEVELS } from "./config.js";
import { later, playerSound, runCommand, safe, tell, title } from "./util.js";

const opening = new Set(); // "x,y,z" of panels currently withdrawn

const OFFSETS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function key(position) {
  return `${position.x},${position.y},${position.z}`;
}

/** Every connected block of the same door type, up to the panel cap. */
function collectPanels(dimension, start, typeId) {
  const found = [];
  const seen = new Set([key(start)]);
  const pending = [start];

  while (pending.length > 0 && found.length < CONFIG.doors.maxPanels) {
    const position = pending.shift();
    const block = safe(() => dimension.getBlock(position));
    if (!block || block.typeId !== typeId) continue;
    found.push(position);

    for (const [dx, dy, dz] of OFFSETS) {
      const next = { x: position.x + dx, y: position.y + dy, z: position.z + dz };
      const id = key(next);
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(next);
    }
  }
  return found;
}

function restore(dimension, panels, typeId, attempt) {
  // Do not crush anything standing in the doorway - wait it out instead.
  let blocked = false;
  for (const position of panels) {
    const occupants = safe(
      () => dimension.getEntities({
        location: { x: position.x + 0.5, y: position.y, z: position.z + 0.5 },
        maxDistance: 1.4,
        excludeFamilies: ["inanimate"],
      }),
      []
    );
    if (occupants.length > 0) {
      blocked = true;
      break;
    }
  }

  if (blocked && attempt < CONFIG.doors.restoreRetries) {
    later(() => restore(dimension, panels, typeId, attempt + 1), 60);
    return;
  }

  for (const position of panels) {
    runCommand(dimension, `setblock ${position.x} ${position.y} ${position.z} ${typeId}`);
    opening.delete(key(position));
  }
  safe(() => dimension.playSound("random.door_close", panels[0], { volume: 0.9, pitch: 0.7 }));
}

function openDoor(player, dimension, block) {
  const typeId = block.typeId;
  const panels = collectPanels(dimension, block.location, typeId);
  if (panels.length === 0) return;
  if (opening.has(key(panels[0]))) return;

  for (const position of panels) {
    opening.add(key(position));
    runCommand(dimension, `setblock ${position.x} ${position.y} ${position.z} minecraft:air`);
  }
  safe(() => dimension.playSound("random.door_open", block.location, { volume: 1, pitch: 0.6 }));
  safe(() => dimension.playSound("beacon.power", block.location, { volume: 0.5, pitch: 1.6 }));

  later(
    () => restore(dimension, panels, typeId, 0),
    CONFIG.doors.openSeconds * 20
  );
}

/** Wired to world.afterEvents.itemUseOn from main. */
export function onItemUseOn(event) {
  const player = event.source;
  const stack = event.itemStack;
  if (!player || !stack) return;

  const dimension = safe(() => player.dimension);
  if (!dimension) return;

  // The event has carried the block itself in some versions and only a
  // location in others.
  const block = event.block
    ?? safe(() => dimension.getBlock(event.blockLocation ?? event.block?.location));
  if (!block) return;

  const required = DOOR_LEVELS[block.typeId];
  if (required === undefined) return;

  const held = stack.typeId;

  if (required === 0) {
    if (held !== BUNKER_KEY) {
      tell(player, "§8[§cLOCK§8] §7This is a bunker door. It needs a bunker key.");
      playerSound(player, "note.bass", 0.8, 0.5);
      return;
    }
    title(player, "§aBUNKER OPEN", "", 2, 20, 6);
    openDoor(player, dimension, block);
    return;
  }

  const level = ACCESS_CARDS[held];
  if (!level) {
    tell(player, `§8[§cLOCK§8] §7Sealed. Level ${required} access card required.`);
    playerSound(player, "note.bass", 0.8, 0.5);
    return;
  }
  if (level < required) {
    title(player, "§cACCESS DENIED", `§7Level ${required} required — you hold ${level}`, 2, 25, 8);
    playerSound(player, "note.bass", 1, 0.5);
    return;
  }

  title(player, "§aACCESS GRANTED", `§7Level ${level} clearance`, 2, 20, 6);
  openDoor(player, dimension, block);
}
