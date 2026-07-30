/*
 * Skyline Parkour - touch menus
 *
 * Every option in the add-on is reachable by tapping, because that is the only
 * input a phone actually has. Forms cannot open while another screen is up, so
 * `showForm` retries for a couple of seconds when the game says "UserBusy".
 */

import { system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { CONFIG, DIFFICULTIES, DIFFICULTY_KEYS, VERSION } from "./config.js";
import { loadCourse } from "./course.js";
import * as game from "./game.js";
import { personalBests, worldRecords } from "./records.js";
import { isRunning, restartRun } from "./run.js";
import { formatTicks, safe, say } from "./util.js";

const ICONS = {
  compass: "textures/items/course_compass",
  marker: "textures/items/checkpoint_marker",
  charm: "textures/items/leap_charm",
};

const RETRY_TICKS = 10;
const MAX_RETRIES = 12;

function showForm(player, form, onResult) {
  let tries = 0;
  const attempt = () => {
    safe(() =>
      form
        .show(player)
        .then((response) => {
          if (
            response.canceled &&
            response.cancelationReason === "UserBusy" &&
            tries++ < MAX_RETRIES
          ) {
            safe(() => system.runTimeout(attempt, RETRY_TICKS));
            return;
          }
          if (!response.canceled) onResult(response);
        })
        .catch(() => {
          /* player closed the game or the form went away */
        })
    );
  };
  attempt();
}

/* ------------------------------------------------------------------ *
 * Main menu
 * ------------------------------------------------------------------ */

export function openMenu(player) {
  const saved = loadCourse(player);
  const running = isRunning(player);

  const form = new ActionFormData().title(`Skyline Parkour v${VERSION}`);
  form.body(
    running
      ? "§aRun in progress. Reach the emerald pad to finish."
      : saved
        ? `§7Saved course: §f${DIFFICULTIES[saved.difficulty]?.label ?? saved.difficulty} · ${saved.jumps} jumps §7(seed ${saved.seed})`
        : "§7Tap 'New course' and a parkour course is built in the sky above you."
  );

  const actions = [];
  const button = (text, icon, handler) => {
    if (icon) form.button(text, icon);
    else form.button(text);
    actions.push(handler);
  };

  button("§l§aNew course", ICONS.compass, () => openSetup(player));
  if (saved) button("§bRebuild & replay saved course", ICONS.compass, () => game.replaySaved(player));
  if (running) {
    button("§eBack to last checkpoint", ICONS.marker, () => game.goToCheckpoint(player));
    button("§eRestart from the start pad", ICONS.marker, () => restartRun(player));
    button("§cStop the run", undefined, () => game.abandonRun(player));
  }
  if (saved) button("§cClear the course blocks", undefined, () => game.clearSaved(player));
  button("§6Records", undefined, () => openRecords(player));
  button("§dBuild your own course", ICONS.marker, () => openMarkers(player));
  button("§7Kit & help", ICONS.charm, () => openHelp(player));

  showForm(player, form, (response) => {
    const handler = actions[response.selection];
    if (handler) handler();
  });
}

/* ------------------------------------------------------------------ *
 * New course
 * ------------------------------------------------------------------ */

function openSetup(player) {
  const labels = DIFFICULTY_KEYS.map((key) => DIFFICULTIES[key].label);
  const form = new ModalFormData()
    .title("New course")
    .dropdown("Difficulty", labels, 1)
    .slider("Jumps", CONFIG.course.minJumps, CONFIG.course.maxJumps, 5, CONFIG.course.defaultJumps)
    .slider(
      "Height above you",
      CONFIG.course.minSkyHeight,
      CONFIG.course.maxSkyHeight,
      2,
      CONFIG.course.defaultSkyHeight
    )
    .toggle("Checkpoints (off = restart on every fall)", true)
    .toggle("Clear my previous course first", true)
    .textField("Seed - leave blank for a random course", "e.g. 12345", "");

  showForm(player, form, (response) => {
    const values = response.formValues ?? [];
    const seedText = String(values[5] ?? "").trim();
    const seed = /^\d+$/.test(seedText) ? Number(seedText) : undefined;

    game.createAndStart(player, {
      difficulty: DIFFICULTY_KEYS[values[0] ?? 1] ?? "normal",
      jumps: Number(values[1]) || CONFIG.course.defaultJumps,
      height: Number(values[2]) || CONFIG.course.defaultSkyHeight,
      useCheckpoints: values[3] !== false,
      clearOld: values[4] !== false,
      seed,
    });
  });
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

function openRecords(player) {
  const mine = personalBests(player);
  const world = worldRecords();
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(world)])].sort();

  const lines = [];
  if (keys.length === 0) {
    lines.push("§7No times yet. Finish a course and it shows up here.");
  } else {
    for (const key of keys) {
      const [difficulty, jumps] = key.split(":");
      const label = DIFFICULTIES[difficulty]?.label ?? difficulty;
      const parts = [`§f${label} §7· §f${jumps} jumps`];
      if (typeof mine[key] === "number") parts.push(`§byou §f${formatTicks(mine[key])}`);
      const record = world[key];
      if (record && typeof record.t === "number") {
        parts.push(`§6best §f${formatTicks(record.t)} §7(${record.n})`);
      }
      lines.push(parts.join(" §8| "));
    }
  }

  const form = new ActionFormData()
    .title("Records")
    .body(lines.join("\n"))
    .button("§7Back", ICONS.compass);
  showForm(player, form, () => openMenu(player));
}

/* ------------------------------------------------------------------ *
 * Hand-built courses
 * ------------------------------------------------------------------ */

function openMarkers(player) {
  const list = game.markers(player);
  const form = new ActionFormData()
    .title("Build your own course")
    .body(
      `§7Markers set: §f${list.length}\n\n` +
        "§71. Hold the §fCheckpoint Marker§7.\n" +
        "§72. Tap the block you want to start on.\n" +
        "§73. Tap more blocks along your course.\n" +
        "§74. The last block you tap is the finish.\n" +
        "§75. Come back here and tap 'Start custom run'."
    );

  const actions = [];
  const button = (text, icon, handler) => {
    if (icon) form.button(text, icon);
    else form.button(text);
    actions.push(handler);
  };

  button("§aStart custom run", ICONS.marker, () => game.startCustomRun(player));
  button("§cClear all markers", undefined, () => game.clearMarkers(player));
  button("§7Back", ICONS.compass, () => openMenu(player));

  showForm(player, form, (response) => {
    const handler = actions[response.selection];
    if (handler) handler();
  });
}

/* ------------------------------------------------------------------ *
 * Help
 * ------------------------------------------------------------------ */

function openHelp(player) {
  const form = new ActionFormData()
    .title("Kit & help")
    .body(
      "§fParkour Compass §7- tap to open this menu.\n" +
        "§fCheckpoint Marker §7- tap blocks to build your own course. Sneak + tap the air to clear.\n" +
        "§fLeap Charm §7- tap to launch yourself forward. 3s cooldown.\n\n" +
        "§7Gold pads are checkpoints, the emerald pad is the finish.\n" +
        "§7Fall off and you are put straight back on your last checkpoint - " +
        "you cannot die on a course.\n\n" +
        "§7Chat commands: §f!pk§7, §f!pk start§7, §f!pk stop§7, §f!pk cp§7, §f!pk clear§7."
    );

  const actions = [];
  const button = (text, icon, handler) => {
    if (icon) form.button(text, icon);
    else form.button(text);
    actions.push(handler);
  };

  button("§aGive me the full kit", ICONS.charm, () => {
    game.giveKit(player, true);
    say(player, "§a[Parkour] Compass, marker and charm added to your inventory.");
  });
  button("§7Back", ICONS.compass, () => openMenu(player));

  showForm(player, form, (response) => {
    const handler = actions[response.selection];
    if (handler) handler();
  });
}

/* ------------------------------------------------------------------ *
 * Exported for /scriptevent and chat shortcuts
 * ------------------------------------------------------------------ */

export { openMarkers, openRecords, openSetup };
