/*
 * Skyline Parkour - course generation
 *
 * Planning, scanning, building and clearing are separate steps on purpose:
 * the whole course is planned in memory first, then checked against the world,
 * so nothing is ever placed unless every single block of the course lands in
 * empty air. Existing builds are never overwritten.
 */

import { system } from "@minecraft/server";
import { BLOCKS, CONFIG, DIFFICULTIES } from "./config.js";
import {
  clamp,
  makeRng,
  packPos,
  packPosList,
  pickWeighted,
  safe,
  turn,
  unpackPos,
  unpackPosList,
} from "./util.js";

const COURSE_PROPERTY = "skypk:course";

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

/** Block offsets of a pad of `size` blocks per edge, centred on the landing block. */
function padOffsets(size) {
  const half = size >= 3 ? Math.floor(size / 2) : 0;
  const to = size === 2 ? 1 : half;
  const offsets = [];
  for (let dx = -half; dx <= to; dx++) {
    for (let dz = -half; dz <= to; dz++) {
      offsets.push({ dx, dz });
    }
  }
  return offsets;
}

/**
 * Plan a course.
 *
 * `origin` is the block the start pad is centred on, `heading` a cardinal
 * direction to run in. Returns a plan that is pure data - nothing is touched
 * in the world yet.
 */
export function planCourse({ origin, heading, difficulty, jumps, seed }) {
  const spec = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const courseSeed = seed >>> 0;
  const rng = makeRng(courseSeed);
  const limits = CONFIG.course;

  const blocks = [];
  const centres = new Map(); // "x,z" -> [y, ...] of everything planned so far
  const checkpoints = [];

  function occupied(pos) {
    const list = centres.get(`${pos.x},${pos.z}`);
    return list ? list.includes(pos.y) : false;
  }

  function remember(pos) {
    const key = `${pos.x},${pos.z}`;
    const list = centres.get(key);
    if (list) list.push(pos.y);
    else centres.set(key, [pos.y]);
  }

  function add(pos, id) {
    // One block per position: a pad that lands on an earlier one just reuses
    // it, so the plan never contains the same coordinate twice.
    if (occupied(pos)) return;
    blocks.push({ pos, id });
    remember(pos);
  }

  function pad(centre, size, idFor) {
    for (const { dx, dz } of padOffsets(size)) {
      add({ x: centre.x + dx, y: centre.y, z: centre.z + dz }, idFor(dx, dz));
    }
  }

  /** Would a pad here sit on top of, or right under, something already planned? */
  function collides(centre, size) {
    for (const { dx, dz } of padOffsets(size)) {
      const list = centres.get(`${centre.x + dx},${centre.z + dz}`);
      if (!list) continue;
      if (list.some((y) => Math.abs(y - centre.y) <= 3)) return true;
    }
    return false;
  }

  // Start pad: lit corners so it reads as the start from a distance.
  const endPad = limits.endPadSize;
  pad(origin, endPad, (dx, dz) =>
    Math.abs(dx) === 2 && Math.abs(dz) === 2 ? BLOCKS.startTrim : BLOCKS.start
  );

  let current = { ...origin };
  let course = { ...heading };
  const path = [{ ...origin }]; // pad centres in order, start first

  for (let index = 1; index <= jumps; index++) {
    const isFinish = index === jumps;
    const isCheckpoint = !isFinish && index % limits.checkpointEvery === 0;
    const size = isFinish
      ? endPad
      : isCheckpoint
        ? Math.max(spec.padSize, 2)
        : spec.padSize;

    /**
     * Keep the course inside its height band without ever inventing a jump
     * that cannot be made: climbing is only possible over a short gap.
     */
    const stepTo = (heading2, gap, dy) => {
      let useGap = gap;
      let useDy = dy;
      if (current.y + useDy > origin.y + limits.riseLimit) {
        useDy = -1;
      } else if (current.y + useDy < origin.y - limits.dropLimit) {
        useDy = 1;
        useGap = Math.min(useGap, 3);
      }
      return {
        x: current.x + heading2.x * useGap,
        y: clamp(current.y + useDy, limits.minBuildY, limits.maxBuildY),
        z: current.z + heading2.z * useGap,
      };
    };

    let next = null;
    let stepHeading = course;

    for (let attempt = 0; attempt < 10 && next === null; attempt++) {
      const heading2 =
        rng() < (attempt === 0 ? spec.turnChance : 0.5)
          ? turn(course, rng() < 0.5)
          : course;
      const move = pickWeighted(rng, spec.moves);
      const candidate = stepTo(heading2, move.gap, move.dy);
      if (collides(candidate, size)) continue;
      stepHeading = heading2;
      next = candidate;
    }

    // Boxed in: sweep every direction and every legal jump in a fixed order.
    if (next === null) {
      const directions = [course, turn(course, true), turn(course, false)];
      // This difficulty's own jumps, longest first, then a straight drop-away
      // that is far enough below the pads above it to always be free.
      const fallbacks = spec.moves
        .map((move) => [move.gap, move.dy])
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .concat([[4, -4], [3, -4]]);
      for (const heading2 of directions) {
        for (const [gap, dy] of fallbacks) {
          const candidate = stepTo(heading2, gap, dy);
          if (collides(candidate, size)) continue;
          stepHeading = heading2;
          next = candidate;
          break;
        }
        if (next) break;
      }
    }

    // Nothing at all fits - go straight and long. Overlapping a pad placed
    // earlier is only cosmetic, and this is vanishingly rare.
    if (next === null) next = stepTo(course, 4, 0);

    course = stepHeading;

    if (isFinish) {
      pad(next, endPad, (dx, dz) =>
        Math.abs(dx) === 2 && Math.abs(dz) === 2 ? BLOCKS.finishTrim : BLOCKS.finish
      );
      // Corner posts, so the finish is visible from the far end of the course.
      for (const [dx, dz] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
        for (let dy = 1; dy <= 3; dy++) {
          add({ x: next.x + dx, y: next.y + dy, z: next.z + dz }, BLOCKS.finishTrim);
        }
      }
    } else if (isCheckpoint) {
      pad(next, size, () => BLOCKS.checkpoint);
      add({ x: next.x, y: next.y - 1, z: next.z }, BLOCKS.startTrim);
      checkpoints.push({ ...next });
    } else {
      const slippery = rng() < spec.slipChance;
      const theme = spec.palette[Math.floor(rng() * spec.palette.length)];
      pad(next, size, () => (slippery ? BLOCKS.slippery : theme));
    }

    path.push({ ...next });
    current = next;
  }

  return {
    seed: courseSeed,
    difficulty,
    jumps,
    heading,
    start: { ...origin },
    checkpoints,
    finish: { ...current },
    path,
    blocks,
  };
}

/** Lift a whole plan by `dy` blocks - used to retry above an obstruction. */
export function liftPlan(plan, dy) {
  const shift = (pos) => ({ x: pos.x, y: pos.y + dy, z: pos.z });
  return {
    ...plan,
    start: shift(plan.start),
    finish: shift(plan.finish),
    checkpoints: plan.checkpoints.map(shift),
    path: plan.path.map(shift),
    blocks: plan.blocks.map(({ pos, id }) => ({ pos: shift(pos), id })),
  };
}

/* ------------------------------------------------------------------ *
 * World checks
 * ------------------------------------------------------------------ */

/**
 * Count planned cells that are not empty air, including the head-room above
 * every landing pad. Unloaded chunks read as undefined and are skipped - the
 * course is built next to the player, so those are far away.
 */
export function countObstructions(dimension, plan) {
  const planned = new Set(plan.blocks.map((entry) => packPos(entry.pos)));
  let blocked = 0;

  const check = (pos) => {
    const block = safe(() => dimension.getBlock(pos));
    // `undefined` means the chunk is not loaded, which is not an obstruction.
    if (block && safe(() => block.isAir) === false) blocked++;
  };

  for (const { pos } of plan.blocks) {
    check(pos);
    for (let dy = 1; dy <= CONFIG.course.headroom; dy++) {
      const above = { x: pos.x, y: pos.y + dy, z: pos.z };
      if (planned.has(packPos(above))) continue;
      check(above);
    }
  }
  return blocked;
}

/* ------------------------------------------------------------------ *
 * Building and clearing (spread over ticks so nothing lag spikes)
 * ------------------------------------------------------------------ */

function drain(items, apply, onDone) {
  let index = 0;
  const handle = system.runInterval(() => {
    let budget = CONFIG.course.blocksPerTick;
    while (budget-- > 0) {
      if (index >= items.length) {
        safe(() => system.clearRun(handle));
        if (onDone) onDone();
        return;
      }
      apply(items[index++]);
    }
  }, 1);
  return handle;
}

export function buildCourse(dimension, plan, onDone) {
  return drain(
    plan.blocks,
    ({ pos, id }) => safe(() => dimension.getBlock(pos)?.setType(id)),
    onDone
  );
}

export function clearBlocks(dimension, positions, onDone) {
  return drain(
    positions,
    (pos) => safe(() => dimension.getBlock(pos)?.setType("minecraft:air")),
    onDone
  );
}

/* ------------------------------------------------------------------ *
 * Persistence - so a course can be replayed or cleared after a reload
 * ------------------------------------------------------------------ */

export function saveCourse(player, plan, dimensionId) {
  const record = {
    v: 1,
    d: plan.difficulty,
    j: plan.jumps,
    s: plan.seed,
    dim: dimensionId,
    h: `${plan.heading.x},${plan.heading.z}`,
    st: packPos(plan.start),
    fi: packPos(plan.finish),
    cp: packPosList(plan.checkpoints),
    bl: packPosList(plan.blocks.map((entry) => entry.pos)),
  };
  safe(() => player.setDynamicProperty(COURSE_PROPERTY, JSON.stringify(record)));
}

export function loadCourse(player) {
  const raw = safe(() => player.getDynamicProperty(COURSE_PROPERTY));
  if (typeof raw !== "string") return undefined;
  const record = safe(() => JSON.parse(raw));
  if (!record || record.v !== 1) return undefined;
  const [hx, hz] = String(record.h ?? "0,1").split(",").map(Number);
  return {
    difficulty: record.d,
    jumps: record.j,
    seed: record.s,
    dimensionId: record.dim,
    heading: { x: hx, z: hz },
    start: unpackPos(record.st),
    finish: unpackPos(record.fi),
    checkpoints: unpackPosList(record.cp),
    blocks: unpackPosList(record.bl),
  };
}

export function forgetCourse(player) {
  safe(() => player.setDynamicProperty(COURSE_PROPERTY, undefined));
}
