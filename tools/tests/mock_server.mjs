/* Minimal stand-in for @minecraft/server, enough to exercise main.js. */

export const GameMode = { creative: "creative", spectator: "spectator", survival: "survival" };
export const EntityDamageCause = { entityAttack: "entityAttack" };

export const log = [];

let nextId = 1;

export class MockEntity {
  constructor(typeId, location, opts = {}) {
    this.id = String(nextId++);
    this.typeId = typeId;
    this.location = location;
    this.tags = new Set(opts.tags ?? []);
    this.removed = false;
    this.events = [];
    this.knockbacks = [];
    this.effects = [];
    this.damage = 0;
    this.gameMode = opts.gameMode ?? GameMode.survival;
    this.dimension = opts.dimension;
    if (opts.health !== undefined) {
      const self = this;
      this.health = {
        currentValue: opts.health,
        effectiveMax: opts.maxHealth ?? opts.health,
        setCurrentValue(v) {
          this.currentValue = v;
          log.push(`heal:${self.typeId}:${v}`);
        },
      };
    }
  }
  getComponent(id) {
    if (id === "minecraft:health") return this.health;
    return undefined;
  }
  getTags() { return [...this.tags]; }
  addTag(t) { this.tags.add(t); return true; }
  removeTag(t) { return this.tags.delete(t); }
  hasTag(t) { return this.tags.has(t); }
  remove() {
    if (this.typeId === "minecraft:player") throw new Error("cannot remove player");
    this.removed = true;
    log.push(`remove:${this.typeId}`);
  }
  kill() { this.removed = true; log.push(`kill:${this.typeId}`); }
  applyDamage(amount) { this.damage += amount; log.push(`damage:${this.typeId}:${amount}`); return true; }
  applyKnockback(...args) { this.knockbacks.push(args); log.push(`knockback:${this.typeId}`); }
  addEffect(id) { this.effects.push(id); }
  triggerEvent(e) { this.events.push(e); log.push(`event:${this.typeId}:${e}`); }
}

class MockDimension {
  constructor(id) { this.id = id; this.entities = []; }
  getEntities(options = {}) {
    let list = this.entities.filter((e) => !e.removed);
    if (options.type) list = list.filter((e) => e.typeId === options.type);
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
  spawnParticle() {}
  playSound(id) { log.push(`sound:${id}`); }
}

const dimensions = new Map([
  ["minecraft:overworld", new MockDimension("minecraft:overworld")],
  ["minecraft:nether", new MockDimension("minecraft:nether")],
  ["minecraft:the_end", new MockDimension("minecraft:the_end")],
]);

export const world = {
  getDimension(id) {
    const d = dimensions.get(id);
    if (!d) throw new Error(`no dimension ${id}`);
    return d;
  },
  getPlayers(options = {}) {
    const all = [...dimensions.values()].flatMap((d) => d.entities);
    return all.filter(
      (e) => e.typeId === "minecraft:player" &&
        !e.removed &&
        (!options.gameMode || e.gameMode === options.gameMode)
    );
  },
  afterEvents: { playerSpawn: { subscribe() {} } },
};

export const intervals = [];
export const system = {
  runInterval(callback, ticks) { intervals.push({ callback, ticks }); return intervals.length; },
  runTimeout(callback) { callback(); },
  run(callback) { callback(); },
};

export function spawn(typeId, location, opts = {}) {
  const dimension = dimensions.get(opts.dimensionId ?? "minecraft:overworld");
  const entity = new MockEntity(typeId, location, { ...opts, dimension });
  dimension.entities.push(entity);
  return entity;
}

export function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    for (const { callback } of intervals) callback();
  }
}
