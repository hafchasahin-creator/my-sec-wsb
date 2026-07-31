/*
 * Laser Eyes
 *
 * A continuous beam that follows where you look for as long as the power
 * runs. Damage and block breaking are on separate slow beats so the beam
 * feels constant without doing twenty raycasts' worth of work every tick -
 * which matters on a phone.
 */

import { BlockPermutation } from "@minecraft/server";
import { CONFIG, SOUNDS } from "../config.js";
import {
  add,
  distance,
  headLocation,
  isPlayer,
  normalize,
  particle,
  safe,
  scale,
  sound,
  viewDirection,
  worldSound,
} from "../util.js";

const BREAKABLE = new Set(CONFIG.laser.breakable);
let airPermutation;

export const laser = {
  key: "laser",
  duration: CONFIG.laser.duration,
  cooldown: CONFIG.laser.cooldown,

  start(player) {
    sound(player, SOUNDS.laser, 1.6);
    return true;
  },

  tick(player, state, elapsed, options) {
    const dimension = safe(() => player.dimension);
    if (!dimension) return;

    const origin = headLocation(player);
    const direction = normalize(viewDirection(player));
    const hit = firstHit(player, dimension, origin, direction);

    drawBeam(dimension, origin, direction, hit.distance);

    if (hit.entity && elapsed % CONFIG.laser.damageEveryTicks === 0) {
      safe(() =>
        hit.entity.applyDamage(CONFIG.laser.damagePerTick, {
          cause: "entityAttack",
          damagingEntity: player,
        })
      );
      particle(dimension, "minecraft:large_explosion", hit.point);
    }

    if (
      hit.block &&
      options?.breaksBlocks !== false &&
      elapsed % CONFIG.laser.breakEveryTicks === 0
    ) {
      burn(dimension, hit.block, hit.point);
    }
  },

  stop(player) {
    sound(player, SOUNDS.expire, 1.6);
  },
};

/** Nearest entity or block along the beam, whichever comes first. */
function firstHit(player, dimension, origin, direction) {
  const range = CONFIG.laser.range;
  let entity;
  let entityDistance = Infinity;

  const hits = safe(() => player.getEntitiesFromViewDirection({ maxDistance: range })) ?? [];
  for (const candidate of hits) {
    const other = candidate.entity ?? candidate;
    if (!other || other.id === player.id || isPlayer(other)) continue;
    const away = distance(origin, other.location);
    if (away < entityDistance) {
      entity = other;
      entityDistance = away;
    }
    break; // getEntitiesFromViewDirection is already sorted by distance
  }

  const blockHit = safe(() =>
    player.getBlockFromViewDirection({
      maxDistance: range,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    })
  );
  const block = blockHit?.block;
  const blockDistance = block ? distance(origin, block.location) : Infinity;

  if (entity && entityDistance <= blockDistance) {
    return { entity, distance: entityDistance, point: add(entity.location, { x: 0, y: 1, z: 0 }) };
  }
  if (block) {
    return {
      block,
      distance: blockDistance,
      point: add(block.location, { x: 0.5, y: 0.5, z: 0.5 }),
    };
  }
  return { distance: range, point: add(origin, scale(direction, range)) };
}

function drawBeam(dimension, origin, direction, length) {
  // One particle every 1.5 blocks: dense enough to look solid, sparse enough
  // that a 24 block beam is 16 particles rather than 100.
  for (let along = 1; along < length; along += 1.5) {
    particle(dimension, "sp:laser_spark", add(origin, scale(direction, along)));
  }
  for (let along = 1.75; along < length; along += 3) {
    particle(dimension, "minecraft:basic_flame_particle", add(origin, scale(direction, along)));
  }
}

function burn(dimension, block, point) {
  const typeId = safe(() => block.typeId);
  if (!typeId || !BREAKABLE.has(typeId)) return;

  if (!airPermutation) airPermutation = safe(() => BlockPermutation.resolve("minecraft:air"));
  if (airPermutation) {
    try {
      block.setPermutation(airPermutation);
    } catch {
      safe(() => block.setType("minecraft:air"));
    }
  } else {
    safe(() => block.setType("minecraft:air"));
  }

  particle(dimension, "minecraft:large_explosion", point);
  worldSound(dimension, "random.fizz", point, 1.4);
}
