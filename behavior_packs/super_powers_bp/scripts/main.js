/*
 * Super Powers - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Pocket Edition / Android)
 * Modules: @minecraft/server 1.11.0, @minecraft/server-ui 1.1.0
 *          Both are the versions that shipped with 1.21.0, so the pack loads
 *          on a plain 1.21.0 device. No experimental toggles.
 *
 * This file is wiring only: events in, engine calls out.
 */

import { ItemStack, system, world } from "@minecraft/server";
import { CONFIG, ITEMS, POWERS, POWER_BY_ITEM, POWER_BY_KEY, VERSION } from "./config.js";
import { activate, end, isRunning, tick } from "./engine.js";
import { openMenu, selectAndReport } from "./menu.js";
import { dropPlayer, settings } from "./state.js";
import { giveItem, hasItem, heal, isPlayer, safe, say } from "./util.js";

const KIT_FLAG = "sp_kit";

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

system.runInterval(tick, 1);

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

safe(() =>
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const typeId = safe(() => event.itemStack?.typeId);
    if (!player || !typeId) return;

    if (typeId === ITEMS.BAND) {
      openMenu(player);
      return;
    }

    const power = POWER_BY_ITEM[typeId];
    if (power) activate(player, power.key);
  })
);

/* ------------------------------------------------------------------ *
 * Damage
 * ------------------------------------------------------------------ */

safe(() =>
  world.afterEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    const cause = safe(() => event.damageSource?.cause);
    const attacker = safe(() => event.damageSource?.damagingEntity);

    // Super speed: whatever the fall took, give it straight back.
    if (
      isPlayer(hurt) &&
      cause === "fall" &&
      isRunning(hurt, "speed") &&
      settings(hurt).speedNoFall !== false
    ) {
      heal(hurt, event.damage);
    }

    // Invisibility: throwing a punch gives you away.
    if (
      isPlayer(attacker) &&
      isRunning(attacker, "invisibility") &&
      CONFIG.invisibility.revealOnAttack
    ) {
      end(attacker, "§7They saw that. Invisibility drops.");
    }
  })
);

/* ------------------------------------------------------------------ *
 * Joining and leaving
 *
 * playerSpawn can be missed entirely on a single-player world - the host
 * finishes spawning before the script starts - so the player list is swept
 * as well. Anyone the event missed still gets greeted and equipped.
 * ------------------------------------------------------------------ */

const greeted = new Set();

function welcome(player) {
  if (!player || greeted.has(player.id)) return;
  greeted.add(player.id);

  say(
    player,
    `§6[Super Powers] §fv${VERSION} loaded - tap the §ePower Band§f to choose a power. ` +
      `§7(no band? type §f!sp kit§7)`
  );

  if (safe(() => player.getDynamicProperty(KIT_FLAG))) return;
  safe(() =>
    system.runTimeout(() => {
      giveItem(player, ItemStack, ITEMS.BAND);
      safe(() => player.setDynamicProperty(KIT_FLAG, true));
    }, 20)
  );
}

safe(() =>
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn) welcome(event.player);
  })
);

safe(() =>
  world.afterEvents.playerLeave?.subscribe((event) => {
    greeted.delete(event.playerId);
    dropPlayer(event.playerId);
  })
);

system.runInterval(() => {
  for (const player of safe(() => world.getAllPlayers()) ?? []) welcome(player);
}, 100);

/* ------------------------------------------------------------------ *
 * Commands: !sp in chat, /scriptevent sp:...
 * ------------------------------------------------------------------ */

function giveKit(player) {
  const wanted = [ITEMS.BAND, ...POWERS.map((power) => power.item)];
  for (const item of wanted) {
    if (!hasItem(player, item)) giveItem(player, ItemStack, item);
  }
  say(player, "§a[Super Powers] Power Band and all six power items added.");
}

function handleCommand(player, args) {
  if (!player) return;
  const command = (args[0] ?? "menu").toLowerCase();

  if (command === "" || command === "menu") {
    openMenu(player);
    return;
  }
  if (command === "kit") {
    giveKit(player);
    return;
  }
  if (command === "off" || command === "stop") {
    end(player, "§7Power switched off.");
    return;
  }
  if (command === "select") {
    const key = (args[1] ?? "").toLowerCase();
    if (!selectAndReport(player, key)) {
      say(player, `§7[Super Powers] Unknown power '${key}'.`);
    }
    return;
  }
  if (POWER_BY_KEY[command]) {
    activate(player, command);
    return;
  }

  const names = POWERS.map((power) => power.key).join(", ");
  say(
    player,
    `§7[Super Powers] Try: §f!sp§7 for the menu, §f!sp <power>§7 to use one ` +
      `(${names}), §f!sp off§7, §f!sp kit§7.`
  );
}

safe(() =>
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const player = event.sourceEntity;
      if (!isPlayer(player)) return;
      const name = event.id.split(":")[1] ?? "menu";
      const extra = String(event.message ?? "").trim().split(/\s+/).filter(Boolean);
      handleCommand(player, [name, ...extra]);
    },
    { namespaces: ["sp"] }
  )
);

safe(() =>
  world.beforeEvents.chatSend?.subscribe((event) => {
    const message = String(event.message ?? "").trim();
    if (!/^!sp\b/i.test(message)) return;
    event.cancel = true;
    const args = message.split(/\s+/).slice(1);
    const sender = event.sender;
    // Before-events are read-only; do the work on the next tick.
    safe(() => system.run(() => handleCommand(sender, args)));
  })
);
