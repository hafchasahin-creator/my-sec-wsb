/*
 * A small stand-in for @minecraft/server 1.11.0.
 *
 * It implements only the surface that behavior_packs/bodyguard_bp/scripts
 * actually uses, and it is deliberately strict: anything the real 1.11.0 API
 * does not expose is absent here too, so a typo or a 2.x-only call fails the
 * test instead of failing on a phone.
 */

export const GameMode = {
  adventure: "adventure",
  creative: "creative",
  spectator: "spectator",
  survival: "survival",
};

export const EquipmentSlot = {
  Chest: "Chest",
  Feet: "Feet",
  Head: "Head",
  Legs: "Legs",
  Mainhand: "Mainhand",
  Offhand: "Offhand",
};

export const EntityDamageCause = {
  entityAttack: "entityAttack",
  fall: "fall",
  magic: "magic",
  none: "none",
  projectile: "projectile",
};

export const EntityComponentTypes = {
  Equippable: "minecraft:equippable",
  Health: "minecraft:health",
  Inventory: "minecraft:inventory",
};

export const stats = {
  getEntitiesCalls: 0,
  getPlayersCalls: 0,
  particles: [],
  sounds: [],
  commands: [],
  knockbacks: [],
  damages: [],
  effects: [],
  teleports: [],
  messages: [],
  actionBars: [],
  triggered: [],
  errors: [],
};

export function resetStats() {
  stats.getEntitiesCalls = 0;
  stats.getPlayersCalls = 0;
  stats.particles.length = 0;
  stats.sounds.length = 0;
  stats.commands.length = 0;
  stats.knockbacks.length = 0;
  stats.damages.length = 0;
  stats.effects.length = 0;
  stats.teleports.length = 0;
  stats.messages.length = 0;
  stats.actionBars.length = 0;
  stats.triggered.length = 0;
}

let nextId = 1;

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId.includes(":") ? typeId : "minecraft:" + typeId;
    this.amount = amount;
    this.nameTag = undefined;
  }
  clone() {
    const copy = new ItemStack(this.typeId, this.amount);
    copy.nameTag = this.nameTag;
    return copy;
  }
}

class HealthComponent {
  constructor(entity, max) {
    this.entity = entity;
    this._max = max;
    this._value = max;
  }
  get currentValue() {
    return this._value;
  }
  get effectiveMax() {
    return this._max;
  }
  get effectiveMin() {
    return 0;
  }
  setCurrentValue(value) {
    this._value = Math.max(0, Math.min(this._max, value));
    return true;
  }
  setMax(value) {
    this._max = value;
    this._value = Math.min(this._value, value);
  }
}

class EquippableComponent {
  constructor(entity) {
    this.entity = entity;
    this.slots = new Map();
  }
  getEquipment(slot) {
    return this.slots.get(slot);
  }
  setEquipment(slot, stack) {
    if (stack === undefined) this.slots.delete(slot);
    else this.slots.set(slot, stack);
    return true;
  }
}

class Container {
  constructor(size) {
    this.size = size;
    this.items = new Array(size).fill(undefined);
  }
  get emptySlotsCount() {
    return this.items.filter((i) => !i).length;
  }
  getItem(slot) {
    return this.items[slot];
  }
  setItem(slot, stack) {
    this.items[slot] = stack;
  }
  addItem(stack) {
    const index = this.items.findIndex((i) => !i);
    if (index < 0) return stack;
    this.items[index] = stack;
    return undefined;
  }
}

class InventoryComponent {
  constructor(entity, size) {
    this.entity = entity;
    this.container = new Container(size);
    this.inventorySize = size;
  }
}

export class Entity {
  constructor(typeId, dimension, location) {
    this.id = String(nextId++);
    this.typeId = typeId;
    this.dimension = dimension;
    this.location = { ...location };
    this.nameTag = "";
    this._valid = true;
    this._properties = new Map();
    this._tags = new Set();
    this._components = new Map();
    this._components.set("minecraft:health", new HealthComponent(this, 40));
    this._components.set("minecraft:equippable", new EquippableComponent(this));
    this.componentGroups = new Set();
  }
  isValid() {
    return this._valid;
  }
  getComponent(id) {
    return this._components.get(id);
  }
  hasComponent(id) {
    return this._components.has(id);
  }
  getDynamicProperty(id) {
    return this._properties.get(id);
  }
  setDynamicProperty(id, value) {
    if (value === undefined) this._properties.delete(id);
    else this._properties.set(id, value);
  }
  getDynamicPropertyIds() {
    return Array.from(this._properties.keys());
  }
  clearDynamicProperties() {
    this._properties.clear();
  }
  addTag(tag) {
    this._tags.add(tag);
    return true;
  }
  removeTag(tag) {
    return this._tags.delete(tag);
  }
  hasTag(tag) {
    return this._tags.has(tag);
  }
  getTags() {
    return Array.from(this._tags);
  }
  triggerEvent(name) {
    stats.triggered.push({ id: this.id, event: name });
    if (!KNOWN_EVENTS.has(name)) {
      throw new Error("entity has no event " + name);
    }
  }
  addEffect(type, duration, options) {
    stats.effects.push({ id: this.id, type, duration, options });
  }
  removeEffect() {
    return true;
  }
  getEffect() {
    return undefined;
  }
  applyDamage(amount, options) {
    stats.damages.push({ id: this.id, amount, options });
    const health = this.getComponent("minecraft:health");
    if (health) health.setCurrentValue(health.currentValue - amount);
    return true;
  }
  applyKnockback(dx, dz, h, v) {
    if ([dx, dz, h, v].some((n) => typeof n !== "number" || Number.isNaN(n))) {
      throw new Error("applyKnockback got a non-number");
    }
    stats.knockbacks.push({ id: this.id, dx, dz, h, v });
  }
  applyImpulse() {}
  teleport(location, options) {
    stats.teleports.push({ id: this.id, location, options, kind: "teleport" });
    this.location = { ...location };
    if (options && options.dimension) this.dimension = options.dimension;
  }
  tryTeleport(location, options) {
    stats.teleports.push({ id: this.id, location, options, kind: "try" });
    this.location = { ...location };
    if (options && options.dimension) this.dimension = options.dimension;
    return true;
  }
  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }
  getEntitiesFromViewDirection() {
    return [];
  }
  getRotation() {
    return { x: 0, y: 0 };
  }
  setRotation() {}
  getVelocity() {
    return { x: 0, y: 0, z: 0 };
  }
  runCommand(command) {
    stats.commands.push({ id: this.id, command });
    return { successCount: 1 };
  }
  remove() {
    this._valid = false;
    world._entities.delete(this.id);
    world.afterEvents.entityRemove._fire({ removedEntityId: this.id, typeId: this.typeId });
  }
  kill() {
    this._valid = false;
    return true;
  }
  playAnimation() {}
  matches() {
    return true;
  }
}

export class Player extends Entity {
  constructor(name, dimension, location) {
    super("minecraft:player", dimension, location);
    this.name = name;
    this._gameMode = GameMode.survival;
    this._components.set("minecraft:inventory", new InventoryComponent(this, 36));
    this.onScreenDisplay = {
      setActionBar: (text) => stats.actionBars.push({ name, text }),
      setTitle: () => {},
      updateSubtitle: () => {},
    };
  }
  getGameMode() {
    return this._gameMode;
  }
  setGameMode(mode) {
    this._gameMode = mode;
  }
  sendMessage(text) {
    stats.messages.push({ name: this.name, text });
  }
  playSound(id, options) {
    stats.sounds.push({ id, options });
  }
}

class Dimension {
  constructor(id) {
    this.id = id;
  }
  getEntities(options = {}) {
    stats.getEntitiesCalls += 1;
    let list = Array.from(world._entities.values()).filter(
      (e) => e.isValid() && e.dimension === this
    );
    if (options.type) list = list.filter((e) => e.typeId === options.type);
    if (options.families) {
      list = list.filter((e) => (e._families || []).some((f) => options.families.includes(f)));
    }
    if (options.excludeFamilies) {
      list = list.filter(
        (e) => !(e._families || []).some((f) => options.excludeFamilies.includes(f))
      );
    }
    if (options.location && options.maxDistance !== undefined) {
      list = list.filter((e) => {
        const dx = e.location.x - options.location.x;
        const dy = e.location.y - options.location.y;
        const dz = e.location.z - options.location.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) <= options.maxDistance;
      });
    }
    return list;
  }
  getPlayers(options = {}) {
    stats.getPlayersCalls += 1;
    return this.getEntities({ ...options, type: "minecraft:player" });
  }
  playSound(id, location, options) {
    stats.sounds.push({ id, location, options });
  }
  spawnParticle(id, location) {
    if (typeof id !== "string" || !id.length) throw new Error("bad particle id");
    stats.particles.push({ id, location });
  }
  spawnEntity(typeId, location) {
    const entity = new Entity(typeId, this, location);
    if (typeId === "bg:bodyguard") entity._families = ["bodyguard", "mob"];
    world._entities.set(entity.id, entity);
    world.afterEvents.entitySpawn._fire({ entity, cause: "Spawned" });
    return entity;
  }
  spawnItem(stack, location) {
    const entity = new Entity("minecraft:item", this, location);
    entity.stack = stack;
    return entity;
  }
  createExplosion() {
    return true;
  }
  getBlock() {
    return undefined;
  }
  runCommand(command) {
    stats.commands.push({ id: this.id, command });
    return { successCount: 1 };
  }
}

class Signal {
  constructor(name) {
    this.name = name;
    this.handlers = [];
  }
  subscribe(handler, options) {
    this.handlers.push({ handler, options });
    return handler;
  }
  unsubscribe(handler) {
    this.handlers = this.handlers.filter((h) => h.handler !== handler);
  }
  _fire(event) {
    for (const { handler, options } of this.handlers) {
      if (options && options.entityTypes && event.entity) {
        if (!options.entityTypes.includes(event.entity.typeId)) continue;
      }
      try {
        handler(event);
      } catch (err) {
        stats.errors.push({ signal: this.name, error: String(err && err.stack ? err.stack : err) });
      }
    }
  }
}

const AFTER_EVENTS = [
  "entitySpawn", "entityLoad", "entityRemove", "entityDie", "entityHurt",
  "entityHitEntity", "entityHealthChanged", "dataDrivenEntityTrigger",
  "itemUse", "itemUseOn", "playerJoin", "playerLeave", "playerSpawn",
  "worldInitialize",
];

class World {
  constructor() {
    this._entities = new Map();
    this._dimensions = new Map();
    this.afterEvents = {};
    for (const name of AFTER_EVENTS) this.afterEvents[name] = new Signal(name);
    this.beforeEvents = { itemUse: new Signal("itemUse") };
    this._properties = new Map();
  }
  getDimension(id) {
    if (!this._dimensions.has(id)) this._dimensions.set(id, new Dimension(id));
    return this._dimensions.get(id);
  }
  getAllPlayers() {
    return Array.from(this._entities.values()).filter(
      (e) => e.typeId === "minecraft:player" && e.isValid()
    );
  }
  getPlayers(options) {
    return this.getAllPlayers();
  }
  getEntity(id) {
    const entity = this._entities.get(id);
    return entity && entity.isValid() ? entity : undefined;
  }
  sendMessage(text) {
    stats.messages.push({ name: "*", text });
  }
  playSound(id, location, options) {
    stats.sounds.push({ id, location, options });
  }
  getDynamicProperty(id) {
    return this._properties.get(id);
  }
  setDynamicProperty(id, value) {
    this._properties.set(id, value);
  }
}

class System {
  constructor() {
    this.currentTick = 0;
    this._intervals = [];
    this._timeouts = [];
    this._immediate = [];
    this._nextRun = 1;
  }
  run(callback) {
    this._immediate.push(callback);
    return this._nextRun++;
  }
  runTimeout(callback, delay = 0) {
    this._timeouts.push({ at: this.currentTick + delay, callback });
    return this._nextRun++;
  }
  runInterval(callback, interval = 1) {
    this._intervals.push({ interval, next: this.currentTick + interval, callback });
    return this._nextRun++;
  }
  clearRun() {}
  /** Advance the simulated clock, running everything that is due. */
  advance(ticks) {
    for (let i = 0; i < ticks; i++) {
      this.currentTick += 1;
      const immediate = this._immediate.splice(0, this._immediate.length);
      for (const callback of immediate) this._guard(callback);
      const due = this._timeouts.filter((t) => t.at <= this.currentTick);
      this._timeouts = this._timeouts.filter((t) => t.at > this.currentTick);
      for (const timeout of due) this._guard(timeout.callback);
      for (const entry of this._intervals) {
        if (this.currentTick >= entry.next) {
          entry.next = this.currentTick + entry.interval;
          this._guard(entry.callback);
        }
      }
    }
  }
  _guard(callback) {
    try {
      callback();
    } catch (err) {
      stats.errors.push({ signal: "system", error: String(err && err.stack ? err.stack : err) });
    }
  }
}

export const world = new World();
export const system = new System();

/** Loaded from the real entity JSON so triggerEvent typos fail the test. */
export const KNOWN_EVENTS = new Set();
export function loadKnownEvents(events) {
  for (const name of events) KNOWN_EVENTS.add(name);
}
