# Minecraft Bedrock add-ons

Two **Bedrock Edition** add-ons (behaviour pack + resource pack each), built and
tested against the format versions available in **Bedrock 1.21.0** — the build in
the attached screenshot (`1.21.0.26`, Android / Pocket Edition). Both use only
**stable** components and the **stable** `@minecraft/server 1.11.0` scripting
module, so **no experimental toggles are required** and they work on phones and
tablets.

| Add-on | What it is | Download |
| --- | --- | --- |
| [**Squid Game**](#squid-game) | Red Light, Green Light minigame with Young-hee | `dist/SquidGame.mcaddon` |
| [**Arcane Arsenal**](#arcane-arsenal) | Six legendary weapons with scripted magic | `dist/ArcaneArsenal.mcaddon` |

They are independent — install either one, or both.

---

# Squid Game

**Red Light, Green Light.** Young-hee stands at the finish line. On a green light
she faces away and sings; on a red light she spins round, and anyone who has
drifted from the spot they were standing on is eliminated. Reach her to survive.

## How a round works

1. **Green light** — Young-hee turns her back and sings
   *Mugunghwa kkoci pieotseumnida* on note blocks. Run.
2. **Red light** — she swivels to face the field. Everyone freezes. Any movement
   beyond a small tolerance and you are out, with a firework crack and an
   `ELIMINATED` title.
3. Phase lengths are **rolled randomly every round** and the green light gets
   **shorter each round**, so the rhythm can never be memorised.
4. Cross the line (within 3 blocks of the marker) and you are **SAFE** for the
   rest of the round; your finishing place is announced in chat.
5. The round ends when the field is empty, or when the **5-minute clock** runs
   out — anyone still running when the buzzer goes is eliminated.

An action bar tracks the light, how many are alive, how many are safe, and the
clock.

## The referee kit

Four items, all craftable, all in the creative **Items** tab. Every one has a
second function on **sneak + use** (crouch, then tap the Use button).

| Item | Use | Sneak + use |
| --- | --- | --- |
| **Young-hee Doll** | Places Young-hee where you are aiming, and sets the finish line there | Removes her |
| **Finish Line Marker** | Sets the finish line at the block you tapped | — |
| **Referee's Whistle** | Starts the round (5-second countdown, then the first green light) | Calls the round off |
| **Player Card 456** | Toggles whether you are in the next round | Prints the current setup and score |

Everyone in the world is enrolled when the whistle blows, minus anyone who
opted out with a Player Card and anyone the game can see is in creative or
spectator. So the usual flow is: the referee opts themselves out with the card,
then blows the whistle.

### Crafting

| Item | Recipe (top → bottom) |
| --- | --- |
| Referee's Whistle | Gold Ingot / Gold + Redstone + Gold / Gold Ingot |
| Young-hee Doll | White Wool / Wool + Eye of Ender + Wool / Stick |
| Finish Line Marker | Redstone Torch / Iron Ingot / Stick |
| Player Card 456 | Paper ring around a Green Dye |

Or in creative:

```
/give @s squidgame:referee_whistle
/give @s squidgame:doll_summoner
/give @s squidgame:finish_line_marker
/give @s squidgame:player_card
/summon squidgame:young_hee
```

## Quick start

1. Build a straight run of ground, 40–80 blocks long.
2. Stand at the far end, aim at the ground and use the **Young-hee Doll**. She
   appears and the finish line is set at her feet.
3. Walk to the start line with everybody else.
4. Sneak + use the **Player Card** if you want to referee rather than play.
5. Use the **Referee's Whistle**. Countdown, then run.

## Tuning

Every number sits in the `CONFIG` object at the top of
`behavior_packs/squid_game_bp/scripts/main.js`:

| Setting | Default | Notes |
| --- | --- | --- |
| `greenTicks` / `redTicks` | 60–160 / 50–110 | Range each phase is rolled from, in ticks (20 = 1s) |
| `speedUpPerRound` | 6 | Ticks trimmed off the green light each round |
| `graceTicks` | 6 | Ticks after red before movement counts — **raise this if players die while already standing still on a laggy connection** |
| `moveThreshold` | 0.25 | Blocks of horizontal drift allowed |
| `verticalThreshold` | 0.4 | Blocks of vertical drift allowed (jumping, falling) |
| `finishRadius` | 3.0 | How close to the marker counts as crossing |
| `timeLimitSeconds` | 300 | `0` disables the clock |
| `eliminationMode` | `"kill"` | `"teleport"` sends players back to the start line instead of killing them |
| `skipCreative` | `true` | Leave creative/spectator players off the roster |

Set `eliminationMode: "teleport"` for a no-death party game.

## Checking it is working

Joining a world with the pack active puts this in chat:

```
[Squid Game] v1.0.0 loaded - Red Light, Green Light is ready.
```

If that line does **not** appear, the behaviour pack's scripts are not running
and nothing else will work either. Turn on **Settings → Creator → Content Log
GUI** to see exactly what the game is complaining about.

---

# Arcane Arsenal

Six legendary weapons with custom magic effects.

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

```
/give @s arcane:frostbite_blade
/give @s arcane:emberfang
/give @s arcane:stormcaller
/give @s arcane:voidreaper
/give @s arcane:cataclysm_hammer
/give @s arcane:meteor_staff
```

### Using the two ranged abilities on touch controls

Both the Stormcaller and the Meteor Staff carry a use duration, so holding one
makes the **use button** appear on the right of the HUD. Aim at a block or mob
and tap it. If nothing is in range the spell lands where your view meets the
ground, up to 40–48 blocks out.

### Checking it is working

```
[Arcane Arsenal] v1.0.1 loaded - 6 weapons armed.
```

### Updating from v1.0.0

v1.0.0 shipped with invisible item icons. If you already installed it, **delete**
both old packs under **Settings → Storage → Resource Packs / Behavior Packs**
first — the old copy is cached, and importing over it can keep the broken
textures. Then import the new `ArcaneArsenal.mcaddon` and re-activate.

### Tuning

Every number — effect durations, amplifiers, lifesteal ratio, explosion radii,
cast ranges, cooldowns — sits in the `CONFIG` object at the top of
`behavior_packs/arcane_arsenal_bp/scripts/main.js`. To stop the Cataclysm Hammer
and Meteor Staff from destroying terrain, set `hammer.breaksBlocks` and
`staff.breaksBlocks` to `false`.

---

# Installing on mobile (Android / Pocket Edition)

1. Download the `.mcaddon` from `dist/` onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate the BP. The matching
   resource pack is pulled in as a dependency; if it is not, activate the RP
   under **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `.zip`, then use a
file manager to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

---

# Repository layout

```
behavior_packs/squid_game_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  items/*.json           4 referee-kit items, format_version 1.21.0
  recipes/*.json         4 shaped recipes
  entities/young_hee.json  the doll, format_version 1.21.0
  scripts/main.js        the whole minigame (@minecraft/server 1.11.0)
resource_packs/squid_game_rp/
  entity/young_hee.entity.json
  models/entity/young_hee.geo.json    hand-built 64x64-mapped model
  render_controllers/
  textures/entity/young_hee.png       generated skin
  textures/items/*.png                4 generated 16x16 icons

behavior_packs/arcane_arsenal_bp/
  items/*.json           6 item definitions
  recipes/*.json         6 shaped recipes
  scripts/main.js        all weapon logic
resource_packs/arcane_arsenal_rp/
  textures/items/*.png   6 hand-made 16x16 icons

tools/
  gen_textures.py        regenerates the Arcane Arsenal icons (stdlib only)
  gen_squid_textures.py  regenerates the Squid Game icons, skin and pack icons
  build.py               validates every pack and writes the .mcaddon files
dist/
  SquidGame.mcaddon
  ArcaneArsenal.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_textures.py        # redraw Arcane icons (--preview for ASCII art)
python3 tools/gen_squid_textures.py  # redraw Squid Game art
python3 tools/build.py               # validate + repackage everything
python3 tools/build.py squid_game    # or just one add-on
```

`build.py` fails loudly if any JSON is malformed, if manifest UUIDs collide
**across add-ons**, if a behaviour pack loses its resource-pack dependency, if an
item icon does not resolve to a real texture, if a recipe produces an item that
does not exist, if an item or entity has no name in `en_US.lang`, or if a custom
entity's client definition, geometry, texture or render controller is missing.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0` for every pack. Components,
  recipe format and script APIs were all chosen to exist in that release, so
  nothing depends on a later update.
- **No experiments:** every item component used is stable in 1.21.0, as is
  `@minecraft/server 1.11.0`.
- **Icon syntax:** `minecraft:icon` must use `{"textures": {"default": "<key>"}}`
  at `format_version` 1.20.60 and above. The older flat `{"texture": "<key>"}`
  field is deprecated, and the game ignores it silently — the item still loads
  and still shows its name, but the icon renders as nothing at all.
  `tools/build.py` fails the build if that form reappears.
- **Defensive scripting:** particle, sound and title calls are individually
  wrapped, and each handler is guarded, so a device or build that lacks one
  cosmetic id degrades that single effect instead of breaking the add-on. The
  Squid Game script also carries an in-memory fallback for dynamic properties,
  and tolerates `isValid` being a method or a property.
