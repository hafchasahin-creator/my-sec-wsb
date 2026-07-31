# Spirit Guardian

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack): a flying spirit
that binds itself to you, follows you everywhere, and takes the soul of anything that
attacks you.

Built against **Bedrock 1.21.0** — the build in your screenshot (`1.21.0.26`, Android /
Pocket Edition). Stable components and the stable `@minecraft/server 1.11.0` module only,
so **no experimental toggles are required**.

---

## What it does

- **Flies.** It has no gravity and no walking AI at all. The script flies it: it hovers
  above your shoulder, orbits you slowly, bobs on the spot, and dives when it has
  something to kill.
- **Follows you anywhere.** It speeds up the further behind it falls, blinks to you if you
  get more than 28 blocks away, and comes through Nether and End portals with you. If it
  ever gets stranded in an unloaded chunk it is recalled to you automatically.
- **Protects you.** Anything that damages you is marked, hunted down and harvested. In
  guard mode it also clears hostiles that simply come within 14 blocks of you, before they
  get a chance.
- **Takes souls.** Every kill sends a soul drifting back into you: 2 hearts of healing
  each, and every 5th soul grants Absorption for 90 seconds. Your soul count is yours — it
  survives the spirit being dismissed, killed or re-summoned.
- **Never turns on people.** Players are never targets, including whoever hit you. It also
  leaves passive animals alone.

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/SpiritGuardian.mcaddon`** onto the device.
2. Tap the file. Minecraft imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Spirit Guardian BP**.
   The resource pack comes along as a dependency.
4. Leave every experimental toggle **off**.

On joining you will see:

```
[Spirit Guardian] v1.0.0 loaded - use the spawn egg, or /function spirit_summon.
```

## Getting one

**Spawn egg** — in creative, search `spirit` or `guardian`; the **Spawn Guardian Spirit**
egg is in the Spawn Eggs tab. Tap the ground with it.

**With cheats on:**

```
/function spirit_summon
/give @s spirit:guardian_spawn_egg
/summon spirit:guardian
```

**Crafting it in survival** (crafting table):

```
      Glowstone Dust
Soul Sand   Ghast Tear   Soul Sand
      Glowstone Dust
```

Whichever way you get it, it binds to the nearest player the moment it appears, tells you
so in chat, and takes your name.

## Commanding it

| Action | What happens |
| --- | --- |
| **Tap the spirit** | Reports your soul count and its current mode |
| **Sneak + tap** | Guard mode → Escort mode |
| **Sneak + tap again** | Dismisses it — it fades, and stops being recalled. Your souls stay yours |

**Guard mode** (default): hunts hostiles within 14 blocks of you, and avenges anything
that hurts you.
**Escort mode**: stays on your shoulder and only avenges attacks on you.

To get it back after dismissing, use another spawn egg.

---

## Tuning

Everything sits in the `CONFIG` object at the top of
`behavior_packs/spirit_guardian_bp/scripts/main.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `orbitRadius` / `hoverHeight` | 2.1 / 1.5 | Where it sits relative to you |
| `followSpeed` / `maxFollowSpeed` | 0.5 / 2.6 | Cruise and catch-up speed, blocks per update |
| `chaseSpeed` / `maxChaseSpeed` | 1.1 / 3.2 | Speed while hunting |
| `recallDistance` | 28 | How far you can get before it blinks to you |
| `guardRadius` | 14 | How close a hostile has to be before it is hunted |
| `instantKill` | `true` | Set `false` and it deals `strikeDamage` (40) instead of taking the soul whole |
| `healPerSoul` | 4 | Half-hearts healed per soul |
| `absorptionEvery` / `absorptionSeconds` | 5 / 90 | Absorption tier threshold and duration |
| `protectOwner` / `huntHostiles` | `true` | Avenge attacks / clear nearby hostiles |
| `updateTicks` | 2 | Flight loop rate — raise it to 3–4 on a very old phone |

---

## Repository layout

```
behavior_packs/spirit_guardian_bp/
  manifest.json                     BP manifest, min_engine_version 1.21.0
  entities/guardian.json            server entity: no gravity, no AI, immune, persistent
  recipes/guardian_spawn_egg.json   spawn egg recipe
  functions/spirit_summon.mcfunction
  scripts/main.js                   flight, guarding, soul harvesting
  texts/                            pack name strings
resource_packs/spirit_guardian_rp/
  entity/guardian.entity.json       client entity: model, texture, controller, spawn egg
  models/entity/guardian.geo.json   hand-written geometry, 64x64 box UV
  animations/guardian.animation.json  idle float and wing flap (Molang)
  render_controllers/
  textures/entity/spirit_guardian.png        painted onto the model's UV layout
  textures/items/spirit_guardian_spawn_egg.png
  texts/en_US.lang                  entity and spawn egg names
tools/
  gen_spirit_textures.py            regenerates the sheet, egg and pack icons (stdlib only)
  build.py                          validates the packs and writes the .mcaddon
  verify_spirit/                    flies the spirit against a mock API
dist/SpiritGuardian.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_spirit_textures.py   # redraw the textures (add --preview for ASCII art)
python3 tools/build.py spirit          # validate + repackage dist/SpiritGuardian.mcaddon
node tools/verify_spirit/verify.mjs    # fly it without launching the game
```

`build.py` now also resolves every reference a custom entity depends on: the client entity
must exist for the server entity, its texture must be a real PNG, its geometry identifier
must be defined in `models/`, its render controllers and animations must be defined, every
animation named in `scripts/animate` must be declared, and the spawn egg texture must
resolve through `item_texture.json`. Any one of those being wrong is what produces an
invisible or bright-pink mob with nothing useful in the content log, so they are build
errors here instead.

`verify.mjs` runs the real `main.js` against a stand-in for the scripting API and checks
that it binds on spawn, actually moves and orbits, keeps station, catches up with a player
who walks away, blinks to one who teleports, follows through a dimension change, is
recalled after being lost, harvests whatever attacks its owner, hunts nearby hostiles,
leaves animals and players alone, grants Absorption at five souls, and honours the
tap/sneak-tap controls.

## Notes on how it is built

- **Flight is script-driven.** The entity JSON deliberately has no navigation or movement
  components and `has_gravity: false`; the loop teleports it along a smoothed path every
  two ticks. That is what makes hovering, orbiting and diving possible — vanilla flying
  AI cannot keep station beside a player.
- **One guardian per owner.** The loop sweeps all three dimensions each update, keeps the
  first spirit it finds for each owner and quietly removes duplicates, so a re-summon can
  never leave you with two.
- **Souls are stored on the player**, not the spirit, as a world dynamic property.
- **The kill is credited to you.** Soul-taking deals the damage with you as the source
  before falling back to `kill()`, so drops, looting and XP behave like your own kill.
- **The spirit is immune to damage** (`minecraft:damage_sensor`), so it cannot be shot out
  of the air by the mobs it is fighting. Dismiss it by sneak-tapping twice.
