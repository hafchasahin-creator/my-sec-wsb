/*
 * Daybreak - the survival gear.
 *
 * Everything here hangs off itemUse / itemCompleteUse, so nothing polls and
 * nothing costs anything until a player actually taps something.
 */

import { EquipmentSlot } from "@minecraft/server";
import { CONFIG, DOCUMENTS, NS } from "./config.js";
import { radioBurst, ticksUntilSunrise } from "./world_cycle.js";
import { stateOf, sunIntensity, weatherFactor } from "./sun.js";
import { startScenario } from "./progress.js";
import {
  actionBar, addEffect, consumeHeld, later, particle, pick, playerSound,
  runCommand, safe, spawn, tell,
} from "./util.js";

/* Light-block syntax has moved around between versions; learn which one this
 * build accepts and then stop guessing. */
const LIGHT_FORMS = [
  (x, y, z) => `setblock ${x} ${y} ${z} minecraft:light_block ["block_light_level"=15]`,
  (x, y, z) => `setblock ${x} ${y} ${z} minecraft:light_block_15`,
  (x, y, z) => `setblock ${x} ${y} ${z} minecraft:light_block 15`,
];
let lightForm = -1; // -1 unknown, -2 unsupported

function placeFlareLight(dimension, position) {
  const { x, y, z } = position;
  if (lightForm === -2) return false;

  if (lightForm >= 0) {
    return runCommand(dimension, LIGHT_FORMS[lightForm](x, y, z));
  }
  for (let index = 0; index < LIGHT_FORMS.length; index++) {
    if (runCommand(dimension, LIGHT_FORMS[index](x, y, z))) {
      lightForm = index;
      return true;
    }
  }
  lightForm = -2;
  return false;
}

/* -------------------------------------------------------------- detector */

function verdict(rate) {
  if (rate >= 0.75) return "§4LETHAL";
  if (rate >= 0.4) return "§cDANGEROUS";
  if (rate >= 0.12) return "§6SURVIVABLE";
  if (rate > 0.01) return "§eTRACE";
  return "§aSAFE";
}

function readDetector(player) {
  const state = stateOf(player);
  const intensity = sunIntensity();
  const weather = weatherFactor(player.dimension);
  const sky = state.lastSky ?? 0;
  const rate = intensity * weather * sky;
  const sunrise = ticksUntilSunrise();

  tell(
    player,
    `§8[§bUV§8] §fSky §7${Math.round(sky * 100)}%  §fSun §7${Math.round(intensity * 100)}%  ` +
    `§fCover §7${Math.round((1 - weather) * 100)}%  §fBurn §7${Math.round(state.exposure)}%`
  );
  tell(player, `§8[§bUV§8] §fReading: ${verdict(rate)}`);
  if (sunrise > 0) {
    tell(player, `§8[§bUV§8] §7Sunrise in about §f${Math.max(1, Math.round(sunrise / 20))}s§7.`);
  }
  actionBar(player, `${verdict(rate)} §8| §fBURN §c${Math.round(state.exposure)}%`);
  playerSound(player, "random.click", 0.7, 1.6);
}

/* ------------------------------------------------------------- flashlight */

function useFlashlight(player) {
  addEffect(player, "night_vision", CONFIG.items.flashlightSeconds * 20, 0);
  playerSound(player, "random.click", 0.8, 1.2);
  actionBar(player, "§eFlashlight on");
  // Batteries drain: the flashlight is repairable with a battery.
  safe(() => {
    const gear = player.getComponent("minecraft:equippable");
    const stack = gear?.getEquipment(EquipmentSlot.Mainhand);
    const durability = stack?.getComponent("minecraft:durability");
    if (!durability) return;
    durability.damage = Math.min(
      durability.maxDurability - 1,
      durability.damage + CONFIG.items.flashlightWear
    );
    gear.setEquipment(EquipmentSlot.Mainhand, stack);
  });
}

/* ------------------------------------------------------------------ flare */

function useFlare(player) {
  const dimension = player.dimension;
  const view = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const origin = safe(() => player.getHeadLocation(), player.location);
  const spot = {
    x: origin.x + view.x * 2.5,
    y: origin.y + view.y * 2.5,
    z: origin.z + view.z * 2.5,
  };

  const flare = spawn(dimension, `${NS}:flare`, spot);
  if (!flare) return;
  safe(() => flare.applyImpulse({ x: view.x * 0.6, y: 0.1, z: view.z * 0.6 }));

  particle(dimension, "minecraft:large_explosion", spot);
  safe(() => dimension.playSound("firework.blast", spot, { volume: 1, pitch: 1.4 }));
  consumeHeld(player, 1);
  actionBar(player, "§6Flare lit — it will pull them to it");

  // Best-effort light source, cleaned up when the flare burns out.
  const cell = { x: Math.floor(spot.x), y: Math.floor(spot.y), z: Math.floor(spot.z) };
  if (placeFlareLight(dimension, cell)) {
    later(
      () => runCommand(dimension, `setblock ${cell.x} ${cell.y} ${cell.z} minecraft:air`),
      CONFIG.items.flareLightSeconds * 20
    );
  }
}

/* -------------------------------------------------------------- documents */

function readDocument(player) {
  tell(player, "§8§m                                        ");
  tell(player, pick(DOCUMENTS));
  tell(player, "§8§m                                        ");
  playerSound(player, "item.book.page_turn", 0.9, 1);
}

/* ------------------------------------------------------------------ table */

const HANDLERS = {
  [`${NS}:uv_detector`]: readDetector,
  [`${NS}:flashlight`]: useFlashlight,
  [`${NS}:emergency_flare`]: useFlare,
  [`${NS}:radio`]: (player) => {
    radioBurst(player);
    playerSound(player, "random.click", 0.7, 0.8);
  },
  [`${NS}:research_document`]: readDocument,
  [`${NS}:survival_starter`]: (player) => {
    startScenario(player, false);
    consumeHeld(player, 1);
  },
};

/** Wired to world.afterEvents.itemUse. */
export function onItemUse(event) {
  const player = event.source;
  const stack = event.itemStack;
  if (!player || !stack) return;
  const handler = HANDLERS[stack.typeId];
  if (!handler) return;
  safe(() => handler(player));
}

/** Wired to world.afterEvents.itemCompleteUse - the consumables. */
export function onItemCompleteUse(event) {
  const player = event.source;
  const stack = event.itemStack;
  if (!player || !stack) return;
  const state = stateOf(player);

  if (stack.typeId === `${NS}:medical_kit`) {
    addEffect(player, "regeneration", CONFIG.items.medkitRegenSeconds * 20, 1, true);
    safe(() => player.removeEffect("poison"));
    safe(() => player.removeEffect("wither"));
    state.exposure = Math.max(0, state.exposure - 18);
    actionBar(player, "§aPatched up");
    playerSound(player, "random.drink", 0.8, 1.1);
  } else if (stack.typeId === `${NS}:emergency_water`) {
    safe(() => player.removeEffect("nausea"));
    state.exposure = Math.max(0, state.exposure - CONFIG.items.waterExposureRelief);
    actionBar(player, "§bThe burning eases a little");
  } else if (stack.typeId === `${NS}:canned_food`) {
    addEffect(player, "saturation", 40, 0);
  }
}
