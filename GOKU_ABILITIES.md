# Goku Abilities

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that puts
**every Goku ability in your inventory as an item**. Hold one, tap the use button, and
it fires.

Built against the format versions available in **Bedrock 1.21.0** — the exact build in
your screenshot (`1.21.0.26`, Android / Pocket Edition). It uses only **stable** item
components and the **stable** `@minecraft/server 1.11.0` scripting module, so **no
experimental toggles are required** and it works on phones and tablets.

Download: **[`dist/GokuAbilities.mcaddon`](dist/GokuAbilities.mcaddon)**

---

## The abilities

All 14 are items. Hold one in your hand and tap the **use button** on the right of the
touch HUD (right-click on keyboard, left trigger on controller).

### Attacks

| Item | Cooldown | What it does |
| --- | --- | --- |
| **Ki Blast** | 1s | Short beam, **8 damage** out to 26 blocks with a little knockback. Your bread-and-butter poke |
| **Kamehameha** | 8s | Charges for ~1s, then fires a **26 damage** beam 44 blocks long that hits *everything* in a 2-block-wide line, plus a blast where it lands. Does **not** break blocks by default |
| **Spirit Bomb** | 30s | 3s of gathering energy (you are rooted and shielded), then a huge orb drops on the point you aimed at: **radius-6 explosion + 45 guaranteed damage** to everything within 10 blocks |
| **Destructo Disk** | 6s | Throws a spinning ki disk that flies 40 blocks, **20 damage** to each of up to 8 things it passes through, and stops on the first wall |
| **Dragon Fist** | 12s | Dashes you forward. For the next 1.5s the first thing you touch takes **32 damage**, catches fire, and detonates |
| **Solar Flare** | 15s | **Blinds** everything within 14 blocks for 8s and hits it with Slowness III + Weakness II. The escape button |
| **Power Pole** | 3s | A melee weapon (10 damage, staggers on hit). Tap use to **extend it**, hitting everything in a 14-block line for 12 damage |

### Movement and support

| Item | Cooldown | What it does |
| --- | --- | --- |
| **Instant Transmission** | 5s | **Teleports you** to whatever you are looking at, up to 64 blocks, and lands you softly |
| **Flying Nimbus** | 3s | Toggles **2 minutes of ki flight**. Look up to climb, sneak to drop, look level to cruise with Speed II. Tap again to dismiss |
| **Senzu Bean** | — | **Heals you to full**, clears poison / wither / blindness / weakness / slowness / nausea, puts out fires, and adds Absorption II. Consumed on use, crafts 3 at a time |

### Transformations

Only **one form can be active at a time** — tapping a different one swaps to it, tapping
the same one again powers down early. Each shows a live countdown on your action bar and
puts an aura around you.

| Item | Cooldown | Lasts | While active |
| --- | --- | --- | --- |
| **Kaio-ken** | 25s | 30s | Strength II, Speed II, Haste II, Resistance I, Jump Boost I — but it **burns 1 health every 2 seconds**, exactly like the original technique |
| **Super Saiyan** | 45s | 60s | Strength II, Speed I, Resistance I, Regeneration I, Jump Boost II, Fire Resistance |
| **Super Saiyan Blue** | 75s | 45s | Strength III, Speed II, Resistance II, Regeneration II, Jump Boost II, Fire Resistance, Water Breathing |
| **Ultra Instinct** | 120s | 30s | Strength II, Speed III, Haste II, Resistance IV, Regeneration II, Jump Boost III, Fire Resistance, Night Vision — **plus autonomous dodging: incoming damage is refunded and your body slips aside** |

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/GokuAbilities.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Goku Abilities BP**.
   The resource pack is pulled in as a dependency; if it is not, activate
   **Goku Abilities RP** under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `GokuAbilities.zip`, then use a
file manager to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/goku_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/goku_rp
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

### Checking it is actually working

When you spawn into a world with the behaviour pack active, chat shows:

```
[Goku Abilities] v1.0.0 loaded - 14 abilities ready.
```

If that line does **not** appear, the behaviour pack's scripts are not running and no
ability will fire — that is the first thing to check. To see exactly what the game
thinks is wrong, turn on **Settings → Creator → Content Log GUI**; it names the pack and
file for any load error.

### Getting everything instantly

```
/give @s goku:ki_blast
/give @s goku:kamehameha
/give @s goku:spirit_bomb
/give @s goku:destructo_disk
/give @s goku:dragon_fist
/give @s goku:solar_flare
/give @s goku:instant_transmission
/give @s goku:flying_nimbus
/give @s goku:kaioken
/give @s goku:super_saiyan
/give @s goku:super_saiyan_blue
/give @s goku:ultra_instinct
/give @s goku:senzu_bean 16
/give @s goku:power_pole
```

In creative, the ability items are all in the **Items** tab and the Power Pole sits with
the swords in **Equipment**.

---

## Crafting

Every recipe is shaped, crafting-table only, and unlocked from the start. Most are a ring
of one ingredient around a core, so they are easy to remember.

| Ability | Ring (above, below, left, right of centre) | Centre |
| --- | --- | --- |
| Ki Blast | Glowstone Dust | Diamond |
| Kamehameha | Blaze Powder | **Ki Blast** |
| Spirit Bomb | Glowstone + Eyes of Ender | **Kamehameha** |
| Destructo Disk | Prismarine Shard | Diamond |
| Dragon Fist | Magma Cream | Blaze Rod |
| Solar Flare | Glowstone Dust | Gold Ingot |
| Instant Transmission | Ender Pearl | Eye of Ender |
| Flying Nimbus | White Wool | Feather |
| Kaio-ken | Redstone Dust | Fire Charge |
| Super Saiyan | Gold Ingot | Golden Apple |
| Super Saiyan Blue | Diamond | **Super Saiyan** |
| Ultra Instinct | Amethyst Shard | **Super Saiyan Blue** |
| Senzu Bean (×3) | Bone Meal | Golden Carrot |
| Power Pole | Iron Ingot, Iron Ingot | Blaze Rod (diagonal) |

The transformations form an upgrade ladder: Ki Blast → Kamehameha → Spirit Bomb, and
Super Saiyan → Super Saiyan Blue → Ultra Instinct.

---

## Repository layout

```
behavior_packs/goku_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  items/*.json           14 item definitions, format_version 1.21.0
  recipes/*.json         14 shaped recipes
  scripts/main.js        all ability logic (@minecraft/server 1.11.0)
  texts/                 pack name strings
resource_packs/goku_rp/
  manifest.json          RP manifest
  textures/item_texture.json
  textures/items/*.png   14 hand-drawn 16x16 icons
  texts/en_US.lang       item display names
tools/
  gen_textures_goku.py   regenerates every icon (stdlib only)
  build_goku.py          validates the packs and writes the .mcaddon
dist/GokuAbilities.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_textures_goku.py   # redraw the icons (add --preview for ASCII art)
python3 tools/build_goku.py          # validate + repackage dist/GokuAbilities.mcaddon
```

`build_goku.py` fails loudly if any JSON is malformed, if manifest UUIDs collide (with
each other *or* with the other add-on in this repo), if the behaviour pack loses its
resource-pack dependency, if an item icon does not resolve to a real PNG, if an item has
no `use_modifiers` (which would leave it with no use button on touch controls), if an
ability is never referenced by the script, if an item's cooldown category does not match
the one the script gates on, if a recipe uses an undefined pattern key or a non-existent
ingredient, or if an item has no name in `en_US.lang`.

## Tuning

Every number — damage, ranges, cooldowns, durations, effect amplifiers, explosion radii —
sits in the `CONFIG` object at the top of `behavior_packs/goku_bp/scripts/main.js`. Edit
it and re-run `tools/build_goku.py`.

Useful switches:

- `CONFIG.kamehameha.breaksBlocks` — `false` by default. Set it to `true` if you want the
  beam to carve terrain.
- `CONFIG.spiritBomb.breaksBlocks` — `true` by default. Set it to `false` for a
  PvP-friendly Spirit Bomb that leaves the map intact.
- `CONFIG.forms["goku:kaioken"].drainEveryTicks` — how often Kaio-ken costs you health.
  Set `drainAmount` to `0` to remove the drawback.
- `CONFIG.senzu.consume` — `false` makes Senzu Beans reusable.
- `CONFIG.nimbus.durationTicks` — flight time per activation (2400 ticks = 2 minutes).

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0`. Item components, recipe format and
  script APIs were all chosen to exist in that release, so nothing depends on a later
  update.
- **No experiments:** every component used (`icon`, `display_name`, `max_stack_size`,
  `hand_equipped`, `glint`, `cooldown`, `use_modifiers`, `tags`, `damage`, `durability`,
  `enchantable`, `repairable`) is stable in 1.21.0, as is `@minecraft/server 1.11.0`.
- **Icon syntax:** `minecraft:icon` uses `{"textures": {"default": "<key>"}}`. The older
  flat `{"texture": "<key>"}` field is deprecated at format_version 1.20.60+ and is
  silently ignored, which renders the item invisible; the build script rejects it.
- **Touch controls:** every ability item carries `minecraft:use_modifiers`, which is what
  makes the use button appear on the mobile HUD. Without it there is no way to trigger an
  ability by tapping, so the build script enforces it.
- **API drift:** `applyKnockback` and `isValid` changed shape between script API
  generations, so both call sites probe for the form this build actually has.
- **Defensive scripting:** every particle and sound call is wrapped individually and each
  handler is guarded, so a device or build missing one cosmetic id degrades that single
  effect instead of breaking the add-on.
- **Coexists with Arcane Arsenal:** different UUIDs, different namespaces
  (`goku:` vs `arcane:`), no shared files. Both add-ons can be active on the same world.
