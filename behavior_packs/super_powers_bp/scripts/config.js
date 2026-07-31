/*
 * Super Powers - tuning
 *
 * Every number the add-on uses is here. Edit, then re-run
 * `python3 tools/build_superpowers.py` to repackage the .mcaddon.
 *
 * Durations and cooldowns are in ticks: 20 ticks = 1 second.
 */

export const VERSION = "1.0.0";

export const ITEMS = {
  SPEED: "sp:speed_core",
  FLIGHT: "sp:flight_core",
  LASER: "sp:laser_core",
  INVISIBILITY: "sp:invisibility_core",
  TELEPORT: "sp:teleport_core",
  TIMESTOP: "sp:timestop_core",
  BAND: "sp:power_band",
};

export const CONFIG = {
  /** Action bar refresh. 4 ticks is smooth without costing anything. */
  hudEveryTicks: 4,
  /** Powers re-apply their effects on this beat, so nothing needs removing. */
  refreshEveryTicks: 20,

  speed: {
    duration: 400, // 20s
    cooldown: 200, // 10s
    /** Movement effect level. 19 is +400%, a true 5x. 9 is easier to steer. */
    speedAmplifier: 19,
    jumpAmplifier: 2,
    /** Fall damage taken while running is healed straight back. */
    negateFallDamage: true,
    trailEveryTicks: 2,
  },

  flight: {
    duration: 1200, // 60s
    cooldown: 300, // 15s
    /** Seconds of slow falling when flight ends, for a feather landing. */
    landingTicks: 100,
    wingEveryTicks: 3,
    /** Fallback when the game refuses creative-style flight: hover instead. */
    hoverLevitationAmplifier: 1,
  },

  laser: {
    duration: 60, // 3s of continuous beam
    cooldown: 160, // 8s
    range: 24,
    damagePerTick: 3,
    /** A tick between damage ticks, so it is 10 hits a second, not 20. */
    damageEveryTicks: 2,
    /** Blocks the beam is allowed to break. Add or remove freely. */
    breaksBlocks: true,
    breakEveryTicks: 4,
    breakable: [
      "minecraft:stone",
      "minecraft:cobblestone",
      "minecraft:dirt",
      "minecraft:grass_block",
      "minecraft:sand",
      "minecraft:gravel",
      "minecraft:netherrack",
      "minecraft:oak_log",
      "minecraft:oak_planks",
      "minecraft:glass",
      "minecraft:ice",
      "minecraft:snow_block",
    ],
  },

  invisibility: {
    duration: 600, // 30s
    cooldown: 300, // 15s
    /** Clear the aim of hostile mobs that have locked on to you. */
    breakMobTargets: true,
    forgetEveryTicks: 10,
    shimmerEveryTicks: 6,
    /** Attacking anything drops you out of stealth. */
    revealOnAttack: true,
  },

  teleport: {
    cooldown: 100, // 5s
    maxDistance: 48,
    /** Blocks of head-room needed at the landing spot. */
    headroom: 2,
    /** How far down to look for solid ground under the aimed point. */
    groundSearch: 24,
  },

  timestop: {
    duration: 160, // 8s
    cooldown: 600, // 30s
    radius: 16,
    /** Hostile families that freeze. Players are never affected. */
    families: ["monster", "slime", "undead"],
    /** Arrows, fireballs and the like are pinned in mid air too. */
    freezeProjectiles: true,
  },
};

/**
 * The powers, in menu order.
 *
 * `key` doubles as the cooldown category on the item, so the item itself
 * shows the countdown sweep while the script keeps the exact tick count.
 */
export const POWERS = [
  {
    key: "speed",
    label: "Super Speed",
    colour: "§e",
    item: ITEMS.SPEED,
    icon: "textures/items/speed_core",
    blurb: "Run five times faster, jump far, and take no fall damage.",
  },
  {
    key: "flight",
    label: "Flight",
    colour: "§b",
    item: ITEMS.FLIGHT,
    icon: "textures/items/flight_core",
    blurb: "Toggle free flight with a feather-soft landing.",
  },
  {
    key: "laser",
    label: "Laser Eyes",
    colour: "§c",
    item: ITEMS.LASER,
    icon: "textures/items/laser_core",
    blurb: "A burning beam from your eyes that cuts mobs and blocks.",
  },
  {
    key: "invisibility",
    label: "Invisibility",
    colour: "§d",
    item: ITEMS.INVISIBILITY,
    icon: "textures/items/invisibility_core",
    blurb: "Vanish. Mobs lose track of you until you strike.",
  },
  {
    key: "teleport",
    label: "Teleportation",
    colour: "§5",
    item: ITEMS.TELEPORT,
    icon: "textures/items/teleport_core",
    blurb: "Blink to whatever you are looking at, landing safely.",
  },
  {
    key: "timestop",
    label: "Time Stop",
    colour: "§9",
    item: ITEMS.TIMESTOP,
    icon: "textures/items/timestop_core",
    blurb: "Freeze every hostile mob and projectile around you.",
  },
];

export const POWER_BY_KEY = Object.fromEntries(POWERS.map((p) => [p.key, p]));
export const POWER_BY_ITEM = Object.fromEntries(POWERS.map((p) => [p.item, p]));

/** Sounds. Vanilla ids on purpose - see the README note about audio. */
export const SOUNDS = {
  activate: "beacon.activate",
  deny: "note.bass",
  speed: "mob.horse.gallop",
  flight: "mob.enderdragon.flap",
  laser: "mob.blaze.shoot",
  invisibility: "mob.endermen.portal",
  teleport: "mob.shulker.teleport",
  timestop: "beacon.power",
  expire: "beacon.deactivate",
};
