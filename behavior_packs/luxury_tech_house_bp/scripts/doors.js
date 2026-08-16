/*
 * Luxury Tech House - automatic sliding doors.
 *
 * No pressure plates anywhere. Each doorway is a strip of columns; opening it
 * retracts those columns from the middle outwards, one per animation frame,
 * with a half-frame in between where the leading column is a thin pane. A four
 * wide entrance therefore plays five distinct frames, which reads as a smooth
 * slide rather than a block popping out of existence.
 *
 * Cost control: only columns whose state actually changed are written, so a
 * frame costs at most two block writes per leaf. Doors are not considered at
 * all unless a player is somewhere on the estate.
 */

import { permutation, safe, soundAt } from "./util.js";
import { SFX, TUNE } from "./config.js";

const AIR = 0;
const PANE = 1;
const SOLID = 2;

/** Number of animation frames between fully shut and fully open. */
export function maxFrame(door) {
  return door.split ? (door.width >> 1) * 2 : door.width * 2;
}

/**
 * Which columns are filled at a given frame. Even frames are whole blocks,
 * odd frames put a pane at the leading edge of each leaf so the travel reads
 * at half-block resolution.
 */
function columnStates(door, frame) {
  const w = door.width;
  const out = new Array(w).fill(AIR);
  const step = frame >> 1;
  const partial = frame & 1;

  if (door.split) {
    const half = w >> 1;
    let aEnd = half - 1 - step;
    if (partial) {
      if (aEnd >= 0) out[aEnd] = PANE;
      aEnd -= 1;
    }
    for (let i = 0; i <= aEnd; i++) out[i] = SOLID;

    let bStart = half + step;
    if (partial) {
      if (bStart <= w - 1) out[bStart] = PANE;
      bStart += 1;
    }
    for (let i = bStart; i <= w - 1; i++) out[i] = SOLID;
  } else {
    let end = w - 1 - step;
    if (partial) {
      if (end >= 0) out[end] = PANE;
      end -= 1;
    }
    for (let i = 0; i <= end; i++) out[i] = SOLID;
  }
  return out;
}

export class DoorSystem {
  constructor(spec, dimension) {
    this.spec = spec;
    this.dimension = dimension;
    this.state = new Map();
    for (const door of spec.doors) {
      this.state.set(door.id, {
        door,
        frame: 0,
        target: 0,
        cols: null, // null forces a full repaint on the first frame
        hold: 0,
        moving: false,
      });
    }
  }

  get(id) {
    return this.state.get(id);
  }

  isOpen(id) {
    const s = this.state.get(id);
    return s ? s.frame >= maxFrame(s.door) : false;
  }

  /** Ask a door to open or close. Used by the secret triggers and the UI. */
  setTarget(id, open) {
    const s = this.state.get(id);
    if (!s) return false;
    s.target = open ? maxFrame(s.door) : 0;
    return true;
  }

  setGroupTarget(predicate, open) {
    let count = 0;
    for (const s of this.state.values()) {
      if (!predicate(s.door)) continue;
      s.target = open ? maxFrame(s.door) : 0;
      count++;
    }
    return count;
  }

  /** Forget the cached column state, e.g. after chunks reloaded. */
  invalidate() {
    for (const s of this.state.values()) s.cols = null;
  }

  /* ---------------- geometry helpers ---------------- */

  columnPosition(door, index) {
    return door.axis === "x"
      ? { x: door.x + index, z: door.z }
      : { x: door.x, z: door.z + index };
  }

  /** A player standing in the opening must never be squashed by it. */
  isBlocked(door, players) {
    const spanX = door.axis === "x" ? door.width : 1;
    const spanZ = door.axis === "z" ? door.width : 1;
    for (const p of players) {
      const l = p.location;
      if (l.y < door.y - 1.2 || l.y > door.y + door.height) continue;
      if (l.x < door.x - 0.4 || l.x > door.x + spanX + 0.4) continue;
      if (l.z < door.z - 0.4 || l.z > door.z + spanZ + 0.4) continue;
      return true;
    }
    return false;
  }

  isNear(door, players) {
    const r2 = door.range * door.range;
    for (const p of players) {
      const l = p.location;
      if (l.y < door.y - 3 || l.y > door.y + door.height + 2) continue;
      const dx = l.x - door.centre.x;
      const dz = l.z - door.centre.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /* ---------------- rendering ---------------- */

  render(state) {
    const door = state.door;
    const next = columnStates(door, state.frame);
    const previous = state.cols;
    const perms = [
      permutation("minecraft:air"),
      permutation(door.pane),
      permutation(door.block),
    ];

    for (let i = 0; i < next.length; i++) {
      if (previous && previous[i] === next[i]) continue;
      const perm = perms[next[i]];
      if (!perm) continue;
      const pos = this.columnPosition(door, i);
      for (let y = door.y; y < door.y + door.height; y++) {
        safe(() => {
          const block = this.dimension.getBlock({ x: pos.x, y, z: pos.z });
          if (block) block.setPermutation(perm);
        });
      }
    }
    state.cols = next;
  }

  sound(door, opening) {
    const heavy = door.sound === "heavy";
    soundAt(
      this.spec.dimensionId,
      door.centre,
      opening
        ? heavy
          ? SFX.HEAVY_OPEN
          : SFX.DOOR_OPEN
        : heavy
          ? SFX.HEAVY_CLOSE
          : SFX.DOOR_CLOSE,
      { volume: heavy ? 0.7 : 0.35, pitch: heavy ? 0.8 : 1.6, range: 26 }
    );
  }

  /* ---------------- per-tick update ---------------- */

  /**
   * @param players  players currently in the estate's dimension and radius
   * @param context  { lockdown, liftAt: Map<liftId, {y, moving}> }
   */
  tick(players, context) {
    /* On the first tick after a load every door needs a full repaint. Doing
     * all of them at once is a few hundred block writes in one frame, so they
     * are metered out over the next few ticks instead. */
    let repaintBudget = 4;
    for (const state of this.state.values()) {
      const door = state.door;
      const limit = maxFrame(door);

      if (context.lockdown && door.lockable) {
        state.target = 0;
        state.hold = 0;
      } else if (door.auto) {
        let allowed = true;
        if (door.lift) {
          const lift = context.liftAt.get(door.lift);
          allowed = !!lift && lift.y === door.stopY && !lift.moving;
        }
        if (allowed && this.isNear(door, players)) {
          state.target = limit;
          state.hold = TUNE.DOOR_HOLD_TICKS;
        } else if (state.hold > 0) {
          state.hold -= TUNE.TICK;
        } else {
          state.target = 0;
        }
      }

      // Never travel towards shut while somebody is standing in the reveal.
      if (state.target < state.frame && this.isBlocked(door, players)) {
        state.target = state.frame;
        state.hold = TUNE.DOOR_HOLD_TICKS;
      }

      if (state.frame === state.target) {
        if (state.moving) state.moving = false;
        if (state.cols === null && repaintBudget > 0) {
          repaintBudget--;
          this.render(state);
        }
        continue;
      }

      if (!state.moving) {
        state.moving = true;
        this.sound(door, state.target > state.frame);
      }
      state.frame += state.target > state.frame ? 1 : -1;
      if (state.frame < 0) state.frame = 0;
      if (state.frame > limit) state.frame = limit;
      this.render(state);
    }
  }
}
