# Minecraft Bedrock add-ons

Two `.mcaddon` packs for **Minecraft Bedrock 1.21.0** (the build in the screenshot,
`1.21.0.26` on Android / Pocket Edition). Both use only stable components and the stable
`@minecraft/server 1.11.0` scripting module, so **no experimental toggles are required**
and both work on phones and tablets.

| Add-on | Download | What it adds |
| --- | --- | --- |
| **Secret Bunker** | `dist/SecretBunker.mcaddon` | 24 modern facility blocks, keycard-locked blast doors, and a beacon that builds a whole six-room bunker under you |
| **Arcane Arsenal** | `dist/ArcaneArsenal.mcaddon` | Six legendary weapons with scripted magic effects |

---

# Secret Bunker

A modern underground facility set: poured concrete, steel plating, hazard stripes,
server racks, wall monitors, security cameras, keypads and hydraulic blast doors — plus a
**Bunker Deployment Beacon** that excavates and builds the entire complex in one tap.

## The one-tap bunker

Hold the **Bunker Deployment Beacon** and tap the ground. Over the next few seconds the
add-on excavates a sealed 27 x 21 x 7 facility ten blocks below you, sinks a ladder shaft
up to a camouflaged **Bunker Hatch** at your feet, stocks the chests, and hands you a
**Level-3 Keycard**. Roughly 4,000 blocks are written in batches across ticks so phones
do not stutter.

```
%#########################%     % hazard column   # reinforced concrete
#        =LL     =        #     = concrete panel  D blast door (1x2)
# CCCCCC =       = bs bs L#     V vault door      k keypad   o window
#        =   #   = b  b   #     C console  S server rack  m monitor
#S       =   !   =        #     L locker   X supply crate  H chest
#S       =   ^   =        #     G generator + medical cabinet
#S     HC=  ldr  = bs bs L#     b bunk     T bench  F furnace  A anvil
#        =       =H     XX#     ! ladder shaft up to the hatch
#===D========D=======D====#
#                         #  <- command | airlock | barracks (north)
V         corridor        V
#                         #  <- armoury | med bay | power (south)
#===D========D=======D====#
#XX      =       =        #
#X       = bs bs =       G#
#        = b  b  =       G#
#L       =       =       G#
#L      A=      w=       G#
#        =     Hu=        #
# HH TF  = ++++  =X     | #
%#########################%
```

Six rooms open off a lit central corridor, each behind its own blast door with a keypad
beside it and an observation window either side:

| Room | Contents |
| --- | --- |
| **Command centre** | Console bank, wall monitors, three server racks, supply chest |
| **Airlock** | Ladder shaft to the surface hatch, lockers, camera, hazard-marked landing |
| **Barracks** | Four bunks, lockers, crates, ration chest |
| **Armoury** | Two stocked chests (one holds a spare keycard), crafting table, furnace, anvil |
| **Med bay** | Medical cabinets, two cots, brewing stand, cauldron, medical chest |
| **Power room** | Four generators, cable runs, grated floor, ceiling vents |

## Keycard, keypads and doors

The **Level-3 Keycard** is the key to everything. Tap it on:

- a **Blast Door** or the **Bunker Hatch** — the whole door (both halves, and any doors
  welded beside it) slides open or seals shut;
- a **Security Keypad** — every blast door within seven blocks releases at once, or, if
  they are already open, the room drops into **lockdown**;
- a **Security Camera** — a 48-block perimeter sweep reporting hostile contacts.

The **Motion Tracker** does the same sweep from wherever you stand (32 blocks), naming the
number of contacts, the distance to the nearest, and its compass bearing.

Open doors lose their collision and retract into their jambs, so you can walk straight
through; closed ones are blast-proof (explosion resistance 120).

## The blocks

| Group | Blocks |
| --- | --- |
| **Structure** | Reinforced Concrete, Concrete Wall Panel, Steel Plating, Hazard Stripe Block, Bunker Floor Tile, Steel Grate, Reinforced Glass, Ventilation Panel, Cable Conduit |
| **Lighting** | Ceiling Light Panel (light 15), Emergency Light (light 8) |
| **Electronics** | Server Rack, Control Console, Wall Monitor, Security Keypad, Security Camera |
| **Storage** | Supply Crate, Storage Locker, Medical Cabinet |
| **Machinery** | Backup Generator |
| **Doors** | Blast Door, Vault Door, Bunker Hatch |
| **Signage** | Radiation Warning Sign |

Everything is in the creative **Construction** tab; the three tools are under **Items**.
Consoles, racks, generators, monitors, keypads, cameras, lockers, cabinets, signs and
doors all face the way you were looking when you placed them.

## Crafting

Every recipe is a crafting-table recipe and unlocked from the start. **Steel Plating**
(iron + coal) is the base material for the electronics, and **Reinforced Concrete**
(stone + iron) for the structural set.

| Item | Recipe |
| --- | --- |
| Reinforced Concrete (x8) | 8 stone around 1 iron ingot |
| Steel Plating (x4) | 2 iron ingots + 2 coal, diagonally |
| Level-3 Keycard | Gold ingot + redstone + paper in a row |
| Motion Tracker | Compass + 2 iron, glass above, redstone block below |
| **Bunker Deployment Beacon** | 3 iron blocks, 4 iron ingots, 1 diamond, 1 redstone block |
| Blast Door | 6 steel plating + 2 hazard stripe blocks |

The rest follow the same pattern — see `behavior_packs/secret_bunker_bp/recipes/`.

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/SecretBunker.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world -> **Behavior Packs** -> activate **Secret Bunker BP**. The
   resource pack comes in as a dependency; if it does not, activate **Secret Bunker RP**
   under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `SecretBunker.zip` and copy the
two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/secret_bunker_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/secret_bunker_rp
```

## Getting the gear quickly

```
/give @s bunker:deployment_beacon
/give @s bunker:keycard
/give @s bunker:motion_tracker
/give @s bunker:blast_door
```

## Tuning

The facility size, how deep it sits, room layout, build throughput and keypad range are
all in the `CONFIG` object and the blueprint functions at the top of
`behavior_packs/secret_bunker_bp/scripts/main.js`. Rooms are described in facility-local
coordinates, so moving a wall is a one-line change.

---

# Arcane Arsenal

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that adds six
legendary weapons with scripted magic effects.

Built and tested against the format versions available in **Bedrock 1.21.0** — the build
running in the attached screenshot (`1.21.0.26`, Android / Pocket Edition). It uses only
**stable** item components and the **stable** `@minecraft/server 1.11.0` scripting module,
so **no experimental toggles are required** and it works on phones and tablets.

---

### The weapons

| Weapon | Type | Effect on use |
| --- | --- | --- |
| **Frostbite Blade** | Sword (8 dmg) | Hits apply **Slowness III for 5s** plus bonus **freeze damage** (4), with an ice-shatter burst |
| **Emberfang** | Sword (8 dmg) | Sets the target **on fire for 8s** and detonates a **small flame burst** that ignites everything within 2.5 blocks |
| **Stormcaller** | Trident-style (9 dmg) | **Summons a lightning strike** on whatever it hits — or long-press/right-click to call lightning at up to 40 blocks |
| **Voidreaper** | Sword (8 dmg) | **Heals the wielder for 35%** of the damage dealt |
| **Cataclysm Hammer** | Maul (11 dmg) | **Large terrain-breaking explosion** on impact (radius 4); the wielder is shielded from their own blast |
| **Meteor Staff** | Ranged (3 dmg melee) | Long-press/right-click to drop a **falling meteor** on the aimed point: radius-4 fiery explosion plus 20 guaranteed area damage |

Stormcaller and Meteor Staff have visible item cooldowns (4s and 6s).

#### Crafting

All recipes are shaped, crafting-table only, and unlocked from the start.

| Weapon | Recipe (top → bottom) |
| --- | --- |
| Frostbite Blade | Blue Ice / Diamond / Stick |
| Emberfang | Magma Block / Blaze Powder / Blaze Rod |
| Stormcaller | Prismarine Shard + Heart of the Sea + Prismarine Shard, then Stick, Stick |
| Voidreaper | Eye of Ender / Netherite Ingot / Blaze Rod |
| Cataclysm Hammer | Obsidian + TNT + Obsidian, Obsidian + Stick + Obsidian, then Stick |
| Meteor Staff | Fire Charge / Magma Cream / Blaze Rod |

Every weapon is also repairable (Frostbite: diamond, Emberfang/Meteor Staff: blaze rod,
Stormcaller: prismarine shard, Voidreaper/Cataclysm: netherite ingot) and enchantable.
They all appear in the creative **Equipment** tab next to the swords.

---

### Installing on mobile (Android / Pocket Edition)

1. Download **`dist/ArcaneArsenal.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Arcane Arsenal BP**.
   The resource pack is pulled in automatically as a dependency; if it is not, activate
   **Arcane Arsenal RP** under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `ArcaneArsenal.zip`, then use a
file manager to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/arcane_arsenal_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/arcane_arsenal_rp
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

#### Updating from v1.0.0

v1.0.0 shipped with invisible item icons. If you already installed it:

1. In Minecraft go to **Settings → Storage → Resource Packs / Behavior Packs** (or the
   global **Profile → Packs** screen), find the two Arcane Arsenal packs and **delete**
   both. This matters — the old copy is cached, and importing over it can keep the broken
   textures.
2. Import the new `ArcaneArsenal.mcaddon` (now version 1.0.1).
3. Re-activate both packs on your world.

#### Checking it is actually working

When you spawn into a world with the behaviour pack active, chat shows:

```
[Arcane Arsenal] v1.0.1 loaded - 6 weapons armed.
```

If that line does **not** appear, the behaviour pack's scripts are not running, and no
weapon effect will fire. If it does appear but a weapon looks wrong, the problem is on the
resource-pack side instead.

To see exactly what the game thinks is wrong, turn on
**Settings → Creator → Content Log GUI** (and "Content Log File"). It names the pack and
file for any load error.

#### Getting the weapons quickly

```
/give @s arcane:frostbite_blade
/give @s arcane:emberfang
/give @s arcane:stormcaller
/give @s arcane:voidreaper
/give @s arcane:cataclysm_hammer
/give @s arcane:meteor_staff
```

#### Using the two ranged abilities on touch controls

Both the Stormcaller and the Meteor Staff carry a use duration, so holding one makes the
**use button** appear on the right of the HUD. Aim at a block or mob and tap it. If nothing
is in range the spell lands where your view meets the ground, up to 40–48 blocks out.

---

---

## Repository layout

```
behavior_packs/secret_bunker_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  blocks/*.json          24 block definitions, format_version 1.21.0
  items/*.json           keycard, deployment beacon, motion tracker
  recipes/*.json         27 shaped recipes
  scripts/main.js        blueprint, builder, doors, keypads, scanners
  texts/                 pack name strings
resource_packs/secret_bunker_rp/
  manifest.json          RP manifest
  models/blocks/secret_bunker.geo.json   6 custom block models
  textures/terrain_texture.json          block atlas
  textures/item_texture.json             item atlas
  textures/blocks/*.png                  31 generated 16x16 block textures
  textures/items/*.png                   3 generated 16x16 icons
  texts/en_US.lang       block and item display names

behavior_packs/arcane_arsenal_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  items/*.json           6 item definitions, format_version 1.21.0
  recipes/*.json         6 shaped recipes
  scripts/main.js        all weapon logic (@minecraft/server 1.11.0)
  texts/                 pack name strings
resource_packs/arcane_arsenal_rp/
  manifest.json          RP manifest
  textures/item_texture.json
  textures/items/*.png   6 hand-made 16x16 icons
  texts/en_US.lang       item display names

tools/
  gen_bunker_textures.py Secret Bunker textures and pack icons (stdlib only)
  gen_textures.py        Arcane Arsenal icons (stdlib only)
  build.py               validates both add-ons and writes both .mcaddon files
dist/SecretBunker.mcaddon
dist/ArcaneArsenal.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_bunker_textures.py   # redraw the bunker textures
python3 tools/gen_textures.py          # redraw the weapon icons
python3 tools/build.py                 # validate + repackage both .mcaddon files
python3 tools/build.py SecretBunker    # ...or just one of them
```

Either generator takes `--preview <name>` to print a texture as ASCII art without
writing files.

`build.py` fails loudly if any JSON is malformed, if manifest UUIDs collide, if a
behaviour pack loses its resource-pack dependency, if an item icon or a block material
instance does not resolve to a real PNG, if a custom block geometry is missing from the
resource pack, if a permutation tests a state the block never declares, if a recipe uses
or produces something undefined, or if a block or item has no name in `en_US.lang`.

## Tuning the weapons

Every number — effect durations, amplifiers, lifesteal ratio, explosion radii, cast
ranges, cooldowns — sits in the `CONFIG` object at the top of
`behavior_packs/arcane_arsenal_bp/scripts/main.js`. Edit it and re-run `tools/build.py`.

To stop the Cataclysm Hammer and Meteor Staff from destroying terrain, set
`hammer.breaksBlocks` and `staff.breaksBlocks` to `false`.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0`. Item components, recipe format and
  script APIs were all chosen to exist in that release, so nothing here depends on a later
  update.
- **No experiments:** every item component used (`icon`, `display_name`, `damage`,
  `durability`, `enchantable`, `repairable`, `hand_equipped`, `glint`, `cooldown`,
  `use_modifiers`, `tags`, `max_stack_size`) is stable in 1.21.0, as is
  `@minecraft/server 1.11.0`.
- **Icon syntax:** `minecraft:icon` must use `{"textures": {"default": "<key>"}}` at
  `format_version` 1.20.60 and above. The older flat `{"texture": "<key>"}` field is
  deprecated, and the game ignores it silently — the item still loads and still shows its
  name, but the icon renders as nothing at all. `tools/build.py` now fails the build if
  that form reappears.
- **Defensive scripting:** particle and sound calls are individually wrapped, and each
  effect handler is guarded, so a device or build that lacks one cosmetic id degrades that
  single effect instead of breaking the add-on.
- **Custom blocks:** block traits (`minecraft:placement_direction`), permutations,
  `minecraft:geometry`, `minecraft:material_instances`, `minecraft:collision_box` and
  `minecraft:light_emission` are all stable at block `format_version` 1.21.0, so the
  Secret Bunker blocks need no experiments either.
- **Bunker deployment is destructive by design:** the beacon clears its own 27 x 21 x 7
  footprint ten blocks below you and lines it with concrete. Anything already there —
  caves, ore, a build — is replaced, so deploy somewhere you do not mind reshaping.
- Mobs that pick up these weapons get the effects too — the script reads the attacker's
  main hand rather than assuming a player.
