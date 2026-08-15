# World Eater

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that adds a giant
boss which really does eat the world — it deletes terrain, grows on what it has eaten, and
gets more monstrous at every stage.

Built against **Bedrock 1.21.0** (targeting `1.21.0.26`, Android / Pocket Edition). It uses
only stable components and the stable `@minecraft/server 1.11.0` scripting module, so **no
experimental toggles are needed**.

Download: **`dist/WorldEater.mcaddon`**

---

## Install on Android

1. Download `WorldEater.mcaddon` to your phone.
2. Tap the file. Minecraft opens and imports both packs.
3. Create or edit a world → **Behaviour Packs** → activate **World Eater BP**.
   Activating it pulls in **World Eater RP** automatically (the BP declares it as a
   dependency). If it does not, activate the resource pack manually too.
4. Both packs must be on for the boss to work: the BP holds the entity and the scripts,
   the RP holds the model, textures, animations, particles and sounds.

No experimental features are required. Cheats are only needed if you want the
`/function` helpers below.

## Spawning it

- **Creative inventory** → *Items* tab → **Spawn Eggs** → **World Eater Spawn Egg**
  (dark speckled egg with a glowing maw). Tap the ground to place one.
- Or `/summon we:world_eater`
- Or `/function we/summon`

**`/function we/stop` is the emergency stop** — it removes every World Eater in loaded
chunks and cancels all queued destruction. Worth knowing before you spawn one.
`/function we/help` prints the controls in chat.

> It eats real blocks and does not put them back. Spawn it in a world you are willing to
> lose, or make a backup copy of the world first.

---

## The four stages

It starts small and grows on the blocks it has swallowed. The current stage shows in the
**boss health bar** at the top of the screen *and* on the floating name tag above it,
along with a live count of what it has eaten.

| Stage | Name | Health | Damage | Speed | Size | Destruction radius | Unlocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Hungry** | 250 | 6 | 0.28 | ×1.0 | 3 | Devour, Shockwave |
| 2 | **Devourer** | 450 | 8 | 0.34 | ×1.7 | 5 | + Ground Split |
| 3 | **Catastrophe** | 750 | 10 | 0.40 | ×2.6 | 7 | + Meteor Rain, World Quake, sky darkens |
| 4 | **World Eater** | 1200 | 13 | 0.46 | ×3.8 | 10 | + Death Beam, Rage Mode |

Thresholds are **400 / 1400 / 3200** blocks eaten. Growing re-rolls its stats, which also
heals it to full — so killing it is easier if you do not let it feed.

Each stage swaps its texture for a more corrupted one: ashen grey-purple with dull red
veins at stage 1, through deep red, through magma-cracked black, to void-black with
white-hot cracks at stage 4. Stages 3 and 4 tuck their limbs and float.

## Abilities

Picked at random from the pool its stage has unlocked, every 2–5 seconds:

| Ability | What it does |
| --- | --- |
| **Devour** | Eats a widening cone of blocks straight out of its mouth |
| **Shockwave** | Clears a disc of terrain around itself and hurls everything nearby outward |
| **Ground Split** | Tears a deep, wandering trench through the ground ahead of it |
| **Meteor Rain** | Drops explosions around up to three nearby targets, spread over several ticks |
| **Death Beam** | Bores a 30-block tube through terrain; anything in the beam takes 8 damage and is thrown |
| **World Quake** | Five explosions in a ring plus a slab of terrain removed under it |
| **Rage Mode** | 11 seconds of ×1.6 radius and roughly double ability rate |

**Protected from deletion:** bedrock, command blocks, structure blocks and structure void,
barriers, jigsaws, light blocks, allow/deny/border blocks, portals and portal frames.
Liquids are left alone as well, so craters flood naturally instead of triggering huge
water-update cascades. Explosions handle this on their own — blast resistance already
protects bedrock and command blocks.

## Fighting it

It targets players, villagers, monsters, animals and iron golems, and it destroys terrain
while chasing. A hit sends you flying (further at every stage), and abilities throw
everything nearby into the air.

It is **not** designed to one-shot you: 13 damage at stage 4 is survivable, and it can be
outrun and escaped. It is immune to fire, lava, fall, suffocation and drowning, and takes
25% damage from explosions — so TNT helps a little, but it will not blow itself up with its
own meteors.

## Death

When a **stage 4** World Eater drops below 40 HP, it stops taking damage and plays a
cinematic instead of just falling over:

1. It stops moving and its body starts shaking.
2. Particles pour out of it for about four seconds.
3. Six controlled explosions go off in a ring around it (radius 2.5 — dramatic, not
   world-ending).
4. It rears back and releases a final roar.
5. The body collapses, sinks and shrinks away into a burst of particles.
6. It dies properly, so its loot table runs and drops the **World Core** trophy, plus
   obsidian, diamonds, netherite scrap and 500 XP.

Stages 1–3 die normally, without the cinematic.

---

## Mobile performance

This is the part that decides whether the add-on is playable on a phone, so it is worth
being explicit about how it is kept in check.

- **One global work queue.** Every ability enqueues a *lazy generator*, not a list of
  coordinates. "Destroy a 10-block sphere" costs a few bytes to schedule rather than
  allocating thousands of objects.
- **Two separate per-tick budgets.** Up to **120 block lookups** and at most **40 actual
  block edits** per tick, globally, across every World Eater alive. Lookups are cheap;
  edits cost neighbour updates and lighting work, which is what actually drops frames. The
  split lets the queue race through the crater it has already dug while the expensive half
  stays hard-capped.
- **The per-tick drain exits immediately when the queue is empty**, so the idle cost is a
  single length check.
- **Everything else runs slowly.** Abilities, growth, name tags and stuck checks run once
  per second; the full entity rescan runs once every 10 seconds.
- **Bounded entity scanning.** Scans are limited to dimensions that contain a player, and
  each ability affects at most 12 entities.
- **Capped particles and explosions.** 10 particle emitters per tick, 14 scheduled
  explosions in flight globally. Big destruction is always spread across ticks.
- **It sleeps when nobody is watching.** No player within 96 blocks and it stops using
  abilities entirely.
- **At most 4 World Eaters** get ability processing, no matter how many are spawned. There
  are no self-spawning entities and no function-calls-function loops anywhere.

Measured in simulation with **ten stage-4 bosses stacked on top of each other for a full
minute** — far past anything reasonable — the peaks held at exactly 120 lookups and 40
edits per tick, 10 particles per tick, and 65 explosions per minute.

---

## Building from source

```
python3 tools/gen_world_eater_assets.py   # model + textures + icons
python3 tools/build_world_eater.py        # validate, then package the .mcaddon
```

`gen_world_eater_assets.py` emits the geometry and paints its texture **together**: cubes
are declared once, the packer assigns each a box-UV rectangle, and the painter fills
exactly those rectangles. The texture cannot drift out of sync with the model.

`build_world_eater.py` fails the build on any of these, rather than shipping an add-on that
imports and is then quietly broken:

- malformed JSON anywhere in either pack
- invalid, duplicated, or externally-clashing manifest UUIDs
- a BP→RP dependency whose UUID or version does not match the RP manifest
- a missing script entry point or `@minecraft/server` dependency
- `is_spawnable`/`is_summonable` off (which silently removes the creative spawn egg)
- entity events or component groups referenced but never defined — including events the
  **script** triggers
- textures, models, geometry identifiers, render controllers, animations, animation
  controllers, particles or sounds referenced but missing
- animations targeting bones or locators the model does not have
- box UVs that fall outside the texture atlas
- item icons that do not resolve through `item_texture.json` to a real PNG
- a spawn egg texture key missing from the atlas
- loot table entries with no item definition, and missing `.lang` name entries

## Layout

```
behavior_packs/world_eater_bp/
  entities/world_eater.json          stages, boss bar, AI, damage rules
  items/world_core.json              the trophy
  loot_tables/entities/world_eater.json
  functions/we/                      summon, stop, grow, help
  scripts/main.js                    destruction, growth, abilities, death
resource_packs/world_eater_rp/
  entity/world_eater.entity.json     model/texture/animation/particle bindings
  models/entity/world_eater.geo.json 51 cubes, 17 bones, generated
  animations/                        idle, walk, hover, roar, death
  animation_controllers/             alive↔dying, stand↔walking
  render_controllers/                per-stage texture selection
  particles/                         7 effects
  sounds/sound_definitions.json      8 events mapped onto vanilla audio
  textures/                          4 stage textures, particle atlas, icons
```

Sounds are custom events mapped onto vanilla Bedrock audio files, so the add-on ships no
audio binaries. If a vanilla path ever moves, that one event goes silent — nothing breaks.
