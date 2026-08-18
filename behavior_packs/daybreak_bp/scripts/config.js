/*
 * Daybreak - tuning and text.
 *
 * Every number that shapes how the scenario plays lives here. The systems in
 * the other modules read from this object and nothing else, so the add-on can
 * be rebalanced without touching gameplay code.
 */

export const NS = "daybreak";

export const CONFIG = {
  /* -------------------------------------------------------------- timing */
  // The exposure loop is the only thing that runs often. 10 ticks = twice a
  // second, which is fast enough to feel responsive and slow enough that a
  // phone never notices it.
  stepTicks: 10,
  slowTicks: 100, // 5s - creatures, survivors, ambience, objectives
  buildOpsPerTick: 18,
  buildMaxFillVolume: 3200,

  /* ------------------------------------------------------------ sunlight */
  sun: {
    // 0 -> 100 exposure in roughly 26 seconds of unprotected direct sun.
    risePerStep: 1.9,
    fallPerStep: 2.5,
    // Never scan more than this many blocks above the player's head.
    scanHeight: 128,
    worldTop: 319,
    // How long a sky-exposure result may be reused while the player stands
    // still, in loop steps.
    cacheSteps: 3,
    tiers: [
      { at: 12, key: "exposure", title: "SUNLIGHT EXPOSURE", colour: "§e" },
      { at: 40, key: "shelter", title: "SEEK SHELTER", colour: "§6" },
      { at: 72, key: "critical", title: "CRITICAL EXPOSURE", colour: "§c" },
    ],
    // Effects are refreshed every N steps rather than every step.
    effectEveryStep: 4,
    weather: { clear: 1.0, rain: 0.55, thunder: 0.22 },
    protection: {
      // Multiplier applied per worn suit piece - four pieces plus the set
      // bonus leave about 12% of the exposure rate getting through.
      suitPiece: 0.7,
      fullSetBonus: 0.5,
      hood: 0.45,
      // Durability burned per 2 seconds of direct sun.
      suitWear: 1,
      hoodWear: 2,
    },
  },

  /* --------------------------------------------------------- day / night */
  cycle: {
    nightStart: 13000,
    warningStart: 22000,
    dayStart: 23200,
    radioMinSlowTicks: 30, // ~2.5 minutes
    radioMaxSlowTicks: 60, // ~5 minutes
    ambienceChance: 0.18,
  },

  /* --------------------------------------------------------- creatures */
  creatures: {
    // Hard ceiling on loaded Daybreak monsters. This is the single most
    // important mobile-performance guard in the add-on.
    globalCap: 42,
    perPlayerRadius: 96,
    cullDistance: 84,
    assimilateChance: 0.35,
    assimilatorChance: 0.3,
    assimilatorRadius: 5.5,
    massSpawnChance: 0.25,
    massBroodLimit: 3,
    mimicSpeakChance: 0.3,
    mimicSpeakRadius: 22,
    dragStrength: 1.15,
    survivorBurnSteps: 6, // slow ticks in the sun before a survivor turns
    survivorChecksPerTick: 6,
    giftChance: 0.08,
  },

  /* ------------------------------------------------------------- items */
  items: {
    flashlightSeconds: 30,
    flashlightWear: 1,
    flareLightSeconds: 45,
    medkitRegenSeconds: 8,
    waterExposureRelief: 12,
  },

  /* -------------------------------------------------------------- doors */
  doors: {
    openSeconds: 8,
    maxPanels: 14,
    restoreRetries: 3,
  },
};

/** Which access level each door needs. 0 = opened by the bunker key. */
export const DOOR_LEVELS = {
  [`${NS}:security_door`]: 1,
  [`${NS}:lab_door`]: 2,
  [`${NS}:blast_door`]: 4,
  [`${NS}:bunker_door`]: 0,
};

export const ACCESS_CARDS = {
  [`${NS}:access_card_1`]: 1,
  [`${NS}:access_card_2`]: 2,
  [`${NS}:access_card_3`]: 3,
  [`${NS}:access_card_4`]: 4,
  [`${NS}:access_card_5`]: 5,
};

export const BUNKER_KEY = `${NS}:bunker_key`;

/* ------------------------------------------------------------------ text */

export const MSG = {
  tag: "§8[§6DAYBREAK§8]§r",
  sunset: "§6THE SUN HAS SET §8— §fSURFACE TRAVEL IS POSSIBLE",
  sunriseWarning: "§cWARNING §8— §fSUNRISE APPROACHING",
  sunrise: "§4THE SUN IS UP",
  sunriseSub: "§cGet under something solid.",
  transform: "§4YOUR SKIN IS COMING APART",
  transformSub: "§cYou stayed out too long.",
  died: "§c%s did not find shelter in time.",
  shelterFound: "§7The burning fades. You are out of the light.",
};

export const RADIO_LINES = [
  "EMERGENCY BROADCAST: AVOID DIRECT SUNLIGHT.",
  "ALL PERSONNEL ARE ORDERED UNDERGROUND.",
  "DO NOT APPROACH PEOPLE STANDING IN DIRECT SUNLIGHT.",
  "SUNRISE INCOMING. FIND COVER IMMEDIATELY.",
  "SHELTER CHECK: SEAL EVERY OPENING. GLASS IS NOT A SEAL.",
  "IF SOMEONE CALLS YOU OUT OF COVER, THEY ARE NOT SOMEONE.",
  "RELAY FOUR IS DARK. RELAY FIVE IS DARK. RELAY SIX STILL SENDING.",
  "MEDICAL NOTE: THE BURNING DOES NOT STOP IN SHADE. IT SLOWS.",
  "COUNT YOUR GROUP AT DUSK. COUNT THEM AGAIN AT DAWN.",
  "SURFACE TEAMS: YOU HAVE UNTIL THE HORIZON TURNS. NOT AFTER.",
  "IF YOU HEAR YOUR OWN NAME OUTSIDE, DO NOT ANSWER IT.",
  "CONVOY NINE NEVER REACHED THE TUNNEL. DO NOT GO LOOKING.",
];

export const MIMIC_LINES = [
  "COME OUTSIDE",
  "THE SUN IS BEAUTIFUL",
  "IT DOESN'T HURT",
  "I CAN SEE YOU IN THERE",
  "OPEN THE DOOR",
  "IT'S WARM OUT HERE",
];

export const DOCUMENTS = [
  "§7Log 04 — §fThe star's output did not change. What changed is what the light does when it lands on us.",
  "§7Log 09 — §fShade is not protection, it is delay. Mass between you and the sky is protection.",
  "§7Log 12 — §fSubjects remain mobile after conversion. They remain oriented toward open sky. They pull.",
  "§7Log 17 — §fGlass fails. Every pane we tested passed enough of it through to convert a test animal in under a minute.",
  "§7Log 23 — §fThe suit works. Not forever. Log your minutes outside like you log your air.",
  "§7Log 31 — §fSome of them keep the voice. Do not answer a voice you recognise from outside a sealed door.",
  "§7Log 38 — §fStorm cover buys us hours. We move under thunder now, and only under thunder.",
  "§7Log 44 — §fIf you are reading this on the surface, you have already made a mistake. Go down.",
];

export const AMBIENCE = [
  { sound: "mob.warden.nearby_close", volume: 0.35, pitch: 0.6 },
  { sound: "ambient.cave", volume: 0.6, pitch: 0.8 },
  { sound: "mob.zombie.say", volume: 0.3, pitch: 0.42 },
  { sound: "mob.ravager.ambient", volume: 0.28, pitch: 0.35 },
  { sound: "mob.enderdragon.growl", volume: 0.18, pitch: 1.8 },
];

/* Mobs that a Daybreak creature can convert when it kills them. */
export const ASSIMILATION_VICTIMS = new Set([
  "minecraft:villager_v2",
  "minecraft:villager",
  "minecraft:wandering_trader",
  "minecraft:zombie",
  "minecraft:husk",
  "minecraft:zombie_villager_v2",
  "minecraft:skeleton",
  "minecraft:cow",
  "minecraft:pig",
  "minecraft:sheep",
  "minecraft:chicken",
  "minecraft:horse",
  "minecraft:llama",
  "minecraft:wolf",
  "minecraft:cat",
  "minecraft:goat",
  "minecraft:rabbit",
  "minecraft:fox",
  `${NS}:survivor_civilian`,
  `${NS}:survivor_scientist`,
  `${NS}:survivor_guard`,
  `${NS}:survivor_medic`,
  `${NS}:survivor_engineer`,
]);

/* What a converted victim becomes, by weight. */
export const CONVERSION_TABLE = [
  { id: `${NS}:crawling_melt`, weight: 6 },
  { id: `${NS}:melted_survivor`, weight: 3 },
  { id: `${NS}:flesh_assimilator`, weight: 1 },
];

export const SURVIVOR_IDS = new Set([
  `${NS}:survivor_civilian`,
  `${NS}:survivor_scientist`,
  `${NS}:survivor_guard`,
  `${NS}:survivor_medic`,
  `${NS}:survivor_engineer`,
]);

export const SUPPLY_GIFTS = [
  `${NS}:canned_food`,
  `${NS}:emergency_water`,
  `${NS}:battery`,
  `${NS}:medical_kit`,
  `${NS}:emergency_flare`,
];
