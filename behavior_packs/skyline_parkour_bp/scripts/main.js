/*
 * Skyline Parkour - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android compatible)
 * Modules: @minecraft/server 1.11.0, @minecraft/server-ui 1.2.0
 *          (both stable - no experimental toggles required)
 *
 * This file is only wiring: events in, module calls out. The logic lives in
 * course.js (generation), run.js (the run), game.js (actions) and menu.js (UI).
 */

import { system, world } from "@minecraft/server";
import { CONFIG, DIFFICULTY_KEYS, ITEMS, VERSION } from "./config.js";
import * as game from "./game.js";
import { openMarkers, openMenu, openRecords } from "./menu.js";
import { tickRuns } from "./run.js";
import { safe, say } from "./util.js";

const KIT_FLAG = "skypk:kit";

/* ------------------------------------------------------------------ *
 * The run loop
 * ------------------------------------------------------------------ */

system.runInterval(tickRuns, 1);

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

safe(() =>
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const typeId = safe(() => event.itemStack?.typeId);
    if (!player || !typeId) return;

    if (typeId === ITEMS.COMPASS) {
      openMenu(player);
      return;
    }

    if (typeId === ITEMS.CHARM) {
      game.leap(player);
      return;
    }

    if (typeId === ITEMS.MARKER) {
      if (player.isSneaking) {
        game.clearMarkers(player);
        return;
      }
      // Tapping a block fires this event as well as itemUseOn, so wait a few
      // ticks: if a marker was placed, that tap was not a request for the menu.
      const tappedAt = system.currentTick;
      safe(() =>
        system.runTimeout(() => {
          if (game.lastMarkerTick(player) < tappedAt) openMarkers(player);
        }, 4)
      );
    }
  })
);

safe(() =>
  world.afterEvents.itemUseOn?.subscribe((event) => {
    if (safe(() => event.itemStack?.typeId) !== ITEMS.MARKER) return;
    if (!event.source || !event.block) return;
    game.addMarker(event.source, event.block);
  })
);

/* ------------------------------------------------------------------ *
 * Joining
 * ------------------------------------------------------------------ */

safe(() =>
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    const player = event.player;

    say(
      player,
      `§6[Skyline Parkour] §fv${VERSION} loaded - tap the §eParkour Compass§f to play.`
    );

    if (!CONFIG.giveCompassOnFirstJoin) return;
    if (safe(() => player.getDynamicProperty(KIT_FLAG))) return;
    // A short delay, so the inventory is definitely there to put things in.
    safe(() =>
      system.runTimeout(() => {
        game.giveKit(player, true);
        safe(() => player.setDynamicProperty(KIT_FLAG, true));
      }, 20)
    );
  })
);

/* ------------------------------------------------------------------ *
 * Commands: /scriptevent pk:... and !pk in chat
 * ------------------------------------------------------------------ */

function handleCommand(player, args) {
  if (!player) return;
  const command = (args[0] ?? "menu").toLowerCase();
  const rest = args.slice(1);

  switch (command) {
    case "":
    case "menu":
      openMenu(player);
      return;
    case "start": {
      const difficulty = DIFFICULTY_KEYS.includes((rest[0] ?? "").toLowerCase())
        ? rest[0].toLowerCase()
        : "normal";
      const jumps = Number(rest[1]);
      const seed = Number(rest[2]);
      game.createAndStart(player, {
        difficulty,
        jumps: Number.isFinite(jumps) ? jumps : CONFIG.course.defaultJumps,
        height: CONFIG.course.defaultSkyHeight,
        seed: Number.isFinite(seed) ? seed : undefined,
      });
      return;
    }
    case "replay":
      game.replaySaved(player);
      return;
    case "stop":
      game.abandonRun(player);
      return;
    case "cp":
    case "checkpoint":
      game.goToCheckpoint(player);
      return;
    case "clear":
      game.clearSaved(player);
      return;
    case "custom":
      game.startCustomRun(player);
      return;
    case "markers":
      openMarkers(player);
      return;
    case "records":
      openRecords(player);
      return;
    case "kit":
      game.giveKit(player, true);
      say(player, "§a[Parkour] Kit added to your inventory.");
      return;
    default:
      say(
        player,
        "§7[Parkour] Try: §f!pk§7, §f!pk start <easy|normal|hard|insane> [jumps] [seed]§7, " +
          "§f!pk replay§7, §f!pk stop§7, §f!pk cp§7, §f!pk clear§7, §f!pk custom§7, §f!pk kit§7."
      );
  }
}

safe(() =>
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const player = event.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") return;
      const name = event.id.split(":")[1] ?? "menu";
      const args = [name, ...String(event.message ?? "").trim().split(/\s+/).filter(Boolean)];
      handleCommand(player, args);
    },
    { namespaces: ["pk"] }
  )
);

safe(() =>
  world.beforeEvents.chatSend?.subscribe((event) => {
    const message = String(event.message ?? "").trim();
    if (!/^!pk\b/i.test(message)) return;
    event.cancel = true;
    const args = message.split(/\s+/).slice(1);
    const sender = event.sender;
    // Before-events run in read-only mode; do the work on the next tick.
    safe(() => system.run(() => handleCommand(sender, args)));
  })
);
