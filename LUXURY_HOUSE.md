# Luxury Estate

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that builds a
fully furnished three-storey luxury villa — grounds, pools and all — from a single item.

Built against the format versions available in **Bedrock 1.21.0**, the build in the
attached screenshot (`1.21.0.26`, Android / Pocket Edition). It uses only **stable** item,
block and recipe components and the **stable** `@minecraft/server 1.11.0` scripting
module, so **no experimental toggles are required** and it works on phones and tablets.

---

## What you get

| Item | What it does |
| --- | --- |
| **Luxury Villa Deed** | Tap Use and the villa is laid out in front of you, about 10,300 blocks over roughly 5 seconds. 15 second cooldown. |
| **Demolition Permit** | Clears the last lot *you* placed back to flat lawn. 8 second cooldown. |

| Block | Notes |
| --- | --- |
| **Polished Marble** | The main structural block, warm off-white with pale veining |
| **Onyx Marble** | Near-black with white veins — corner piers, drive, estate wall |
| **Gilded Marble** | Marble with an inlaid gold band — cornices, rims, door surrounds |
| **Crystal Glass** | Gold-framed translucent glazing, lets full light through |
| **Gold Lamp** | Light level 15 |
| **Royal Rug** | Crimson pile in a woven gold border — a full block, used as floor tiling |

All six blocks are craftable and appear in the creative **Construction** tab.

### Crafting

All recipes are crafting-table only and unlocked from the start.

| Result | Recipe |
| --- | --- |
| Luxury Villa Deed | Gold Ingot / Paper / Gold Ingot, Paper / **Emerald** / Paper, Gold Ingot / Paper / Gold Ingot |
| Demolition Permit | Iron Ingot / Paper / Iron Ingot, Paper / **TNT** / Paper, Iron Ingot / Paper / Iron Ingot |
| Polished Marble ×4 | 2×2 of Quartz Blocks |
| Onyx Marble ×8 | 8 Polished Marble around 1 Coal |
| Gilded Marble | Polished Marble + Gold Ingot (shapeless) |
| Crystal Glass | Glass + Amethyst Shard (shapeless) |
| Gold Lamp | Glowstone with a Gold Ingot on each side |
| Royal Rug ×2 | 2 Red Wool + Gold Ingot (shapeless) |

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/LuxuryEstate.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Luxury Estate BP**.
   The resource pack is pulled in as a dependency; if it is not, activate
   **Luxury Estate RP** under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `LuxuryEstate.zip`, then use a
file manager to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/luxury_house_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/luxury_house_rp
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

### Checking it is actually working

When you spawn into a world with the behaviour pack active, chat shows:

```
[Luxury Estate] v1.0.0 loaded - craft a Luxury Villa Deed, then tap Use.
```

If that line does **not** appear, the behaviour pack's scripts are not running and the
deed will do nothing. To see exactly what the game thinks is wrong, turn on
**Settings → Creator → Content Log GUI**.

### Getting the items quickly

```
/give @s luxury:villa_deed
/give @s luxury:wrecking_permit
/give @s luxury:marble 64
/give @s luxury:onyx_marble 64
/give @s luxury:gilded_marble 64
/give @s luxury:crystal_glass 64
/give @s luxury:gold_lamp 64
/give @s luxury:royal_rug 64
```

---

## Placing the villa

Stand where you want the driveway, **face the direction the villa should face**, and tap
Use with the deed. The villa is laid out ahead of you and squares up to whichever
compass direction you are closest to facing, so the front door always looks back at you.

* **Lot:** 30 × 35 blocks, from 3 below your feet to 16 above.
* **Villa:** 22 × 18 footprint, three levels plus a rooftop deck.
* The ground under the whole lot is flattened and the space above it is cleared, so
  **anything already standing there is destroyed.** Give it room — an open field, not
  your existing base. A Demolition Permit puts the lot back to flat lawn, but it does
  not restore what was there before.
* On touch controls the deed carries a use duration, so holding it puts the **use button**
  on the right of the HUD.

### What is inside

**Ground floor** — grand hall with onyx colonnade and chandeliers, living room with a
sunken seating group and a lit fireplace, kitchen with a full appliance run, island and
dining table, home cinema with a black screen wall and tiered seating, and a spa with a
sunken bath.

**First floor** — master suite with a double bed and bedside lanterns, guest bedroom,
library and study with an enchanting table and lectern, and a dressing room with a wall
of chests.

**Roof** — deck with a plunge pool, a pergola-shaded lounge, and a stair kiosk.

**Grounds** — gated estate wall with lamp piers, onyx driveway with a gilded centre line,
front terrace under a balcony carried on onyx columns, hedges, flower beds, four
ornamental trees, and a 12 × 6 back-garden pool with underwater lighting, a diving board
and sun loungers.

Two staircases connect the levels: the great hall run goes ground floor → first floor,
and a second run in the back corner of the dressing room goes first floor → roof.

### Demolition

The Demolition Permit clears **your** most recent lot — each player's site is stored
separately, so it never touches someone else's villa. If you have not placed one, or you
are in a different dimension from it, it says so and does nothing.

---

## Tuning

Everything adjustable sits in the `CONFIG` object at the top of
`behavior_packs/luxury_house_bp/scripts/main.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `blocksPerTick` | 300 | Lower it if a very old phone stutters during a build |
| `frontGap` | 5 | Blocks between you and the front wall |
| `clearSite` | true | Clear the airspace over the lot first |
| `flattenGround` | true | Flatten and re-grass the lot |
| `buildGarden` / `buildDriveway` / `buildBackPool` / `buildRoofPool` | true | Optional sections |
| `furnish` | true | Place furniture, or leave a bare shell |
| `consumeDeed` | false | Set true to use up the deed on each villa |
| `announceProgress` | true | Percentage on the action bar while building |

---

## Repository layout

```
behavior_packs/luxury_house_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  blocks/*.json          6 block definitions, format_version 1.21.0
  items/*.json           2 item definitions
  recipes/*.json         8 recipes (shaped and shapeless)
  scripts/main.js        blueprint, tick-budgeted builder, demolition
  texts/                 pack name strings
resource_packs/luxury_house_rp/
  manifest.json          RP manifest
  textures/terrain_texture.json, textures/blocks/*.png   6 block tiles
  textures/item_texture.json, textures/items/*.png       2 item icons
  texts/en_US.lang       item and block display names
tools/
  gen_luxury_textures.py regenerates every texture (stdlib only)
  build.py               validates the packs and writes the .mcaddon
  verify_villa/          builds the villa against a mock API and checks the layout
dist/LuxuryEstate.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_luxury_textures.py   # redraw the textures (add --preview for ASCII art)
python3 tools/build.py luxury          # validate + repackage dist/LuxuryEstate.mcaddon
python3 tools/build.py                 # or do every add-on in the repo
node tools/verify_villa/verify.mjs     # check the layout without launching the game
```

`verify.mjs` runs the real `main.js` against a stand-in for the Bedrock scripting API and
asserts what a JSON diff cannot show: that no pool can drain across the build, that both
stair runs have headroom and land on solid floor, that the shell has no holes, that every
room is walkable from the front door, and that demolition leaves flat lawn behind. It
found two genuine bugs while this add-on was being written, so run it after editing the
blueprint.

`build.py` fails loudly if any JSON is malformed, if manifest UUIDs collide, if the
behaviour pack loses its resource-pack dependency, if an item icon or block texture does
not resolve to a real PNG, if a recipe uses or produces something with no definition, or
if a custom item or block has no name in `en_US.lang`.

## How the builder works

The villa is described once, in local coordinates, as a list of rectangular *ops*
(`Plan.fill`, `Plan.walls`, `Plan.ring`, …). Nothing is placed while the blueprint is
being drawn up, so the description stays readable and later ops simply overwrite earlier
ones — walls first, then windows cut into them, then furniture.

Applying the plan is separate: `runPlan` walks the ops a few hundred cells per tick and
stops when its budget runs out, which is what keeps a ~10,300-block build from freezing a
phone. Cells that are already air are skipped, so clearing the lot costs almost nothing.

Local coordinates are mapped onto the world through a *site*, which carries the origin
plus the player's forward and right vectors. That is the only place rotation is handled;
every layout function is written as if the villa always faced south. Demolition reuses
the same machinery with an axis-aligned site.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0`. Item, block and recipe formats and
  the script APIs were all chosen to exist in that release.
- **No experiments:** custom blocks with `minecraft:material_instances` and
  `minecraft:geometry` have been stable since 1.20, and `@minecraft/server 1.11.0` is the
  stable module for 1.21.0.
- **Icon syntax:** `minecraft:icon` must use `{"textures": {"default": "<key>"}}` at
  `format_version` 1.20.60 and above; the older flat `{"texture": "<key>"}` field is
  silently ignored and renders a blank icon. `tools/build.py` fails the build if it
  reappears.
- **Defensive block ids:** every vanilla block is resolved through a candidate list
  (`minecraft:quartz_slab` falling back to `minecraft:stone_block_slab`,
  `minecraft:grass_block` to `minecraft:grass`, and so on) and every block state is
  applied with a fallback to the default permutation. A build that spells one id
  differently loses that one detail instead of failing the whole villa.
- **Protected or unloaded ground:** cells the game refuses are counted and reported at
  the end rather than aborting the build.
