/*
 * Minimal stand-in for @minecraft/server, used only by tools/build_luxury_house.py
 * to run the add-on's own modules under Node and check what they produce.
 *
 * It implements exactly the surface the add-on touches. Anything the add-on
 * starts using that is not here will throw during validation, which is the
 * point: the harness should fail loudly rather than silently skip a code path.
 */

/** Block ids the fake engine will admit. Populated by the harness. */
export const KNOWN_BLOCKS = new Set(["minecraft:air"]);

/** Every command the add-on asked a dimension to run. */
export const COMMAND_LOG = [];

/** Every block the add-on wrote through the block API. */
export const BLOCK_LOG = [];

class FakeBlock {
  constructor(dimension, location) {
    this.dimension = dimension;
    this.location = location;
    this.typeId = "minecraft:air";
  }
  setPermutation(permutation) {
    this.typeId = permutation.id;
    BLOCK_LOG.push({ ...this.location, id: permutation.id });
  }
  setType(type) {
    this.typeId = typeof type === "string" ? type : type.id;
  }
  getComponent() {
    return undefined;
  }
}

class FakeDimension {
  constructor(id) {
    this.id = id;
  }
  runCommand(command) {
    COMMAND_LOG.push(command);
    return { successCount: 1 };
  }
  getBlock(location) {
    return new FakeBlock(this, location);
  }
  getEntities() {
    return [];
  }
  spawnEntity(typeId, location) {
    return {
      typeId,
      location,
      getComponent: () => ({ setEquipment: () => true }),
    };
  }
}

const dimensions = new Map();

function eventHub() {
  return new Proxy(
    {},
    {
      get: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
    }
  );
}

let players = [];
let timeOfDay = 6000;

/** A player the add-on can see. Only the surface the add-on touches. */
export function makePlayer(dimensionId, location) {
  return {
    id: `player-${Math.random().toString(36).slice(2)}`,
    dimension: { id: dimensionId },
    location,
    playSound: () => {},
    teleport(target) {
      this.location = { ...target };
    },
    addEffect: () => {},
    sendMessage: () => {},
    onScreenDisplay: { setTitle: () => {}, setActionBar: () => {} },
  };
}

export function setPlayers(list) {
  players = list;
}

export function setTimeOfDay(value) {
  timeOfDay = value;
}

export const world = {
  afterEvents: eventHub(),
  beforeEvents: eventHub(),
  getDimension(id) {
    if (!dimensions.has(id)) dimensions.set(id, new FakeDimension(id));
    return dimensions.get(id);
  },
  getAllPlayers: () => players,
  getDynamicProperty: () => undefined,
  setDynamicProperty: () => {},
  getTimeOfDay: () => timeOfDay,
  getAbsoluteTime: () => timeOfDay,
  playSound: () => {},
  sendMessage: () => {},
};

let nextHandle = 1;
const tasks = new Map();

export const system = {
  currentTick: 0,
  run(callback) {
    // module-init work should happen straight away so imports are exercised
    callback();
    return nextHandle++;
  },
  runTimeout(callback, ticks) {
    const handle = nextHandle++;
    tasks.set(handle, { callback, period: ticks, next: system.currentTick + ticks, once: true });
    return handle;
  },
  runInterval(callback, period) {
    const handle = nextHandle++;
    const every = Math.max(1, period);
    tasks.set(handle, { callback, period: every, next: system.currentTick + every });
    return handle;
  },
  clearRun(handle) {
    tasks.delete(handle);
  },
};

/** Advance the fake clock, running whatever the add-on scheduled. */
export function pump(ticks) {
  for (let i = 0; i < ticks; i++) {
    system.currentTick++;
    for (const [handle, task] of [...tasks]) {
      if (!tasks.has(handle)) continue;
      if (system.currentTick < task.next) continue;
      task.next = system.currentTick + task.period;
      if (task.once) tasks.delete(handle);
      task.callback();
    }
  }
}

export function pendingTasks() {
  return tasks.size;
}

export class BlockPermutation {
  constructor(id) {
    this.id = id;
  }
  static resolve(id) {
    if (!KNOWN_BLOCKS.has(id)) throw new Error(`unknown block id: ${id}`);
    return new BlockPermutation(id);
  }
}

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
}

export const EquipmentSlot = {
  Head: "Head",
  Chest: "Chest",
  Legs: "Legs",
  Feet: "Feet",
  Mainhand: "Mainhand",
  Offhand: "Offhand",
};

export const EntityDamageCause = { entityAttack: "entityAttack" };
