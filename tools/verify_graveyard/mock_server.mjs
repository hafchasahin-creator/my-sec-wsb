// Minimal stand-in for the Bedrock scripting API, enough to haunt a graveyard.
//
// Beyond the usual: a block world (stone to y = 64, air above, plus walls the
// tests can raise to break line of sight), a clock the tests can set to night
// or day, and a record of every fog command, because the fog is part of the
// horror and worth asserting.

export const handlers = {
  entityHurt: [],
  entitySpawn: [],
  itemUse: [],
  playerBreakBlock: [],
  playerPlaceBlock: [],
  playerSpawn: [],
};

export const log = { particles: [], sounds: [], warnings: [], commands: [], items: [] };
export const terrain = { placed: new Map(), walls: new Set(), reads: 0 };

let currentTick = 0;
let timeOfDay = 15000; // night by default
const once = new Map();
const intervals = [];

function scheduleAt(tick, fn) {
  if (!once.has(tick)) once.set(tick, []);
  once.get(tick).push(fn);
}

export const system = {
  get currentTick() {
    return currentTick;
  },
  run: (fn) => scheduleAt(currentTick + 1, fn),
  runTimeout: (fn, ticks) => scheduleAt(currentTick + Math.max(1, ticks), fn),
  runInterval: (fn, period) => intervals.push({ period: Math.max(1, period), fn }),
};

export function runTicks(count) {
  for (let step = 0; step < count; step += 1) {
    currentTick += 1;
    for (const fn of once.get(currentTick) ?? []) fn();
    once.delete(currentTick);
    for (const interval of intervals) {
      if (currentTick % interval.period === 0) interval.fn();
    }
  }
}

export function setTime(value) {
  timeOfDay = value;
}

export const EntityDamageCause = { entityAttack: "entityAttack" };
export const console = { warn: (message) => log.warnings.push(message) };

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
}

export class BlockPermutation {
  constructor(id, states) {
    this.type = { id };
    this.states = states;
  }
  static resolve(id, states) {
    if (typeof id !== "string" || !id.includes(":")) throw new Error(`bad id ${id}`);
    return new BlockPermutation(id, states);
  }
}

/* ------------------------------------------------------------------ */

const everything = [];
const worldProperties = new Map();
let idCounter = 0;

export function reset() {
  everything.length = 0;
  terrain.placed.clear();
  terrain.walls.clear();
  terrain.reads = 0;
  log.particles.length = 0;
  log.sounds.length = 0;
  log.warnings.length = 0;
  log.commands.length = 0;
  log.items.length = 0;
  worldProperties.clear();
  timeOfDay = 15000;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const cellKey = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;

/** Raise a solid wall the tests can hide the wraith behind. */
export function buildWall(x, y, z, height = 3) {
  for (let step = 0; step < height; step += 1) terrain.walls.add(`${x},${y + step},${z}`);
}

export const dimension = {
  id: "minecraft:overworld",
  spawnParticle(id, location) {
    if (!location || Number.isNaN(location.x)) throw new Error("bad particle location");
    log.particles.push({ id, location });
  },
  playSound(id, location) {
    log.sounds.push({ id, location });
  },
  spawnEntity(typeId, location) {
    return new Entity(typeId, location, { dimension: DIMENSIONS[this.id] ?? dimension });
  },
  spawnItem(stack, location) {
    log.items.push({ typeId: stack.typeId, amount: stack.amount, location });
  },
  getBlock(location) {
    terrain.reads += 1;
    const key = cellKey(location);
    const y = Math.floor(location.y);
    if (y < -64 || y > 320) return undefined;
    const placed = terrain.placed.get(key);
    const solid = placed
      ? placed !== "minecraft:air"
      : terrain.walls.has(key) || y <= 64;
    const typeId = placed ?? (terrain.walls.has(key) ? "minecraft:stone" : solid ? "minecraft:stone" : "minecraft:air");
    const container = [];
    return {
      typeId,
      location: { x: Math.floor(location.x), y, z: Math.floor(location.z) },
      isAir: !solid,
      isLiquid: false,
      permutation: { type: { id: typeId } },
      setPermutation(permutation) {
        terrain.placed.set(key, permutation.type.id);
      },
      setType(id) {
        terrain.placed.set(key, id);
      },
      getComponent(name) {
        if (name !== "minecraft:inventory") return undefined;
        if (typeId !== "minecraft:chest") return undefined;
        return { container: { addItem: (stack) => container.push(stack), items: container } };
      },
    };
  },
  getEntities(options = {}) {
    let found = everything.filter((e) => e.isValid() && e.dimension.id === this.id);
    if (options.type) found = found.filter((e) => e.typeId === options.type);
    if (options.families) {
      found = found.filter((e) => options.families.some((f) => e.families.includes(f)));
    }
    if (options.location) {
      found = found.filter((e) => distance(e.location, options.location) <= options.maxDistance);
    }
    return found;
  },
};

export const nether = { ...dimension, id: "minecraft:nether" };
const DIMENSIONS = { "minecraft:overworld": dimension, "minecraft:nether": nether };

export class Entity {
  constructor(typeId, location, options = {}) {
    this.typeId = typeId;
    this.id = `${typeId}#${(idCounter += 1)}`;
    this.location = { ...location };
    this.dimension = options.dimension ?? dimension;
    this.families = options.families ?? [];
    this.health = options.health ?? 20;
    this.dead = false;
    this.removed = false;
    this.events = [];
    this.properties = new Map();
    everything.push(this);
    for (const handler of handlers.entitySpawn) handler({ entity: this, cause: "Spawned" });
  }

  isValid() {
    return !this.dead;
  }

  getDynamicProperty(key) {
    return this.properties.get(key);
  }

  setDynamicProperty(key, value) {
    this.properties.set(key, value);
  }

  triggerEvent(name) {
    this.events.push(name);
  }

  teleport(location, options = {}) {
    this.location = { ...location };
    if (options.dimension) this.dimension = options.dimension;
  }

  applyDamage(amount, options = {}) {
    if (this.dead) return false;
    this.health -= amount;
    this.lastDamage = amount;
    if (this.health <= 0) this.dead = true;
    for (const handler of handlers.entityHurt) {
      handler({
        hurtEntity: this,
        damage: amount,
        damageSource: { cause: options.cause ?? "entityAttack", damagingEntity: options.damagingEntity },
      });
    }
    return true;
  }

  kill() {
    this.dead = true;
    return true;
  }

  remove() {
    this.dead = true;
    this.removed = true;
  }

  getComponent() {
    return undefined;
  }
}

export class Player extends Entity {
  constructor(location, options = {}) {
    super("minecraft:player", location, { ...options, families: ["player"] });
    this.name = options.name ?? "Steve";
    this.isSneaking = false;
    this.messages = [];
    this.actionBars = [];
    this.effects = [];
    this.viewDirection = options.viewDirection ?? { x: 0, y: 0, z: 1 };
    this.onScreenDisplay = { setActionBar: (text) => this.actionBars.push(text) };
  }

  getViewDirection() {
    return this.viewDirection;
  }

  getHeadLocation() {
    return { x: this.location.x, y: this.location.y + 1.6, z: this.location.z };
  }

  /** Point the player at a location, the way a real one would turn. */
  lookAt(target) {
    const eye = this.getHeadLocation();
    const dx = target.x - eye.x;
    const dy = target.y + 1 - eye.y;
    const dz = target.z - eye.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    this.viewDirection = { x: dx / length, y: dy / length, z: dz / length };
  }

  lookAway() {
    this.viewDirection = { x: -this.viewDirection.x, y: 0, z: -this.viewDirection.z };
  }

  sendMessage(text) {
    this.messages.push(text);
  }

  addEffect(name, duration, options) {
    this.effects.push({ name, duration, options });
  }

  runCommand(command) {
    log.commands.push(command);
    return { successCount: 1 };
  }
}

export const world = {
  afterEvents: {
    entityHurt: { subscribe: (fn) => handlers.entityHurt.push(fn) },
    entitySpawn: { subscribe: (fn) => handlers.entitySpawn.push(fn) },
    itemUse: { subscribe: (fn) => handlers.itemUse.push(fn) },
    playerBreakBlock: { subscribe: (fn) => handlers.playerBreakBlock.push(fn) },
    playerPlaceBlock: { subscribe: (fn) => handlers.playerPlaceBlock.push(fn) },
    playerSpawn: { subscribe: (fn) => handlers.playerSpawn.push(fn) },
  },
  getDimension: (id) => DIMENSIONS[id],
  getAllPlayers: () => everything.filter((e) => e.typeId === "minecraft:player" && e.isValid()),
  getTimeOfDay: () => timeOfDay,
  getDynamicProperty: (key) => worldProperties.get(key),
  setDynamicProperty: (key, value) => worldProperties.set(key, value),
  sendMessage: () => {},
};

export function useItem(player, typeId) {
  for (const handler of handlers.itemUse) handler({ source: player, itemStack: { typeId } });
}

export function breakBlock(player, typeId, location) {
  terrain.placed.set(cellKey(location), "minecraft:air");
  for (const handler of handlers.playerBreakBlock) {
    handler({
      player,
      dimension: player.dimension,
      block: { location, typeId: "minecraft:air" },
      brokenBlockPermutation: { type: { id: typeId } },
    });
  }
}

export function placeBlock(player, typeId, location) {
  terrain.placed.set(cellKey(location), typeId);
  for (const handler of handlers.playerPlaceBlock) {
    handler({
      player,
      dimension: player.dimension,
      block: { location, typeId, permutation: { type: { id: typeId } } },
    });
  }
}
