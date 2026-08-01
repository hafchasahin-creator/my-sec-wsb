/*
 * A small stand-in for @minecraft/server, enough to run Builder Buddy's
 * behaviour script outside the game.
 *
 * The point is to catch the mistakes that are invisible in a JSON linter but
 * fatal in-game: block ids that do not exist, block states with the wrong
 * name, a house plan that leaves holes in the walls, a build loop that never
 * terminates. Block ids and their states below mirror Bedrock 1.21.0.
 */

// ---------------------------------------------------------------------------
// Block registry - id -> the set of state names that block accepts
// ---------------------------------------------------------------------------

const BLOCKS = {
  "minecraft:air": [],
  "minecraft:dirt": ["dirt_type"],
  "minecraft:grass_block": [],
  "minecraft:oak_planks": [],
  "minecraft:oak_log": ["pillar_axis"],
  "minecraft:oak_stairs": ["weirdo_direction", "upside_down_bit"],
  "minecraft:oak_slab": ["minecraft:vertical_half"],
  "minecraft:oak_fence": [],
  "minecraft:oak_fence_gate": ["direction", "in_wall_bit", "open_bit"],
  "minecraft:oak_door": ["direction", "upper_block_bit", "door_hinge_bit", "open_bit"],
  "minecraft:stone_bricks": [],
  "minecraft:cobblestone": [],
  "minecraft:glass": [],
  "minecraft:glass_pane": [],
  "minecraft:torch": ["torch_facing_direction"],
  "minecraft:lantern": ["hanging"],
  "minecraft:crafting_table": [],
  "minecraft:furnace": ["facing_direction"],
  "minecraft:chest": ["facing_direction"],
  "minecraft:bookshelf": [],
  "minecraft:bed": ["direction", "head_piece_bit", "occupied_bit"],
  "minecraft:white_carpet": [],
  "minecraft:farmland": ["moisturized_amount"],
  "minecraft:water": ["liquid_depth"],
  "minecraft:wheat": ["growth"],
  "minecraft:flower_pot": ["update_bit"],
  "minecraft:stone": [],
  "minecraft:short_grass": [],
  "minecraft:oak_leaves": ["persistent_bit", "update_bit"],
  "minecraft:lava": ["liquid_depth"]
};

export class BlockPermutation {
  constructor(type, states) {
    this.type = { id: type };
    this.states = states;
  }

  static resolve(id, states) {
    const allowed = BLOCKS[id];
    if (!allowed) throw new Error(`unknown block id: ${id}`);
    for (const key of Object.keys(states ?? {})) {
      if (!allowed.includes(key)) {
        throw new Error(`block ${id} has no state "${key}"`);
      }
    }
    return new BlockPermutation(id, states ?? {});
  }

  get typeId() {
    return this.type.id;
  }
}

// ---------------------------------------------------------------------------
// World model
// ---------------------------------------------------------------------------

class Block {
  constructor(dim, x, y, z) {
    this.dim = dim;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get typeId() {
    return this.dim.getId(this.x, this.y, this.z);
  }

  get permutation() {
    return this.dim.blocks.get(key(this.x, this.y, this.z));
  }

  setPermutation(p) {
    if (!(p instanceof BlockPermutation)) throw new Error("not a permutation");
    this.dim.blocks.set(key(this.x, this.y, this.z), p);
    this.dim.writes++;
  }
}

function key(x, y, z) {
  return `${x},${y},${z}`;
}

export class Dimension {
  constructor(id) {
    this.id = id;
    this.blocks = new Map();
    this.entities = [];
    this.writes = 0;
    this.reads = 0;
    this.particles = [];
    this.explosions = [];
    /** Terrain function: (x, y, z) -> block id for anything never written. */
    this.terrain = (x, y, z) => (y < 64 ? "minecraft:stone" : "minecraft:air");
    this.minY = -64;
    this.maxY = 320;
  }

  getId(x, y, z) {
    const found = this.blocks.get(key(x, y, z));
    if (found) return found.typeId;
    return this.terrain(x, y, z);
  }

  getBlock(loc) {
    this.reads++;
    const { x, y, z } = loc;
    if (y < this.minY || y > this.maxY) throw new Error("y out of range");
    return new Block(this, x, y, z);
  }

  setId(x, y, z, id, states) {
    this.blocks.set(key(x, y, z), BlockPermutation.resolve(id, states ?? {}));
  }

  getEntities(options) {
    let list = this.entities.filter((e) => !e.dead);
    if (options?.type) list = list.filter((e) => e.typeId === options.type);
    if (options?.families) {
      list = list.filter((e) => options.families.some((f) => e.families.includes(f)));
    }
    if (options?.tags) {
      list = list.filter((e) => options.tags.every((t) => e.tags.has(t)));
    }
    if (options?.excludeFamilies) {
      list = list.filter((e) => !options.excludeFamilies.some((f) => e.families.includes(f)));
    }
    if (options?.location && options?.maxDistance !== undefined) {
      list = list.filter((e) => dist(e.location, options.location) <= options.maxDistance);
    }
    if (options?.closest) {
      list = [...list].sort(
        (a, b) => dist(a.location, options.location) - dist(b.location, options.location)
      );
      list = list.slice(0, options.closest);
    }
    return list;
  }

  getPlayers(options) {
    return this.getEntities({ ...options, type: "minecraft:player" });
  }

  spawnParticle(id, location) {
    this.particles.push({ id, location });
  }

  createExplosion(location, radius, options) {
    this.explosions.push({ location, radius, options });
    return true;
  }

  spawnItem(itemStack, location) {
    const e = new Entity("minecraft:item", this, location);
    e.itemComponent = { itemStack };
    this.entities.push(e);
    return e;
  }

  spawnEntity(typeId, location) {
    const e = new Entity(typeId, this, location);
    this.entities.push(e);
    for (const fn of spawnHandlers) fn({ entity: e });
    return e;
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const ITEMS = new Set([
  "minecraft:oak_log",
  "minecraft:oak_planks",
  "minecraft:stick",
  "minecraft:cobblestone",
  "minecraft:coal",
  "minecraft:torch",
  "minecraft:oak_sapling",
  "minecraft:wheat_seeds",
  "minecraft:raw_iron",
  "minecraft:apple",
  "minecraft:diamond",
  "bb:house_builder_remote",
  "tp:parasite_serum"
]);

export class ItemStack {
  constructor(typeId, amount) {
    if (!ITEMS.has(typeId)) throw new Error(`unknown item: ${typeId}`);
    if (amount !== undefined && (amount < 1 || amount > 64)) {
      throw new Error(`bad stack size: ${amount}`);
    }
    this.typeId = typeId;
    this.amount = amount ?? 1;
  }
}

class Container {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
    this.full = false;
  }

  /** Everything currently held, for simple assertions. */
  get items() {
    return this.slots.filter(Boolean);
  }

  addItem(stack) {
    if (this.full) throw new Error("container is full");
    const i = this.slots.findIndex((s) => s === undefined);
    if (i < 0) throw new Error("container is full");
    this.slots[i] = stack;
  }

  getItem(i) {
    return this.slots[i];
  }

  setItem(i, stack) {
    this.slots[i] = stack;
  }
}

let nextId = 1;

export class Entity {
  constructor(typeId, dimension, location) {
    this.typeId = typeId;
    this.dimension = dimension;
    this.location = { ...location };
    this.id = String(nextId++);
    this.tags = new Set();
    this.families = typeId === "bb:builder_buddy" ? ["mob", "builder_buddy"] : [];
    this.nameTag = "";
    this.events = [];
    this.dead = false;
    this.effects = [];
    this.health = { currentValue: 40, effectiveMax: 40 };
  }

  addTag(t) {
    this.tags.add(t);
    return true;
  }

  removeTag(t) {
    return this.tags.delete(t);
  }

  hasTag(t) {
    return this.tags.has(t);
  }

  triggerEvent(name) {
    this.events.push(name);
  }

  getComponent(name) {
    if (name === "minecraft:health") return this.health;
    if (name === "minecraft:inventory") return { container: this.container };
    if (name === "minecraft:item") return this.itemComponent;
    return undefined;
  }

  applyDamage(amount) {
    this.health.currentValue -= amount;
    if (this.health.currentValue <= 0) this.kill();
    return true;
  }

  kill() {
    if (this.dead) return false;
    this.dead = true;
    const i = this.dimension.entities.indexOf(this);
    if (i >= 0) this.dimension.entities.splice(i, 1);
    world.afterEvents.entityDie.emit({ deadEntity: this });
    return true;
  }

  addEffect(type, duration, options) {
    this.effects.push({ type, duration, options });
    return true;
  }

  remove() {
    this.dead = true;
    const i = this.dimension.entities.indexOf(this);
    if (i >= 0) this.dimension.entities.splice(i, 1);
  }

  teleport(location, options) {
    this.location = { ...location };
    if (options?.dimension) this.dimension = options.dimension;
  }

  sendMessage(text) {
    this.messages.push(text);
  }
}

export class Player extends Entity {
  constructor(dimension, location, name) {
    super("minecraft:player", dimension, location);
    this.name = name ?? "Tester";
    this.families = ["player", "mob"];
    this.container = new Container();
    this.actionBars = [];
    this.onScreenDisplay = {
      setActionBar: (text) => this.actionBars.push(text)
    };
    this.messages = [];
    this.sounds = [];
    this.isSneaking = false;
    this.forms = [];
  }

  playSound(id, options) {
    this.sounds.push({ id, options });
  }
}

// ---------------------------------------------------------------------------
// Events and the tick scheduler
// ---------------------------------------------------------------------------

function signal() {
  const handlers = [];
  return {
    handlers,
    subscribe(fn) {
      handlers.push(fn);
      return fn;
    },
    unsubscribe(fn) {
      const i = handlers.indexOf(fn);
      if (i >= 0) handlers.splice(i, 1);
    },
    emit(payload) {
      for (const fn of [...handlers]) fn(payload);
    }
  };
}

const spawnHandlers = [];

const overworld = new Dimension("overworld");
const nether = new Dimension("nether");
const theEnd = new Dimension("the_end");
const dimensions = { overworld, nether, the_end: theEnd };

export const world = {
  messages: [],
  sendMessage(text) {
    this.messages.push(text);
  },
  getDimension(id) {
    const d = dimensions[id];
    if (!d) throw new Error(`no dimension ${id}`);
    return d;
  },
  timeOfDay: 6000,
  getTimeOfDay() {
    return this.timeOfDay;
  },
  getAllPlayers() {
    return Object.values(dimensions).flatMap((d) =>
      d.entities.filter((e) => e.typeId === "minecraft:player" && !e.dead)
    );
  },
  afterEvents: {
    itemUse: signal(),
    itemUseOn: signal(),
    entityHitEntity: signal(),
    entityDie: signal(),
    entitySpawn: (() => {
      const s = signal();
      spawnHandlers.push((p) => s.emit(p));
      return s;
    })()
  }
};

const intervals = new Map();
const timeouts = new Map();
let handleSeq = 1;

export const system = {
  currentTick: 0,
  afterEvents: {
    scriptEventReceive: signal()
  },
  run(fn) {
    const h = handleSeq++;
    timeouts.set(h, { at: system.currentTick, fn });
    return h;
  },
  runTimeout(fn, ticks) {
    const h = handleSeq++;
    timeouts.set(h, { at: system.currentTick + ticks, fn });
    return h;
  },
  runInterval(fn, ticks) {
    const h = handleSeq++;
    intervals.set(h, { every: Math.max(1, ticks), next: system.currentTick + ticks, fn });
    return h;
  },
  clearRun(handle) {
    intervals.delete(handle);
    timeouts.delete(handle);
  }
};

/** Advance the simulated clock, running everything that is due. */
export function advance(ticks) {
  for (let i = 0; i < ticks; i++) {
    system.currentTick++;
    for (const [h, t] of [...timeouts]) {
      if (t.at <= system.currentTick) {
        timeouts.delete(h);
        t.fn();
      }
    }
    for (const [, iv] of [...intervals]) {
      if (iv.next <= system.currentTick) {
        iv.next = system.currentTick + iv.every;
        iv.fn();
      }
    }
  }
}

export function fireScriptEvent(id, sourceEntity, message) {
  world.afterEvents /* keep shape stable */;
  system.afterEvents.scriptEventReceive.emit({ id, sourceEntity, message: message ?? "" });
}

/**
 * Wipe the real overworld and give it fresh terrain.
 *
 * Tests that exercise the per-tick companion loop have to use this rather than
 * `new Dimension(...)`: the loop only ever looks at the three dimensions
 * world.getDimension() knows about, so a detached one is never ticked and the
 * test would pass without running a single line of the behaviour under test.
 */
export function resetOverworld(terrain) {
  overworld.blocks.clear();
  overworld.entities.length = 0;
  overworld.writes = 0;
  overworld.reads = 0;
  if (terrain) overworld.terrain = terrain;
  return overworld;
}

export const testWorld = { overworld, nether, theEnd, dimensions, Player };
