/*
 * Luxury Tech House - build pipeline.
 *
 * The mansion is placed with /fill and /setblock rather than the block API on
 * purpose: one /fill moves thousands of blocks in a single call, which is the
 * difference between a two second build and a phone-melting one. The commands
 * are queued and metered out a fixed number per tick so the build never spikes
 * the frame time, and every command is individually guarded so a block id the
 * device does not recognise costs one block instead of the whole mansion.
 */

import { system } from "@minecraft/server";
import { safe } from "./util.js";
import { TUNE } from "./config.js";

/** Bedrock refuses a /fill larger than this many blocks. */
const FILL_LIMIT = 30000;

export class CommandQueue {
  constructor(dimension, rate = TUNE.BUILD_RATE) {
    this.dimension = dimension;
    this.rate = rate;
    this.commands = [];
    this.handle = undefined;
    this.done = 0;
    this.failures = [];
  }

  push(command) {
    this.commands.push(command);
  }

  get total() {
    return this.done + this.commands.length;
  }

  /** Execute one command, retrying without block states if those were bad. */
  runOne(command) {
    try {
      this.dimension.runCommand(command);
      return true;
    } catch (error) {
      const stripped = command.replace(/\s*\[[^\]]*\]/g, "");
      if (stripped !== command) {
        try {
          this.dimension.runCommand(stripped);
          return true;
        } catch {
          /* fall through to the failure log */
        }
      }
      if (this.failures.length < 12) {
        this.failures.push(`${command} :: ${error}`);
      }
      return false;
    }
  }

  /** Drain the queue over as many ticks as it takes. */
  start(onProgress, onDone) {
    if (this.handle !== undefined) return;
    const total = this.commands.length;
    this.handle = system.runInterval(() => {
      for (let i = 0; i < this.rate && this.commands.length > 0; i++) {
        this.runOne(this.commands.shift());
        this.done++;
      }
      if (onProgress) safe(() => onProgress(this.done, total));
      if (this.commands.length === 0) {
        this.stop();
        if (onDone) safe(() => onDone(this));
      }
    }, 1);
  }

  /** Run everything right now. Only used for short bursts (lighting swaps). */
  flush() {
    while (this.commands.length > 0) {
      this.runOne(this.commands.shift());
      this.done++;
    }
  }

  stop() {
    if (this.handle !== undefined) {
      safe(() => system.clearRun(this.handle));
      this.handle = undefined;
    }
  }
}

/**
 * Relative-coordinate drawing surface. Every method takes coordinates in the
 * estate's own frame (origin = south-west corner of the lot at ground level)
 * and emits absolute commands into the queue.
 */
export class Builder {
  constructor(origin, queue) {
    this.o = origin;
    this.q = queue;
  }

  ax(x) {
    return this.o.x + x;
  }
  ay(y) {
    return this.o.y + y;
  }
  az(z) {
    return this.o.z + z;
  }

  raw(command) {
    this.q.push(command);
  }

  /**
   * /fill with automatic splitting. opts:
   *   states        - block state suffix, e.g. '["upside_down_bit"=true]'
   *   mode          - replace | hollow | outline | keep | destroy
   *   replace       - block id filter used with mode "replace"
   *   replaceStates - state filter for the replaced block
   */
  fill(x1, y1, z1, x2, y2, z2, id, opts = {}) {
    const lo = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      z: Math.min(z1, z2),
    };
    const hi = {
      x: Math.max(x1, x2),
      y: Math.max(y1, y2),
      z: Math.max(z1, z2),
    };
    const dx = hi.x - lo.x + 1;
    const dy = hi.y - lo.y + 1;
    const dz = hi.z - lo.z + 1;

    if (dx * dy * dz > FILL_LIMIT) {
      // Split along whichever axis is longest and recurse.
      if (dx >= dy && dx >= dz) {
        const mid = lo.x + ((dx / 2) | 0) - 1;
        this.fill(lo.x, lo.y, lo.z, mid, hi.y, hi.z, id, opts);
        this.fill(mid + 1, lo.y, lo.z, hi.x, hi.y, hi.z, id, opts);
      } else if (dy >= dz) {
        const mid = lo.y + ((dy / 2) | 0) - 1;
        this.fill(lo.x, lo.y, lo.z, hi.x, mid, hi.z, id, opts);
        this.fill(lo.x, mid + 1, lo.z, hi.x, hi.y, hi.z, id, opts);
      } else {
        const mid = lo.z + ((dz / 2) | 0) - 1;
        this.fill(lo.x, lo.y, lo.z, hi.x, hi.y, mid, id, opts);
        this.fill(lo.x, lo.y, mid + 1, hi.x, hi.y, hi.z, id, opts);
      }
      return;
    }

    let command =
      `fill ${this.ax(lo.x)} ${this.ay(lo.y)} ${this.az(lo.z)} ` +
      `${this.ax(hi.x)} ${this.ay(hi.y)} ${this.az(hi.z)} ${id}`;
    if (opts.states) command += ` ${opts.states}`;
    if (opts.mode) {
      command += ` ${opts.mode}`;
      if (opts.replace) {
        command += ` ${opts.replace}`;
        if (opts.replaceStates) command += ` ${opts.replaceStates}`;
      }
    }
    this.q.push(command);
  }

  set(x, y, z, id, states) {
    let command = `setblock ${this.ax(x)} ${this.ay(y)} ${this.az(z)} ${id}`;
    if (states) command += ` ${states}`;
    this.q.push(command);
  }

  /** Swap one block id for another inside a volume, leaving everything else. */
  swap(x1, y1, z1, x2, y2, z2, from, to) {
    this.fill(x1, y1, z1, x2, y2, z2, to, { mode: "replace", replace: from });
  }

  air(x1, y1, z1, x2, y2, z2) {
    this.fill(x1, y1, z1, x2, y2, z2, "minecraft:air");
  }

  /** Horizontal slab one block thick. */
  plane(x1, z1, x2, z2, y, id, opts) {
    this.fill(x1, y, z1, x2, y, z2, id, opts);
  }

  /** Vertical plane at a constant X. */
  wallX(x, z1, z2, y1, y2, id, opts) {
    this.fill(x, y1, z1, x, y2, z2, id, opts);
  }

  /** Vertical plane at a constant Z. */
  wallZ(z, x1, x2, y1, y2, id, opts) {
    this.fill(x1, y1, z, x2, y2, z, id, opts);
  }

  /** A 1x1 vertical column. */
  col(x, z, y1, y2, id, opts) {
    this.fill(x, y1, z, x, y2, z, id, opts);
  }

  /** Four vertical walls of a room, no floor and no ceiling. */
  walls(x1, z1, x2, z2, y1, y2, id) {
    this.wallX(x1, z1, z2, y1, y2, id);
    this.wallX(x2, z1, z2, y1, y2, id);
    this.wallZ(z1, x1, x2, y1, y2, id);
    this.wallZ(z2, x1, x2, y1, y2, id);
  }

  /** A single-block-wide border drawn on one horizontal layer. */
  outline(x1, z1, x2, z2, y, id) {
    this.wallZ(z1, x1, x2, y, y, id);
    this.wallZ(z2, x1, x2, y, y, id);
    this.wallX(x1, z1, z2, y, y, id);
    this.wallX(x2, z1, z2, y, y, id);
  }

  /** Hollow shell: walls plus floor plus ceiling, interior untouched. */
  shell(x1, y1, z1, x2, y2, z2, id) {
    this.plane(x1, z1, x2, z2, y1, id);
    this.plane(x1, z1, x2, z2, y2, id);
    this.walls(x1, z1, x2, z2, y1 + 1, y2 - 1, id);
  }

  /** Filled disc on one layer - fountains, planters, pad markings. */
  disc(cx, cz, radius, y, id, innerRadius = -1) {
    const r2 = radius * radius + radius * 0.4;
    const i2 = innerRadius >= 0 ? innerRadius * innerRadius + innerRadius * 0.4 : -1;
    for (let dz = -radius; dz <= radius; dz++) {
      let runStart = null;
      for (let dx = -radius; dx <= radius + 1; dx++) {
        const d = dx * dx + dz * dz;
        const inside = dx <= radius && d <= r2 && d > i2;
        if (inside && runStart === null) runStart = dx;
        if (!inside && runStart !== null) {
          this.fill(cx + runStart, y, cz + dz, cx + dx - 1, y, cz + dz, id);
          runStart = null;
        }
      }
    }
  }

  /**
   * One straight flight of stairs built from solid blocks: the block placed at
   * height y is walked on at y+1, so a run of `count` blocks climbs `count`.
   * Headroom above each tread is cleared.
   */
  stairRun(x1, x2, z, dz, count, y, tread, headroom = 6) {
    for (let i = 0; i < count; i++) {
      const zz = z + dz * i;
      this.fill(x1, y + i, zz, x2, y + i, zz, tread);
      this.air(x1, y + i + 1, zz, x2, y + i + headroom, zz);
    }
  }

  /**
   * Switchback staircase filling a shaft, used where a single flight cannot
   * cover the rise (the escape tunnel exit climbs 19 blocks).
   */
  switchback(x1, x2, z1, z2, yFrom, yTo, tread, headroom = 4) {
    const depth = z2 - z1 + 1;
    let y = yFrom;
    let forward = true;
    let guard = 0;
    while (y < yTo && guard++ < 40) {
      for (let i = 0; i < depth - 1 && y < yTo; i++) {
        const z = forward ? z1 + i : z2 - i;
        this.fill(x1, y, z, x2, y, z, tread);
        this.air(x1, y + 1, z, x2, y + headroom, z);
        y++;
      }
      if (y >= yTo) break;
      const turn = forward ? z2 : z1;
      this.fill(x1, y, turn, x2, y, turn, tread);
      this.air(x1, y + 1, turn, x2, y + headroom, turn);
      y++;
      forward = !forward;
    }
  }

  /** Stripe helper: every `step` blocks along X, drop a 1x1 marker. */
  dotsX(x1, x2, z, y, step, id, offset = 0) {
    for (let x = x1 + offset; x <= x2; x += step) this.set(x, y, z, id);
  }

  /** Stripe helper: every `step` blocks along Z, drop a 1x1 marker. */
  dotsZ(z1, z2, x, y, step, id, offset = 0) {
    for (let z = z1 + offset; z <= z2; z += step) this.set(x, y, z, id);
  }
}
