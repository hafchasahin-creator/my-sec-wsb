# Saitama Bot

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack): a hero bot that
walks with you, kills anything that hurts you in a single punch, and erases **99,000+
blocks of world** doing it.

Built against **Bedrock 1.21.0** — the build in your screenshot (`1.21.0.26`, Android /
Pocket Edition). Stable components and the stable `@minecraft/server 1.11.0` module only,
so **no experimental toggles are required**.

---

## ⚠️ Read this first

By default **every avenge punch is a Serious Punch**, and a Serious Punch keeps digging
until 99,000 blocks are gone. One zombie scratching you in your base is enough to set it
off. Three things keep it survivable:

- The blast is always aimed **away from you**, along the line from the bot to whatever hit
  you.
- Blocks within **12 blocks of you** are never touched, so the ground under your feet stays
  put.
- There is a **10 second cooldown** between world-enders, and only one runs at a time.

If you want the hero without the crater, sneak-tap him for **casual mode**: still one
punch, still an instant kill, but only a 5-block crater. Or set `seriousOnEveryHit: false`
in the script and keep the big punch on `/function saitama_serious` only.

---

## What he does

- **Follows you.** Walks at your shoulder, runs to catch up (he is always faster than you
  are), steps up onto terrain rather than clipping through it, blinks to you past 32
  blocks, and follows you through portals. If he ever gets stranded he is recalled.
- **One punch.** Anything that damages you gets marked, chased down at speed, and hit once.
  It does not matter what it is or how much health it has.
- **99,000+ blocks.** The punch is not a hit box. It carves a **10-block-wide shockwave
  lane 140 blocks long** in the direction he swings, then opens a crater at the far end
  that keeps widening until 99,000 blocks have been erased — up to a 52-block radius.
  Chat reports the exact count and your career total.
- **Animated.** Idle, run and punch animations, driven from the script through
  `minecraft:variant`, so he winds up and follows through on every hit.
- **Cannot be hurt.** Nothing damages him. That is the entire joke.
- **Never hits people.** Players are never targets, including whoever hit you.

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/SaitamaBot.mcaddon`** onto the device.
2. Tap the file. Minecraft imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Saitama Bot BP**.
4. Leave every experimental toggle **off**.

On joining you will see:

```
[Saitama Bot] v1.0.0 loaded - spawn egg, or /function saitama_summon.
```

## Getting him

**Spawn egg** — in creative, search `saitama` and tap the ground with the egg.

**With cheats on:**

```
/function saitama_summon
/give @s saitama:hero_spawn_egg
/summon saitama:hero
```

**Crafting it in survival** (crafting table): three yellow wool across the top, yellow wool
either side of a **nether star** in the middle, three red wool along the bottom.

He binds to the nearest player the moment he appears.

## Controls

| Action | What happens |
| --- | --- |
| **Tap him** | Reports his mode and how many blocks he has erased for you |
| **Sneak + tap** | Serious mode → Casual mode (small crater) |
| **Sneak + tap again** | Sends him off — he stops being recalled. Spawn egg brings him back |
| `/function saitama_serious` | He punches wherever **you** are looking, on demand |

---

## Tuning

Everything is in the `CONFIG` object at the top of
`behavior_packs/saitama_bot_bp/scripts/main.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `seriousOnEveryHit` | `true` | Turn off and avenge punches use the small crater instead |
| `seriousCooldownTicks` | 200 | 10 seconds between world-enders |
| `serious.targetBlocks` | 99000 | How much world one punch erases |
| `serious.blocksPerTick` | 1500 | Cells examined per tick. **Lower this if an old phone stutters** — the punch just takes longer |
| `serious.corridorRadius` / `corridorLength` | 10 / 140 | The shockwave lane |
| `serious.craterRadius` | 52 | Hard cap on the crater |
| `serious.protectRadius` | 12 | Blocks this close to you are spared |
| `serious.unbreakable` | bedrock, barriers, command blocks, portals | Never destroyed |
| `casualCraterRadius` | 5 | The restrained punch |
| `followDistance` / `maxFollowSpeed` | 2.6 / 3.0 | How close he stays and how fast he catches up |
| `maxChaseSpeed` | 6.0 | How fast he closes on a target |

---

## Repository layout

```
behavior_packs/saitama_bot_bp/
  manifest.json                    BP manifest, min_engine_version 1.21.0
  entities/saitama.json            server entity, with variant groups for the three states
  recipes/saitama_spawn_egg.json
  functions/saitama_summon.mcfunction, saitama_serious.mcfunction
  scripts/main.js                  following, punching, the demolition engine
resource_packs/saitama_bot_rp/
  entity/saitama.entity.json       client entity
  models/entity/saitama.geo.json   hand-written humanoid geometry with a cape
  animations/saitama.animation.json          idle, run, punch
  animation_controllers/                     state machine driven by query.variant
  render_controllers/
  textures/entity/saitama_hero.png           painted onto the model's UV layout
  textures/items/saitama_hero_spawn_egg.png
  texts/en_US.lang
tools/
  gen_saitama_textures.py          regenerates the sheet, egg and pack icons (stdlib only)
  build.py                         validates the packs and writes the .mcaddon
  verify_saitama/                  runs the bot against a mock API with real terrain
dist/SaitamaBot.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_saitama_textures.py   # redraw the textures (add --preview for ASCII art)
python3 tools/build.py saitama          # validate + repackage dist/SaitamaBot.mcaddon
node tools/verify_saitama/verify.mjs    # punch a mock world without launching the game
```

## How the punch is built

Nearly a quarter of a million cells cannot be touched in one tick, so the punch is a
**generator**: `punchCells()` yields cells in blast order — the shockwave lane one disc at
a time, then the crater as cube shells clipped back to a sphere — and a tick loop pulls a
fixed budget out of it each tick. That is what keeps the frame rate steady and makes the
destruction visibly travel outward instead of appearing all at once.

Two details matter for it feeling instant rather than interminable:

- **The crater's centre is sunk below the impact point.** A sphere centred at head height
  is half sky, and sweeping empty air is what made the first version take a minute.
- **It stops the moment the quota is met.** With the crater biased into the ground it
  reaches 99,000 destroyed after sweeping about 145,000 cells, which is roughly seven
  seconds — not the full million-cell sphere.

Cube shells are enumerated face by face rather than by scanning the solid cube, which is
what keeps the crater `O(radius³)` overall instead of `O(radius⁴)`.

## Verified before shipping

`node tools/verify_saitama/verify.mjs` runs the real `main.js` against a stand-in for the
scripting API that serves actual terrain — stone to y 64, air above, bedrock at the bottom
— and counts every block read and cleared. It checks that he binds and keeps up with a
player who runs off, that he follows across dimensions, that the attacker dies in one
punch with the run/punch/idle animations firing, that **the serious punch really erases
99,000 blocks**, that it never exceeds its per-tick budget, that the ground under the
owner and bedrock both survive, that a second attacker cannot start a second demolition,
that casual mode leaves the world standing, that `/function saitama_serious` works, and
that he never punches a player.

The mock re-raises `entityHurt` from inside `applyDamage`, the way the game does, so the
test proves the killing blow cannot recurse back into the avenge handler.

## Compatibility notes

- **Animation states** ride on `minecraft:variant`, switched with `triggerEvent` from the
  script and read by the animation controller as `query.variant`. That channel has been
  stable for years, unlike newer entity-property APIs.
- **Movement is script-driven.** The entity has no gravity and no navigation components;
  the loop teleports him along a smoothed path and snaps him to the terrain surface.
- **Fan work.** Saitama is Yusuke Murata and ONE's character; this is a hobby add-on, not
  an official or endorsed product.
