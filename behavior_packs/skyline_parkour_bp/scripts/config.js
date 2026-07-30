/*
 * Skyline Parkour - tuning
 *
 * Every number the add-on uses lives here. Edit, then re-run
 * `python3 tools/build_parkour.py` to repackage the .mcaddon.
 */

export const VERSION = "1.0.1";

export const ITEMS = {
  COMPASS: "parkour:course_compass",
  MARKER: "parkour:checkpoint_marker",
  CHARM: "parkour:leap_charm",
};

export const CONFIG = {
  course: {
    defaultJumps: 20,
    minJumps: 5,
    maxJumps: 60,
    /** How high above the player the course is built. */
    defaultSkyHeight: 30,
    minSkyHeight: 8,
    maxSkyHeight: 90,
    /** Absolute build limits, kept inside overworld bounds on purpose. */
    minBuildY: -40,
    maxBuildY: 300,
    /** A checkpoint pad is placed every N jumps. */
    checkpointEvery: 5,
    /** Edge length of the start and finish pads (odd number). */
    endPadSize: 5,
    /** Head-room in blocks that must be clear above every pad. */
    headroom: 3,
    /** How far the course may drift up/down from the start height. */
    riseLimit: 18,
    dropLimit: 14,
    /** Blocks placed (or removed) per tick, so big courses never lag spike. */
    blocksPerTick: 48,
    /** Refuse to build if more than this many planned blocks are not air. */
    blockedTolerance: 0,
    /** Extra attempts, each 12 blocks higher, before giving up. */
    liftAttempts: 3,
  },

  run: {
    /** Blocks below the last checkpoint before you are sent back to it. */
    fallGrace: 6,
    checkpointRadius: 1.9,
    finishRadius: 2.4,
    hudEveryTicks: 4,
    /** Resistance V while running, so a bad landing never kills you. */
    noFallDamage: true,
    /** Top up saturation so hunger can never stop you sprinting mid-run. */
    keepFed: true,
  },

  leap: {
    horizontal: 1.1,
    vertical: 0.62,
    cooldownCategory: "parkour_leap",
    cooldownTicks: 60,
  },

  /** Put a Parkour Compass in the inventory the first time someone joins. */
  giveCompassOnFirstJoin: true,
};

/*
 * Jump tables.
 *
 * `gap` is the horizontal block distance to the next pad, `dy` the height
 * change. The two are paired deliberately - in Bedrock a 4-block gap is only
 * reachable flat or falling, and you can never gain more than one block of
 * height in a single jump - so every entry below is a jump a player can
 * actually make. `w` is the pick weight.
 */
export const DIFFICULTIES = {
  easy: {
    label: "Easy",
    blurb: "Big 3x3 pads, one block of air between them. A first run.",
    padSize: 3,
    turnChance: 0.2,
    slipChance: 0,
    // 3x3 pads are 3 wide, so anything shorter than a 3-gap would fuse two
    // pads into a walkway and there would be nothing left to jump over.
    moves: [
      { gap: 3, dy: 0, w: 6 },
      { gap: 3, dy: 1, w: 3 },
      { gap: 3, dy: -1, w: 3 },
      { gap: 4, dy: 0, w: 2 },
    ],
    palette: ["minecraft:quartz_block", "minecraft:sandstone"],
  },
  normal: {
    label: "Normal",
    blurb: "2x2 pads, 3-block jumps. The classic parkour rhythm.",
    padSize: 2,
    turnChance: 0.3,
    slipChance: 0,
    moves: [
      { gap: 3, dy: 0, w: 6 },
      { gap: 3, dy: 1, w: 3 },
      { gap: 3, dy: -1, w: 3 },
      { gap: 4, dy: 0, w: 2 },
      { gap: 2, dy: 1, w: 2 },
    ],
    palette: ["minecraft:end_stone", "minecraft:quartz_block", "minecraft:sandstone"],
  },
  hard: {
    label: "Hard",
    blurb: "Single-block pads and 4-block sprint jumps.",
    padSize: 1,
    turnChance: 0.35,
    slipChance: 0.1,
    moves: [
      { gap: 3, dy: 0, w: 4 },
      { gap: 3, dy: 1, w: 2 },
      { gap: 4, dy: 0, w: 4 },
      { gap: 4, dy: -1, w: 3 },
      { gap: 4, dy: -2, w: 1 },
    ],
    palette: ["minecraft:obsidian", "minecraft:netherrack", "minecraft:coal_block"],
  },
  insane: {
    label: "Insane",
    blurb: "Single blocks, ice, and drops you have to aim at.",
    padSize: 1,
    turnChance: 0.45,
    slipChance: 0.22,
    moves: [
      { gap: 4, dy: 0, w: 5 },
      { gap: 4, dy: -1, w: 4 },
      { gap: 4, dy: -2, w: 2 },
      { gap: 3, dy: 1, w: 3 },
      { gap: 5, dy: -2, w: 2 },
    ],
    palette: ["minecraft:obsidian", "minecraft:glass", "minecraft:redstone_block"],
  },
};

export const DIFFICULTY_KEYS = ["easy", "normal", "hard", "insane"];

/** Blocks with a fixed meaning, kept in one place so themes cannot break them. */
export const BLOCKS = {
  start: "minecraft:diamond_block",
  startTrim: "minecraft:sea_lantern",
  checkpoint: "minecraft:gold_block",
  finish: "minecraft:emerald_block",
  finishTrim: "minecraft:sea_lantern",
  slippery: "minecraft:packed_ice",
};
