/*
 * Luxury Tech House - palette, geometry and tuning constants.
 *
 * Target: Minecraft Bedrock 1.21.0 (Android / Pocket Edition friendly).
 *
 * Block ids here are deliberately restricted to ids that have had their own
 * flattened identifier since 1.17 or earlier. Bedrock has been renaming
 * aggregate blocks (stone_block_slab -> *_slab, grass -> grass_block, ...)
 * across the 1.21 line, and a renamed id makes a /fill silently do nothing.
 * Everything below is safe on 1.21.0; slabs are limited to the deepslate,
 * blackstone and copper families, which never lived in an aggregate id.
 */

export const B = {
  AIR: "minecraft:air",
  STONE: "minecraft:stone",
  DEEPSLATE: "minecraft:deepslate",
  DIRT: "minecraft:dirt",

  // ---- Shell -----------------------------------------------------------
  WHITE: "minecraft:white_concrete",
  BONE: "minecraft:quartz_block",
  QUARTZ_BRICK: "minecraft:quartz_bricks",
  CHISEL_QUARTZ: "minecraft:chiseled_quartz_block",
  BLACK: "minecraft:black_concrete",
  GRAY: "minecraft:gray_concrete",
  LGRAY: "minecraft:light_gray_concrete",
  DARK: "minecraft:polished_deepslate",
  DARK_TILE: "minecraft:deepslate_tiles",
  DARK_BRICK: "minecraft:deepslate_bricks",
  DARK_CHISEL: "minecraft:chiseled_deepslate",
  BLACKSTONE: "minecraft:polished_blackstone",
  BLACKSTONE_BRICK: "minecraft:polished_blackstone_bricks",
  SMOOTH_STONE: "minecraft:smooth_stone",
  SMOOTH_QUARTZ: "minecraft:smooth_quartz",
  POLISHED_ANDESITE: "minecraft:polished_andesite",
  ANDESITE: "minecraft:andesite",
  BASALT: "minecraft:smooth_basalt",
  TUFF: "minecraft:tuff",
  AMETHYST: "minecraft:amethyst_block",
  COPPER: "minecraft:copper_block",
  IRON: "minecraft:iron_block",
  GOLD: "minecraft:gold_block",
  DIAMOND: "minecraft:diamond_block",
  EMERALD: "minecraft:emerald_block",
  NETHERITE: "minecraft:netherite_block",
  LAPIS: "minecraft:lapis_block",
  REDSTONE_BLOCK: "minecraft:redstone_block",

  /*
   * Smart-lighting markers. These five ids are reserved: they appear ONLY as
   * light fittings, never as structure. Day/night/lockdown transitions are a
   * handful of "/fill ... replace <marker>" calls over the whole estate, which
   * is why each marker has to be unique to its fitting group.
   */
  MARK_EXT: "minecraft:polished_diorite", // facade strips, dark by day
  MARK_NEON: "minecraft:polished_granite", // neon accent channels, dark by day
  MARK_PATH: "minecraft:calcite", // garden + driveway path lights
  MARK_POOL: "minecraft:light_blue_concrete", // pool floors
  MARK_HELI: "minecraft:yellow_concrete", // helipad markings
  MAGMA: "minecraft:magma_block", // lockdown tint for the neon channels

  // ---- Glass -----------------------------------------------------------
  GLASS: "minecraft:glass",
  TINTED: "minecraft:tinted_glass",
  GLASS_WHITE: "minecraft:white_stained_glass",
  GLASS_BLACK: "minecraft:black_stained_glass",
  GLASS_GRAY: "minecraft:gray_stained_glass",
  GLASS_CYAN: "minecraft:light_blue_stained_glass",
  GLASS_BLUE: "minecraft:blue_stained_glass",
  GLASS_RED: "minecraft:red_stained_glass",
  PANE: "minecraft:glass_pane",
  PANE_CYAN: "minecraft:light_blue_stained_glass_pane",
  PANE_BLACK: "minecraft:black_stained_glass_pane",
  PANE_WHITE: "minecraft:white_stained_glass_pane",
  PANE_RED: "minecraft:red_stained_glass_pane",
  BARS: "minecraft:iron_bars",
  CHAIN: "minecraft:chain",

  // ---- Lighting --------------------------------------------------------
  SEA_LANTERN: "minecraft:sea_lantern",
  GLOWSTONE: "minecraft:glowstone",
  SHROOMLIGHT: "minecraft:shroomlight",
  FROG_OCHRE: "minecraft:ochre_froglight",
  FROG_VERDANT: "minecraft:verdant_froglight",
  FROG_PEARL: "minecraft:pearlescent_froglight",
  END_ROD: "minecraft:end_rod",
  LANTERN: "minecraft:lantern",
  SOUL_LANTERN: "minecraft:soul_lantern",
  REDSTONE_TORCH: "minecraft:redstone_torch",
  CRYING: "minecraft:crying_obsidian",
  BEACON: "minecraft:beacon",
  CONDUIT: "minecraft:conduit",

  // ---- Colour accents --------------------------------------------------
  CYAN: "minecraft:cyan_concrete",
  BLUE: "minecraft:blue_concrete",
  RED: "minecraft:red_concrete",
  ORANGE: "minecraft:orange_concrete",
  LIME: "minecraft:lime_concrete",
  GREEN: "minecraft:green_concrete",
  PURPLE: "minecraft:purple_concrete",
  MAGENTA: "minecraft:magenta_concrete",
  BROWN: "minecraft:brown_concrete",

  // ---- Screens / consoles ---------------------------------------------
  SCREEN_A: "minecraft:blue_glazed_terracotta",
  SCREEN_B: "minecraft:light_blue_glazed_terracotta",
  SCREEN_C: "minecraft:cyan_glazed_terracotta",
  SCREEN_D: "minecraft:black_glazed_terracotta",
  SCREEN_E: "minecraft:gray_glazed_terracotta",
  SCREEN_F: "minecraft:purple_glazed_terracotta",
  SCREEN_G: "minecraft:green_glazed_terracotta",
  SCREEN_H: "minecraft:lime_glazed_terracotta",
  SCREEN_RED: "minecraft:red_glazed_terracotta",
  SCREEN_WHITE: "minecraft:white_glazed_terracotta",

  // ---- Soft goods ------------------------------------------------------
  WOOL_WHITE: "minecraft:white_wool",
  WOOL_BLACK: "minecraft:black_wool",
  WOOL_GRAY: "minecraft:gray_wool",
  WOOL_LGRAY: "minecraft:light_gray_wool",
  WOOL_RED: "minecraft:red_wool",
  WOOL_BLUE: "minecraft:blue_wool",
  CARPET_WHITE: "minecraft:white_carpet",
  CARPET_BLACK: "minecraft:black_carpet",
  CARPET_GRAY: "minecraft:gray_carpet",
  CARPET_LGRAY: "minecraft:light_gray_carpet",
  CARPET_RED: "minecraft:red_carpet",
  CARPET_CYAN: "minecraft:light_blue_carpet",
  CARPET_BLUE: "minecraft:blue_carpet",

  // ---- Stairs (all have had standalone ids since 1.16 or earlier) ------
  ST_QUARTZ: "minecraft:quartz_stairs",
  ST_SMOOTH_QUARTZ: "minecraft:smooth_quartz_stairs",
  ST_DARK: "minecraft:polished_deepslate_stairs",
  ST_DARK_TILE: "minecraft:deepslate_tile_stairs",
  ST_BLACKSTONE: "minecraft:polished_blackstone_stairs",
  ST_PRISMARINE: "minecraft:dark_prismarine_stairs",
  ST_WARPED: "minecraft:warped_stairs",
  ST_CRIMSON: "minecraft:crimson_stairs",
  ST_PURPUR: "minecraft:purpur_stairs",
  ST_COPPER: "minecraft:cut_copper_stairs",

  // ---- Slabs (deepslate / blackstone / copper families only) ----------
  SL_DARK: "minecraft:polished_deepslate_slab",
  SL_DARK_TILE: "minecraft:deepslate_tile_slab",
  SL_BLACKSTONE: "minecraft:polished_blackstone_slab",
  SL_COPPER: "minecraft:cut_copper_slab",
  SL_WARPED: "minecraft:warped_slab",
  SL_CRIMSON: "minecraft:crimson_slab",

  // ---- Nature ----------------------------------------------------------
  WATER: "minecraft:water",
  MOSS: "minecraft:moss_block",
  MOSS_CARPET: "minecraft:moss_carpet",
  AZALEA_LEAVES: "minecraft:azalea_leaves",
  AZALEA_FLOWER: "minecraft:azalea_leaves_flowered",
  MANGROVE_LEAVES: "minecraft:mangrove_leaves",
  CHERRY_LEAVES: "minecraft:cherry_leaves",
  MANGROVE_LOG: "minecraft:mangrove_log",
  CHERRY_LOG: "minecraft:cherry_log",
  WARPED_STEM: "minecraft:warped_stem",
  BAMBOO_BLOCK: "minecraft:bamboo_block",
  CORAL_BRAIN: "minecraft:brain_coral_block",
  CORAL_TUBE: "minecraft:tube_coral_block",
  CORAL_FIRE: "minecraft:fire_coral_block",
  CORAL_HORN: "minecraft:horn_coral_block",
  CORAL_BUBBLE: "minecraft:bubble_coral_block",
  SEA_PICKLE: "minecraft:sea_pickle",
  SAND: "minecraft:sand",
  PRISMARINE: "minecraft:prismarine",
  DARK_PRISMARINE: "minecraft:dark_prismarine",

  // ---- Utility / props -------------------------------------------------
  BOOKSHELF: "minecraft:bookshelf",
  CHISELED_BOOKSHELF: "minecraft:chiseled_bookshelf",
  LECTERN: "minecraft:lectern",
  BARREL: "minecraft:barrel",
  CHEST: "minecraft:chest",
  ENDER_CHEST: "minecraft:ender_chest",
  CRAFTING: "minecraft:crafting_table",
  ANVIL: "minecraft:anvil",
  SMITHING: "minecraft:smithing_table",
  GRINDSTONE: "minecraft:grindstone",
  STONECUTTER: "minecraft:stonecutter",
  LOOM: "minecraft:loom",
  CARTOGRAPHY: "minecraft:cartography_table",
  FLETCHING: "minecraft:fletching_table",
  ENCHANTING: "minecraft:enchanting_table",
  BREWING: "minecraft:brewing_stand",
  CAULDRON: "minecraft:cauldron",
  BLAST_FURNACE: "minecraft:blast_furnace",
  SMOKER: "minecraft:smoker",
  FURNACE: "minecraft:furnace",
  CAMPFIRE: "minecraft:campfire",
  SOUL_CAMPFIRE: "minecraft:soul_campfire",
  COMPOSTER: "minecraft:composter",
  NOTE_BLOCK: "minecraft:noteblock",
  JUKEBOX: "minecraft:jukebox",
  OBSERVER: "minecraft:observer",
  DISPENSER: "minecraft:dispenser",
  DROPPER: "minecraft:dropper",
  HOPPER: "minecraft:hopper",
  PISTON: "minecraft:piston",
  STICKY_PISTON: "minecraft:sticky_piston",
  TARGET: "minecraft:target",
  LODESTONE: "minecraft:lodestone",
  RESPAWN_ANCHOR: "minecraft:respawn_anchor",
  BELL: "minecraft:bell",
  FLOWER_POT: "minecraft:flower_pot",
  ARMOR_STAND: "minecraft:armor_stand",
  BUTTON: "minecraft:polished_blackstone_button",
  BUTTON_RED: "minecraft:crimson_button",
  IRON_TRAPDOOR: "minecraft:iron_trapdoor",
  LADDER: "minecraft:ladder",
  SCAFFOLD: "minecraft:scaffolding",
};

/*
 * Bedrock keeps renaming aggregate block ids batch by batch across the 1.21
 * line, and the exact batch a given id landed in differs between betas. Rather
 * than betting the whole build on a guess, every id that has ever lived inside
 * an aggregate is listed here with substitutes in descending order of
 * prettiness. resolvePalette() asks the engine which one actually exists and
 * rewrites B in place, so a renamed id costs a little polish instead of
 * leaving a hole in the mansion.
 */
export const ALT = {
  CARPET_WHITE: ["minecraft:carpet", "minecraft:white_wool"],
  CARPET_BLACK: ["minecraft:black_wool"],
  CARPET_GRAY: ["minecraft:gray_wool"],
  CARPET_LGRAY: ["minecraft:light_gray_wool"],
  CARPET_RED: ["minecraft:red_wool"],
  CARPET_CYAN: ["minecraft:light_blue_wool"],
  CARPET_BLUE: ["minecraft:blue_wool"],
  MOSS_CARPET: ["minecraft:moss_block"],
  AZALEA_FLOWER: ["minecraft:flowering_azalea_leaves", "minecraft:azalea_leaves"],
  CHERRY_LEAVES: ["minecraft:azalea_leaves"],
  CHERRY_LOG: ["minecraft:mangrove_log"],
  MANGROVE_LEAVES: ["minecraft:azalea_leaves"],
  MANGROVE_LOG: ["minecraft:warped_stem"],
  BAMBOO_BLOCK: ["minecraft:warped_stem"],
  CHISELED_BOOKSHELF: ["minecraft:bookshelf"],
  NOTE_BLOCK: ["minecraft:note_block", "minecraft:jukebox"],
  FROG_OCHRE: ["minecraft:glowstone"],
  FROG_VERDANT: ["minecraft:sea_lantern"],
  FROG_PEARL: ["minecraft:sea_lantern"],
  BASALT: ["minecraft:basalt", "minecraft:deepslate"],
  TUFF: ["minecraft:deepslate"],
  MAGMA: ["minecraft:red_concrete"],
  TINTED: ["minecraft:gray_stained_glass"],
  BUTTON: ["minecraft:stone_button", "minecraft:wooden_button"],
  BUTTON_RED: ["minecraft:polished_blackstone_button", "minecraft:stone_button"],
  SL_DARK: ["minecraft:cobbled_deepslate_slab", "minecraft:polished_blackstone_slab"],
  SL_DARK_TILE: ["minecraft:deepslate_brick_slab", "minecraft:polished_blackstone_slab"],
  SL_BLACKSTONE: ["minecraft:blackstone_slab", "minecraft:polished_deepslate_slab"],
  SL_COPPER: ["minecraft:polished_blackstone_slab"],
  SL_WARPED: ["minecraft:crimson_slab", "minecraft:polished_blackstone_slab"],
  SL_CRIMSON: ["minecraft:warped_slab", "minecraft:polished_blackstone_slab"],
  ST_SMOOTH_QUARTZ: ["minecraft:quartz_stairs"],
  ST_DARK_TILE: ["minecraft:polished_deepslate_stairs"],
  ST_COPPER: ["minecraft:polished_blackstone_stairs"],
  ST_WARPED: ["minecraft:crimson_stairs", "minecraft:polished_deepslate_stairs"],
  ST_CRIMSON: ["minecraft:warped_stairs", "minecraft:polished_deepslate_stairs"],
  ST_PURPUR: ["minecraft:quartz_stairs"],
  ST_PRISMARINE: ["minecraft:prismarine_stairs", "minecraft:polished_deepslate_stairs"],
  QUARTZ_BRICK: ["minecraft:quartz_block"],
  CHISEL_QUARTZ: ["minecraft:quartz_block"],
  DARK_CHISEL: ["minecraft:polished_deepslate"],
  DARK_TILE: ["minecraft:polished_deepslate"],
  DARK_BRICK: ["minecraft:polished_deepslate"],
  BLACKSTONE_BRICK: ["minecraft:polished_blackstone"],
  AMETHYST: ["minecraft:purple_concrete"],
  COPPER: ["minecraft:waxed_copper", "minecraft:orange_concrete"],
  MOSS: ["minecraft:grass_block", "minecraft:green_concrete"],
  SCAFFOLD: ["minecraft:bamboo_block", "minecraft:iron_bars"],
  SOUL_CAMPFIRE: ["minecraft:campfire"],
  SEA_PICKLE: ["minecraft:sea_lantern"],
  CORAL_BRAIN: ["minecraft:pink_concrete"],
  CORAL_TUBE: ["minecraft:blue_concrete"],
  CORAL_FIRE: ["minecraft:red_concrete"],
  CORAL_HORN: ["minecraft:yellow_concrete"],
  CORAL_BUBBLE: ["minecraft:purple_concrete"],
  CRYING: ["minecraft:obsidian"],
  LODESTONE: ["minecraft:chiseled_stone_bricks"],
  RESPAWN_ANCHOR: ["minecraft:crying_obsidian", "minecraft:obsidian"],
  TARGET: ["minecraft:red_concrete"],
  SCREEN_A: ["minecraft:blue_concrete"],
  SCREEN_B: ["minecraft:light_blue_concrete"],
  SCREEN_C: ["minecraft:cyan_concrete"],
  SCREEN_D: ["minecraft:black_concrete"],
  SCREEN_E: ["minecraft:gray_concrete"],
  SCREEN_F: ["minecraft:purple_concrete"],
  SCREEN_G: ["minecraft:green_concrete"],
  SCREEN_H: ["minecraft:lime_concrete"],
  SCREEN_RED: ["minecraft:red_concrete"],
  SCREEN_WHITE: ["minecraft:white_concrete"],
};

/**
 * Ask the engine which ids exist and rewrite B in place. Called once at world
 * load, before anything can be built. Returns the list of keys that had to be
 * downgraded so the content log shows what this platform is missing.
 */
export function resolvePalette(resolve) {
  const swapped = [];
  for (const key of Object.keys(B)) {
    const candidates = [B[key], ...(ALT[key] ?? [])];
    let chosen;
    for (const candidate of candidates) {
      if (resolve(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (chosen === undefined) {
      // Nothing in the chain exists. Leave the preferred id in place: the
      // command simply no-ops rather than substituting something absurd.
      swapped.push(`${key}: none of ${candidates.join(", ")} resolved`);
    } else if (chosen !== B[key]) {
      swapped.push(`${key}: ${B[key]} -> ${chosen}`);
      B[key] = chosen;
    }
  }
  return swapped;
}

/* ------------------------------------------------------------------ *
 * Vertical stack. Every "stand" level sits one block above its floor
 * slab; every storey is a uniform 8 block rise so one staircase helper
 * serves the whole building.
 * ------------------------------------------------------------------ */

export const Y = {
  DEEP_FLOOR: -20,
  DEEP: -19,
  DEEP_CEIL: -13,

  GAR_FLOOR: -9,
  GAR: -8,
  GAR_CEIL: -2,

  G_FLOOR: -1,
  G: 0,

  F2_FLOOR: 7,
  F2: 8,

  F3_FLOOR: 15,
  F3: 16,

  ROOF_FLOOR: 23,
  ROOF: 24,
  PARAPET: 26,
};

/* ------------------------------------------------------------------ *
 * Plan. All values are relative to the build origin, which is the
 * south-west (min X, min Z) corner of the lot at ground level.
 * ------------------------------------------------------------------ */

export const PLAN = {
  LOT: { x0: 0, x1: 63, z0: 0, z1: 71 },
  HOUSE: { x0: 6, x1: 57, z0: 18, z1: 49 },

  // vertical circulation
  SHAFT: { x0: 26, x1: 30, z0: 42, z1: 46 }, // glass elevator, outer bounds
  CAB: { x0: 27, x1: 29, z0: 43, z1: 45 }, // glass elevator, interior
  STAIR: { x0: 34, x1: 37, z0: 41, z1: 48 },
  SECURE: { x0: 52, x1: 56, z0: 44, z1: 48 }, // secure lift, outer bounds
  SECURE_CAB: { x0: 53, x1: 55, z0: 45, z1: 47 },

  ATRIUM: { x0: 27, x1: 37, z0: 28, z1: 40 },

  // outdoors
  FOUNTAIN: { cx: 32, cz: 9, r: 5 },
  POOL: { x0: 14, x1: 40, z0: 54, z1: 66 },
  LOUNGE: { x0: 43, x1: 57, z0: 54, z1: 68 },
  LIFT_PAD: { x0: 44, x1: 49, z0: 6, z1: 11 },

  // underground
  GARAGE: { x0: 9, x1: 54, z0: 20, z1: 47 },
  GARAGE_TUNNEL: { x0: 44, x1: 49, z0: 12, z1: 19 },
  COMMAND: { x0: 24, x1: 46, z0: 28, z1: 48 },
  AIRLOCK: { x0: 16, x1: 22, z0: 37, z1: 42 },
  VAULT: { x0: 5, x1: 14, z0: 34, z1: 46 },
  LIFT_HALL: { x0: 48, x1: 51, z0: 43, z1: 48 },

  // escape tunnel runs west, well clear of the estate
  TUNNEL: { x0: -76, x1: 23, z0: 28, z1: 31 },
  TUNNEL_EXIT: { x0: -78, x1: -72, z0: 26, z1: 32 },

  ROOFTOP_PAD: { x0: 38, x1: 53, z0: 26, z1: 41 },
};

/* ------------------------------------------------------------------ *
 * Behaviour tuning
 * ------------------------------------------------------------------ */

export const TUNE = {
  /** Commands executed per tick while the mansion is being built. */
  BUILD_RATE: 12,
  /** Master loop period. Everything proximity based rides on this. */
  TICK: 3,
  /** Skip all door work unless somebody is this close to the estate. */
  ESTATE_RADIUS: 96,
  /** Door trigger radius, in blocks, measured from the doorway centre. */
  DOOR_RANGE: 3.4,
  /** Extra grace time a door stays open after the last player leaves. */
  DOOR_HOLD_TICKS: 30,
  /** Ticks between animation frames. Two frames per block of travel. */
  DOOR_FRAME_TICKS: 2,
  /** How often the day/night watcher samples the clock. */
  CLOCK_PERIOD: 40,
  /** Alarm chirp period while lockdown is active. */
  ALARM_PERIOD: 24,
  /** Elevator travel: blocks per frame and ticks per frame. */
  LIFT_STEP: 2,
  LIFT_FRAME_TICKS: 2,
  /** Vehicle platform is heavier and moves one block at a time. */
  PLATFORM_FRAME_TICKS: 3,
  /** Minimum origin Y - below this the basement would clip bedrock. */
  MIN_ORIGIN_Y: -25,
  MAX_ORIGIN_Y: 250,
};

export const SFX = {
  DOOR_OPEN: "mob.shulker.open",
  DOOR_CLOSE: "mob.shulker.close",
  HEAVY_OPEN: "tile.piston.out",
  HEAVY_CLOSE: "tile.piston.in",
  CLICK: "random.click",
  LIFT_START: "beacon.power",
  LIFT_ARRIVE: "note.bell",
  VAULT_STEP: "random.anvil_use",
  VAULT_DONE: "beacon.activate",
  ALARM_HI: "note.pling",
  ALARM_LO: "note.bass",
  LOCKDOWN: "beacon.deactivate",
  RELEASE: "random.levelup",
  NIGHT: "random.orb",
  BUILD_DONE: "conduit.activate",
};

/** Dynamic property key holding the persisted estate record. */
export const STATE_KEY = "lux:estate";
