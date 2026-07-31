// Minimal stand-in for the Bedrock scripting API, enough to run the armoury.
//
// The important detail: applyDamage() re-raises entityHurt synchronously, the
// same way the real game does. That is the path that turns a careless kill
// handler into infinite recursion, so the mock has to reproduce it.

export const handlers = {
  entityHurt: [],
  itemUse: [],
  itemUseOn: [],
  playerSpawn: [],
};

export const log = { particles: [], sounds: [], warnings: [] };

let currentTick = 0;
const scheduled = new Map(); // tick -> callbacks

function scheduleAt(tick, fn) {
  if (!scheduled.has(tick)) scheduled.set(tick, []);
  scheduled.get(tick).push(fn);
}

export const system = {
  get currentTick() {
    return currentTick;
  },
  run: (fn) => scheduleAt(currentTick + 1, fn),
  runTimeout: (fn, ticks) => scheduleAt(currentTick + Math.max(1, ticks), fn),
};

/** Advance the world one tick, running whatever was scheduled for it. */
export function tick() {
  currentTick += 1;
  const due = scheduled.get(currentTick) ?? [];
  scheduled.delete(currentTick);
  for (const fn of due) fn();
  for (const player of players) player.tickCooldowns();
  return due.length;
}

export function runTicks(count) {
  let ran = 0;
  for (let i = 0; i < count; i += 1) ran += tick();
  return ran;
}

export const EquipmentSlot = { Mainhand: "Mainhand" };
export const EntityDamageCause = {
  entityAttack: "entityAttack",
  override: "override",
  fall: "fall",
};

export const console = {
  warn: (message) => log.warnings.push(message),
};

/* ------------------------------------------------------------------ */

const entities = [];
const players = [];

export function reset() {
  entities.length = 0;
  players.length = 0;
  log.particles.length = 0;
  log.sounds.length = 0;
  log.warnings.length = 0;
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
  getEntities(options = {}) {
    const live = [...entities, ...players].filter((e) => e.isValid());
    if (!options.location) return live;
    return live.filter((e) => distance(e.location, options.location) <= options.maxDistance);
  },
  getBlock(location) {
    // Solid ground below y = 0, open air above it.
    const solid = location.y < 0;
    return { isAir: !solid, isLiquid: false };
  },
};

export class Entity {
  constructor(typeId, location, health = 20, options = {}) {
    this.typeId = typeId;
    this.id = `${typeId}#${entities.length + players.length}`;
    this.location = { ...location };
    this.health = health;
    this.dead = false;
    this.dimension = dimension;
    this.nameTag = options.nameTag;
    this.tamed = options.tamed ?? false;
    this.damageEvents = 0;
    this.killCalls = 0;
    this.knockbacks = 0;
    entities.push(this);
  }

  isValid() {
    return !this.dead;
  }

  getComponent(id) {
    if (id === "minecraft:is_tamed" && this.tamed) return {};
    return undefined;
  }

  applyDamage(amount, options = {}) {
    if (this.dead) return false;
    this.damageEvents += 1;
    if (this.damageEvents > 50) throw new Error(`runaway damage loop on ${this.id}`);
    this.health -= amount;
    if (this.health <= 0) this.dead = true;
    // The real game raises entityHurt from inside applyDamage.
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
    this.killCalls += 1;
    this.dead = true;
    return true;
  }

  applyKnockback() {
    this.knockbacks += 1;
  }

  addEffect() {}
}

export class Player extends Entity {
  constructor(location, options = {}) {
    super("minecraft:player", location, options.health ?? 20, options);
    entities.pop();
    this.id = `player#${players.length}`;
    this.held = options.held;
    this.gameMode = options.gameMode ?? "survival";
    this.messages = [];
    this.actionBars = [];
    this.cooldowns = new Map();
    this.viewTargets = options.viewTargets ?? [];
    this.teleports = [];
    this.effects = [];
    this.onScreenDisplay = { setActionBar: (text) => this.actionBars.push(text) };
    players.push(this);
  }

  getGameMode() {
    return this.gameMode;
  }

  getComponent(id) {
    if (id === "minecraft:equippable") {
      return {
        getEquipment: () => (this.held ? { typeId: this.held } : undefined),
      };
    }
    return super.getComponent(id);
  }

  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }

  getHeadLocation() {
    return { x: this.location.x, y: this.location.y + 1.6, z: this.location.z };
  }

  getEntitiesFromViewDirection() {
    return this.viewTargets.filter((e) => e.isValid()).map((entity) => ({ entity }));
  }

  sendMessage(text) {
    this.messages.push(text);
  }

  teleport(location) {
    this.teleports.push({ ...location });
    this.location = { ...location };
  }

  addEffect(name, duration, options) {
    this.effects.push({ name, duration, options });
  }

  startItemCooldown(category, ticks) {
    this.cooldowns.set(category, ticks);
  }

  getItemCooldown(category) {
    return this.cooldowns.get(category) ?? 0;
  }

  tickCooldowns() {
    for (const [category, remaining] of this.cooldowns) {
      if (remaining > 0) this.cooldowns.set(category, remaining - 1);
    }
  }
}

export const world = {
  afterEvents: {
    entityHurt: { subscribe: (fn) => handlers.entityHurt.push(fn) },
    itemUse: { subscribe: (fn) => handlers.itemUse.push(fn) },
    itemUseOn: { subscribe: (fn) => handlers.itemUseOn.push(fn) },
    playerSpawn: { subscribe: (fn) => handlers.playerSpawn.push(fn) },
  },
  sendMessage: () => {},
};

/** Simulate a melee swing: the game applies weapon damage, then we react. */
export function meleeHit(attacker, victim, weaponDamage = 120) {
  victim.applyDamage(weaponDamage, {
    cause: "entityAttack",
    damagingEntity: attacker,
  });
}

export function useItem(player, itemId) {
  for (const handler of handlers.itemUse) {
    handler({ source: player, itemStack: { typeId: itemId } });
  }
}
