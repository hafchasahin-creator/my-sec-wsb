/*
 * Squid Game - Red Light, Green Light
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Module: @minecraft/server 1.11.0 (stable - no experimental toggles required)
 *
 * Young-hee stands at the finish line. On GREEN LIGHT she faces away and sings;
 * on RED LIGHT she spins round, and anyone who has drifted from the spot they
 * were standing on is eliminated. Reach her to survive the round.
 *
 * Every cosmetic call (sound, particle, title) is wrapped, and every gameplay
 * call is guarded, so a device or build missing one id degrades that single
 * effect instead of taking the whole minigame down.
 */

import { world, system, EntityDamageCause } from "@minecraft/server";

const VERSION = "1.0.0";

const DOLL_ID = "squidgame:young_hee";

const ITEMS = {
  WHISTLE: "squidgame:referee_whistle",
  DOLL: "squidgame:doll_summoner",
  MARKER: "squidgame:finish_line_marker",
  CARD: "squidgame:player_card",
};

/* ------------------------------------------------------------------ *
 * Tuning - everything the game feels like lives here
 * ------------------------------------------------------------------ */

const CONFIG = {
  // Lead-in before the first green light.
  countdownSeconds: 5,

  // Phase lengths, in ticks (20 ticks = 1 second). Each is rolled randomly
  // inside its range, so nobody can learn the rhythm.
  greenTicks: { min: 60, max: 160 },
  redTicks: { min: 50, max: 110 },

  // Young-hee gets faster every round: this many ticks come off the green
  // light each time, down to `minGreenTicks`.
  speedUpPerRound: 6,
  minGreenTicks: 30,

  // Ticks after the light turns red before movement is punished. This is the
  // margin that absorbs momentum and phone-network lag - raise it if players
  // complain about dying while already standing still.
  graceTicks: 6,

  // How far a frozen player may drift before Young-hee sees them.
  moveThreshold: 0.25,
  verticalThreshold: 0.4,

  // Distance from the finish marker that counts as crossing the line.
  finishRadius: 3.0,

  // Whole-game clock. 0 disables the limit.
  timeLimitSeconds: 300,
  eliminateOnTimeout: true,

  // "kill" drops the player where they stand; "teleport" sends them back to
  // where they were standing when the whistle blew.
  eliminationMode: "kill",

  // Ticks Young-hee takes to swivel between facing away and facing the field.
  dollTurnTicks: 6,

  // Players in creative or spectator are left out of the roster when the
  // build exposes the game mode. They can still opt in with the Player Card.
  skipCreative: true,

  showActionBar: true,
};

// "Mu-gung-hwa kko-chi pi-eot-seum-ni-da" - eleven syllables, as semitone
// offsets fed to note.harp.
const SONG = [0, 0, 4, 4, 7, 5, 4, 2, 0, 2, 4];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Run a cosmetic call and swallow any platform-specific failure. */
function safe(fn) {
  try {
    fn();
  } catch {
    /* cosmetic only - ignore */
  }
}

function sound(dimension, id, location, options) {
  safe(() => dimension.playSound(id, location, options));
}

function particle(dimension, id, location) {
  safe(() => dimension.spawnParticle(id, location));
}

function randomBetween(range) {
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function snapshot(location) {
  return { x: location.x, y: location.y, z: location.z };
}

/**
 * Bedrock yaw for a direction vector. Yaw 0 looks down +Z, 90 looks down -X,
 * which is what `-atan2(dx, dz)` produces.
 */
function yawTowards(from, to) {
  return (-Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI;
}

function wrapDegrees(degrees) {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

function formatClock(ticks) {
  const seconds = Math.max(0, Math.ceil(ticks / 20));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function title(player, text, subtitle, stay = 30) {
  safe(() =>
    player.onScreenDisplay.setTitle(text, {
      subtitle,
      fadeInDuration: 3,
      stayDuration: stay,
      fadeOutDuration: 6,
    })
  );
}

function actionBar(player, text) {
  if (!CONFIG.showActionBar) return;
  safe(() => player.onScreenDisplay.setActionBar(text));
}

function announce(message) {
  safe(() => world.sendMessage(message));
}

/** Some builds expose isValid as a method, others as a property. */
function isValid(entity) {
  if (!entity) return false;
  try {
    const flag = entity.isValid;
    if (typeof flag === "function") return flag.call(entity);
    if (typeof flag === "boolean") return flag;
    return true;
  } catch {
    return false;
  }
}

/** True only when we can prove the player is in creative or spectator. */
function isNonCombatant(player) {
  if (!CONFIG.skipCreative) return false;
  try {
    const mode = player.getGameMode?.();
    return mode === "creative" || mode === "spectator";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Persisted arena setup
 * ------------------------------------------------------------------ */

// Dynamic properties are the durable copy; `memory` keeps the add-on working
// on builds where they are unavailable.
const memory = {};

function saveProperty(key, value) {
  memory[key] = value;
  safe(() => world.setDynamicProperty(key, value));
}

function loadProperty(key) {
  try {
    const stored = world.getDynamicProperty(key);
    if (stored !== undefined) return stored;
  } catch {
    /* fall through to memory */
  }
  return memory[key];
}

function setFinishLine(location, dimensionId) {
  saveProperty(
    "squidgame:finish",
    JSON.stringify({
      x: Math.floor(location.x) + 0.5,
      y: Math.floor(location.y) + 1,
      z: Math.floor(location.z) + 0.5,
      dimension: dimensionId,
    })
  );
}

function getFinishLine() {
  const raw = loadProperty("squidgame:finish");
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function getDimension(dimensionId) {
  try {
    return world.getDimension(dimensionId ?? "minecraft:overworld");
  } catch {
    return undefined;
  }
}

function findDoll(dimension, near) {
  try {
    const options = { type: DOLL_ID };
    if (near) {
      options.location = near;
      options.maxDistance = 128;
    }
    const [doll] = dimension.getEntities(options);
    return doll;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

const PHASE = {
  IDLE: "idle",
  COUNTDOWN: "countdown",
  GREEN: "green",
  RED: "red",
};

const STATUS = {
  RUNNING: "running",
  FINISHED: "finished",
  OUT: "out",
};

const game = {
  phase: PHASE.IDLE,
  phaseTicks: 0,
  phaseTotal: 0,
  round: 0,
  clock: 0,
  finish: undefined,
  dimensionId: "minecraft:overworld",
  // playerId -> { name, status, anchor, lobby }
  roster: new Map(),
  finishOrder: [],
  nextNote: 0,
  noteIndex: 0,
  dollFacing: undefined,
};

// Players who used the Player Card to sit a round out.
const optedOut = new Set();

function rosterCount(status) {
  let total = 0;
  for (const entry of game.roster.values()) {
    if (entry.status === status) total += 1;
  }
  return total;
}

function isPlaying() {
  return game.phase !== PHASE.IDLE;
}

/* ------------------------------------------------------------------ *
 * Young-hee
 * ------------------------------------------------------------------ */

function activeCentroid(fallback) {
  let x = 0;
  let z = 0;
  let count = 0;
  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry || entry.status !== STATUS.RUNNING) continue;
    x += player.location.x;
    z += player.location.z;
    count += 1;
  }
  if (!count) return fallback;
  return { x: x / count, y: fallback.y, z: z / count };
}

function pointDoll(yaw) {
  const dimension = getDimension(game.dimensionId);
  if (!dimension) return;
  const doll = findDoll(dimension, game.finish);
  if (!isValid(doll)) return;

  const target = wrapDegrees(yaw);
  const from = game.dollFacing ?? target;
  const delta = wrapDegrees(target - from);
  const steps = Math.max(1, CONFIG.dollTurnTicks);

  for (let step = 1; step <= steps; step++) {
    const angle = wrapDegrees(from + (delta * step) / steps);
    system.runTimeout(() => {
      if (!isValid(doll)) return;
      safe(() =>
        doll.teleport(doll.location, {
          rotation: { x: 0, y: angle },
        })
      );
      safe(() => doll.setRotation({ x: 0, y: angle }));
    }, step);
  }

  game.dollFacing = target;
}

function faceField() {
  if (!game.finish) return;
  const centroid = activeCentroid(game.finish);
  pointDoll(yawTowards(game.finish, centroid));
}

function faceAway() {
  if (!game.finish) return;
  const centroid = activeCentroid(game.finish);
  pointDoll(yawTowards(game.finish, centroid) + 180);
}

function singNote(dimension) {
  if (!game.finish) return;
  const semitone = SONG[game.noteIndex % SONG.length];
  game.noteIndex += 1;
  sound(dimension, "note.harp", game.finish, {
    pitch: Math.pow(2, semitone / 12),
    volume: 1.4,
  });
  particle(dimension, "minecraft:villager_happy", {
    x: game.finish.x,
    y: game.finish.y + 2.6,
    z: game.finish.z,
  });
}

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

/**
 * Everyone in the world joins, minus anyone who opted out with a Player Card
 * and anyone we can prove is in creative or spectator.
 */
function enrol() {
  game.roster.clear();
  game.finishOrder = [];

  for (const player of world.getAllPlayers()) {
    if (optedOut.has(player.id)) continue;
    if (isNonCombatant(player)) continue;

    game.roster.set(player.id, {
      name: player.name,
      status: STATUS.RUNNING,
      anchor: snapshot(player.location),
      lobby: snapshot(player.location),
    });
  }
  return game.roster.size;
}

function eliminate(player, entry, reason) {
  entry.status = STATUS.OUT;

  const dimension = player.dimension;
  const at = player.location;

  title(player, "§4§lELIMINATED", `§7${reason}`, 40);
  sound(dimension, "firework.large_blast", at, { volume: 1.2 });
  sound(dimension, "random.explode", at, { pitch: 1.4, volume: 0.6 });
  particle(dimension, "minecraft:huge_explosion_emitter", at);

  announce(`§c✖ §f${entry.name} §7was eliminated. §8(${reason})`);

  if (CONFIG.eliminationMode === "teleport") {
    safe(() => player.teleport(entry.lobby, { dimension }));
    safe(() => player.addEffect("slowness", 60, { amplifier: 3 }));
    return;
  }

  system.run(() => {
    if (!isValid(player)) return;
    try {
      player.kill();
    } catch {
      safe(() =>
        player.applyDamage(1000, { cause: EntityDamageCause.entityAttack })
      );
    }
  });
}

function reachFinish(player, entry) {
  entry.status = STATUS.FINISHED;
  game.finishOrder.push(entry.name);

  const place = game.finishOrder.length;
  const dimension = player.dimension;

  title(player, "§a§lSAFE", `§f#${place} across the line`, 40);
  sound(dimension, "random.levelup", player.location);
  particle(dimension, "minecraft:totem_particle", player.location);
  safe(() => player.addEffect("resistance", 200, { amplifier: 4 }));

  announce(`§a✔ §f${entry.name} §7crossed the line §8(#${place})`);
}

/* ------------------------------------------------------------------ *
 * Phase transitions
 * ------------------------------------------------------------------ */

function beginGreen() {
  game.phase = PHASE.GREEN;
  game.round += 1;

  const trim = CONFIG.speedUpPerRound * (game.round - 1);
  const rolled = randomBetween(CONFIG.greenTicks);
  game.phaseTicks = Math.max(CONFIG.minGreenTicks, rolled - trim);
  game.phaseTotal = game.phaseTicks;

  // Pace the song so the last syllable lands just as she turns.
  game.noteIndex = 0;
  game.nextNote = 0;

  const dimension = getDimension(game.dimensionId);
  if (dimension && game.finish) {
    sound(dimension, "beacon.activate", game.finish, { volume: 1.5 });
  }
  faceAway();

  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry || entry.status !== STATUS.RUNNING) continue;
    title(player, "§a§lGREEN LIGHT", "§7Run!", 20);
    sound(player.dimension, "note.pling", player.location, { pitch: 1.6 });
  }
}

function beginRed() {
  game.phase = PHASE.RED;
  game.phaseTicks = randomBetween(CONFIG.redTicks);
  game.phaseTotal = game.phaseTicks;

  const dimension = getDimension(game.dimensionId);
  if (dimension && game.finish) {
    sound(dimension, "beacon.deactivate", game.finish, { volume: 1.5 });
    sound(dimension, "random.anvil_land", game.finish, { pitch: 0.8 });
  }
  faceField();

  // The anchor is taken at the END of the grace window, so momentum from the
  // green light does not count against anybody.
  system.runTimeout(() => {
    if (game.phase !== PHASE.RED) return;
    for (const player of world.getAllPlayers()) {
      const entry = game.roster.get(player.id);
      if (!entry || entry.status !== STATUS.RUNNING) continue;
      entry.anchor = snapshot(player.location);
    }
  }, CONFIG.graceTicks);

  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry || entry.status !== STATUS.RUNNING) continue;
    title(player, "§c§lRED LIGHT", "§7Freeze!", 20);
    sound(player.dimension, "note.bass", player.location, { pitch: 0.6 });
  }
}

function startGame(referee) {
  const finish = getFinishLine();
  const dimension = getDimension(finish?.dimension ?? referee.dimension.id);
  const doll = dimension ? findDoll(dimension, finish) : undefined;

  // The doll can stand in for a marker that was never placed, and vice versa.
  let line = finish;
  if (!line && isValid(doll)) {
    line = {
      x: doll.location.x,
      y: doll.location.y,
      z: doll.location.z,
      dimension: doll.dimension.id,
    };
    setFinishLine(doll.location, doll.dimension.id);
  }

  if (!line) {
    referee.sendMessage(
      "§c[Squid Game]§r No finish line. Aim at a block and use the " +
        "§eFinish Line Marker§r, or place §eYoung-hee§r first."
    );
    return;
  }

  game.finish = line;
  game.dimensionId = line.dimension ?? "minecraft:overworld";
  game.round = 0;
  game.finishOrder = [];
  game.dollFacing = undefined;
  game.clock =
    CONFIG.timeLimitSeconds > 0 ? CONFIG.timeLimitSeconds * 20 : Infinity;

  const count = enrol();
  if (count === 0) {
    referee.sendMessage(
      "§c[Squid Game]§r Nobody is on the roster. Use the §ePlayer Card§r to opt in."
    );
    return;
  }

  game.phase = PHASE.COUNTDOWN;
  game.phaseTicks = CONFIG.countdownSeconds * 20;
  game.phaseTotal = game.phaseTicks;

  faceAway();
  announce(
    `§6§l[Squid Game]§r §fRed Light, Green Light §7- §f${count} player${
      count === 1 ? "" : "s"
    } §7at the line.`
  );
  if (!isValid(doll)) {
    announce("§7Young-hee is not on the field - the round runs without her.");
  }
}

function stopGame(reason) {
  if (!isPlaying()) return;

  const survivors = game.finishOrder;
  game.phase = PHASE.IDLE;
  game.phaseTicks = 0;

  const dimension = getDimension(game.dimensionId);
  if (dimension && game.finish) {
    sound(dimension, "beacon.deactivate", game.finish, { pitch: 0.7 });
  }

  announce(`§6§l[Squid Game]§r §f${reason}`);
  if (survivors.length) {
    announce(`§a§lSurvivors:§r §f${survivors.join(", ")}`);
  } else {
    announce("§c§lNobody made it across.");
  }

  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry) continue;
    if (entry.status === STATUS.FINISHED) {
      title(player, "§a§lYOU SURVIVED", "§7Round over", 50);
    }
    actionBar(player, "");
  }

  game.roster.clear();
  faceAway();
}

/* ------------------------------------------------------------------ *
 * Per-tick loop
 * ------------------------------------------------------------------ */

function tickCountdown(dimension) {
  const remaining = Math.ceil(game.phaseTicks / 20);
  if (game.phaseTicks % 20 === 0) {
    for (const player of world.getAllPlayers()) {
      if (!game.roster.has(player.id)) continue;
      title(player, `§e§l${remaining}`, "§7Get ready...", 14);
      sound(player.dimension, "random.click", player.location, {
        pitch: 1 + (CONFIG.countdownSeconds - remaining) * 0.1,
      });
    }
    if (dimension && game.finish) {
      particle(dimension, "minecraft:villager_happy", game.finish);
    }
  }
}

function tickGreen(dimension) {
  if (!dimension) return;
  // Space the eleven syllables evenly across whatever is left of the phase, so
  // the song always finishes right as Young-hee turns around.
  if (game.nextNote <= 0 && game.noteIndex < SONG.length) {
    singNote(dimension);
    const remainingNotes = SONG.length - game.noteIndex;
    game.nextNote = Math.max(
      2,
      Math.floor(game.phaseTicks / Math.max(1, remainingNotes))
    );
  }
  game.nextNote -= 1;
}

function tickRed(dimension) {
  if (dimension && game.finish && game.phaseTicks % 6 === 0) {
    particle(dimension, "minecraft:redstone_wire_dust_particle", {
      x: game.finish.x,
      y: game.finish.y + 2.8,
      z: game.finish.z,
    });
  }
}

function tickPlayers(enforceFreeze) {
  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry || entry.status !== STATUS.RUNNING) continue;

    const location = player.location;

    if (game.finish && distance3D(location, game.finish) <= CONFIG.finishRadius) {
      reachFinish(player, entry);
      continue;
    }

    if (!enforceFreeze) {
      entry.anchor = snapshot(location);
      continue;
    }

    const drift = distance2D(location, entry.anchor);
    const rise = Math.abs(location.y - entry.anchor.y);
    if (drift > CONFIG.moveThreshold || rise > CONFIG.verticalThreshold) {
      eliminate(player, entry, "moved on a red light");
    }
  }
}

function tickActionBar() {
  if (!CONFIG.showActionBar) return;

  const alive = rosterCount(STATUS.RUNNING);
  const safeCount = rosterCount(STATUS.FINISHED);
  const light =
    game.phase === PHASE.GREEN
      ? "§a● GREEN"
      : game.phase === PHASE.RED
      ? "§c● RED"
      : "§e● READY";
  const clock =
    game.clock === Infinity ? "§b∞" : `§b${formatClock(game.clock)}`;

  const line = `${light} §8| §f${alive} alive §8| §a${safeCount} safe §8| ${clock}`;

  for (const player of world.getAllPlayers()) {
    const entry = game.roster.get(player.id);
    if (!entry) continue;
    if (entry.status === STATUS.RUNNING) {
      actionBar(player, line);
    } else if (entry.status === STATUS.FINISHED) {
      actionBar(player, `§a● SAFE §8| ${line}`);
    }
  }
}

function everyoneDone() {
  return rosterCount(STATUS.RUNNING) === 0;
}

system.runInterval(() => {
  if (!isPlaying()) return;

  const dimension = getDimension(game.dimensionId);

  // Whole-game clock.
  if (game.clock !== Infinity) {
    game.clock -= 1;
    if (game.clock <= 0) {
      if (CONFIG.eliminateOnTimeout) {
        for (const player of world.getAllPlayers()) {
          const entry = game.roster.get(player.id);
          if (entry?.status === STATUS.RUNNING) {
            eliminate(player, entry, "ran out of time");
          }
        }
      }
      stopGame("Time is up.");
      return;
    }
  }

  switch (game.phase) {
    case PHASE.COUNTDOWN:
      tickCountdown(dimension);
      break;
    case PHASE.GREEN:
      tickGreen(dimension);
      tickPlayers(false);
      break;
    case PHASE.RED: {
      tickRed(dimension);
      // Movement only counts once the grace window has closed - the anchor is
      // taken at exactly that moment, so this is also when it becomes valid.
      const elapsed = game.phaseTotal - game.phaseTicks;
      tickPlayers(elapsed >= CONFIG.graceTicks);
      break;
    }
    default:
      break;
  }

  tickActionBar();

  game.phaseTicks -= 1;
  if (game.phaseTicks <= 0) {
    if (game.phase === PHASE.COUNTDOWN || game.phase === PHASE.RED) {
      beginGreen();
    } else if (game.phase === PHASE.GREEN) {
      beginRed();
    }
  }

  if (everyoneDone()) {
    stopGame("Every player is off the field.");
  }
}, 1);

/* ------------------------------------------------------------------ *
 * Referee kit
 * ------------------------------------------------------------------ */

/** itemUse and itemUseOn both fire for a tap on a block - collapse them. */
const lastUse = new Map();

function debounce(player, itemId) {
  const key = `${player.id}:${itemId}`;
  const now = system.currentTick;
  const previous = lastUse.get(key);
  lastUse.set(key, now);
  return previous !== undefined && now - previous < 4;
}

function summonDoll(player, at) {
  const dimension = player.dimension;
  const existing = findDoll(dimension, at);
  if (isValid(existing)) {
    safe(() => existing.triggerEvent("squidgame:remove"));
    safe(() => existing.remove());
  }

  const spot = {
    x: Math.floor(at.x) + 0.5,
    y: Math.floor(at.y) + 1,
    z: Math.floor(at.z) + 0.5,
  };

  let doll;
  try {
    doll = dimension.spawnEntity(DOLL_ID, spot);
  } catch (err) {
    player.sendMessage(`§c[Squid Game]§r Could not place Young-hee: ${err}`);
    return;
  }

  safe(() => {
    doll.nameTag = "§fYoung-hee";
  });
  game.dollFacing = undefined;
  setFinishLine(spot, dimension.id);

  sound(dimension, "mob.villager.idle", spot, { pitch: 0.6 });
  particle(dimension, "minecraft:villager_happy", spot);
  player.sendMessage(
    "§6[Squid Game]§r Young-hee is in place. The finish line is set here."
  );
}

function removeDoll(player) {
  const doll = findDoll(player.dimension, player.location);
  if (!isValid(doll)) {
    player.sendMessage("§7[Squid Game] No Young-hee nearby.");
    return;
  }
  safe(() => doll.triggerEvent("squidgame:remove"));
  safe(() => doll.remove());
  sound(player.dimension, "random.pop", player.location);
  player.sendMessage("§6[Squid Game]§r Young-hee has left the field.");
}

function reportStatus(player) {
  const line = getFinishLine();
  const enrolled = optedOut.has(player.id) ? "§cout" : "§ain";

  player.sendMessage(`§6§l[Squid Game]§r v${VERSION}`);
  player.sendMessage(`§7Your entry: ${enrolled}`);
  if (line) {
    player.sendMessage(
      `§7Finish line: §f${Math.floor(line.x)}, ${Math.floor(
        line.y
      )}, ${Math.floor(line.z)} §8(${line.dimension})`
    );
  } else {
    player.sendMessage("§7Finish line: §cnot set");
  }
  if (isPlaying()) {
    player.sendMessage(
      `§7Round §f${game.round} §8| §f${rosterCount(
        STATUS.RUNNING
      )} alive §8| §a${rosterCount(STATUS.FINISHED)} safe §8| §b${formatClock(
        game.clock === Infinity ? 0 : game.clock
      )}`
    );
  } else {
    player.sendMessage("§7No round in progress.");
  }
}

function toggleEntry(player) {
  if (optedOut.has(player.id)) {
    optedOut.delete(player.id);
    player.sendMessage("§a[Squid Game]§r You are in the next round.");
    sound(player.dimension, "random.orb", player.location);
  } else {
    optedOut.add(player.id);
    const entry = game.roster.get(player.id);
    if (entry && entry.status === STATUS.RUNNING) entry.status = STATUS.OUT;
    player.sendMessage("§e[Squid Game]§r You are sitting the next round out.");
    sound(player.dimension, "random.pop", player.location, { pitch: 0.7 });
  }
}

/** Where is the player pointing? Falls back to their own feet. */
function aimBlock(player, maxDistance = 24) {
  try {
    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (hit?.block) return hit.block.location;
  } catch {
    /* fall through */
  }
  return player.location;
}

function handleUse(player, itemId, blockLocation) {
  if (!player || !itemId) return;
  if (debounce(player, itemId)) return;

  const sneaking = player.isSneaking === true;

  try {
    switch (itemId) {
      case ITEMS.WHISTLE:
        if (sneaking) {
          if (isPlaying()) stopGame("The referee called the round off.");
          else player.sendMessage("§7[Squid Game] No round in progress.");
        } else if (isPlaying()) {
          player.sendMessage(
            "§7[Squid Game] A round is already running - sneak + use to call it off."
          );
        } else {
          startGame(player);
        }
        break;

      case ITEMS.DOLL:
        if (sneaking) removeDoll(player);
        else summonDoll(player, blockLocation ?? aimBlock(player));
        break;

      case ITEMS.MARKER: {
        const at = blockLocation ?? aimBlock(player);
        setFinishLine(at, player.dimension.id);
        if (isPlaying()) game.finish = getFinishLine();
        sound(player.dimension, "random.orb", at);
        particle(player.dimension, "minecraft:villager_happy", {
          x: Math.floor(at.x) + 0.5,
          y: Math.floor(at.y) + 1.5,
          z: Math.floor(at.z) + 0.5,
        });
        player.sendMessage(
          `§6[Squid Game]§r Finish line set at §f${Math.floor(
            at.x
          )}, ${Math.floor(at.y) + 1}, ${Math.floor(at.z)}§r.`
        );
        break;
      }

      case ITEMS.CARD:
        if (sneaking) reportStatus(player);
        else toggleEntry(player);
        break;

      default:
        break;
    }
  } catch (err) {
    console.warn(`[Squid Game] item use failed: ${err}`);
  }
}

world.afterEvents.itemUse.subscribe((event) => {
  handleUse(event.source, event.itemStack?.typeId, undefined);
});

world.afterEvents.itemUseOn.subscribe((event) => {
  handleUse(event.source, event.itemStack?.typeId, event.block?.location);
});

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */

world.afterEvents.playerLeave.subscribe((event) => {
  const id = event.playerId;
  if (!id) return;
  const entry = game.roster.get(id);
  if (entry && entry.status === STATUS.RUNNING) {
    entry.status = STATUS.OUT;
    announce(`§7[Squid Game] §f${entry.name} §7left the field.`);
  }
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  safe(() =>
    event.player.sendMessage(
      `§6[Squid Game]§r v${VERSION} loaded - Red Light, Green Light is ready.`
    )
  );
});

console.warn(`[Squid Game] v${VERSION} loaded - Red Light, Green Light ready.`);
