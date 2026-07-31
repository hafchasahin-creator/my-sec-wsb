/*
 * Super Powers - the touch menu
 *
 * The Power Band opens this. Every power can be picked and fired from here,
 * so the add-on is fully playable without ever crafting the six items.
 *
 * Forms refuse to open while another screen is closing, which the game
 * reports as "UserBusy"; showForm retries for a couple of seconds.
 */

import { system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { POWERS, POWER_BY_KEY, VERSION } from "./config.js";
import { activate } from "./engine.js";
import { implementationFor } from "./powers/index.js";
import { cooldownLeft, saveSettings, selectPower, selectedKey, settings } from "./state.js";
import { actionBar, safe, seconds } from "./util.js";

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
          /* the player closed it */
        })
    );
  };
  attempt();
}

export function openMenu(player) {
  const current = selectedKey(player);
  const form = new ActionFormData()
    .title(`Super Powers v${VERSION}`)
    .body(`§7Selected: ${POWER_BY_KEY[current].colour}${POWER_BY_KEY[current].label}\n§7Tap a power to use it now.`);

  const actions = [];
  for (const power of POWERS) {
    const waiting = cooldownLeft(player, power.key);
    const label =
      waiting > 0
        ? `§8${power.label} §7(${seconds(waiting)}s)`
        : `${power.colour}${power.label}`;
    form.button(label, power.icon);
    actions.push(() => activate(player, power.key));
  }

  form.button("§7Settings");
  actions.push(() => openSettings(player));
  form.button("§7How the powers work");
  actions.push(() => openHelp(player));

  showForm(player, form, (response) => {
    const handler = actions[response.selection];
    if (handler) handler();
  });
}

function openSettings(player) {
  const current = settings(player);
  const form = new ModalFormData()
    .title("Settings")
    .toggle("Laser eyes break blocks", current.laserBreaksBlocks)
    .toggle("Time stop freezes arrows", current.timestopProjectiles)
    .toggle("No fall damage while running", current.speedNoFall)
    .toggle("Invisibility makes mobs forget you", current.invisibilityBreaksTargets)
    .toggle("Show the power bar on screen", current.hud);

  showForm(player, form, (response) => {
    const values = response.formValues ?? [];
    saveSettings(player, {
      laserBreaksBlocks: values[0] !== false,
      timestopProjectiles: values[1] !== false,
      speedNoFall: values[2] !== false,
      invisibilityBreaksTargets: values[3] !== false,
      hud: values[4] !== false,
    });
    actionBar(player, "§aSettings saved.");
  });
}

function openHelp(player) {
  const lines = POWERS.map((power) => {
    const implementation = implementationFor(power.key);
    const timing =
      implementation.duration > 0
        ? `${seconds(implementation.duration)}s, recharge ${seconds(implementation.cooldown)}s`
        : `instant, recharge ${seconds(implementation.cooldown)}s`;
    return `${power.colour}${power.label}\n§7${power.blurb}\n§8${timing}`;
  });

  const form = new ActionFormData()
    .title("How the powers work")
    .body(
      `${lines.join("\n\n")}\n\n` +
        "§7Hold a power item and tap the use button, or pick one here.\n" +
        "§7Tapping a power that is already running switches it off.\n" +
        "§7Chat: §f!sp§7, §f!sp flight§7, §f!sp off§7, §f!sp kit§7."
    )
    .button("§7Back");

  showForm(player, form, () => openMenu(player));
}

export function selectAndReport(player, key) {
  if (!selectPower(player, key)) return false;
  actionBar(player, `${POWER_BY_KEY[key].colour}${POWER_BY_KEY[key].label}§7 selected`);
  return true;
}
