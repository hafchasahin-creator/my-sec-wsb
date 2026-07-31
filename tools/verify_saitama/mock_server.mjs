// Minimal stand-in for the Bedrock scripting API, enough to run the hero bot.
//
// Two things it has to model faithfully. applyDamage() re-raises entityHurt
// synchronously, as the game does, so the bot's own killing blow must not come
// back as a fresh attack on its owner. And getBlock() serves a real terrain
// column - stone below y = 64, air above, bedrock at the bottom - so the
// serious punch is measured against something it can actually dig through.

export const handlers = {
  entityHurt: [],
  entitySpawn: [],
  playerInteractWithEntity: [],
  playerSpawn: [],
  scriptEventReceive: [],
};

// Blocks the punch has cleared, plus a counter of getBlock calls per tick so
// the tests can prove the demolition stays inside its budget.
export const terrain = { cleared: new Set(), reads: 0, peakReadsPerTick: 0 };

export const log = { particles: [], sounds: [], warnings: [] };

let currentTick = 0;
const once = new Map(); // tick -> callbacks
const intervals = []; // { period, fn }

function scheduleAt(tick, fn) {
  if (!once.has(tick)) once.set(tick, []);
  once.get(tick).push(fn);
}

export const system = {
  afterEvents: {
    scriptEventReceive: { subscribe: (fn) => handlers.scriptEventReceive.push(fn) },
  },
  get currentTick() {
    return currentTick;
  },
  run: (fn) => scheduleAt(currentTick + 1, fn),
  runTimeout: (fn, ticks) => scheduleAt(currentTick + Math.max(1, ticks), fn),
  runInterval: (fn, period) => {
    intervals.push({ period: Math.max(1, period), fn });
    return intervals.length - 1;
  },
};

export function runTicks(count) {
  for (let step = 0; step < count; step += 1) {
    currentTick += 1;
    terrain.reads = 0;
    for (const fn of once.get(currentTick) ?? []) fn();
    once.delete(currentTick);
    for (const interval of intervals) {
      if (currentTick % interval.period === 0) interval.fn();
    }
    if (terrain.reads > terrain.peakReadsPerTick) terrain.peakReadsPerTick = terrain.reads;
  }
}

export const EntityDamageCause = { entityAttack: "entityAttack" };
export const console = { warn: (message) => log.warnings.push(message) };

/* ------------------------------------------------------------------ */

const everything = [];
const worldProperties = new Map();
// Entity ids must stay unique across resets: the script keeps an in-memory
// fallback keyed by entity id, and the real game never reuses one.
let idCounter = 0;

export function reset() {
  terrain.cleared.clear();
  terrain.reads = 0;
  terrain.peakReadsPerTick = 0;
  everything.length = 0;
  log.particles.length = 0;
  log.sounds.length = 0;
  log.warnings.length = 0;
  worldProperties.clear();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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
  getBlock(location) {
    terrain.reads += 1;
    const x = Math.floor(location.x), y = Math.floor(location.y), z = Math.floor(location.z);
    const key = `${x},${y},${z}`;
    if (y < -64 || y > 320) return undefined;
    const bedrock = y === -64;
    const solid = y <= 64 && !terrain.cleared.has(key);
    return {
      typeId: bedrock ? "minecraft:bedrock" : solid ? "minecraft:stone" : "minecraft:air",
      isAir: !bedrock && !solid,
      isLiquid: false,
      permutation: { type: { id: solid ? "minecraft:stone" : "minecraft:air" } },
      setType(id) {
        if (bedrock) throw new Error("bedrock was cleared, which must never happen");
        if (id === "minecraft:air") terrain.cleared.add(key);
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
export const theEnd = { ...dimension, id: "minecraft:the_end" };
const DIMENSIONS = { "minecraft:overworld": dimension, "minecraft:nether": nether, "minecraft:the_end": theEnd };

export class Entity {
  constructor(typeId, location, options = {}) {
    this.typeId = typeId;
    this.id = options.id ?? `${typeId}#${(idCounter += 1)}`;
    this.location = { ...location };
    this.dimension = options.dimension ?? dimension;
    this.families = options.families ?? [];
    this.health = options.health ?? 20;
    this.dead = false;
    this.nameTag = undefined;
    this.properties = new Map();
    this.damageEvents = 0;
    this.teleports = 0;
    this.events = [];
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
    if (value === undefined) this.properties.delete(key);
    else this.properties.set(key, value);
  }

  teleport(location, options = {}) {
    this.teleports += 1;
    this.location = { ...location };
    if (options.dimension) this.dimension = options.dimension;
    if (options.facingLocation && Number.isNaN(options.facingLocation.x)) {
      throw new Error("bad facingLocation");
    }
  }

  applyDamage(amount, options = {}) {
    if (this.dead) return false;
    this.damageEvents += 1;
    if (this.damageEvents > 50) throw new Error(`runaway damage loop on ${this.id}`);
    this.health -= amount;
    if (this.health <= 0) this.dead = true;
    for (const handler of handlers.entityHurt) {
      handler({
        hurtEntity: this,
        damage: amount,
        damageSource: {
          cause: options.cause ?? "entityAttack",
          damagingEntity: options.damagingEntity,
        },
      });
    }
    return true;
  }

  triggerEvent(name) {
    this.events.push(name);
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
    this.maxHealth = 20;
    this.onScreenDisplay = { setActionBar: (text) => this.actionBars.push(text) };
  }

  getViewDirection() {
    return this.viewDirection ?? { x: 0, y: 0, z: 1 };
  }

  sendMessage(text) {
    this.messages.push(text);
  }

  addEffect(name, duration, options) {
    this.effects.push({ name, duration, options });
  }

  getComponent(id) {
    if (id !== "minecraft:health") return undefined;
    const self = this;
    return {
      get currentValue() {
        return self.health;
      },
      effectiveMax: self.maxHealth,
      defaultValue: self.maxHealth,
      setCurrentValue(value) {
        self.health = value;
      },
    };
  }
}

export const world = {
  afterEvents: {
    entityHurt: { subscribe: (fn) => handlers.entityHurt.push(fn) },
    entitySpawn: { subscribe: (fn) => handlers.entitySpawn.push(fn) },
    playerInteractWithEntity: {
      subscribe: (fn) => handlers.playerInteractWithEntity.push(fn),
    },
    playerSpawn: { subscribe: (fn) => handlers.playerSpawn.push(fn) },
  },
  getDimension: (id) => DIMENSIONS[id],
  getAllPlayers: () => everything.filter((e) => e.typeId === "minecraft:player" && e.isValid()),
  getDynamicProperty: (key) => worldProperties.get(key),
  setDynamicProperty: (key, value) => worldProperties.set(key, value),
  sendMessage: () => {},
};

export function scriptEvent(id, sourceEntity) {
  for (const handler of handlers.scriptEventReceive) handler({ id, sourceEntity });
}

export function interact(player, target) {
  for (const handler of handlers.playerInteractWithEntity) handler({ player, target });
}
