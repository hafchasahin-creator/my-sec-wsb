/*
 * Flight
 *
 * Real flight is granted with `ability @s mayfly true`, which gives the
 * smooth creative-style movement the game already has. If that is refused -
 * some worlds and some builds will - the power falls back to a hover: gentle
 * levitation while looking up, slow falling the rest of the time.
 *
 * The ability is only ever revoked if this power granted it, so a creative
 * player never loses their own flight.
 */

import { CONFIG, SOUNDS } from "../config.js";
import { add, effect, particle, safe, sound, viewDirection } from "../util.js";

export const flight = {
  key: "flight",
  duration: CONFIG.flight.duration,
  cooldown: CONFIG.flight.cooldown,

  start(player, state) {
    sound(player, SOUNDS.flight, 1.2);

    if (isCreative(player)) {
      // Already able to fly - do not touch the ability, just add the wings.
      state.data.granted = false;
      state.data.hover = false;
      return true;
    }

    // Assume the grant lands. If the command is refused the catch below drops
    // into hover mode instead - and because `granted` starts true, switching
    // the power off in the same tick still hands the ability back.
    state.data.granted = true;
    state.data.hover = false;
    safe(() =>
      player.runCommandAsync("ability @s mayfly true").catch(() => {
        state.data.granted = false;
        state.data.hover = true;
      })
    );
    return true;
  },

  tick(player, state, elapsed) {
    if (state.data.hover && elapsed % CONFIG.refreshEveryTicks === 0) {
      const ticks = CONFIG.refreshEveryTicks * 3;
      effect(player, "slow_falling", ticks, 0);
      if (viewDirection(player).y > 0.45) {
        effect(player, "levitation", 12, CONFIG.flight.hoverLevitationAmplifier);
      }
    }

    if (elapsed % CONFIG.flight.wingEveryTicks !== 0) return;
    const dimension = safe(() => player.dimension);
    const at = player.location;
    for (const side of [-0.6, 0.6]) {
      const wing = add(at, { x: side, y: 1.1, z: 0 });
      particle(dimension, "sp:wing_feather", wing);
      particle(dimension, "minecraft:endrod", wing);
    }
  },

  stop(player, state) {
    if (state?.data?.granted) {
      safe(() => player.runCommandAsync("ability @s mayfly false").catch(() => {}));
    }
    // Feather landing: whatever height flight ended at, you drift down.
    effect(player, "slow_falling", CONFIG.flight.landingTicks, 0);
    sound(player, SOUNDS.expire, 1.4);
  },
};

function isCreative(player) {
  return safe(() => player.matches({ gameMode: "creative" })) === true;
}
