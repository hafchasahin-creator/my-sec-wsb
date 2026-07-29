# Minecraft Bedrock add-ons

Two self-contained **Bedrock Edition** add-ons (each a behaviour pack + resource pack):

| Add-on | What it adds | Package |
| --- | --- | --- |
| **[Arcane Arsenal](#arcane-arsenal)** | Six legendary weapons with scripted magic effects | `dist/ArcaneArsenal.mcaddon` |
| **[One Punch Man](#one-punch-man)** | *Serious Series: Serious Punch* — a world-ending fist | `dist/OnePunchMan.mcaddon` |

They are independent: install either one, or both at once.

Built and tested against the format versions available in **Bedrock 1.21.0** — the build
running in the attached screenshot (`1.21.0.26`, Android / Pocket Edition). Both use only
**stable** item components and the **stable** `@minecraft/server 1.11.0` scripting module,
so **no experimental toggles are required** and they work on phones and tablets.

---

# Arcane Arsenal

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

---

## Installing on mobile (Android / Pocket Edition)

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

### Updating from v1.0.0

v1.0.0 shipped with invisible item icons. If you already installed it:

1. In Minecraft go to **Settings → Storage → Resource Packs / Behavior Packs** (or the
   global **Profile → Packs** screen), find the two Arcane Arsenal packs and **delete**
   both. This matters — the old copy is cached, and importing over it can keep the broken
   textures.
2. Import the new `ArcaneArsenal.mcaddon` (now version 1.0.1).
3. Re-activate both packs on your world.

### Checking it is actually working

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

---

# One Punch Man

One item: **Serious Series: Serious Punch**, a red glove that hits like Saitama.

```
/give @s opm:serious_punch
```

Craft it with **8 netherite ingots + 1 nether star + 1 netherite block**
(nether star centre, netherite block bottom-centre, netherite ingots everywhere else).

## Controls

| Input | Result |
| --- | --- |
| **Tap the use button** | Fire the selected move where you are looking |
| **Sneak + tap** | Switch to the next move (announced in chat and on the action bar) |
| **Hit a mob normally** | One punch, one kill — anything, any health, plus a crater |
| `!punch list` | Show all moves and which one is selected |
| `!punch <name>` | Jump straight to a move, e.g. `!punch apocalypse` |
| `!punch stop` | Abort a move that is still running |

## The seven moves

Sneak + tap cycles through these in order. The list wraps, so there is always a way back
down off APOCALYPSE.

| # | Move | What it does | Terrain deleted | Time to finish |
| --- | --- | --- | --- | --- |
| 1 | **Normal Punch** | A 40-block tunnel | ~330k blocks | instant |
| 2 | **Consecutive Normal Punches** | 14 punches fanned across your view | ~7.8M blocks | ~1.7 s |
| 3 | **Serious Punch** *(default)* | 224-block trench + 160-wide crater + shockwave | ~3.9M blocks | ~4.6 s |
| 4 | **Serious Series: Table Flip** | Rips a 192-wide slab of ground out and throws everything on it skyward | ~1M blocks | ~0.6 s |
| 5 | **Serious Series: Sideways Jumps** | 8 punches at once, one down every compass line | ~6.8M blocks | ~0.8 s |
| 6 | **Killer Move: Serious Series** | A 340-block sphere of nothing | ~21M blocks | ~8 s, stalls hard |
| 7 | **APOCALYPSE** | 800 blocks across, ~1,600 chunks | **~270M blocks** | **will hang, may crash** |

"Terrain deleted" is real deleted volume, not explosion radius — see below.

Everything within the move's kill radius dies: mobs are removed outright, players take
2000 damage and get their camera shaken. The wielder gets Resistance V and Fire Resistance
for the duration, so you survive your own punch — but you will still fall into the hole.

## Why it hits so much harder than an explosion

Explosions alone pockmark terrain and leave floating debris, and their damage falls off
sharply with distance. So each move is built out of three primitives, not one:

- **carve** — a `/fill` of air over a 32×32×32 box, deleting 32,768 blocks in one command.
  This is where nearly all the destruction comes from. The crater is carved as a grid of
  these boxes, nearest the centre first, so the hole opens outwards.
- **blast** — `createExplosion` for the ragged rim, the sound, and the shove.
- **launch** — an upward impulse on everything in radius (Table Flip).

A `/fill` is capped at 32,768 blocks by the game, which is exactly why the boxes are 32³.

## Why the small moves do not lock the game up

Every carve, blast and launch goes onto one shared queue, drained at a fixed budget per
tick (`perTick`, 8 → 64 depending on the move). Nothing tries to run a whole move inside a
single frame. `maxJobs` is a second, hard cap per activation. That is what keeps Normal
Punch instant and Serious Punch to a few seconds of stutter, while still letting
APOCALYPSE do what it says on the tin.

If a move is taking too long, **`!punch stop`** empties the queue immediately.

## Installing on mobile

Download **`dist/OnePunchMan.mcaddon`**, tap it, then activate **One Punch Man BP** on
your world. On spawn, chat shows:

```
[Serious Punch] v1.1.0 loaded — 7 moves, selected: Serious Punch
```

## If the item icon does not show

The icon lives in the **resource** pack, so a missing icon almost always means the
resource pack is not applied — the behaviour pack alone still gives you a working item
with a correct name and no picture.

1. Open the world → **Resource Packs** → **Active**. If **One Punch Man RP** is not
   listed there, activate it manually. The behaviour pack declares it as a dependency and
   Minecraft usually pulls it in automatically, but that does not always happen on an
   import over a previous version.
2. If you installed an earlier build, **delete both old packs** first under
   **Settings → Storage → Resource Packs / Behavior Packs**. Importing over a cached copy
   can keep the old, broken texture.
3. Turn on **Settings → Creator → Content Log GUI**. It names the pack and file for any
   texture that failed to load.

The icon is declared with the string shorthand `"minecraft:icon": "opm_serious_punch"`,
and `opm_serious_punch` is the key in `resource_packs/one_punch_rp/textures/item_texture.json`.
Both the shorthand and the `{"textures": {"default": ...}}` object form are valid at
format version 1.20.60 and above; the shorthand is used here because it is the form the
Bedrock Wiki troubleshooting guide recommends and it has one less place to go wrong. The
texture key is namespaced (`opm_` prefix) so it cannot collide with a key from another
pack, which is the other classic cause of a blank icon.

## Turning off terrain damage

In `behavior_packs/one_punch_bp/scripts/main.js`, set `CONFIG.carveTerrain` and
`CONFIG.breaksBlocks` to `false`. The moves keep their full range, knockback and entity
damage but leave the world intact.

---

## Repository layout

```
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
behavior_packs/one_punch_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  items/serious_punch.json
  recipes/serious_punch.json
  scripts/main.js        7 moves, job queue, carve/blast/launch primitives
  texts/                 pack name strings
resource_packs/one_punch_rp/
  manifest.json          RP manifest
  textures/item_texture.json
  textures/items/serious_punch.png
  texts/en_US.lang       item display name
tools/
  gen_textures.py        regenerates the Arcane Arsenal icons (stdlib only)
  gen_opm_textures.py    regenerates the Serious Punch icon (stdlib only)
  build.py               validates every add-on and writes the .mcaddon files
dist/ArcaneArsenal.mcaddon
dist/OnePunchMan.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_textures.py       # redraw the Arcane icons (--preview for ASCII art)
python3 tools/gen_opm_textures.py   # redraw the Serious Punch icon
python3 tools/build.py              # validate + repackage both .mcaddon files
python3 tools/build.py one_punch    # just one add-on: arcane | one_punch
```

`build.py` fails loudly if any JSON is malformed, if manifest UUIDs collide (within an
add-on *or* between add-ons), if a behaviour pack loses its resource-pack dependency, if
an item icon does not resolve to a real PNG, if a recipe produces an item that does not
exist, or if an item has no name in `en_US.lang`.

## Tuning

Every number — effect durations, amplifiers, lifesteal ratio, explosion radii, cast
ranges, cooldowns — sits in the `CONFIG` object at the top of
`behavior_packs/arcane_arsenal_bp/scripts/main.js`. Edit it and re-run `tools/build.py`.

To stop the Cataclysm Hammer and Meteor Staff from destroying terrain, set
`hammer.breaksBlocks` and `staff.breaksBlocks` to `false`.

For One Punch Man the same applies to the `MOVES` array and the `CONFIG` object in
`behavior_packs/one_punch_bp/scripts/main.js`. Every move is a plain object — raise
`reach`, `crater`, `shockwave` and `maxJobs` for more devastation, or raise `perTick` to
make a move finish sooner at the cost of a harder freeze while it runs. Each field is
documented in the comment above `MOVES`, and `DEFAULT_MOVE` picks which one is selected in
a fresh world.

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
- Mobs that pick up these weapons get the effects too — the script reads the attacker's
  main hand rather than assuming a player.
- **Optional APIs are probed, not assumed:** One Punch Man's `!punch` chat commands need
  `world.beforeEvents.chatSend`, which is not exposed on every 1.21 build, so the
  subscription is wrapped. If chat commands do nothing on your device, sneak + tap still
  cycles the power tier — that path uses nothing but `isSneaking`.
- **Destruction budget:** the top One Punch Man move is intentionally past what a phone
  can survive. That is the requested behaviour, not a bug; drop to Killer Move or Serious
  Punch for something that finishes.
- **No Intl:** Bedrock's script engine ships without full `Intl`, so the script formats
  numbers with plain arithmetic rather than `toLocaleString`.
