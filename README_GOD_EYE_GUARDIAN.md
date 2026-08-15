# God Eye Guardian

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that adds one
entity: a giant floating eye that bonds to the player who spawned it, follows them in
silence, and destroys anything that attacks them.

The God Eye isn't a pet. It is something immensely powerful that has decided you are
under its protection.

Built for **Bedrock 1.21.0** — specifically the `1.21.0.26` beta on Android / Pocket
Edition. It uses only **stable** entity components and the **stable**
`@minecraft/server 1.11.0` scripting module, so **no experimental toggles are required**.

**Download:** [`dist/God_Eye_Guardian.mcaddon`](dist/God_Eye_Guardian.mcaddon)

---

## Installing on Android

1. Download `God_Eye_Guardian.mcaddon` onto the device.
2. Tap the file. Minecraft opens and imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **God Eye Guardian BP**.
   The resource pack comes along as a dependency; if it does not, also activate
   **God Eye Guardian RP** under **Resource Packs**.
4. Leave every experimental toggle **off** — none are needed.

When you join, chat shows:

```
[God Eye Guardian] v1.0.0 - /function god_eye_help
```

If that line does not appear the behaviour pack's scripts are not running, and nothing
else in this add-on will work either. That is the first thing to check.

If tapping the file does not open Minecraft, rename it to `God_Eye_Guardian.zip` and copy
the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/god_eye_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/god_eye_rp
```

## Getting one

Either grab the **God Eye spawn egg** from the creative inventory (it sits with the other
spawn eggs), or run:

```
/function god_eye_spawn
```

Either way the eye bonds to you permanently the moment it appears. One eye per player —
spawning a second dismisses the first.

## Commands

| Command | What it does |
| --- | --- |
| `/function god_eye_spawn` | Calls your eye |
| `/function god_eye_remove` | Dismisses **your** eye only — other players keep theirs |
| `/function god_eye_mode_normal` | Default. Retaliates only, and never against players |
| `/function god_eye_mode_aggressive` | Hunts hostiles near you, and answers players who strike you |
| `/function god_eye_help` | Prints the list plus your current bond and mode |

Mode is stored per player and survives relogging.

---

## What it does

### Most of the time, nothing

It floats **5–7 blocks above and behind you**, drifting on a slow orbit, rotating gently,
trailing dark particles. Its pupil tracks nearby hostile mobs on its own. Every so often
it makes a deep, wrong-sounding noise. That is all it does.

If you look **directly** at it, it will sometimes notice: the pupil shrinks and the whole
eye slowly turns away. Sometimes. Not always.

Occasionally it dissolves into particles and reappears somewhere else near you. It also
does this if you get too far ahead of it, or change dimension.

### The instant something attacks you

Anything that damages you — or merely swings at you, even if your armour or shield ate
the hit — is marked as a threat, and the eye responds within about **3 ticks**. It picks
one of six executions at random:

| Execution | What happens |
| --- | --- |
| **Judgement Beam** | Locks on and fires a beam from its pupil in six pulses, then an explosion-like burst kills the target |
| **Sky Smite** | Shoves the target clear of you, strikes it with real lightning four times, then finishes it |
| **Void Execution** | Levitates the target, wraps it in void particles, and makes it disappear entirely |
| **Crush** | Launches the target upward, hangs it there, then slams it into the ground with a huge particle burst |
| **Eye Swarm** | Five smaller spectral eyes surround the target, tighten their ring, and strike together |
| **Erase** | The world goes dark and the screen shakes for everyone nearby while the target simply stops existing |

Void Execution and Erase remove the target outright — no drops. The other four kill
normally, so you still get loot and XP.

It protects against zombies, skeletons, creepers, spiders, pillagers, endermen, the
Wither, the Ender Dragon, and anything else that attacks you. Attacking the eye itself
counts too.

### Things it will not do

- It never attacks unprovoked in normal mode.
- It never touches other **players** unless you switch to aggressive mode. One PvP tap
  should not erase somebody.
- It never targets you, other eyes, or the swarm eyes.
- It will not re-execute the same attacker within 3 seconds.

### Killing it

You cannot, and neither can anything else. A damage sensor rejects every damage cause
except `suicide`/`self_destruct`, its health is restored by script if anything slips
through, and its entity families deliberately exclude `mob` and `monster` so no hostile
mob will ever choose it as a target. `/function god_eye_remove` is the way to get rid of
it; `/kill` works as an emergency escape hatch.

---

## Performance on Android

This is one entity per player, and it is built to stay cheap:

- **No pathfinding.** The eye has no navigation component at all. Position is one
  interpolated `teleport` per tick — a few floating-point operations.
- **The constant aura is client-side.** Particles are emitted by keyframes in a looping
  animation, not by the server, so the ambient effect costs the server nothing. It is
  four particles every 1.2 seconds.
- **Work is spread across ticks.** Threat scanning runs at most once a second and only in
  aggressive mode; terrain probing every 8 ticks; the "are you staring at me" check every
  5; sound and blink rolls every few hundred.
- **Executions are capped.** At most **two** run world-wide at once (`limits.maxConcurrent`),
  and each is a short bounded sequence that cleans up after itself.
- **The swarm is bounded.** Five extra entities for three seconds, and each one carries a
  `minecraft:timer` that despawns it after 14 seconds even if the script dies.
- **Bandwidth optimization** is declared on both entities so distant eyes drop position
  updates instead of streaming them.
- No block-breaking explosions are ever created; the explosion look is particles and sound.

If you want it lighter still, raise `follow.lerp` toward 1.0 and teleport less often, or
drop `limits.maxConcurrent` to 1. Everything is in the `CONFIG` object at the top of
`behavior_packs/god_eye_bp/scripts/main.js`.

## Tuning

`CONFIG` covers hover height and distance, drift, blink range, the stare threshold and
how often it reacts, response speed, per-target cooldown, aggressive-mode radius and
cooldown, and every timing and particle count in all six executions.

---

## Repository layout

```
behavior_packs/god_eye_bp/
  manifest.json                   min_engine_version 1.21.0
  entities/god_eye.json           the eye - format_version 1.21.0
  entities/swarm_eye.json         the small spectral eyes
  functions/*.mcfunction          five commands
  scripts/main.js                 all guardian logic (@minecraft/server 1.11.0)
resource_packs/god_eye_rp/
  entity/*.entity.json            client entities, materials, spawn egg
  models/entity/god_eye.geo.json  generated - layered sphere, 18 cubes
  animations/                     float, look, shy, alert, execute, spawn, aura
  animation_controllers/          state machine keyed on query.mark_variant
  render_controllers/             alphatest body, alphablend aura, emissive glow
  particles/                      9 effects, all using one 32x32 atlas
  fogs/god_eye_void.json          the Erase blackout
  textures/                       generated
tools/
  gen_god_eye_textures.py         redraw every texture (stdlib only)
  gen_god_eye_model.py            regenerate the geometry
  build_god_eye.py                validate + package
  sim/                            headless test harness for main.js
dist/God_Eye_Guardian.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_god_eye_textures.py   # redraw textures
python3 tools/gen_god_eye_model.py      # regenerate geometry
node     tools/sim/run.mjs              # exercise the script headlessly
python3 tools/build_god_eye.py          # validate + repackage the .mcaddon
```

`build_god_eye.py` runs the simulation itself and refuses to package if anything is
wrong. It checks manifest shape, UUID uniqueness and validity, the BP→RP dependency and
version match, the script entry point, that every behaviour entity has a client entity,
that every geometry/texture/animation/controller/particle/material name a client entity
references actually exists, that animations only touch bones and locators the geometry
has, that animation-controller states only play declared animations and only transition
to real states, that component groups named by events exist, that the spawn egg resolves
through `item_texture.json` to a PNG, that every `god_eye:*` identifier in `main.js` is a
real entity, particle, fog or event, that the command tags in the `.mcfunction` files and
in `main.js` agree, that display names exist, that paths are lowercase ASCII, and finally
that the zip it produced opens and contains both manifests.

`tools/sim/` runs `main.js` against a strict mock of `@minecraft/server` that rejects the
same arguments the real module rejects (NaN positions, unknown `TeleportOptions` keys,
`applyImpulse` on players, non-integer effect durations). It drives 54 assertions: the
bond, following distance and height, blinking, all six executions running to completion
and cleaning up, the stare reaction, invulnerability, PvP gating in both modes,
aggressive auto-hunting, duplicate cleanup, and no leaked timers or entities.

---

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0` on both packs. Entity format
  version is `1.21.0`; client entities, animations, controllers and particles use the
  long-stable `1.10.0`/`1.8.0`/`1.12.0` formats; fog uses `1.16.100`.
- **No experiments:** every component used (`type_family`, `collision_box`, `physics`,
  `pushable`, `movement`, `health`, `knockback_resistance`, `fire_immune`,
  `damage_sensor`, `persistent`, `mark_variant`, `scale`, `timer`, `instant_despawn`,
  `conditional_bandwidth_optimization`, and the three `behavior.look_*` goals) is stable
  in 1.21.0, as is `@minecraft/server 1.11.0`.
- **State is driven through `mark_variant`.** Client animation states key off
  `query.mark_variant`, which the script sets through the component and, failing that,
  through the data-driven `god_eye:set_*` events. Both paths ship, so the look survives
  either way.
- **Pupil tracking is free.** It comes from `query.target_x_rotation` /
  `target_y_rotation` on a bone named `head`, fed by the `look_at_entity` and
  `look_at_player` goals. That is all client-side; the server does no work for it.
- **Sounds are vanilla ids, pitched down.** No `.ogg` files are shipped, so there is
  nothing to fail to load — the ambience is warden heartbeats, cave ambience, ender and
  wither sounds played at pitch 0.2–0.5. Every sound and particle call is individually
  wrapped, so a device or build missing one id loses that single effect and nothing else.
- **Sky Smite uses real lightning,** which can start fires like any lightning. The target
  is teleported away from you first and you are given fire resistance for the duration.
  Set `smite.strikes` to 0 if you would rather it never happened.
