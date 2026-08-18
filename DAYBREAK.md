# Daybreak

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that turns the
overworld into a survival-horror apocalypse where **the sun is the monster**.

Built and tested against the format versions available in **Bedrock 1.21.0** — the build
running on Android / Pocket Edition (`1.21.0.26`). It uses only **stable** components and
the **stable** `@minecraft/server 1.11.0` scripting module, so **no experimental toggles
are required**.

> Inspired by the "when day breaks" premise — an anomalous sun that unmakes anything alive
> caught under open sky. All text, names, creatures, items and structures here are
> original to this add-on.

---

## Install on Android

1. Download **`dist/Daybreak.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Daybreak BP**. The resource
   pack comes along as a dependency; if it does not, activate **Daybreak RP** as well.
4. Leave every experimental toggle **off**. None are needed.
5. In the world, run `/function daybreak_start`.

If tapping the file does not open Minecraft, rename it to `Daybreak.zip` and copy the two
inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/daybreak_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/daybreak_rp
```

### Checking it is actually running

On first spawn the chat shows:

```
[DAYBREAK] Daybreak v1.0.0 loaded.
```

If that line never appears, the behaviour pack's scripts are not running and nothing else
in this document will work. Turn on **Settings → Creator → Content Log GUI** to see why.

---

## Commands

| Command | What it does |
| --- | --- |
| `/function daybreak_start` | Sets the clock to just before sunrise, issues the starter kit, begins the objective chain |
| `/function daybreak_give_items` | Every custom item, including all five access cards (plain `/give` commands — works even with scripting off) |
| `/function daybreak_spawn_facility` | Builds the underground research site next to you |
| `/function daybreak_reset` | Clears exposure, fog and every loaded Daybreak creature |
| `/function daybreak_status` | Diagnostics: sun strength, creature count, build queue |
| `/function daybreak_briefing` | Re-read the briefing and your current objective |
| `/function daybreak_help` | Lists all of the above in chat |
| `/function daybreak/structures/<name>` | Places one structure — see [Structures](#structures) |

There is also a creative item, **Daybreak Survival Starter**, which hands out the kit and
starts the scenario without touching the world clock.

---

## ☀️ The deadly sun

The core loop asks one question twice a second: **how much sky is above your head?**

The script walks the block column above the player, stops at the first thing that blocks
light, and multiplies through anything that only filters it.

| Cover | Light that gets through |
| --- | --- |
| Any solid block (stone, wood, dirt, slabs, a roof of any kind) | **0%** — total protection |
| Glass block | 45% |
| Glass pane | 55% — *thinner, so worse* |
| Tinted glass | 12% |
| Leaves | 35% |
| Water above you | 55% |
| Ice / packed ice | 50% / 30% |
| Bars, chains, scaffolding, cobweb | 85% |
| Torches, flowers, rails, signs, ladders, carpets | 100% — these are not roofs |

Exposure then builds at a rate of `sun intensity × weather × sky × gear`:

- **0 → 100% in about 26 seconds** of unprotected noon sun.
- Exposure **falls at 5% per second** once you are covered — 20 seconds to clear a full
  meter — so ducking inside is always the right move, but the burn does not vanish
  instantly.

### Warnings

| Exposure | Warning | What happens |
| --- | --- | --- |
| 12% | `SUNLIGHT EXPOSURE` | Warning title, on-screen meter |
| 40% | `SEEK SHELTER` | Weakness, Slowness, Nausea |
| 72% | `CRITICAL EXPOSURE` | Weakness II, Slowness II, screen shake, red burn fog, you catch fire |
| 100% | — | You die and a **Melted Survivor wearing your name** stands up where you fell |

You always get several seconds of escalating warning before anything lethal happens.

### Weather

| Sky | Exposure rate |
| --- | --- |
| Clear | 100% |
| Rain | 55% |
| Thunderstorm | 22% — a genuine window for daytime work |

---

## 🌑 Night

Night is safe from the sun and dangerous from everything else. At the transitions:

```
[DAYBREAK] THE SUN HAS SET — SURFACE TRAVEL IS POSSIBLE
[DAYBREAK] WARNING — SUNRISE APPROACHING
```

The sunrise warning fires **60 seconds** before the sun returns. When it does:
survivors bolt for cover, monsters get a speed burst, the radio switches to the
"find cover" broadcast, and anything alive still under open sky begins converting.

---

## 🫠 The creatures

| Creature | Health | Speed | Damage | Behaviour |
| --- | --- | --- | --- | --- |
| **Melted Survivor** | 40 | slow (0.19) | 6 | Tracks players from **44 blocks** and does not lose interest. Each hit **drags you toward it** — toward the open |
| **Flesh Mass** | 140 | very slow (0.13) | 13 | Large, heavy wind-up slam, near-immune to knockback, **spawns Crawling Melts** from itself |
| **Crawling Melt** | 10 | fast (0.34) | 3 | Tiny (0.7 × 0.55) so it **fits through gaps you left open**, climbs, attacks in groups |
| **Mimic Survivor** | 24 → 46 | 0.2 → 0.31 | 0 → 8 | Reads as a survivor. Says things. **Transforms and attacks inside 3.5 blocks** |
| **Flesh Assimilator** | 60 | 0.23 | 4 | Hunts animals, villagers and survivors specifically, and **converts them** |

The Mimic calls out lines like `"COME OUTSIDE"`, `"THE SUN IS BEAUTIFUL"`,
`"IT DOESN'T HURT"` while it still looks human. It switches both skin **and skeleton**
when it drops the act.

### 🧬 Assimilation

When a Daybreak creature kills a villager, animal, zombie or survivor, there is a **35%
chance** the victim becomes a new Daybreak creature (usually a Crawling Melt). Flesh
Assimilators also convert anything living within 5.5 blocks on their own.

Infection therefore spreads through a region on its own — but **never past the population
ceiling** (see [Mobile performance](#-mobile-performance)).

Survivors and rescued NPCs caught in the open at sunrise convert the same way you do,
after about 30 seconds of exposure.

---

## 👨‍🚀 Survivors

Five types spawn inside shelters and structures: **civilian, scientist, security guard,
field medic, facility engineer**.

- Feed one **canned food, emergency water or a medical kit** to rescue it.
- Rescued survivors **follow you**, gain health, and occasionally **hand you supplies**.
- Guards and engineers **fight Daybreak creatures**; the others flee from them.
- All of them **run from the sun** — and burn in it if they are caught out.

---

## 🥼 Equipment

| Item | Effect |
| --- | --- |
| **Daybreak Suit** (helmet / chestpiece / leggings / boots) | Each piece cuts the exposure rate by 30%; the **full set leaves only ~12%** getting through — roughly **3.5 minutes** of direct noon sun instead of 26 seconds. Burns durability while you are in the light |
| **Reinforced Sun Hood** | 55% reduction, but only ~90 seconds of wear. Emergency use |
| **UV Exposure Detector** | Reads sky exposure, sun strength, cloud cover, your current burn, and time until sunrise |
| **Flashlight** | 30 seconds of night vision per use, recharged with batteries |
| **Emergency Flare** | Throws a burning flare that lights the area and **pulls nearby creatures onto it** instead of you |
| **Gas Mask** | Head protection for contaminated facility air |
| **Medical Kit** | Regeneration, clears poison, cuts 18% off your burn |
| **Canned Food / Emergency Water** | Food; water also clears nausea and cools the burn |
| **Field Radio** | Pulls in an extra emergency transmission on demand |
| **Research Document** | One page of site logs |
| **Scrap Plating / UV Lens / Battery / Flesh Sample** | Crafting materials |

Everything except the access cards is craftable. The suit needs **scrap plating**
(iron + coal) and **UV lenses** (glass + amethyst).

---

## 🔑 Access cards and doors

Four door blocks, four locks:

| Door | Opens with |
| --- | --- |
| Security Door | Level 1+ |
| Laboratory Door | Level 2+ |
| Blast Door | Level 4+ |
| Bunker Door | Bunker Key |

**Hold the card and tap the door.** The whole panel withdraws for 8 seconds, then closes
again — and it will not close on top of anything standing in the doorway. Tapping with too
low a card shows `ACCESS DENIED — Level 4 required, you hold 2`.

Cards are **never craftable**. Level 1–2 come off corpses and town loot, 3 from guards and
military crates, 4–5 only from deep inside the research site.

---

## 🏚️ Structures

Bedrock cannot inject custom structures into world generation without experimental
features, so Daybreak ships them as **blueprints you place on demand**, built by the
script a few blocks at a time so a phone never has to place a whole site in one frame.

| `/function daybreak/structures/…` | Contents |
| --- | --- |
| `facility` | The full SCP-style research site — see below |
| `bunker` | Sealed underground bunker with a ladder shaft, stores and a survivor |
| `laboratory` | Sublevel lab, containment cube, a loose Assimilator |
| `shelter` | Small sealed surface shelter |
| `town` | Four ruined buildings, collapsed roofs, a Flesh Mass and a Mimic |
| `checkpoint` | Military roadblock, guard booth, watchtower, surviving guard |
| `hospital` | Wards, triage signage, medic, contamination |
| `camp` | Walled survivor camp with a fire and three rescuable survivors |
| `highway` | Collapsed elevated highway, wrecked vehicles, checkpoint booth |
| `village` | Contaminated village, five infected huts, quarantine sign |

### The research facility

`/function daybreak_spawn_facility` builds, 34 blocks below you:

security checkpoint · surveillance room · two laboratories · containment wing ·
medical wing · armoury · offices · generator room · cafeteria · maintenance tunnels one
level further down · a sealed emergency bunker behind a bunker door

with card-locked doors on every room, lit corridors, loot chests, signage that explains
what happened, survivors to rescue, and creatures already inside. The entry shaft rises to
the surface and is capped by a **blast door**, so the way in needs Level 4 clearance.

---

## 🎮 Progression

`/function daybreak_start` starts a ten-step objective chain, announced one at a time:

1. Get under a solid roof before the sun finds you
2. Search the ruins for supplies
3. Travel while the sun is down
4. Find an abandoned research site
5. Take an access card off the site
6. Find protective equipment
7. Rescue a survivor
8. Establish a permanent bunker
9. Push into a contaminated zone
10. Wear the complete suit and stand in open daylight

---

## 🌇 Atmosphere

- The **sun texture is replaced** with a blown-out white core inside a bleeding corona.
- Fog changes with your situation and only when it changes: burnt orange haze in daylight,
  deep red at critical exposure, near-black blue at night, close grey underground, washed
  grey under a thunderstorm.
- Emergency broadcasts arrive every few minutes; near sunrise they switch to the warning.
- Distant screams, cave ambience, ravager groans and alarm tones play around the player.
- Creature voices are pitched-down vanilla sound events, mapped per entity in `sounds.json`.

---

## 📱 Mobile performance

This is designed around a phone, not a PC:

- **Three loops total.** Exposure runs twice a second, creatures and objectives every five
  seconds, the builder every tick but returns instantly when the queue is empty.
- **Nothing scans the sky at night** — the loop exits before any block read.
- **The sky walk stops at the first solid block**, so anyone underground costs one or two
  block reads, and it is capped at 128 blocks regardless.
- **Standing still reuses the last reading** for up to three steps.
- **Block classification is memoised** per block type, so the regex work happens once.
- **Hard population ceiling of 42 loaded creatures.** Assimilation is refused at the cap,
  and anything further than 84 blocks from every player is deleted, not left ticking.
- **Every entity query is radius-bounded** — nothing ever iterates the whole world.
- **Structures are queued** at 18 operations per tick, and any fill larger than 3,200
  blocks is split before it is issued.
- **No ticking areas, no repeating command blocks, no particle spam.** Models are a handful
  of cubes each; textures are 16×16 icons and 32–128px skins.

`/function daybreak_status` prints the live creature count and build queue.

---

## Repository layout

```
behavior_packs/daybreak_bp/
  manifest.json           BP manifest, min_engine_version 1.21.0
  scripts/                11 ES modules (@minecraft/server 1.11.0)
    main.js                 entry point, three loops, event wiring
    config.js               every tunable number and every string
    sun.js                  sky scan, exposure, protection, transformation
    world_cycle.js          day/night state machine, fog, radio, ambience
    creatures.js            assimilation, population ceiling, mimics, survivors
    items.js                gear handlers
    doors.js                access cards and door panels
    progress.js             starter kit and the objective chain
    builder.js              paced structure queue
    blueprints.js           the ten structures
    util.js                 defensive wrappers around the script API
  entities/               13 entity behaviours
  items/                  25 items
  blocks/                 4 card-locked doors
  recipes/                21 recipes
  loot_tables/            10 entity tables + 7 chest tables
  functions/              17 functions
  spawn_rules/            5 natural spawn rules
resource_packs/daybreak_rp/
  entity/                 13 client entities
  models/entity/          11 geometries
  animations/             13 animations
  animation_controllers/  4 controllers
  render_controllers/     3 controllers
  attachables/            4 suit layers
  fogs/                   5 fog definitions
  sounds.json             per-entity sound mapping
  textures/               45 PNGs, including the replacement sun
tools/
  daybreak_models.py       model tables shared by the two generators
  gen_daybreak_textures.py paints every PNG (standard library only)
  gen_daybreak_assets.py   generates the repetitive JSON
  build_daybreak.py        validates everything, then packages the .mcaddon
  simulate_daybreak.mjs    runs the real scripts against a stubbed API
dist/Daybreak.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_daybreak_textures.py   # repaint every PNG
python3 tools/gen_daybreak_assets.py     # regenerate the boilerplate JSON
node    tools/simulate_daybreak.mjs      # run the gameplay simulation
python3 tools/build_daybreak.py          # validate + package dist/Daybreak.mcaddon
```

`build_daybreak.py` fails the build if any JSON is malformed, if UUIDs collide (including
against the other add-on in this repository), if an item icon does not resolve to a real
PNG, if an icon is blank enough to look invisible in the hotbar, if an entity skin does not
match its model's UV size, if a client entity references a geometry, animation, controller
or texture that does not exist, if an animation controller plays an animation the entity
never declared, if a loot table, recipe, spawn rule or function points at something
missing, if any `daybreak:` identifier in a script or function is not real, if a custom
item, block or entity has no name in `en_US.lang`, or if the packaged `.mcaddon` ends up
with a nested archive inside it.

`simulate_daybreak.mjs` stubs `@minecraft/server`, loads the real scripts unmodified and
asserts the gameplay: open sky escalates through all three warnings and eventually kills,
a stone roof is total protection, glass is not, a pane is worse than a block, night and
underground cost nothing, thunderstorms slow the burn, the full suit multiplies your time
outside without granting immunity, creative players are exempt, exposure decays under
cover, a level 2 card cannot open a level 4 door while a level 5 card can, doors close
again afterwards, every ladder shaft is enclosed in solid blocks, and the research facility
places in full without a single failed operation.

## Tuning

Every number lives in `CONFIG` at the top of
`behavior_packs/daybreak_bp/scripts/config.js` — exposure rates, warning thresholds, gear
protection, the population ceiling, cull distance, assimilation odds, build pacing, door
timings. Edit it and re-run `tools/build_daybreak.py`.

To make the sun gentler, lower `sun.risePerStep`. To support a weaker device, lower
`creatures.globalCap` and `buildOpsPerTick`.

## Compatibility notes and honest limits

- **No experiments.** Every component used is stable in 1.21.0, as is `@minecraft/server`
  1.11.0.
- **World generation.** Bedrock has no stable data-driven custom structure generation, so
  the ten structures are placed on demand by function rather than appearing in fresh
  chunks. Natural spawning of the creatures themselves *is* data-driven and does work in
  ordinary world generation, through `spawn_rules/`.
- **Custom armour rendering** uses attachables with geometry shipped in this pack, so it
  does not depend on any vanilla model identifier. The sunlight protection is script-driven
  and works regardless of whether the visual layer renders on a given build.
- **Sounds** are pitched-down vanilla sound events rather than new audio files, so the pack
  stays small and no sound can fail to load. An id a device does not know simply stays
  silent.
- **Flare lighting** tries three known `light_block` command syntaxes once, remembers which
  one this build accepts, and quietly skips the light if none work. The flare's creature
  distraction does not depend on it.
- **Defensive scripting.** Every event subscription, particle, sound, command and component
  read is individually wrapped. A build missing one API loses that feature rather than the
  add-on.
