/*
 * Luxury Tech House - the Mansion Tech Remote's control panel.
 *
 * A touch-first menu: every system in the house is one or two taps away, which
 * matters a lot more on a phone than a chat command would. If the UI module is
 * unavailable for any reason the caller falls back to printing status text, so
 * the add-on never depends on the form showing.
 */

import { ActionFormData } from "@minecraft/server-ui";
import { safe, say } from "./util.js";

function show(form, player, handler) {
  safe(() =>
    form
      .show(player)
      .then((response) => {
        if (response.canceled) return;
        safe(() => handler(response.selection));
      })
      .catch(() => {})
  );
}

function statusPanel(player, estate) {
  const form = new ActionFormData()
    .title("Estate Status")
    .body(estate.status().join("\n"))
    .button("Back");
  show(form, player, () => mainPanel(player, estate));
}

function doorsPanel(player, estate) {
  const form = new ActionFormData()
    .title("Doors")
    .body("§7Automatic doors return to proximity control on their own.")
    .button("Open every door")
    .button("Close every door")
    .button("Open the main entrance")
    .button("Back");
  show(form, player, (choice) => {
    if (choice === 0) estate.doors.setGroupTarget(() => true, true);
    else if (choice === 1) estate.doors.setGroupTarget(() => true, false);
    else if (choice === 2) {
      estate.doors.setTarget("main_entrance", true);
      estate.doors.setTarget("rear_terrace", true);
    } else return mainPanel(player, estate);
    mainPanel(player, estate);
  });
}

function secretPanel(player, estate) {
  const form = new ActionFormData()
    .title("Concealed Systems")
    .body("§7Every one of these also has a physical control in the house.")
    .button(`Bookshelf wall: ${estate.flags.shelf ? "close" : "open"}`)
    .button(`Vault: ${estate.flags.vault ? "seal" : "open"}`)
    .button(`Escape tunnel: ${estate.flags.tunnel ? "seal" : "open"}`)
    .button(`Helipad: ${estate.flags.helipad ? "retract" : "extend"}`)
    .button(`Vehicle platform: ${estate.flags.platform ? "lower" : "raise"}`)
    .button("Back");
  show(form, player, (choice) => {
    const actions = [
      "shelf_toggle",
      "vault_toggle",
      "tunnel_toggle",
      "helipad_toggle",
      "platform_toggle",
    ];
    if (choice < actions.length) estate.dispatch(actions[choice], player);
    mainPanel(player, estate);
  });
}

function liftPanel(player, estate) {
  const form = new ActionFormData().title("Lifts").body("§7Choose a landing.");
  const options = [];
  for (const lift of estate.spec.lifts) {
    for (const stop of lift.stops) {
      options.push({ liftId: lift.id, y: stop.y, label: stop.label });
      form.button(`${lift.id === "main" ? "Glass lift" : "Secure lift"} · ${stop.label}`);
    }
  }
  form.button("Back");
  show(form, player, (choice) => {
    const option = options[choice];
    if (option) estate.callLift(option.liftId, option.y);
    mainPanel(player, estate);
  });
}

function travelPanel(player, estate) {
  const form = new ActionFormData().title("Travel").body("§7Jump anywhere on the estate.");
  for (const target of estate.spec.teleports) form.button(target.label);
  form.button("Back");
  show(form, player, (choice) => {
    const target = estate.spec.teleports[choice];
    if (target) {
      safe(() =>
        player.teleport(
          { x: target.x + 0.5, y: target.y, z: target.z + 0.5 },
          { dimension: estate.dimension }
        )
      );
    } else {
      mainPanel(player, estate);
    }
  });
}

export function mainPanel(player, estate) {
  const form = new ActionFormData()
    .title("Luxury Tech House")
    .body(
      `§7Security §f${estate.lockdown ? "§cLOCKDOWN" : "§aNormal"}   ` +
        `§7Lighting §f${estate.lighting ?? "-"} §8(${estate.lightOverride})`
    )
    .button(estate.lockdown ? "§cCancel lockdown" : "§4Trigger lockdown")
    .button(`Lighting scene: ${estate.lightOverride}`)
    .button("Doors")
    .button("Concealed systems")
    .button("Lifts")
    .button("Travel")
    .button("Status");

  show(form, player, (choice) => {
    switch (choice) {
      case 0:
        estate.setLockdown(!estate.lockdown);
        break;
      case 1:
        estate.dispatch("lighting_cycle", player);
        break;
      case 2:
        doorsPanel(player, estate);
        break;
      case 3:
        secretPanel(player, estate);
        break;
      case 4:
        liftPanel(player, estate);
        break;
      case 5:
        travelPanel(player, estate);
        break;
      case 6:
        statusPanel(player, estate);
        break;
      default:
        break;
    }
  });
}

/** Chat rendering, used when no estate exists yet or the form cannot show. */
export function printStatus(player, estate) {
  say(player, "§b§lLuxury Tech House");
  for (const line of estate.status()) say(player, line);
}
