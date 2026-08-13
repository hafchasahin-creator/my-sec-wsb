// Minimal stand-in for the Bedrock scripting API, enough to run the builder.
export const handlers = { itemUse: [], playerSpawn: [], worldInitialize: [] };
export const tickQueue = [];
const dynamic = new Map();

export const world = {
  afterEvents: {
    itemUse: { subscribe: (fn) => handlers.itemUse.push(fn) },
    playerSpawn: { subscribe: (fn) => handlers.playerSpawn.push(fn) },
    worldInitialize: { subscribe: (fn) => handlers.worldInitialize.push(fn) },
  },
  sendMessage: () => {},
  setDynamicProperty: (k, v) => (v === undefined ? dynamic.delete(k) : dynamic.set(k, v)),
  getDynamicProperty: (k) => dynamic.get(k),
};

export const system = { run: (fn) => tickQueue.push(fn) };

// Ids this fake game knows about. Anything else throws, exactly like the real
// resolve() does, so the fallback chains get exercised.
const KNOWN = new Set([
  "minecraft:air", "minecraft:water", "minecraft:dirt", "minecraft:grass_block",
  "minecraft:azalea_leaves", "minecraft:flowering_azalea_leaves", "minecraft:oak_log",
  "minecraft:quartz_block", "minecraft:quartz_slab", "minecraft:quartz_stairs",
  "minecraft:bookshelf", "minecraft:sea_lantern", "minecraft:end_rod", "minecraft:chain",
  "minecraft:black_concrete", "minecraft:gold_block", "minecraft:iron_block",
  "minecraft:campfire", "minecraft:cauldron", "minecraft:crafting_table",
  "minecraft:barrel", "minecraft:cake", "minecraft:lectern", "minecraft:enchanting_table",
  "minecraft:jukebox", "minecraft:poppy", "minecraft:dandelion", "minecraft:bed",
  "minecraft:chest", "minecraft:furnace", "minecraft:smoker", "minecraft:blast_furnace",
  "minecraft:dark_oak_door", "minecraft:lantern",
  "luxury:marble", "luxury:onyx_marble", "luxury:gilded_marble",
  "luxury:crystal_glass", "luxury:gold_lamp", "luxury:royal_rug",
]);
const STATES = {
  "minecraft:quartz_stairs": ["weirdo_direction", "upside_down_bit"],
  "minecraft:bed": ["direction", "head_piece_bit", "occupied_bit"],
  "minecraft:chest": ["facing_direction"],
  "minecraft:furnace": ["facing_direction"],
  "minecraft:smoker": ["facing_direction"],
  "minecraft:blast_furnace": ["facing_direction"],
  "minecraft:dark_oak_door": ["direction", "upper_block_bit", "door_hinge_bit", "open_bit"],
  "minecraft:lantern": ["hanging"],
  "minecraft:campfire": ["extinguished"],
};

export class BlockPermutation {
  constructor(id, states) { this.type = { id }; this.states = states; }
  static resolve(id, states) {
    if (!KNOWN.has(id)) throw new Error(`unknown block ${id}`);
    if (states) {
      const allowed = STATES[id] || [];
      for (const key of Object.keys(states)) {
        if (!allowed.includes(key)) throw new Error(`unknown state ${key} on ${id}`);
      }
    }
    return new BlockPermutation(id, states);
  }
}
