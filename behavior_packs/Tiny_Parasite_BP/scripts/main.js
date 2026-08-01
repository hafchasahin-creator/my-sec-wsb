/*
 * Tiny Parasite - infection, incubation, burst and spread.
 *
 * Targets Minecraft Bedrock 1.21.0 with the stable @minecraft/server 1.11.0
 * module only, so no experimental toggles are needed.
 *
 * The life cycle:
 *   1. A parasite hunts the nearest living thing and lands one hit.
 *   2. On that hit it burrows in and vanishes; the host is marked infected.
 *   3. The infection incubates for a few seconds, visibly.
 *   4. The host bursts, and two fresh parasites crawl out.
 *
 * Because step 4 feeds step 1, the population is capped per dimension and the
 * newborns spend two seconds dormant. /function parasite_purge is the panic
 * button and always works.
 */

import { world, system } from "@minecraft/server";

const PARASITE = "tp:parasite";
const SERUM = "tp:parasite_serum";
const INFECTED_TAG = "tp_infected";
const PREFIX = "§5[Parasite]§r ";

/** How long a host has before it bursts. Players get twice as long. */
const INCUBATION_MOB = 160; // 8 seconds
const INCUBATION_PLAYER = 320; // 16 seconds

/** Spread rate: one host becomes this many parasites. */
const SPAWN_ON_BURST = 2;
/** Killing an infected host early gives you a cheaper outcome. */
const SPAWN_ON_EARLY_KILL = 1;

/**
 * Hard ceiling per dimension. A self-replicating mob with no cap will crawl
 * to a halt on a phone, so bursts stop producing offspring past this many.
 */
const MAX_PARASITES = 40;

const DIMENSION_IDS = ["overworld", "nether", "the_end"];

/** hostId -> { host, start, isPlayer, originalName, dimId } */
const infections = new Map();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function announce(message) {
  try {
    world.sendMessage(PREFIX + message);
  } catch {
    /* nobody to tell */
  }
}

function setPose(entity, pose) {
  try {
    entity.triggerEvent("tp:pose_" + pose + "_event");
  } catch {
    /* already gone */
  }
}

function particles(dim, id, location, count, spread) {
  const n = count ?? 1;
  const r = spread ?? 0.4;
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnParticle(id, {
        x: location.x + (Math.random() - 0.5) * r * 2,
        y: location.y + Math.random() * r * 2,
        z: location.z + (Math.random() - 0.5) * r * 2
      });
    } catch {
      return; // particle unsupported here - drop the whole burst quietly
    }
  }
}

function soundAround(dim, location, id, pitch) {
  try {
    for (const player of dim.getPlayers({ location, maxDistance: 24 })) {
      player.playSound(id, { location, pitch: pitch ?? 1.0, volume: 0.9 });
    }
  } catch {
    /* sound is cosmetic */
  }
}

function countParasites(dim) {
  try {
    return dim.getEntities({ type: PARASITE }).length;
  } catch {
    return 0;
  }
}

/** Living things only: no items, arrows, boats or armour stands. */
function canBeHost(entity) {
  if (!entity) return false;
  try {
    if (entity.typeId === PARASITE) return false;
    if (entity.hasTag(INFECTED_TAG)) return false;
    return !!entity.getComponent("minecraft:health");
  } catch {
    return false;
  }
}

function isPlayer(entity) {
  try {
    return entity.typeId === "minecraft:player";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Infection
// ---------------------------------------------------------------------------

function infect(host, parasite) {
  if (!canBeHost(host)) return false;

  let originalName = "";
  try {
    originalName = host.nameTag ?? "";
  } catch {
    originalName = "";
  }

  try {
    host.addTag(INFECTED_TAG);
  } catch {
    return false;
  }

  infections.set(host.id, {
    host,
    start: system.currentTick,
    isPlayer: isPlayer(host),
    originalName,
    dimId: host.dimension.id
  });

  if (parasite) {
    // Burrow in: drill down into the host, then disappear.
    setPose(parasite, "burrow");
    try {
      parasite.teleport(host.location, { dimension: host.dimension });
    } catch {
      /* teleport is cosmetic */
    }
    system.runTimeout(() => {
      try {
        parasite.remove();
      } catch {
        /* already gone */
      }
    }, 8);
  }

  try {
    const loc = host.location;
    particles(host.dimension, "minecraft:villager_angry", loc, 6, 0.6);
    soundAround(host.dimension, loc, "mob.silverfish.say", 0.6);
  } catch {
    /* host left the world */
  }

  if (isPlayer(host)) {
    try {
      host.sendMessage(
        PREFIX + "§cSomething just burrowed into you!§r Use an Antiparasitic Serum, fast."
      );
    } catch {
      /* player left */
    }
  }
  return true;
}

function cure(record, hostId) {
  infections.delete(hostId);
  const host = record.host;
  try {
    host.removeTag(INFECTED_TAG);
    host.nameTag = record.originalName ?? "";
    particles(host.dimension, "minecraft:heart_particle", host.location, 4, 0.5);
  } catch {
    /* host is gone, the map entry is what mattered */
  }
}

// ---------------------------------------------------------------------------
// The burst
// ---------------------------------------------------------------------------

function burst(dim, location, host, offspring) {
  particles(dim, "minecraft:huge_explosion_emitter", location, 1, 0.1);
  particles(dim, "minecraft:critical_hit_emitter", location, 10, 0.8);
  soundAround(dim, location, "mob.slime.big", 0.7);

  // A blast that hurts but never eats the terrain around it.
  try {
    dim.createExplosion(location, 1.8, {
      breaksBlocks: false,
      causesFire: false,
      allowUnderwater: true
    });
  } catch {
    // Explosions are not essential; fall back to a manual splash.
    try {
      for (const nearby of dim.getEntities({ location, maxDistance: 3 })) {
        if (nearby.typeId === PARASITE) continue;
        nearby.applyDamage(4);
      }
    } catch {
      /* nothing to hurt */
    }
  }

  if (host) {
    try {
      if (isPlayer(host)) {
        // Players survive it - brutal, but the mode stays playable.
        host.applyDamage(12);
        host.addEffect("nausea", 200, { amplifier: 1, showParticles: true });
        host.addEffect("slowness", 120, { amplifier: 1, showParticles: true });
        host.sendMessage(PREFIX + "§cIt burst out of you!§r");
      } else {
        host.kill();
      }
    } catch {
      /* host already dead */
    }
  }

  // Spread, but only up to the cap.
  const room = Math.max(0, MAX_PARASITES - countParasites(dim));
  const spawnCount = Math.min(offspring, room);
  for (let i = 0; i < spawnCount; i++) {
    try {
      const born = dim.spawnEntity(PARASITE, {
        x: location.x + (Math.random() - 0.5),
        y: location.y + 0.3,
        z: location.z + (Math.random() - 0.5)
      });
      born.triggerEvent("tp:born_event"); // two seconds dormant before hunting
    } catch {
      /* no room to spawn */
    }
  }
  return spawnCount;
}

// ---------------------------------------------------------------------------
// Incubation tick
// ---------------------------------------------------------------------------

function tickInfection(hostId, record) {
  const host = record.host;
  let loc;
  let dim;
  try {
    loc = host.location;
    dim = host.dimension;
  } catch {
    infections.delete(hostId); // host unloaded or died elsewhere
    return;
  }

  const limit = record.isPlayer ? INCUBATION_PLAYER : INCUBATION_MOB;
  const elapsed = system.currentTick - record.start;
  const left = Math.max(0, Math.ceil((limit - elapsed) / 20));
  const progress = Math.min(1, elapsed / limit);

  // The infection gets visibly worse as it goes.
  particles(dim, "minecraft:villager_angry", { x: loc.x, y: loc.y + 1, z: loc.z },
    1 + Math.floor(progress * 4), 0.4 + progress * 0.4);

  if (record.isPlayer) {
    try {
      host.onScreenDisplay.setActionBar(`§c☣ INFECTED ☣  §fbursting in ${left}s`);
      if (progress > 0.5) host.addEffect("slowness", 20, { amplifier: 0, showParticles: false });
      if (progress > 0.8) host.addEffect("nausea", 40, { amplifier: 0, showParticles: true });
    } catch {
      /* action bar unsupported - particles still show */
    }
  } else {
    try {
      host.nameTag = `§c☣ ${left}s`;
      if (progress > 0.5) host.addEffect("slowness", 30, { amplifier: 1, showParticles: false });
    } catch {
      /* no name tag on this entity */
    }
  }

  if (elapsed < limit) return;

  infections.delete(hostId);
  try {
    host.removeTag(INFECTED_TAG);
  } catch {
    /* already gone */
  }
  const born = burst(dim, loc, host, SPAWN_ON_BURST);
  if (born > 0) announce(`A host burst open. §d${born}§r more parasites are loose.`);
  else announce("A host burst open, but the swarm is already at its limit.");
}

system.runInterval(() => {
  for (const [hostId, record] of [...infections]) {
    try {
      tickInfection(hostId, record);
    } catch {
      infections.delete(hostId);
    }
  }
}, 5);

/**
 * Re-adopt infected hosts whose bookkeeping was lost - after a script reload,
 * or if a host was in an unloaded chunk when it was tagged. The tag on the
 * entity is the durable record; this map is just the fast path.
 */
system.runInterval(() => {
  for (const id of DIMENSION_IDS) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch {
      continue;
    }
    let tagged;
    try {
      tagged = dim.getEntities({ tags: [INFECTED_TAG] });
    } catch {
      continue;
    }
    for (const host of tagged) {
      if (infections.has(host.id)) continue;
      infections.set(host.id, {
        host,
        start: system.currentTick,
        isPlayer: isPlayer(host),
        originalName: "",
        dimId: id
      });
    }
  }
}, 100);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// A parasite landing a hit is what starts an infection.
try {
  world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const victim = event.hitEntity;
    if (!attacker || attacker.typeId !== PARASITE) return;
    if (!canBeHost(victim)) return;

    setPose(attacker, "lunge");
    infect(victim, attacker);
  });
} catch {
  /* older runtime */
}

// Killing an infected host early still bursts it, but for fewer parasites.
try {
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!dead) return;

    let tagged = false;
    try {
      tagged = dead.hasTag(INFECTED_TAG);
    } catch {
      tagged = infections.has(dead.id);
    }
    if (!tagged && !infections.has(dead.id)) return;

    let loc;
    let dim;
    try {
      loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z };
      dim = dead.dimension;
    } catch {
      infections.delete(dead.id);
      return;
    }

    infections.delete(dead.id);
    const born = burst(dim, loc, undefined, SPAWN_ON_EARLY_KILL);
    if (born > 0) announce(`An infected host was cut down early - §d${born}§r parasite escaped.`);
  });
} catch {
  /* older runtime */
}

// Freshly spawned parasites announce the outbreak once it gets going.
let lastOutbreakTick = -9999;
try {
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (!entity || entity.typeId !== PARASITE) return;
    if (system.currentTick - lastOutbreakTick < 200) return;

    let total = 0;
    try {
      total = countParasites(entity.dimension);
    } catch {
      return;
    }
    if (total >= MAX_PARASITES) {
      lastOutbreakTick = system.currentTick;
      announce(`§cThe swarm has hit its limit of ${MAX_PARASITES}.§r Use §f/function parasite_purge§r.`);
    }
  });
} catch {
  /* older runtime */
}

// ---------------------------------------------------------------------------
// Serum and commands
// ---------------------------------------------------------------------------

function consumeOne(player, itemId) {
  try {
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (let i = 0; i < container.size; i++) {
      const stack = container.getItem(i);
      if (!stack || stack.typeId !== itemId) continue;
      if (stack.amount > 1) {
        stack.amount -= 1;
        container.setItem(i, stack);
      } else {
        container.setItem(i, undefined);
      }
      return;
    }
  } catch {
    /* leave the stack alone rather than fail the cure */
  }
}

function cureNear(player, radius, consume) {
  let healed = 0;

  const self = infections.get(player.id);
  if (self) {
    cure(self, player.id);
    healed++;
  }

  try {
    for (const entity of player.dimension.getEntities({
      location: player.location,
      maxDistance: radius,
      tags: [INFECTED_TAG]
    })) {
      const record = infections.get(entity.id);
      if (record) cure(record, entity.id);
      else {
        try {
          entity.removeTag(INFECTED_TAG);
          entity.nameTag = "";
        } catch {
          /* gone */
        }
      }
      healed++;
    }
  } catch {
    /* query unsupported */
  }

  if (healed > 0) {
    if (consume) consumeOne(player, SERUM);
    try {
      player.playSound("random.levelup", { pitch: 1.4, volume: 0.8 });
      player.sendMessage(PREFIX + `§aCured ${healed} infection${healed === 1 ? "" : "s"}.§r`);
    } catch {
      /* player left */
    }
  } else {
    try {
      player.sendMessage(PREFIX + "§7Nothing infected nearby.§r");
    } catch {
      /* player left */
    }
  }
  return healed;
}

try {
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack && event.itemStack.typeId === SERUM) cureNear(event.source, 8, true);
  });
} catch {
  /* older runtime */
}

try {
  world.afterEvents.itemUseOn.subscribe((event) => {
    if (event.itemStack && event.itemStack.typeId === SERUM) cureNear(event.source, 8, true);
  });
} catch {
  /* itemUseOn is absent on some runtimes; itemUse covers the common case */
}

function resolvePlayer(event) {
  const src = event.sourceEntity;
  try {
    if (src && src.typeId === "minecraft:player") return src;
  } catch {
    /* fall through */
  }
  const all = world.getAllPlayers();
  return all.length ? all[0] : undefined;
}

function commandSpawn(player) {
  try {
    const l = player.location;
    player.dimension.spawnEntity(PARASITE, { x: l.x + 1, y: l.y, z: l.z + 1 });
    announce("A parasite has been released.");
  } catch {
    try {
      player.sendMessage(PREFIX + "§cNo room to spawn one here.§r");
    } catch {
      /* player left */
    }
  }
}

function commandPurge(player) {
  let killed = 0;
  let cured = 0;

  for (const id of DIMENSION_IDS) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch {
      continue;
    }
    try {
      for (const parasite of dim.getEntities({ type: PARASITE })) {
        parasite.remove();
        killed++;
      }
    } catch {
      /* nothing loaded here */
    }
    try {
      for (const host of dim.getEntities({ tags: [INFECTED_TAG] })) {
        const record = infections.get(host.id);
        if (record) cure(record, host.id);
        else {
          host.removeTag(INFECTED_TAG);
          host.nameTag = "";
        }
        cured++;
      }
    } catch {
      /* nothing loaded here */
    }
  }

  // Anything still on the books had its host unloaded.
  for (const [hostId, record] of [...infections]) cure(record, hostId);

  announce(`§aPurged.§r Removed ${killed} parasites and cured ${cured} hosts.`);
  if (player) {
    try {
      player.playSound("random.levelup", { pitch: 0.8 });
    } catch {
      /* cosmetic */
    }
  }
}

function commandStatus(player) {
  const lines = ["§5--- Tiny Parasite ---§r"];
  let total = 0;
  for (const id of DIMENSION_IDS) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch {
      continue;
    }
    const n = countParasites(dim);
    total += n;
    if (n > 0) lines.push(`§7${id}: §f${n} parasites`);
  }
  lines.push(`§7Parasites loaded: §f${total}§7 (cap ${MAX_PARASITES} per dimension)`);
  lines.push(`§7Infected hosts: §f${infections.size}`);
  lines.push("§7Purge with §f/function parasite_purge");

  try {
    for (const line of lines) player.sendMessage(line);
  } catch {
    /* player left */
  }
}

function commandHelp(player) {
  const lines = [
    "§5--- Tiny Parasite ---§r",
    "§7Release one with the §fTiny Parasite Spawn Egg§7.",
    "§7It hunts anything alive, burrows in, and the host bursts into 2 more.",
    "§7Cure yourself with the §fAntiparasitic Serum§7 before the timer runs out.",
    "§7Fire hurts them three times over.",
    "§f/function parasite_spawn§7 - release one",
    "§f/function parasite_cure§7 - cure infections near you",
    "§f/function parasite_purge§7 - remove every parasite, cure every host",
    "§f/function parasite_status§7 - how bad is it",
    "§f/function parasite_help§7 - this list"
  ];
  try {
    for (const line of lines) player.sendMessage(line);
  } catch {
    /* player left */
  }
}

const SCRIPT_EVENTS = {
  "tp:spawn": commandSpawn,
  "tp:purge": commandPurge,
  "tp:cure": (player) => cureNear(player, 12, false),
  "tp:status": commandStatus,
  "tp:help": commandHelp
};

try {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id === "tp:spawned") return; // entity announcing itself; nothing to do
    const handler = SCRIPT_EVENTS[event.id];
    if (!handler) return;
    const player = resolvePlayer(event);
    if (player) handler(player);
  });
} catch {
  /* scriptevent unavailable */
}
