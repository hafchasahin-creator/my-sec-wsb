/*
 * Super Powers - the engine
 *
 * Activation rules, the tick loop and the action bar. Everything here is
 * per-player: two people can hold different powers at the same time without
 * touching each other's cooldowns.
 */

import { system, world } from "@minecraft/server";
import { CONFIG, POWER_BY_KEY, SOUNDS } from "./config.js";
import { implementationFor } from "./powers/index.js";
import {
  activeIds,
  activeOf,
  clearActive,
  cooldownLeft,
  dropPlayer,
  isActive,
  selectPower,
  selectedKey,
  setActive,
  settings,
  startCooldown,
} from "./state.js";
import { actionBar, bar, safe, seconds, sound, title } from "./util.js";

/**
 * Turn a power on (or off again, if it is already running and has a duration).
 * Returns true if anything happened.
 */
export function activate(player, key) {
  const power = POWER_BY_KEY[key];
  const implementation = implementationFor(key);
  if (!power || !implementation) return false;

  const running = activeOf(player);
  if (running) {
    if (running.key === key && implementation.duration > 0) {
      end(player, "§7You switch it off.");
      return true;
    }
    const other = POWER_BY_KEY[running.key];
    actionBar(player, `§c${other?.label ?? running.key} is still running.`);
    sound(player, SOUNDS.deny, 0.8);
    return false;
  }

  const waiting = cooldownLeft(player, key);
  if (waiting > 0) {
    actionBar(player, `§c${power.label} recharging §f${seconds(waiting)}s`);
    sound(player, SOUNDS.deny, 0.8);
    return false;
  }

  selectPower(player, key);
  const state = setActive(player, key, implementation.duration);
  const started = safe(() => implementation.start(player, state, settings(player)));
  if (started === false) {
    clearActive(player);
    return false;
  }

  sound(player, SOUNDS.activate, 1.2);

  if (implementation.duration > 0) {
    // The recharge is counted from when the power ends, so the cooldown is a
    // real wait rather than something that ticks away while you are using it.
    title(player, `${power.colour}${power.label}`, "§7active");
  } else {
    clearActive(player);
    startCooldown(player, key, implementation.cooldown);
    actionBar(player, `${power.colour}${power.label}§7 used`);
  }
  return true;
}

export function end(player, message) {
  const state = activeOf(player);
  if (!state) return;
  const implementation = implementationFor(state.key);
  clearActive(player);
  safe(() => implementation?.stop(player, state));
  startCooldown(player, state.key, implementation?.cooldown ?? 0);
  if (message) actionBar(player, message);
}

/* ------------------------------------------------------------------ *
 * Tick loop
 * ------------------------------------------------------------------ */

export function tick() {
  const ids = activeIds();
  const players = safe(() => world.getAllPlayers()) ?? [];

  if (ids.length > 0) {
    const byId = new Map(players.map((player) => [player.id, player]));
    for (const id of ids) {
      const player = byId.get(id);
      if (!player) {
        // Left the world mid-power; nothing to stop.
        dropPlayer(id);
        continue;
      }
      run(player);
    }
  }

  if (system.currentTick % CONFIG.hudEveryTicks === 0) {
    for (const player of players) hud(player);
  }
}

function run(player) {
  const state = activeOf(player);
  if (!state) return;

  const implementation = implementationFor(state.key);
  if (!implementation) {
    clearActive(player);
    return;
  }

  if (system.currentTick >= state.endTick) {
    end(player, `§7${POWER_BY_KEY[state.key]?.label ?? state.key} has run out.`);
    return;
  }

  const elapsed = system.currentTick - state.startTick;
  safe(() => implementation.tick(player, state, elapsed, settings(player)));
}

/**
 * The action bar only speaks when it has something to say: a power running,
 * or a power recharging. Silence the rest of the time keeps it out of the way
 * of other add-ons.
 */
function hud(player) {
  if (settings(player).hud === false) return;

  const state = activeOf(player);
  if (state) {
    const power = POWER_BY_KEY[state.key];
    const left = Math.max(0, state.endTick - system.currentTick);
    actionBar(
      player,
      `${power.colour}${power.label}  ${bar(left, state.duration, power.colour)}  §f${seconds(left)}s`
    );
    return;
  }

  const key = selectedKey(player);
  const power = POWER_BY_KEY[key];
  const waiting = cooldownLeft(player, key);
  if (waiting > 0) {
    actionBar(
      player,
      `§8${power.label}  ${bar(waiting, implementationFor(key).cooldown, "§7")}  §7${seconds(waiting)}s`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Used by the damage handler in main.js
 * ------------------------------------------------------------------ */

export function isRunning(player, key) {
  return isActive(player, key);
}
