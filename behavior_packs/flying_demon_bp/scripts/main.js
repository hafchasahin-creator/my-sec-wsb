// Flying Demon Companion — optional enhancement layer.
// Uses ONLY the stable @minecraft/server 1.11.0 module shipped with
// Minecraft Bedrock 1.21.0.26 — no experimental toggles required.
//
// Everything gameplay-critical is data-driven in the behavior pack; this
// script only upgrades one heuristic: the devour animation normally starts
// when the demon loses its target, but here it is triggered the moment the
// demon actually KILLS its target, and the demon gorges itself back to
// health while eating.

import { world } from "@minecraft/server";

const DEMON_ID = "fdc:flying_demon";

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const killer = ev.damageSource ? ev.damageSource.damagingEntity : undefined;
    if (!killer || !killer.isValid() || killer.typeId !== DEMON_ID) {
      return;
    }
    // Start the devour sequence immediately (the data-driven
    // fdc:target_lost fallback fires a moment later and is harmless).
    killer.triggerEvent("fdc:target_killed");
    // Feeding frenzy: eating restores the demon.
    killer.addEffect("regeneration", 80, {
      amplifier: 1,
      showParticles: false
    });
  } catch (e) {
    // Never let a scripting hiccup disturb the demon.
  }
});
