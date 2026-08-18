/*
 * Daybreak - the day/night state machine, atmosphere and radio.
 *
 * This module owns everything that happens *to the world* on a schedule:
 * the sunset and sunrise announcements, the fog each player sees, the
 * emergency broadcasts, and the distant noises. It runs off the slow loop and
 * only touches a player when the thing they should be looking at changes.
 */

import { world } from "@minecraft/server";
import { AMBIENCE, CONFIG, MSG, NS, RADIO_LINES } from "./config.js";
import { agitateMonsters, alertSurvivors } from "./creatures.js";
import { weatherFactor } from "./sun.js";
import {
  broadcast, chance, pick, playerSound, popFog, pushFog, safe, title,
} from "./util.js";

export const PHASE = { DAY: "day", NIGHT: "night", PREDAWN: "predawn" };

let phase = null;
let radioCountdown = 20;
const fogState = new Map(); // player id -> fog identifier currently pushed

export function currentPhase() {
  const time = safe(() => world.getTimeOfDay(), 0) ?? 0;
  if (time >= CONFIG.cycle.dayStart) return PHASE.DAY;
  if (time >= CONFIG.cycle.warningStart) return PHASE.PREDAWN;
  if (time >= CONFIG.cycle.nightStart) return PHASE.NIGHT;
  return PHASE.DAY;
}

/** Ticks of real time until the sun comes back, or 0 if it is already up. */
export function ticksUntilSunrise() {
  const time = safe(() => world.getTimeOfDay(), 0) ?? 0;
  if (time >= CONFIG.cycle.dayStart || time < CONFIG.cycle.nightStart) return 0;
  return CONFIG.cycle.dayStart - time;
}

function enterPhase(next) {
  const players = world.getPlayers();

  if (next === PHASE.NIGHT) {
    broadcast(`${MSG.tag} ${MSG.sunset}`);
    for (const player of players) {
      playerSound(player, "beacon.deactivate", 0.7, 0.8);
      title(player, "§6NIGHTFALL", "§7Surface travel is possible.", 5, 40, 12);
    }
  } else if (next === PHASE.PREDAWN) {
    broadcast(`${MSG.tag} ${MSG.sunriseWarning}`);
    for (const player of players) {
      playerSound(player, "beacon.activate", 0.9, 0.5);
      title(player, "§cSUNRISE APPROACHING", "§7Find cover.", 5, 50, 15);
    }
    // Everything alive reacts to the coming light.
    alertSurvivors();
    agitateMonsters();
  } else if (next === PHASE.DAY) {
    for (const player of players) {
      playerSound(player, "ambient.weather.thunder", 0.5, 1.4);
      title(player, MSG.sunrise, MSG.sunriseSub, 5, 45, 15);
    }
  }
}

/** Fog identifier this player should be under right now. */
function fogFor(player, sky) {
  const stormy = weatherFactor(player.dimension) <= CONFIG.sun.weather.thunder;
  if (phase === PHASE.DAY) {
    if (sky <= 0.15) return `${NS}:facility`;
    return stormy ? `${NS}:storm_relief` : `${NS}:sun_haze`;
  }
  if (sky <= 0.15 && player.location.y < 50) return `${NS}:facility`;
  return `${NS}:night_pall`;
}

/** Called once per player per exposure step with that player's sky reading. */
export function updateAtmosphere(player, sky) {
  const wanted = fogFor(player, sky);
  const current = fogState.get(player.id);
  if (current === wanted) return;
  if (current) popFog(player, "daybreak_mood");
  pushFog(player, wanted, "daybreak_mood");
  fogState.set(player.id, wanted);
}

export function clearAtmosphere(playerId) {
  fogState.delete(playerId);
}

/* ----------------------------------------------------------------- radio */

function sendTransmission(players, line) {
  const text = `§8[§aRADIO§8] §7"${line}§7"`;
  for (const player of players) {
    safe(() => player.sendMessage(text));
    playerSound(player, "random.click", 0.6, 0.7);
  }
}

function tickRadio(players) {
  radioCountdown -= 1;
  if (radioCountdown > 0) return;
  const { radioMinSlowTicks, radioMaxSlowTicks } = CONFIG.cycle;
  radioCountdown =
    radioMinSlowTicks + Math.floor(Math.random() * (radioMaxSlowTicks - radioMinSlowTicks));

  // Near sunrise the broadcast is always the one that matters.
  const line = phase === PHASE.PREDAWN
    ? "SUNRISE INCOMING. FIND COVER IMMEDIATELY."
    : pick(RADIO_LINES);
  sendTransmission(players, line);
}

/** A radio held in the hand pulls in extra chatter. */
export function radioBurst(player) {
  sendTransmission([player], pick(RADIO_LINES));
}

/* -------------------------------------------------------------- ambience */

function tickAmbience(players) {
  if (!chance(CONFIG.cycle.ambienceChance)) return;
  const player = pick(players);
  if (!player) return;
  const clip = pick(AMBIENCE);
  const origin = player.location;
  const location = {
    x: origin.x + (Math.random() - 0.5) * 26,
    y: origin.y + (Math.random() - 0.5) * 6,
    z: origin.z + (Math.random() - 0.5) * 26,
  };
  safe(() =>
    player.dimension.playSound(clip.sound, location, {
      volume: clip.volume,
      pitch: clip.pitch,
    })
  );
}

/* ------------------------------------------------------------------ loop */

export function tickCycle() {
  const players = world.getPlayers();
  const next = currentPhase();
  if (next !== phase) {
    const first = phase === null;
    phase = next;
    if (!first) enterPhase(next);
  }
  if (players.length === 0) return;
  tickRadio(players);
  tickAmbience(players);
}

export function phaseNow() {
  return phase ?? currentPhase();
}
