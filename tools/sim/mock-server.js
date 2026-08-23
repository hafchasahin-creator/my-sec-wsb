/*
 * A small stand-in for @minecraft/server, enough to run a behaviour pack's
 * script outside Minecraft and drive it tick by tick.
 *
 * It is deliberately strict: any API member the real 1.11.0 module does not
 * have is simply absent here, so a script that reaches for one fails in the
 * harness instead of on someone's phone. Where the real module throws - most
 * importantly applyImpulse on a Player - this throws too.
 */

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const EquipmentSlot = {
  Head: "Head",
  Chest: "Chest",
  Legs: "Legs",
  Feet: "Feet",
  Mainhand: "Mainhand",
  Offhand: "Offhand",
};

export const EntityDamageCause = {
  contact: "contact",
  entityAttack: "entityAttack",
  entityExplosion: "entityExplosion",
  fall: "fall",
  fire: "fire",
  fireTick: "fireTick",
  freezing: "freezing",
  lava: "lava",
  magic: "magic",
  none: "none",
  projectile: "projectile",
  selfDestruct: "selfDestruct",
  suffocation: "suffocation",
  void: "void",
  wither: "wither",
};

export const GameMode = {
  adventure: "adventure",
  creative: "creative",
  spectator: "spectator",
  survival: "survival",
};

/* ------------------------------------------------------------------ *
 * The recorder - every observable side effect lands here
 * ------------------------------------------------------------------ */

export const log = {
  sounds: [],
  particles: [],
  commands: [],
  messages: [],
  titles: [],
  actionBars: [],
  explosions: [],
  damage: [],
  effects: [],
  spawns: [],
  removals: [],
  events: [],
  warnings: [],
  // Call counters rather than records: these fire often enough that keeping
  // every one would dwarf everything else in the log.
  counts: { getEntities: 0, entitiesScanned: 0 },
  reset() {
    for (const key of Object.keys(this)) {
      if (Array.isArray(this[key])) this[key].length = 0;
    }
    for (const key of Object.keys(this.counts)) this.counts[key] = 0;
  },
};

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
  }
  clone() {
    return new ItemStack(this.typeId, this.amount);
  }
  getComponent() {
    return undefined;
  }
}

class Container {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
  }
  getItem(index) {
    const item = this.slots[index];
    // The real API hands back a copy; writing to it does not touch the
    // container until setItem. Modelling that is the whole point here.
    return item ? item.clone() : undefined;
  }
  setItem(index, item) {
    if (index < 0 || index >= this.size) throw new Error("slot out of range");
    this.slots[index] = item ? item.clone() : undefined;
  }
  addItem(item) {
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        this.slots[i] = item.clone();
        return undefined;
      }
    }
    return item;
  }
  countOf(typeId) {
    let total = 0;
    for (const item of this.slots) {
      if (item?.typeId === typeId) total += item.amount;
    }
    return total;
  }
}

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

let nextId = 1;

export class Entity {
  constructor(typeId, dimension, location) {
    this.id = `e${nextId++}`;
    this.typeId = typeId;
    this.dimension = dimension;
    this.location = { ...location };
    this.isValid = true;
    this.nameTag = "";
    this.velocity = { x: 0, y: 0, z: 0 };
    this.tags = new Set();
    this.effects = new Map();
    this.triggered = [];
    this.health = { current: 20, max: 20 };
    this.viewDirection = { x: 0, y: 0, z: 1 };
    this.componentOverrides = {};
  }

  getComponent(id) {
    if (this.componentOverrides[id] !== undefined) return this.componentOverrides[id];
    if (id === "minecraft:health") {
      const self = this;
      return {
        get currentValue() {
          return self.health.current;
        },
        get effectiveMax() {
          return self.health.max;
        },
        get defaultValue() {
          return self.health.max;
        },
        setCurrentValue(value) {
          self.health.current = value;
          if (value <= 0) self.dimension.world._die(self);
        },
      };
    }
    return undefined;
  }

  addTag(tag) {
    this.tags.add(tag);
    return true;
  }
  removeTag(tag) {
    return this.tags.delete(tag);
  }
  hasTag(tag) {
    return this.tags.has(tag);
  }
  getTags() {
    return [...this.tags];
  }

  applyDamage(amount, options) {
    if (!this.isValid) throw new Error("entity is not valid");
    log.damage.push({ id: this.id, typeId: this.typeId, amount, cause: options?.cause });
    this.health.current -= amount;
    if (this.health.current <= 0) {
      this.health.current = 0;
      this.dimension.world._die(this);
    }
    return true;
  }

  addEffect(id, duration, options) {
    log.effects.push({ id: this.id, effect: id, duration, ...options });
    this.effects.set(id, { duration, amplifier: options?.amplifier ?? 0 });
  }

  setOnFire(seconds) {
    this.onFire = seconds;
    return true;
  }

  applyImpulse(vector) {
    if (this.typeId === "minecraft:player") {
      // Matches the real module: Player does not support applyImpulse.
      throw new Error("applyImpulse is not supported for Player");
    }
    this.velocity = { ...vector };
    log.events.push({ kind: "impulse", id: this.id, vector });
  }

  triggerEvent(name) {
    if (!this.isValid) throw new Error("entity is not valid");
    this.triggered.push(name);
    log.events.push({ kind: "triggerEvent", id: this.id, name });
  }

  remove() {
    if (!this.isValid) throw new Error("entity is not valid");
    this.isValid = false;
    this.dimension._remove(this);
    log.removals.push({ id: this.id, typeId: this.typeId });
  }

  kill() {
    this.health.current = 0;
    this.dimension.world._die(this);
    return true;
  }

  getViewDirection() {
    return { ...this.viewDirection };
  }

  getHeadLocation() {
    return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
  }

  teleport(location, options) {
    this.location = { ...location };
    if (options?.dimension) {
      this.dimension._remove(this);
      this.dimension = options.dimension;
      options.dimension._add(this);
    }
  }

  runCommand(text) {
    log.commands.push({ id: this.id, text });
    return { successCount: 1 };
  }
}

export class Player extends Entity {
  constructor(name, dimension, location) {
    super("minecraft:player", dimension, location);
    this.name = name;
    this.gameMode = GameMode.survival;
    this._inventory = new Container(36);
    this._mainhand = undefined;
    this.onScreenDisplay = {
      setTitle: (text, options) => {
        log.titles.push({ player: name, text, ...options });
      },
      setActionBar: (text) => {
        log.actionBars.push({ player: name, text });
      },
      updateSubtitle: (text) => {
        log.titles.push({ player: name, subtitleUpdate: text });
      },
    };
  }

  getGameMode() {
    return this.gameMode;
  }

  sendMessage(text) {
    log.messages.push({ player: this.name, text });
  }

  playSound(id, options) {
    log.sounds.push({ player: this.name, id, ...options });
  }

  getComponent(id) {
    if (id === "minecraft:inventory") {
      return { container: this._inventory, inventorySize: this._inventory.size };
    }
    if (id === "minecraft:equippable") {
      const self = this;
      return {
        getEquipment(slot) {
          if (slot !== EquipmentSlot.Mainhand) return undefined;
          return self._mainhand ? self._mainhand.clone() : undefined;
        },
        setEquipment(slot, item) {
          if (slot !== EquipmentSlot.Mainhand) return false;
          self._mainhand = item ? item.clone() : undefined;
          return true;
        },
      };
    }
    return super.getComponent(id);
  }

  /** Convenience for tests: hold `count` of `typeId` and mirror it into slot 0. */
  hold(typeId, count = 1) {
    const stack = new ItemStack(typeId, count);
    this._mainhand = stack.clone();
    this._inventory.setItem(0, stack);
  }
}

/* ------------------------------------------------------------------ *
 * Dimension
 * ------------------------------------------------------------------ */

export class Dimension {
  constructor(id, world) {
    this.id = id;
    this.world = world;
    this.entities = new Set();
    /** Set to true to make spawnEntity fail, as an unloaded chunk would. */
    this.spawnFails = false;
  }

  _add(entity) {
    this.entities.add(entity);
  }
  _remove(entity) {
    this.entities.delete(entity);
  }

  spawnEntity(typeId, location) {
    if (this.spawnFails) throw new Error("chunk not loaded");
    const entity = new Entity(typeId, this, location);
    this._add(entity);
    log.spawns.push({ typeId, location: { ...location }, id: entity.id });
    this.world.afterEvents.entitySpawn.emit({ entity, cause: "Spawned" });
    return entity;
  }

  getEntities(options = {}) {
    log.counts.getEntities++;
    log.counts.entitiesScanned += this.entities.size;
    let found = [...this.entities];
    if (options.type) found = found.filter((e) => e.typeId === options.type);
    if (options.families) {
      found = found.filter((e) => (e.families ?? []).some((f) => options.families.includes(f)));
    }
    if (options.location && options.maxDistance !== undefined) {
      const { x, y, z } = options.location;
      found = found.filter((e) => {
        const dx = e.location.x - x;
        const dy = e.location.y - y;
        const dz = e.location.z - z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) <= options.maxDistance;
      });
    }
    return found;
  }

  spawnParticle(id, location) {
    log.particles.push({ id, location: { ...location } });
  }

  playSound(id, location, options) {
    log.sounds.push({ id, location: { ...location }, ...options });
  }

  createExplosion(location, radius, options) {
    log.explosions.push({ location: { ...location }, radius, ...options });
    return true;
  }

  getBlock(location) {
    return { location, isAir: location.y > 60, isLiquid: false };
  }

  runCommand(text) {
    log.commands.push({ dimension: this.id, text });
    return { successCount: 1 };
  }
}

/* ------------------------------------------------------------------ *
 * Events, world and the tick pump
 * ------------------------------------------------------------------ */

class Signal {
  constructor(name) {
    this.name = name;
    this.handlers = [];
  }
  subscribe(handler) {
    this.handlers.push(handler);
    return handler;
  }
  unsubscribe(handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
  emit(payload) {
    for (const handler of this.handlers) handler(payload);
  }
}

class World {
  constructor() {
    this.overworld = new Dimension("minecraft:overworld", this);
    this.nether = new Dimension("minecraft:nether", this);
    this.dimensions = { "minecraft:overworld": this.overworld, "minecraft:nether": this.nether };
    this.players = [];
    this.afterEvents = {
      itemUse: new Signal("itemUse"),
      entityDie: new Signal("entityDie"),
      entityHurt: new Signal("entityHurt"),
      entitySpawn: new Signal("entitySpawn"),
      entityLoad: new Signal("entityLoad"),
      playerSpawn: new Signal("playerSpawn"),
      playerLeave: new Signal("playerLeave"),
    };
    this.beforeEvents = {
      itemUse: new Signal("beforeItemUse"),
    };
  }

  getAllPlayers() {
    return this.players.filter((p) => p.isValid);
  }

  getDimension(id) {
    return this.dimensions[id];
  }

  sendMessage(text) {
    log.messages.push({ broadcast: true, text });
  }

  addPlayer(name, dimension = this.overworld, location = { x: 0, y: 64, z: 0 }) {
    const player = new Player(name, dimension, location);
    dimension._add(player);
    this.players.push(player);
    return player;
  }

  _die(entity) {
    if (entity._dead) return;
    entity._dead = true;
    this.afterEvents.entityDie.emit({
      deadEntity: entity,
      damageSource: { cause: EntityDamageCause.none },
    });
    // A dead mob leaves the world; a dead player stays a valid entity until
    // they respawn, which is how Bedrock behaves and what the script assumes.
    if (entity.typeId !== "minecraft:player") {
      entity.isValid = false;
      entity.dimension._remove(entity);
    }
  }
}

class System {
  constructor() {
    this.currentTick = 0;
    this.jobs = [];
    this.nextHandle = 1;
  }
  run(callback) {
    const handle = this.nextHandle++;
    this.jobs.push({ handle, kind: "once", at: this.currentTick + 1, callback });
    return handle;
  }
  runTimeout(callback, ticks = 0) {
    const handle = this.nextHandle++;
    this.jobs.push({ handle, kind: "once", at: this.currentTick + Math.max(1, ticks), callback });
    return handle;
  }
  runInterval(callback, ticks = 1) {
    const handle = this.nextHandle++;
    const period = Math.max(1, ticks);
    this.jobs.push({ handle, kind: "interval", at: this.currentTick + period, period, callback });
    return handle;
  }
  clearRun(handle) {
    this.jobs = this.jobs.filter((job) => job.handle !== handle);
  }

  /** Advance the world by `ticks`, running everything that is due. */
  pump(ticks) {
    for (let i = 0; i < ticks; i++) {
      this.currentTick++;
      const due = this.jobs.filter((job) => job.at <= this.currentTick);
      for (const job of due) {
        if (job.kind === "interval") {
          job.at = this.currentTick + job.period;
        } else {
          this.jobs = this.jobs.filter((other) => other !== job);
        }
        try {
          job.callback();
        } catch (err) {
          log.warnings.push(`uncaught in tick job: ${err?.stack ?? err}`);
        }
      }
    }
  }
}

export const world = new World();
export const system = new System();

// The script's own console.warn calls are diagnostics, so capture them.
const realWarn = console.warn;
console.warn = (...args) => {
  log.warnings.push(args.join(" "));
  if (process.env.SIM_VERBOSE) realWarn(...args);
};
