# Flying Demon Companion

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that gives you a
terrifying flying demon bodyguard: a huge-winged, horned, ember-shedding beast that
shadows you through the world and **devours anything that dares lay a hand on you**.

Built for and verified against **Bedrock Beta `1.21.0.26` (Android / mobile)**. Every
entity component, event response, Molang query, particle component and script API used by
the packs is cross-checked at build time against the documentation and vanilla packs that
Mojang ships for that exact build (`Mojang/bedrock-samples @ v1.21.0.26-preview`), so
nothing depends on a newer Minecraft version. **No experimental toggles are required.**

---

## Installing on Android

1. Copy **`dist/FlyingDemonCompanion.mcaddon`** to the device and tap it. Minecraft
   imports both packs automatically.
2. Create or edit a world → **Behavior Packs** → activate **Flying Demon Companion BP**.
   The resource pack is pulled in automatically as a dependency.

No `/function` commands, no cheats toggle, no experiments.

## Quick start

1. Creative inventory → spawn eggs → **Flying Demon** (custom dark egg with a glowing
   eye) → tap a block. The demon appears with a roar and circles nearby, watching you.
2. A chat whisper explains the pact: **offer it any raw meat or a bone** (rotten flesh,
   bone, raw beef/porkchop/chicken/mutton/rabbit, cod or salmon — one tap while holding
   the item). Bonding is instant and permanent — hearts, a bow of the head, done.
3. That's it. It now flies with you, hovers and circles overhead, lands to prowl beside
   you when you linger, and perches when told to stay (tap it to toggle sit/stand, just
   like a wolf).

> **Why one feeding?** True "owner = whoever cracked the egg" taming needs the script
> `EntityTameableComponent.tame(player)`, which in 1.21.0.26 exists only in the
> **beta** `@minecraft/server 1.12.0-beta` module — that would force the Beta APIs
> experiment on every world. This pack deliberately stays on the **stable 1.11.0**
> module, so bonding uses the engine's rock-solid wolf-style taming with a 100 % success
> chance and a generous item list: spawn → one tap → bound. Closest reliable
> alternative, chosen on purpose.

## What it does

### Guardian behaviour
- **Follows you** anywhere with real flight pathfinding (`navigation.fly`, the parrot
  flight stack — no teleport-spam). It keeps a ~5-block bubble, wanders and circles
  around you (up to ~8 blocks out, biased upward), and only hard-teleports if you get
  extremely far away (engine follow-owner failsafe).
- **Lands, walks and perches** when you stand around; takes off again when you move.
  Tap to make it **stay** (it settles, folds its wings like a cloak and curls its tail);
  tap again to release it.
- **Never turns on its owner** — engine-level: a tamed mob's revenge targeting ignores
  its owner. It also never attacks harmless mobs on its own; it only ever fights *for*
  you or in self-defence.
- Heal it with cooked meat (or rotten flesh). It is fireproof, immune to fall damage,
  breathes underwater, never despawns, can be leashed and renamed.

### Revenge / rage
The moment anything — hostile mob, player, anything damageable — hurts you (or you start
a fight yourself), the demon **remembers that exact attacker** (`owner_hurt_by_target` /
`owner_hurt_target`, not "nearest entity") and snaps:

- Its **eyes flash white-hot and the whole hide lights with lava cracks** (texture swap
  + eye-flare particles), it **rears up, spreads its wings and roars**, then accelerates
  to attack speed.
- **Opening phase (~5 s):** strafes the target and **breathes fire** — bursts of three
  demon-fire projectiles that ignite what they hit (block fire respects mobGriefing).
- **Close phase (~12 s):** phantom-style **dive attacks** (wings folded, screaming
  descent) mixed with its **grab-bite**: mouth unhinges to ~95°, snaps shut, then
  violently **thrashes its head** while its claws rake down. Bites slow the victim
  (Slowness, 3 s) so prey can't simply run. The phases alternate until something dies.
- Tough enemies (iron golems, wardens, other players' pets…) are a **real fight** —
  rage boosts it to 11 damage per bite, but there is no cheese, no instant kill.

### The devour
When its victim dies, the demon **feasts**: it hunches over the kill, mantles its wings
around it like a raptor, and chain-chomps with wet crunching sounds and flying gore
particles while the corpse despawns under it, then calms down, the cracks fade, and it
flies back to your side. (A tiny stable-API script triggers the feast on the actual
killing blow and lets the demon gorge back health; with scripts unavailable the
behaviour pack falls back to starting the feast when the target drops.)

### Fire-starting personality
Even bonded, it is still a demon. Every **2½–5½ minutes** (random), it slows, looks
around… and **breathes real fire over the nearby terrain** — the full fire-breath
animation and flame cone, plus actual `fire` blocks set a few blocks ahead of its snout
(only where there is air — it never replaces blocks). Grass burns, forests are at risk,
your roof is a suggestion. Then it acts like nothing happened and drifts back to you.
The cooldown, and the fact it only happens while calm, keep your world standing.

### Sounds & effects
Ten custom-synthesized voice files (deep layered roar, rage riser, idle growl, bite
snap, wet devouring crunches, fire-breath roar+crackle, wing flaps, hurt bark, long
death bellow, landing thud) wired through `sound_definitions.json`, the entity sound
events (`ambient`/`hurt`/`death`/`attack.strong`) and animation keyframes. Six custom
particle systems (body embers, smoke wisps, fire-breath cone, rage nova, bouncing gore
bits, eye flares) with deliberately low spawn rates — nothing here hammers a phone GPU.

## Combat kit

| Ability | Mechanic | Notes |
| --- | --- | --- |
| Demonic Bite | `delayed_attack`, 7 dmg (11 enraged) + Slowness 3 s | damage lands mid-animation, on the jaw-snap |
| Claw Slash | part of every melee swing | claws rake during the bite thrash |
| Fire Breath | `ranged_attack`, 3-shot bursts, 6 dmg + ignite | rage opening phase, 14-block range |
| Dive Attack | `swoop_attack`, ×1.6 speed | rage close phase, wings-folded dive pose |
| Devour | feast state after a kill | heals the demon (script), gore + crunching |
| Rage Mode | auto on owner hurt | +damage, +speed, texture/eye/particle change, roar |

## Animation set

Ground idle · walk · hover · flight · fast flight · dive · landing · perched/sit (with
tail-curl and head scanning) · rage entrance (wing-spread + roar + head shake) ·
bite/grab-thrash · devour loop · fire breath (inhale, jaw drop, side-to-side spray) ·
head tracking (vanilla `look_at_target`) — all blended through two animation
controllers with 0.1–0.4 s cross-fades, wing-beat frequencies phase-locked to loop
lengths so cycles never pop.

## Mobile performance

- No tick-loop scripting at all — the only script is three tiny event subscriptions.
- All AI is engine-native (the same goal system vanilla mobs use); the rage state
  machine is component-group swaps driven by timers, not repeating commands.
- 47 files, ~660 KiB total; one 256×128 texture per skin; 62-cube model; particle
  emitters capped at a few particles per second (the fire cone is burst-limited).

## Honest limitations (and why)

- **Bonding takes one feeding** — see the box above; script-free auto-tame does not
  exist in 1.21.0.26's stable surface.
- **The mischief fire-breath doesn't seek a distant target** — data-driven mobs can't
  pathfind to "a nice flammable spot", so it torches whatever is in front of it instead.
- **If a victim escapes alive** (rare — mobs fight to the death) the demon may still
  celebrate with a short feast animation when scripts are disabled; with scripts on, the
  feast fires only on real kills.
- **The mischief `setblock` fire ignores mobGriefing** (commands always do); the fire
  *projectiles* respect it. Delete the four `queue_command` lines in
  `fdc:arson_start` (in `behavior_packs/flying_demon_bp/entities/flying_demon.json`)
  if you want the arson habit to be purely cosmetic.

## Rebuilding from source

```bash
python3 tools/demon/build.py
```

regenerates the geometry (`tools/demon/spec.py` is the single source of truth for
cubes *and* UVs), repaints every texture, resynthesizes every sound, re-runs the full
1.21.0.26 cross-verification (set `BEDROCK_SAMPLES` to a checkout of
`Mojang/bedrock-samples` at `v1.21.0.26-preview`), and repackages
`dist/FlyingDemonCompanion.mcaddon`. The build **fails** if any JSON is malformed, any
component/query/particle/script API is unknown to that Minecraft build, or any internal
reference (bones, locators, animations, particles, sounds, textures, groups, events,
UUIDs) dangles.

## File tour

```
behavior_packs/flying_demon_bp/
  entities/flying_demon.json   # the whole brain: taming, follow, rage phases, arson
  entities/demon_fire.json     # fire-breath projectile (small_fireball derivative)
  scripts/main.js              # optional: devour-on-kill + feast healing (stable 1.11.0)
resource_packs/flying_demon_rp/
  entity/…                     # client wiring: textures, anims, particles, sounds, egg
  models/entity/…              # 62-cube demon + fireball geometry (generated)
  animations/…                 # 15 animations + fireball trail
  animation_controllers/…      # locomotion + action state machines
  particles/…                  # 6 custom particle systems
  sounds/…                     # 10 synthesized wav voices + definitions
tools/demon/                   # generators, validator, packager
dist/FlyingDemonCompanion.mcaddon
```
