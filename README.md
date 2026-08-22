# Minecraft Bedrock add-ons

Two self-contained **Bedrock Edition** add-ons, both built and tested against the format
versions available in **Bedrock 1.21.0** (the `1.21.0.26` beta build, Android / Pocket
Edition). Both use only **stable** JSON formats and the **stable** `@minecraft/server`
scripting module, so **no experimental toggles are required** and they work on phones and
tablets.

| Add-on | Package | What it does |
| --- | --- | --- |
| **Natural Disasters** | `dist/NaturalDisasters.mcaddon` | 11 disasters as creative items — hold one, tap a block, watch the world get wrecked |
| **Arcane Arsenal** | `dist/ArcaneArsenal.mcaddon` | 6 legendary weapons with scripted magic effects |

---

# Natural Disasters

Eleven natural disasters, each one an **item in the creative inventory** (Items tab, with
its own hand-drawn icon and an enchant glint). No `/function` commands, no chat commands:
**hold the item and tap any block** — the disaster spawns right there. Tapping into the
air works too and targets the block you are aiming at (up to 64 blocks away).

Every disaster physically affects the world — blocks are broken, burned, buried, frozen
or flooded, and entities are pulled, launched, damaged and set on fire. Nothing here is
just a particle show.

## The disasters

| Item | Duration | What actually happens |
| --- | --- | --- |
| 🌪️ **Tornado** | 60s | A spinning 15-block funnel (custom model + animation) **wanders around**, sucks in mobs/players/items from 20 blocks, spins and **launches** anything that gets close, **rips blocks out of the ground** (the drops become flying debris), with swirling dust and wind roar |
| 🌊 **Tsunami** | ~20s | A 15-wide, 4-tall **wall of water** races 64 blocks in the direction you were facing, riding the terrain, **sweeping entities along** and battering them; the flood then drains itself |
| 🌎 **Earthquake** | 25s | **Camera shake**, rumbling, entities stumble and take rubble damage, and real **fissures tear open** in the ground — some with lava at the bottom |
| ☄️ **Meteor Strike** | ~6s | Three burning meteors streak in from the sky and **explode on impact** (fire + block damage), leaving craters dressed with magma, fire and obsidian; nearby entities are burned and launched |
| 🌋 **Volcano** | 90s | A rock cone **builds itself layer by layer**, carves a lava-filled crater, then **erupts**: ballistic lava bombs that explode where they land, lava spills down the flanks, ash and ember columns. The mountain stays forever |
| 🌊 **Flash Flood** | 45s | Rain sets in and water **rises one layer at a time** (only filling open space, so builds survive), a churning current drags entities in circles, then the water **recedes on its own** |
| 🌀 **Hurricane** | 60s | Thunderstorm + a 30-block cyclone: calm eye, violent eyewall that **lifts entities**, rotating winds across the whole area, **vegetation shredded off the terrain**, and random lightning |
| ⚡ **Super Thunderstorm** | 40s | Targeted **lightning barrage** — bolts prefer to strike near mobs, some detonate on impact, shocked entities are damaged and thrown |
| ❄️ **Blizzard** | 50s | Whiteout **fog**, driving snow around every player, **snow layers pile up and water freezes to ice**, entities are slowed, weakened and take frost damage |
| 🔥 **Wildfire** | 45s | Fire **spreads from block to block** through anything flammable (up to ~260 ignitions), embers and smoke rise, and anything wandering the burn zone catches fire |
| 🏜️ **Sandstorm** | 45s | Sand-colored **fog** and driving grit, a constant gale that shoves everything downwind, blindness in the thick of it, and **dunes of real sand** creeping over the terrain |

Up to **5 disasters** can run at once (a 6th tap tells you to wait). Each item has a short
visible cooldown so touch taps do not double-fire.

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/NaturalDisasters.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Natural Disasters BP**.
   The resource pack is pulled in automatically as a dependency; if it is not, activate
   **Natural Disasters RP** under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `NaturalDisasters.zip`, then use
a file manager to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/natural_disasters_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/natural_disasters_rp
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

### Checking it is actually working

When you spawn into a world with the behaviour pack active, chat shows:

```
[Disasters] v1.0.0 loaded - 11 disasters armed. Hold a disaster item and tap a block!
```

If that line does **not** appear, the behaviour pack's scripts are not running and no
disaster will fire. If it does appear but something looks wrong, the problem is on the
resource-pack side. To see exactly what the game thinks is wrong, turn on
**Settings → Creator → Content Log GUI**.

### Finding the items

Open the creative inventory and search for the disaster by name (Tornado, Tsunami,
Earthquake, Meteor Strike, Volcano, Flash Flood, Hurricane, Super Thunderstorm, Blizzard,
Wildfire, Sandstorm) — or scroll to the end of the **Items** tab. In survival they also
work and can be given with `/give @s nd:tornado`, `/give @s nd:meteor`, etc. (ids:
`nd:tornado`, `nd:tsunami`, `nd:earthquake`, `nd:meteor`, `nd:volcano`, `nd:flash_flood`,
`nd:hurricane`, `nd:thunderstorm`, `nd:blizzard`, `nd:wildfire`, `nd:sandstorm`).

### Touch tips

- **Tap a block** = spawn the disaster on top of that block (the exact flow from the item
  description: take Tornado → hold it → tap the ground → tornado).
- Aim at distant terrain and tap = the disaster lands where you are looking.
- The items never break blocks in creative (`can_destroy_in_creative` is off), so a tap
  can't accidentally mine the block you aimed at.

### Fair warning

These are disasters. The tornado, earthquake, meteors, volcano, wildfire, blizzard and
sandstorm **permanently modify terrain** (that is the point). The tsunami and flash flood
clean their own water up. Don't fire a meteor at your own base and file a bug about it.

## Repository layout (Natural Disasters)

```
behavior_packs/natural_disasters_bp/
  manifest.json           BP manifest, min_engine_version 1.21.0, script module
  items/*.json            11 item definitions, format_version 1.21.0
  entities/tornado.json   invisible-to-damage tornado marker entity (with a
                          90s failsafe despawn timer)
  scripts/main.js         the whole disaster engine (@minecraft/server 1.11.0)
  texts/                  pack name strings
resource_packs/natural_disasters_rp/
  manifest.json
  textures/items/*.png    11 icons, drawn at 64px and downsampled to 32px
  textures/item_texture.json
  textures/entity/tornado.png     alpha-tested funnel streaks
  textures/particle/*.png         6 particle sprites
  models/entity/tornado.geo.json  6-segment funnel, ~15 blocks tall
  animations/tornado.animation.json   per-segment spin + wobble (Molang)
  render_controllers/
  entity/tornado.entity.json      client entity wiring
  particles/*.json        dust, ember, snowfall, sand gust, splash, wind streak
  fogs/*.json             blizzard + sandstorm fog settings
  sounds/sound_definitions.json
  sounds/nd/*.wav         5 procedurally synthesized effects (wind, rumble,
                          whoosh, wave, fire crackle - 16-bit mono PCM)
  texts/en_US.lang        item display names
tools/
  gen_disaster_assets.py  regenerates every texture, sound, item JSON and lang
                          file (stdlib only - no Pillow, no audio libs)
  build_disasters.py      validates everything and writes the .mcaddon
dist/NaturalDisasters.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_disaster_assets.py   # regenerate icons, textures, sounds, item JSONs
python3 tools/build_disasters.py       # validate + repackage dist/NaturalDisasters.mcaddon
```

`build_disasters.py` is the 1.21.0.26 compatibility gate. It fails loudly if any JSON is
malformed or uses a `format_version` newer than 1.21.0, if manifest UUIDs collide (also
against the Arcane Arsenal packs), if the BP loses its RP dependency, if
`@minecraft/server` is bumped past 1.11.0, if an item uses a component outside the vetted
stable set or the deprecated flat icon syntax, if the script references a particle /
sound / fog / entity / block / effect that is not defined by the packs or hand-verified to
exist in vanilla 1.21.0, if the tornado's geometry, animation, render controller and
texture wiring do not line up, or if any PNG/WAV is malformed.

## Compatibility notes (Natural Disasters)

- **Target:** Bedrock **1.21.0** (`min_engine_version [1, 21, 0]`), matching beta
  `1.21.0.26`. Every `format_version` in both packs is at or below `1.21.0` — nothing
  from a later update is used.
- **Scripting:** stable `@minecraft/server 1.11.0` only (the version that ships in
  1.21.0). Events: `itemUse`, `itemUseOn`, `playerSpawn`; APIs: `runInterval`,
  `getBlock`, `getEntities`, `spawnEntity`, `createExplosion`, `applyKnockback`,
  `applyDamage`, `addEffect`, `setOnFire`, `teleport`, `triggerEvent`,
  `spawnParticle`/`playSound` (each with a `runCommandAsync` fallback). No beta APIs, no
  experiments.
- **Items in creative:** the 1.20.50+ data-driven item format with `menu_category`, and
  the post-1.20.60 icon shape `{"textures": {"default": ...}}` (the flat form renders an
  invisible icon on 1.21.0 — the build fails if it reappears).
- **Defensive scripting:** every cosmetic call is individually wrapped and every disaster
  tick runs inside a try/catch with an error budget, so one bad id or unloaded chunk
  degrades a single effect instead of killing the add-on.
- **Commands used** (`fill`/`setblock` with `[]` block-state syntax, `weather`,
  `camerashake`, `fog`, `summon`, `playsound`, `particle`) and every vanilla id they
  reference are all present in 1.21.0.

---

# Arcane Arsenal

Six legendary weapons with scripted magic effects.

## The weapons

| Weapon | Type | Effect on use |
| --- | --- | --- |
| **Frostbite Blade** | Sword (8 dmg) | Hits apply **Slowness III for 5s** plus bonus **freeze damage** (4), with an ice-shatter burst |
| **Emberfang** | Sword (8 dmg) | Sets the target **on fire for 8s** and detonates a **small flame burst** that ignites everything within 2.5 blocks |
| **Stormcaller** | Trident-style (9 dmg) | **Summons a lightning strike** on whatever it hits — or long-press/right-click to call lightning at up to 40 blocks |
| **Voidreaper** | Sword (8 dmg) | **Heals the wielder for 35%** of the damage dealt |
| **Cataclysm Hammer** | Maul (11 dmg) | **Large terrain-breaking explosion** on impact (radius 4); the wielder is shielded from their own blast |
| **Meteor Staff** | Ranged (3 dmg melee) | Long-press/right-click to drop a **falling meteor** on the aimed point: radius-4 fiery explosion plus 20 guaranteed area damage |

Stormcaller and Meteor Staff have visible item cooldowns (4s and 6s).

### Crafting

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

## Installing

Same flow as Natural Disasters, with **`dist/ArcaneArsenal.mcaddon`** and the
`arcane_arsenal_bp` / `arcane_arsenal_rp` folders. On spawn, chat shows
`[Arcane Arsenal] v1.0.1 loaded - 6 weapons armed.` — if it does not, the scripts are not
running.

> **Updating from v1.0.0:** v1.0.0 shipped with invisible item icons. Delete both cached
> Arcane Arsenal packs under **Settings → Storage** before importing v1.0.1, then
> re-activate them on your world.

### Getting the weapons quickly

```
/give @s arcane:frostbite_blade
/give @s arcane:emberfang
/give @s arcane:stormcaller
/give @s arcane:voidreaper
/give @s arcane:cataclysm_hammer
/give @s arcane:meteor_staff
```

### Using the two ranged abilities on touch controls

Both the Stormcaller and the Meteor Staff carry a use duration, so holding one makes the
**use button** appear on the right of the HUD. Aim at a block or mob and tap it. If nothing
is in range the spell lands where your view meets the ground, up to 40–48 blocks out.

## Rebuilding

```bash
python3 tools/gen_textures.py      # redraw the icons (add --preview for ASCII art)
python3 tools/build.py             # validate + repackage dist/ArcaneArsenal.mcaddon
```

## Tuning

Every number — effect durations, amplifiers, lifesteal ratio, explosion radii, cast
ranges, cooldowns — sits in the `CONFIG` object at the top of
`behavior_packs/arcane_arsenal_bp/scripts/main.js`. Edit it and re-run `tools/build.py`.

To stop the Cataclysm Hammer and Meteor Staff from destroying terrain, set
`hammer.breaksBlocks` and `staff.breaksBlocks` to `false`.

## Compatibility notes (Arcane Arsenal)

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
  name, but the icon renders as nothing at all. Both build scripts fail if that form
  reappears.
- **Defensive scripting:** particle and sound calls are individually wrapped, and each
  effect handler is guarded, so a device or build that lacks one cosmetic id degrades that
  single effect instead of breaking the add-on.
- Mobs that pick up these weapons get the effects too — the script reads the attacker's
  main hand rather than assuming a player.
