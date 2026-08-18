/*
 * Daybreak - the structure builder.
 *
 * Structures are placed by draining a queue of small operations a few per
 * tick instead of running one enormous function. A phone never has to build a
 * whole research site inside a single frame, and a half-finished site simply
 * keeps growing while the player watches.
 *
 * Every fill is also split until it is under a volume cap, because one
 * 30,000-block fill is exactly the kind of thing that drops a mobile world to
 * single digit frame rates.
 */

import { ItemStack } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { runCommand, safe, spawn } from "./util.js";

/* Block ids that changed name across versions get a second chance. */
const FALLBACKS = {
  "minecraft:web": "minecraft:cobweb",
  "minecraft:cobweb": "minecraft:web",
  "minecraft:smooth_stone": "minecraft:stone",
  "minecraft:deepslate_bricks": "minecraft:stone_bricks",
  "minecraft:polished_deepslate": "minecraft:stone",
  "minecraft:deepslate_tiles": "minecraft:stone_bricks",
  "minecraft:sea_lantern": "minecraft:glowstone",
  "minecraft:lantern": "minecraft:torch",
  "minecraft:standing_sign": "minecraft:oak_sign",
  "minecraft:oak_sign": "minecraft:standing_sign",
  "minecraft:barrel": "minecraft:chest",
  "minecraft:copper_block": "minecraft:iron_block",
  "minecraft:cracked_stone_bricks": "minecraft:stone_bricks",
  "minecraft:mossy_stone_bricks": "minecraft:stone_bricks",
  "minecraft:chiseled_stone_bricks": "minecraft:stone_bricks",
  "minecraft:campfire": "minecraft:torch",
  "minecraft:hay_block": "minecraft:dirt",
  "minecraft:coarse_dirt": "minecraft:dirt",
  "minecraft:oak_fence": "minecraft:fence",
  "minecraft:brewing_stand": "minecraft:cauldron",
};

/* Used only if the /loot command is unavailable on this build. */
const BACKUP_LOOT = {
  daybreak_facility: ["daybreak:research_document", "daybreak:access_card_3",
                      "daybreak:scrap_plating", "daybreak:medical_kit"],
  daybreak_lab: ["daybreak:uv_lens", "daybreak:research_document", "daybreak:access_card_2"],
  daybreak_medical: ["daybreak:medical_kit", "daybreak:emergency_water", "daybreak:gas_mask"],
  daybreak_military: ["daybreak:emergency_flare", "daybreak:access_card_3",
                      "daybreak:scrap_plating"],
  daybreak_bunker: ["daybreak:canned_food", "daybreak:emergency_water", "daybreak:battery"],
  daybreak_town: ["daybreak:canned_food", "daybreak:battery", "daybreak:emergency_water"],
  daybreak_camp: ["daybreak:canned_food", "daybreak:emergency_flare", "daybreak:medical_kit"],
};

function resolve(name) {
  return name.includes(":") ? name : `minecraft:${name}`;
}

/* ------------------------------------------------------------------ queue */

const queue = [];
let active = null;

export function queueLength() {
  return queue.reduce((total, job) => total + job.ops.length, 0) + (active?.ops.length ?? 0);
}

function splitFill(op, out) {
  const [x1, y1, z1, x2, y2, z2, block] = op.f;
  const width = Math.abs(x2 - x1) + 1;
  const height = Math.abs(y2 - y1) + 1;
  const depth = Math.abs(z2 - z1) + 1;
  if (width * height * depth <= CONFIG.buildMaxFillVolume) {
    out.push(op);
    return;
  }
  if (width >= height && width >= depth) {
    const mid = Math.floor((Math.min(x1, x2) + Math.max(x1, x2)) / 2);
    splitFill({ f: [Math.min(x1, x2), y1, z1, mid, y2, z2, block] }, out);
    splitFill({ f: [mid + 1, y1, z1, Math.max(x1, x2), y2, z2, block] }, out);
  } else if (depth >= height) {
    const mid = Math.floor((Math.min(z1, z2) + Math.max(z1, z2)) / 2);
    splitFill({ f: [x1, y1, Math.min(z1, z2), x2, y2, mid, block] }, out);
    splitFill({ f: [x1, y1, mid + 1, x2, y2, Math.max(z1, z2), block] }, out);
  } else {
    const mid = Math.floor((Math.min(y1, y2) + Math.max(y1, y2)) / 2);
    splitFill({ f: [x1, Math.min(y1, y2), z1, x2, mid, z2, block] }, out);
    splitFill({ f: [x1, mid + 1, z1, x2, Math.max(y1, y2), z2, block] }, out);
  }
}

/** Translate a blueprint to world space, split oversized fills, and queue it. */
export function enqueue(dimension, ops, origin, label, onDone) {
  const prepared = [];
  for (const op of ops) {
    if (op.f) {
      const [x1, y1, z1, x2, y2, z2, block] = op.f;
      splitFill({
        f: [
          origin.x + x1, origin.y + y1, origin.z + z1,
          origin.x + x2, origin.y + y2, origin.z + z2,
          block,
        ],
      }, prepared);
    } else if (op.s) {
      const [x, y, z, block] = op.s;
      prepared.push({ s: [origin.x + x, origin.y + y, origin.z + z, block] });
    } else if (op.c) {
      const [x, y, z, loot] = op.c;
      prepared.push({ c: [origin.x + x, origin.y + y, origin.z + z, loot] });
    } else if (op.g) {
      const [x, y, z, text] = op.g;
      prepared.push({ g: [origin.x + x, origin.y + y, origin.z + z, text] });
    } else if (op.e) {
      const [x, y, z, id] = op.e;
      prepared.push({ e: [origin.x + x, origin.y + y, origin.z + z, id] });
    }
  }
  queue.push({ dimension, ops: prepared, label, onDone, done: 0, failed: 0 });
  return prepared.length;
}

function fillChest(dimension, x, y, z, loot) {
  const path = `loot_tables/chests/${loot}.json`;
  if (runCommand(dimension, `loot insert ${x} ${y} ${z} loot "${path}"`)) return;

  // /loot missing or refused - stock the chest directly instead.
  const table = BACKUP_LOOT[loot] ?? BACKUP_LOOT.daybreak_town;
  safe(() => {
    const container = dimension.getBlock({ x, y, z })?.getComponent("minecraft:inventory")
      ?.container;
    if (!container) return;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let index = 0; index < count; index++) {
      const id = table[Math.floor(Math.random() * table.length)];
      container.addItem(new ItemStack(id, 1 + Math.floor(Math.random() * 2)));
    }
  });
}

function runOp(job, op) {
  const dimension = job.dimension;
  if (op.f) {
    const [x1, y1, z1, x2, y2, z2, name] = op.f;
    const block = resolve(name);
    if (runCommand(dimension, `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`)) return true;
    const alternative = FALLBACKS[block];
    return alternative
      ? runCommand(dimension, `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${alternative}`)
      : false;
  }
  if (op.s) {
    const [x, y, z, name] = op.s;
    const block = resolve(name);
    if (runCommand(dimension, `setblock ${x} ${y} ${z} ${block}`)) return true;
    const alternative = FALLBACKS[block];
    return alternative ? runCommand(dimension, `setblock ${x} ${y} ${z} ${alternative}`) : false;
  }
  if (op.c) {
    const [x, y, z, loot] = op.c;
    if (!runCommand(dimension, `setblock ${x} ${y} ${z} minecraft:chest`)) return false;
    fillChest(dimension, x, y, z, loot);
    return true;
  }
  if (op.g) {
    const [x, y, z, text] = op.g;
    let placed = runCommand(dimension, `setblock ${x} ${y} ${z} minecraft:standing_sign`);
    if (!placed) placed = runCommand(dimension, `setblock ${x} ${y} ${z} minecraft:oak_sign`);
    if (!placed) return false;
    safe(() => {
      dimension.getBlock({ x, y, z })?.getComponent("minecraft:sign")?.setText(text);
    });
    return true;
  }
  if (op.e) {
    const [x, y, z, id] = op.e;
    return spawn(dimension, id, { x: x + 0.5, y, z: z + 0.5 }) !== undefined;
  }
  return true;
}

/** Drain a slice of the queue. Called once per tick from main. */
export function tickBuilder(report) {
  if (!active) {
    active = queue.shift();
    if (!active) return;
  }

  let budget = CONFIG.buildOpsPerTick;
  while (budget > 0 && active.ops.length > 0) {
    const op = active.ops.shift();
    if (runOp(active, op)) active.done += 1;
    else active.failed += 1;
    budget -= 1;
  }

  if (active.ops.length === 0) {
    const finished = active;
    active = null;
    if (report) {
      report(finished.label, finished.done, finished.failed);
    }
    safe(() => finished.onDone?.());
  }
}
