/*
 * Aurora Visuals - helpers
 */

export function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function say(player, text) {
  safe(() => player.sendMessage(text));
}

export function actionBar(player, text) {
  safe(() => player.onScreenDisplay.setActionBar(text));
}
