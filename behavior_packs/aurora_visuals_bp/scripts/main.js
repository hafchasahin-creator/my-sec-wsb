/*
 * Aurora Visuals - behaviour script
 *
 * Target: Minecraft Bedrock 1.21.0 (Android). Modules are the ones 1.21.0
 * ships: @minecraft/server 1.11.0 and @minecraft/server-ui 1.1.0.
 *
 * This pack is optional. Without it the resource pack still changes the sun,
 * moon, clouds, grass and water; with it the distance haze also follows the
 * time of day and the dimension you are in.
 */

import { system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { PRESETS, apply, bandFor, clear, forget, timeOfDay } from "./fog.js";
import { actionBar, safe, say } from "./util.js";

const VERSION = "1.0.0";
const PRESET_PROPERTY = "aurora_preset";
const REFRESH_TICKS = 40; // two seconds; fog only changes at band edges

const LABELS = {
  vivid: "§bVivid §7- deep haze, clear water, strong mood",
  soft: "§aSoft §7- a gentle version, closer to vanilla",
  off: "§7Off §8- vanilla fog, textures still apply",
};

function presetOf(player) {
  const stored = safe(() => player.getDynamicProperty(PRESET_PROPERTY));
  return PRESETS.includes(stored) ? stored : "vivid";
}

function setPreset(player, preset) {
  if (!PRESETS.includes(preset)) return false;
  safe(() => player.setDynamicProperty(PRESET_PROPERTY, preset));
  if (preset === "off") clear(player);
  else {
    forget(player.id);
    apply(player, preset);
  }
  actionBar(player, `§6Aurora §f${preset}`);
  return true;
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

system.runInterval(() => {
  for (const player of safe(() => world.getAllPlayers()) ?? []) {
    const preset = presetOf(player);
    if (preset !== "off") apply(player, preset);
  }
}, REFRESH_TICKS);

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

function openMenu(player) {
  const current = presetOf(player);
  const form = new ActionFormData()
    .title(`Aurora Visuals v${VERSION}`)
    .body(
      `§7Current: §f${current}\n§7Time: §f${bandFor(timeOfDay())}\n\n` +
        "§7The haze follows sunrise, day, sunset and night, and changes in the " +
        "Nether and the End."
    );

  const order = ["vivid", "soft", "off"];
  for (const preset of order) form.button(LABELS[preset]);
  form.button("§7What this pack can and cannot do");

  let tries = 0;
  const show = () => {
    safe(() =>
      form
        .show(player)
        .then((response) => {
          if (response.canceled) {
            if (response.cancelationReason === "UserBusy" && tries++ < 12) {
              safe(() => system.runTimeout(show, 10));
            }
            return;
          }
          if (response.selection < order.length) {
            setPreset(player, order[response.selection]);
          } else {
            explain(player);
          }
        })
        .catch(() => {})
    );
  };
  show();
}

function explain(player) {
  say(
    player,
    "§6[Aurora] §fWhat this is\n" +
      "§7Minecraft Bedrock runs RenderDragon, and it does not load shader code " +
      "from resource packs - real shaders need patched engine files.\n" +
      "§7So this pack does everything a resource pack still can: a bloomed sun, " +
      "a lit moon, softer clouds, richer grass and leaves, clearer water, and " +
      "distance haze that follows the time of day.\n" +
      "§7It costs no frame rate: there is no extra rendering, only different " +
      "textures and fog values."
  );
}

/* ------------------------------------------------------------------ *
 * Joining
 * ------------------------------------------------------------------ */

const greeted = new Set();

function welcome(player) {
  if (!player || greeted.has(player.id)) return;
  greeted.add(player.id);
  say(
    player,
    `§6[Aurora Visuals] §fv${VERSION} loaded - type §e!vis§f to change the mood.`
  );
  apply(player, presetOf(player));
}

safe(() =>
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn) welcome(event.player);
  })
);

safe(() =>
  world.afterEvents.playerLeave?.subscribe((event) => {
    greeted.delete(event.playerId);
    forget(event.playerId);
  })
);

// playerSpawn can be missed on a single-player world, so sweep as well.
system.runInterval(() => {
  for (const player of safe(() => world.getAllPlayers()) ?? []) welcome(player);
}, 100);

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function handleCommand(player, args) {
  if (!player) return;
  const command = (args[0] ?? "menu").toLowerCase();
  if (command === "" || command === "menu") {
    openMenu(player);
    return;
  }
  if (PRESETS.includes(command)) {
    setPreset(player, command);
    return;
  }
  say(player, "§7[Aurora] Try: §f!vis§7, §f!vis vivid§7, §f!vis soft§7, §f!vis off§7.");
}

safe(() =>
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const player = event.sourceEntity;
      if (safe(() => player?.typeId) !== "minecraft:player") return;
      const name = event.id.split(":")[1] ?? "menu";
      handleCommand(player, [name]);
    },
    { namespaces: ["aurora"] }
  )
);

safe(() =>
  world.beforeEvents.chatSend?.subscribe((event) => {
    const message = String(event.message ?? "").trim();
    if (!/^!vis\b/i.test(message)) return;
    event.cancel = true;
    const args = message.split(/\s+/).slice(1);
    const sender = event.sender;
    safe(() => system.run(() => handleCommand(sender, args)));
  })
);
