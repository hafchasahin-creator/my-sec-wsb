/*
 * GENERATED FILE - edit tools/fungi_spec.py and re-run
 * python3 tools/gen_fungi_pack.py instead of editing this by hand.
 */

export const VERSION = "1.0.0";

export const DANGER_NAMES = {
  "1": "LEVEL I - IRRITANT",
  "2": "LEVEL II - HARMFUL",
  "3": "LEVEL III - TOXIC",
  "4": "LEVEL IV - EXTREMELY DANGEROUS",
  "5": "LEVEL V - CATASTROPHIC"
};

export const EQUIPMENT = {
  "scanner": "fungi:fungal_scanner",
  "mask": "fungi:spore_mask",
  "head": "fungi:hazard_helmet",
  "chest": "fungi:hazard_chestplate",
  "legs": "fungi:hazard_leggings",
  "feet": "fungi:hazard_boots"
};

export const SPECIES = [
  {
    "id": "fungi:bloodcap",
    "key": "bloodcap",
    "name": "Bloodcap Fungus",
    "danger": 3,
    "range": 3.0,
    "damage": 1.0,
    "contact": 1.0,
    "pulse": 1,
    "effects": [
      {
        "id": "wither",
        "ticks": 60,
        "amp": 0
      }
    ],
    "particle": "fungi:bloodcap_spore",
    "habitat": "Damp cave walls and abandoned mineshafts.",
    "desc": "A crimson cap that weeps a corrosive red mist. Standing close drains the blood."
  },
  {
    "id": "fungi:toxic_veil",
    "key": "toxic_veil",
    "name": "Toxic Veil",
    "danger": 2,
    "range": 3.5,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "poison",
        "ticks": 80,
        "amp": 0
      }
    ],
    "particle": "fungi:toxic_veil_spore",
    "habitat": "Swamp shallows and rotting wood.",
    "desc": "A drooping lattice of green threads that sheds poison whenever it is brushed."
  },
  {
    "id": "fungi:sporeburst",
    "key": "sporeburst",
    "name": "Sporeburst Mushroom",
    "danger": 2,
    "range": 3.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 2,
    "effects": [
      {
        "id": "nausea",
        "ticks": 80,
        "amp": 0
      },
      {
        "id": "blindness",
        "ticks": 20,
        "amp": 0
      }
    ],
    "particle": "fungi:sporeburst_spore",
    "habitat": "Forest floors and leaf litter.",
    "desc": "A taut puffball. Any disturbance splits the skin and floods the air with choking spores."
  },
  {
    "id": "fungi:shadow_morel",
    "key": "shadow_morel",
    "name": "Shadow Morel",
    "danger": 3,
    "range": 3.5,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "blindness",
        "ticks": 70,
        "amp": 0
      }
    ],
    "particle": "fungi:shadow_morel_spore",
    "habitat": "Lightless caverns far from any torch.",
    "desc": "Grows only where no light reaches. Its pitted cap swallows the dark and gives it back."
  },
  {
    "id": "fungi:embercap",
    "key": "embercap",
    "name": "Embercap",
    "danger": 4,
    "range": 3.0,
    "damage": 2.0,
    "contact": 2.0,
    "pulse": 1,
    "effects": [],
    "particle": "fungi:embercap_spore",
    "habitat": "Nether wastes and basalt fields.",
    "desc": "Its cap holds a living coal. Anything that lingers beside it catches light.",
    "ignites": true
  },
  {
    "id": "fungi:frost_mold",
    "key": "frost_mold",
    "name": "Frost Mold",
    "danger": 2,
    "range": 3.5,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "slowness",
        "ticks": 90,
        "amp": 1
      }
    ],
    "particle": "fungi:frost_mold_spore",
    "habitat": "Snowfields, ice sheets and frozen peaks.",
    "desc": "A creeping rime that steals the warmth out of anything standing on it."
  },
  {
    "id": "fungi:rotcap",
    "key": "rotcap",
    "name": "Rotcap",
    "danger": 2,
    "range": 3.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "hunger",
        "ticks": 120,
        "amp": 0
      },
      {
        "id": "weakness",
        "ticks": 120,
        "amp": 0
      }
    ],
    "particle": "fungi:rotcap_spore",
    "habitat": "Rotting logs in swamps and old forests.",
    "desc": "Sags under its own decay. The stink alone hollows out a stomach."
  },
  {
    "id": "fungi:phantom_fungus",
    "key": "phantom_fungus",
    "name": "Phantom Fungus",
    "danger": 3,
    "range": 4.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "nausea",
        "ticks": 100,
        "amp": 0
      },
      {
        "id": "blindness",
        "ticks": 25,
        "amp": 0
      }
    ],
    "particle": "fungi:phantom_fungus_spore",
    "habitat": "Deep, still caves. Rare.",
    "desc": "Barely there. It thins the air until direction stops meaning anything."
  },
  {
    "id": "fungi:shockshroom",
    "key": "shockshroom",
    "name": "Shockshroom",
    "danger": 4,
    "range": 3.0,
    "damage": 3.0,
    "contact": 0.0,
    "pulse": 3,
    "effects": [],
    "particle": "fungi:shockshroom_spore",
    "habitat": "Ore-rich cave systems.",
    "desc": "Stores a charge in its stalk and dumps it into anything nearby every few seconds."
  },
  {
    "id": "fungi:acid_bloom",
    "key": "acid_bloom",
    "name": "Acid Bloom",
    "danger": 3,
    "range": 2.5,
    "damage": 0.0,
    "contact": 3.0,
    "pulse": 1,
    "effects": [
      {
        "id": "poison",
        "ticks": 70,
        "amp": 1
      }
    ],
    "particle": "fungi:acid_bloom_spore",
    "habitat": "Humid jungle basins and swamp edges.",
    "desc": "An open cup brimming with something that eats through boots."
  },
  {
    "id": "fungi:voidcap",
    "key": "voidcap",
    "name": "Voidcap",
    "danger": 4,
    "range": 3.0,
    "damage": 2.0,
    "contact": 2.0,
    "pulse": 1,
    "effects": [
      {
        "id": "darkness",
        "ticks": 120,
        "amp": 0
      },
      {
        "id": "mining_fatigue",
        "ticks": 100,
        "amp": 0
      }
    ],
    "particle": "fungi:voidcap_spore",
    "habitat": "The deepest deepslate, near sculk. Deep Dark depths.",
    "desc": "A cap that is mostly absence. Light bends into it and does not come back."
  },
  {
    "id": "fungi:spine_fungus",
    "key": "spine_fungus",
    "name": "Spine Fungus",
    "danger": 3,
    "range": 2.0,
    "damage": 0.0,
    "contact": 4.0,
    "pulse": 1,
    "effects": [],
    "particle": "fungi:spine_fungus_spore",
    "habitat": "Cave floors and ravine ledges.",
    "desc": "Hardened fungal needles. They do not need to be touched hard to draw blood.",
    "hurts_mobs": true
  },
  {
    "id": "fungi:crimson_brain",
    "key": "crimson_brain",
    "name": "Crimson Brain Fungus",
    "danger": 3,
    "range": 3.0,
    "damage": 0.0,
    "contact": 1.0,
    "pulse": 1,
    "effects": [
      {
        "id": "nausea",
        "ticks": 120,
        "amp": 0
      },
      {
        "id": "weakness",
        "ticks": 120,
        "amp": 0
      }
    ],
    "particle": "fungi:crimson_brain_spore",
    "habitat": "Crimson forests and nether wastes.",
    "desc": "Folded like something that thinks. Being near it makes thinking harder."
  },
  {
    "id": "fungi:glowspore",
    "key": "glowspore",
    "name": "Glowspore",
    "danger": 2,
    "range": 5.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "mining_fatigue",
        "ticks": 80,
        "amp": 0
      }
    ],
    "particle": "fungi:glowspore_spore",
    "habitat": "Lush cave pockets and flooded tunnels.",
    "desc": "Lights a wide patch of tunnel and saturates all of it with heavy spores.",
    "contaminates": true
  },
  {
    "id": "fungi:deathbell",
    "key": "deathbell",
    "name": "Deathbell Mushroom",
    "danger": 4,
    "range": 4.0,
    "damage": 1.0,
    "contact": 2.0,
    "pulse": 1,
    "effects": [
      {
        "id": "poison",
        "ticks": 90,
        "amp": 1
      },
      {
        "id": "weakness",
        "ticks": 110,
        "amp": 0
      },
      {
        "id": "slowness",
        "ticks": 70,
        "amp": 0
      },
      {
        "id": "blindness",
        "ticks": 30,
        "amp": 0
      }
    ],
    "particle": "fungi:deathbell_spore",
    "habitat": "Deep caves and forgotten structures. Very rare.",
    "desc": "Pale bell on a black stalk. Everything it touches fails at once."
  },
  {
    "id": "fungi:creeping_mold",
    "key": "creeping_mold",
    "name": "Creeping Mold",
    "danger": 2,
    "range": 3.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "weakness",
        "ticks": 100,
        "amp": 0
      }
    ],
    "particle": "fungi:creeping_mold_spore",
    "habitat": "Damp stone and swamp mud. Spreads slowly.",
    "desc": "Black-green film that walks outward one block at a time, and only so far.",
    "spreads": {
      "radius": 2,
      "max_nearby": 6,
      "chance": 0.25
    }
  },
  {
    "id": "fungi:ash_fungus",
    "key": "ash_fungus",
    "name": "Ash Fungus",
    "danger": 2,
    "range": 3.0,
    "damage": 0.0,
    "contact": 0.0,
    "pulse": 1,
    "effects": [
      {
        "id": "weakness",
        "ticks": 120,
        "amp": 0
      }
    ],
    "particle": "fungi:ash_fungus_spore",
    "habitat": "Basalt deltas and burnt ground.",
    "desc": "Grey stalks that shed a constant dry smoke. Lungs give out before muscles do."
  },
  {
    "id": "fungi:nightmare_cap",
    "key": "nightmare_cap",
    "name": "Nightmare Cap",
    "danger": 4,
    "range": 4.0,
    "damage": 1.0,
    "contact": 1.0,
    "pulse": 1,
    "effects": [
      {
        "id": "darkness",
        "ticks": 140,
        "amp": 0
      },
      {
        "id": "slowness",
        "ticks": 90,
        "amp": 1
      },
      {
        "id": "nausea",
        "ticks": 120,
        "amp": 0
      }
    ],
    "particle": "fungi:nightmare_cap_spore",
    "habitat": "Under dark oak canopy. Rare.",
    "desc": "Tall, watchful and wrong. Whatever it does to a mind, it does slowly."
  },
  {
    "id": "fungi:parasite_bloom",
    "key": "parasite_bloom",
    "name": "Parasite Bloom",
    "danger": 4,
    "range": 4.0,
    "damage": 0.0,
    "contact": 1.0,
    "pulse": 1,
    "effects": [],
    "particle": "fungi:parasite_bloom_spore",
    "habitat": "Jungle undergrowth and drowned roots. Rare.",
    "desc": "Seeds a fictional fungal infection that keeps working long after you walk away.",
    "infects": true
  },
  {
    "id": "fungi:mycelium_x",
    "key": "mycelium_x",
    "name": "Mycelium-X Core",
    "danger": 5,
    "range": 6.0,
    "damage": 2.0,
    "contact": 3.0,
    "pulse": 1,
    "effects": [
      {
        "id": "poison",
        "ticks": 100,
        "amp": 1
      },
      {
        "id": "weakness",
        "ticks": 140,
        "amp": 1
      },
      {
        "id": "slowness",
        "ticks": 100,
        "amp": 1
      },
      {
        "id": "nausea",
        "ticks": 120,
        "amp": 0
      },
      {
        "id": "darkness",
        "ticks": 80,
        "amp": 0
      }
    ],
    "particle": "fungi:mycelium_x_spore",
    "habitat": "Only the deepest bedrock-adjacent voids. Extremely rare.",
    "desc": "A mutated fungal heart. It contaminates everything around it and keeps growing.",
    "contaminates": true,
    "infects": true,
    "spreads": {
      "radius": 2,
      "max_nearby": 4,
      "chance": 0.18
    }
  }
];

/** typeId -> species record, built once at load. */
export const BY_ID = Object.create(null);
for (const entry of SPECIES) BY_ID[entry.id] = entry;

export const DANGER_BLOCK = {
  "1": "minecraft:emerald_block",
  "2": "minecraft:gold_block",
  "3": "minecraft:copper_block",
  "4": "minecraft:redstone_block",
  "5": "minecraft:obsidian"
};
