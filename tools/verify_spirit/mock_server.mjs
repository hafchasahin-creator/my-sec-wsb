// Minimal stand-in for the Bedrock scripting API, enough to fly the spirit.
//
// As in the armoury mock, applyDamage() re-raises entityHurt synchronously the
// way the real game does - here that matters because the spirit's own killing
// blow must not come back as "something attacked my owner".

export const handlers = {
  entityHurt: [],
  entitySpawn: [],
  playerInteractWithEntity: [],
  playerSpawn: [],
};

export const log = { particles: [], sounds: [], warnings: [] };

let currentTick = 0;
const once = new Map(); // tick -> callbacks
const intervals = []; // { period, fn }

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
  runInterval: (fn, period) => {
    intervals.push({ period: Math.max(1, period), fn });
    return intervals.length - 1;
  },
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

export const EntityDamageCause = { entityAttack: "entityAttack" };
export const console = { warn: (message) => log.warnings.push(message) };

/* ------------------------------------------------------------------ */

const everything = [];
const worldProperties = new Map();
// Entity ids must stay unique across resets: the script keeps an in-memory
// fallback keyed by entity id, and the real game never reuses one.
let idCounter = 0;

export function reset() {
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

export function interact(player, target) {
  for (const handler of handlers.playerInteractWithEntity) handler({ player, target });
}
