/*
 * Minimal stand-in for @minecraft/server 1.11.0.
 *
 * It is not an emulator - it is a strict shape check. Every method validates
 * the arguments the way the real module does (rejecting NaN positions,
 * unknown TeleportOptions/EntityQueryOptions keys, applyImpulse on players,
 * non-integer effect durations) so tools/sim/run.mjs can drive the real
 * behaviour script through every code path and catch mistakes that would
 * otherwise only show up on a phone.
 */

export const calls = {
  particles: [],
  sounds: [],
  commands: [],
  messages: [],
  actionbars: [],
  effects: [],
  spawned: [],
  removed: [],
  killed: [],
  warnings: [],
};

let nextId = 1;
const entities = new Map();

class Block {
  constructor(air) {
    this.isAir = air;
    this.isLiquid = false;
  }
}

export class Dimension {
  constructor(id) {
    this.id = id;
  }
  spawnEntity(typeId, location) {
    if (!location || typeof location.x !== "number" || Number.isNaN(location.x)) {
      throw new Error(`bad spawn location for ${typeId}: ${JSON.stringify(location)}`);
    }
    const entity = new Entity(typeId, { ...location }, this);
    entities.set(entity.id, entity);
    calls.spawned.push(typeId);
    return entity;
  }
  spawnParticle(id, location) {
    if (!id.includes(":")) throw new Error(`particle id must be namespaced: ${id}`);
    if (!location || Number.isNaN(location.x + location.y + location.z)) {
      throw new Error(`bad particle location for ${id}`);
    }
    calls.particles.push(id);
  }
  playSound(id, location, options) {
    if (!location || Number.isNaN(location.x + location.y + location.z)) {
      throw new Error(`bad sound location for ${id}`);
    }
    if (options && options.pitch !== undefined && (options.pitch < 0 || options.pitch > 256)) {
      throw new Error(`bad pitch for ${id}`);
    }
    calls.sounds.push(id);
  }
  getBlock(location) {
    if (!location || Number.isNaN(location.x + location.y + location.z)) {
      throw new Error("bad getBlock location");
    }
    // Everything below y=0 is stone, everything above is air.
    return new Block(location.y >= 0);
  }
  getPlayers(options = {}) {
    return filterQuery([...entities.values()].filter((e) => e.typeId === "minecraft:player"), options, this);
  }
  getEntities(options = {}) {
    return filterQuery([...entities.values()], options, this);
  }
}

function filterQuery(pool, options, dimension) {
  const known = new Set(["location", "maxDistance", "minDistance", "type", "families", "closest", "farthest", "excludeTypes"]);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) throw new Error(`unsupported EntityQueryOptions key: ${key}`);
  }
  let list = pool.filter((e) => e.valid && e.dimension.id === dimension.id);
  if (options.type) list = list.filter((e) => e.typeId === options.type);
  if (options.families) {
    list = list.filter((e) => options.families.some((f) => e.families.includes(f)));
  }
  if (options.location) {
    const { x, y, z } = options.location;
    list = list
      .map((e) => ({ e, d: Math.hypot(e.location.x - x, e.location.y - y, e.location.z - z) }))
      .filter((row) => options.maxDistance === undefined || row.d <= options.maxDistance)
      .sort((a, b) => a.d - b.d)
      .map((row) => row.e);
  }
  if (options.closest !== undefined) list = list.slice(0, options.closest);
  return list;
}

export const overworld = new Dimension("minecraft:overworld");
export const nether = new Dimension("minecraft:nether");

export class Entity {
  constructor(typeId, location, dimension, families = []) {
    this.id = String(nextId++);
    this.typeId = typeId;
    this.location = location;
    this.dimension = dimension;
    this.families = families;
    this.valid = true;
    this.tags = new Set();
    this.props = new Map();
    this.components = new Map([
      ["minecraft:mark_variant", { value: 0 }],
      [
        "minecraft:health",
        {
          effectiveMax: 500,
          current: 500,
          setCurrentValue(v) {
            if (typeof v !== "number") throw new Error("bad health");
            this.current = v;
          },
        },
      ],
    ]);
  }
  isValid() {
    return this.valid;
  }
  getComponent(id) {
    return this.components.get(id);
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
  getDynamicProperty(k) {
    return this.props.get(k);
  }
  setDynamicProperty(k, v) {
    if (v === undefined) this.props.delete(k);
    else this.props.set(k, v);
  }
  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }
  teleport(location, options = {}) {
    if (!this.valid) throw new Error("teleport on invalid entity");
    if (!location || Number.isNaN(location.x + location.y + location.z)) {
      throw new Error(`bad teleport location: ${JSON.stringify(location)}`);
    }
    const known = new Set(["dimension", "facingLocation", "rotation", "keepVelocity", "checkForBlocks"]);
    for (const key of Object.keys(options)) {
      if (!known.has(key)) throw new Error(`unsupported TeleportOptions key: ${key}`);
    }
    if (options.facingLocation) {
      const f = options.facingLocation;
      if (Math.hypot(f.x - location.x, f.y - location.y, f.z - location.z) < 1e-6) {
        throw new Error("facingLocation equals destination");
      }
    }
    this.location = { ...location };
    if (options.dimension) this.dimension = options.dimension;
    return true;
  }
  applyImpulse(v) {
    if (this.typeId === "minecraft:player") throw new Error("applyImpulse not supported for players");
    if (Number.isNaN(v.x + v.y + v.z)) throw new Error("bad impulse");
    return undefined;
  }
  applyKnockback(a, b, c, d) {
    if (typeof a !== "number") throw new Error("legacy signature expects numbers");
    if ([a, b, c, d].some((n) => typeof n !== "number")) throw new Error("bad knockback");
    return undefined;
  }
  addEffect(type, duration, options) {
    if (typeof type !== "string") throw new Error("bad effect id");
    if (!Number.isInteger(duration) || duration <= 0) throw new Error(`bad effect duration ${duration}`);
    if (options && options.amplifier !== undefined && !Number.isInteger(options.amplifier)) {
      throw new Error("bad amplifier");
    }
    calls.effects.push(type);
    return undefined;
  }
  triggerEvent(name) {
    if (!name || !name.startsWith("god_eye:")) throw new Error(`bad event ${name}`);
  }
  kill() {
    calls.killed.push(this.typeId);
    this.valid = false;
    entities.delete(this.id);
    return true;
  }
  remove() {
    calls.removed.push(this.typeId);
    this.valid = false;
    entities.delete(this.id);
  }
  runCommand(cmd) {
    calls.commands.push(cmd);
    return { successCount: 1 };
  }
}

export class Player extends Entity {
  constructor(name, location, dimension) {
    super("minecraft:player", location, dimension, ["player", "mob"]);
    this.name = name;
    this.onScreenDisplay = {
      setActionBar: (t) => calls.actionbars.push(t),
    };
  }
  sendMessage(t) {
    calls.messages.push(t);
  }
}

/* --- registry helpers used by the test harness --------------------- */

export function register(entity) {
  entities.set(entity.id, entity);
  return entity;
}

export function makePlayer(name, location = { x: 0, y: 64, z: 0 }, dimension = overworld) {
  return register(new Player(name, location, dimension));
}

export function makeMob(typeId, location = { x: 2, y: 64, z: 2 }, dimension = overworld) {
  return register(new Entity(typeId, location, dimension, ["monster", "mob", "undead"]));
}

/* --- world / system ------------------------------------------------ */

function makeSignal() {
  const handlers = [];
  return {
    subscribe(fn) {
      handlers.push(fn);
      return fn;
    },
    unsubscribe() {},
    fire(event) {
      for (const fn of handlers) fn(event);
    },
  };
}

export const world = {
  afterEvents: {
    entityHurt: makeSignal(),
    entityHitEntity: makeSignal(),
    entitySpawn: makeSignal(),
    playerSpawn: makeSignal(),
  },
  getEntity(id) {
    const e = entities.get(id);
    return e && e.valid ? e : undefined;
  },
  getAllPlayers() {
    return [...entities.values()].filter((e) => e.typeId === "minecraft:player" && e.valid);
  },
  getDimension(id) {
    return id.includes("nether") ? nether : overworld;
  },
};

let tick = 0;
let nextRunId = 1;
const intervals = new Map();
const timeouts = new Map();
const immediate = [];

export const system = {
  get currentTick() {
    return tick;
  },
  run(fn) {
    immediate.push(fn);
    return nextRunId++;
  },
  runInterval(fn, period = 1) {
    const id = nextRunId++;
    intervals.set(id, { fn, period, next: tick + period });
    return id;
  },
  runTimeout(fn, delay = 1) {
    const id = nextRunId++;
    timeouts.set(id, { fn, at: tick + delay });
    return id;
  },
  clearRun(id) {
    intervals.delete(id);
    timeouts.delete(id);
  },
};

export function advance(ticks) {
  for (let i = 0; i < ticks; i += 1) {
    tick += 1;
    while (immediate.length) immediate.shift()();
    for (const [id, entry] of [...timeouts]) {
      if (entry.at <= tick) {
        timeouts.delete(id);
        entry.fn();
      }
    }
    for (const [, entry] of [...intervals]) {
      if (entry.next <= tick) {
        entry.next = tick + entry.period;
        entry.fn();
      }
    }
    while (immediate.length) immediate.shift()();
  }
}

export function pendingRuns() {
  return { intervals: intervals.size, timeouts: timeouts.size };
}

export function liveEntities() {
  return [...entities.values()];
}

/* Fail loudly on anything the script logs as a warning. */
const realWarn = console.warn;
console.warn = (...args) => {
  const line = args.join(" ");
  if (!line.includes("loaded.")) calls.warnings.push(line);
  realWarn(...args);
};
