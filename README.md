# Minecraft Bedrock add-ons

Two self-contained add-ons, each a behaviour pack + resource pack pair, built and tested
against the format versions available in **Bedrock 1.21.0** (Android / Pocket Edition).
Neither one needs an experimental toggle.

| Add-on | What it adds | Download |
| --- | --- | --- |
| **[Anaconda](#anaconda)** | A giant snake that constricts, swallows creatures whole and grows | `dist/Anaconda.mcaddon` |
| **[Arcane Arsenal](#arcane-arsenal)** | Six legendary weapons with scripted magic effects | `dist/ArcaneArsenal.mcaddon` |

---

# Anaconda

A huge custom mob: a jungle anaconda that hunts anything that moves, drags it in, and
swallows it whole. Every meal heals it, and enough meals make it grow — a juvenile that
survives long enough becomes a titan roughly two and a half times its original size.

## The snake

| | Juvenile | Adult | Titan |
| --- | --- | --- | --- |
| Health | 60 | 120 | 220 |
| Bite damage | 7 | 11 | 16 |
| Model scale | 1.0 | 1.6 | 2.4 |
| Constricts within | 6.5 blocks | 9 blocks | 12 blocks |
| Swallows within | 2.6 blocks | 3.4 blocks | 4.4 blocks |
| Swallows anything at or below | 14 HP | 24 HP | 40 HP |
| Meals to grow | 8 | 16 | — |

A natural spawn rolls its size at random (55% juvenile, 35% adult, 10% titan). The model
is a fourteen-bone chain about seven blocks long that slithers in a travelling sine wave,
faster the faster it moves, with a separate vertical undulation while swimming.

## How eating works

Every quarter second each snake looks around itself:

- **Anything inside the constriction radius** is dragged towards the snake twice a second
  and held under Slowness II.
- **Anything inside the swallow radius** is eaten. If its health is at or below the
  stage's threshold it goes down **whole** — the entity is removed outright, so it drops
  nothing. Anything tougher gets **crushed** for the stage's squeeze damage once a second
  until it is weak enough to swallow.
- **Things with no health bar** — dropped items, boats, minecarts, armour stands — are
  simply swallowed, and count as a third of a meal.
- A swallowed meal sends a **visible bulge travelling down the body**, one segment at a
  time, and heals the snake.

Players are eaten by the same rules, except that a player cannot be removed from the world,
so a player who is weak enough is finished off with damage instead and dies normally, with
the usual death message and drops.

**Never eaten:** other anacondas, XP orbs, arrows and other projectiles, TNT, falling
blocks, lightning, area effect clouds, fishing hooks, and anything at all carrying the
`anaconda_safe` tag:

```
/tag @e[type=minecraft:horse] add anaconda_safe
```

Players in **creative or spectator mode are ignored entirely** — not pulled, not bitten.

## Where it spawns

Naturally on the surface of **jungle** and **swamp** biomes at any light level, on Easy
difficulty and above, one per group, at most two per surface chunk area. Naturally spawned
snakes despawn at distance like any other monster — until one grows, at which point it
becomes permanent.

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/Anaconda.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Anaconda BP**. The resource
   pack comes along as a dependency; if it does not, activate **Anaconda RP** under
   **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `Anaconda.zip` and copy the two
inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/anaconda_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/anaconda_rp
```

## Getting one right now

```
/summon anaconda:anaconda
/give @s anaconda:anaconda_spawn_egg
```

The spawn egg is also in the creative inventory under **Items → Spawn Eggs**. To force a
size on a snake you have already spawned:

```
/event entity @e[type=anaconda:anaconda,c=1] anaconda:grow_titan
```

### Checking it is actually working

When you spawn into a world with the behaviour pack active, chat shows:

```
[Anaconda] v1.0.0 loaded - something is hungry in the jungle.
```

If that line does **not** appear, the behaviour pack's scripts are not running: the snake
will still spawn, slither and bite with its vanilla AI, but it will not constrict, swallow
or grow. Turn on **Settings → Creator → Content Log GUI** to see what the game objected to.

## Repository layout

```
behavior_packs/anaconda_bp/
  manifest.json                 BP manifest, min_engine_version 1.21.0
  entities/anaconda.json        stats, vanilla AI, size stages, events
  spawn_rules/anaconda.json     jungle + swamp surface spawning
  loot_tables/entities/         leather, string, bone and the odd swallowed treasure
  scripts/main.js               constriction, swallowing and growth
resource_packs/anaconda_rp/
  manifest.json                 RP manifest
  entity/anaconda.entity.json   model, texture, animation and spawn-egg bindings
  models/entity/anaconda.geo.json       14-bone chained body
  animations/anaconda.animation.json    slither, swim, look, swallow
  render_controllers/
  textures/entity/anaconda.png  128x128 skin
  textures/items/               spawn egg icon
  texts/en_US.lang              mob and spawn egg names
tools/
  gen_anaconda_textures.py      regenerates every PNG (stdlib only)
  build_anaconda.py             validates the packs and writes the .mcaddon
  tests/test_anaconda.mjs       behaviour tests for scripts/main.js
dist/Anaconda.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_anaconda_textures.py   # redraw the skin, spawn egg and pack icons
node tools/tests/test_anaconda.mjs       # 20 behaviour checks against a mocked API
python3 tools/build_anaconda.py          # validate + repackage dist/Anaconda.mcaddon
```

`build_anaconda.py` fails loudly on the mistakes Bedrock reports as silence: a component
group no event ever adds, an event fired from a timer or from `main.js` that the entity
never defines, a spawn rule pointing at an event that does not exist, a client entity whose
geometry / texture / render controller / animation does not resolve, an **animation that
targets a bone the model does not have**, a spawn egg with no icon, a missing display name,
or UUIDs that collide with the other add-on in this repository.

`tools/tests/test_anaconda.mjs` rewrites the script's `@minecraft/server` import to point at
a mock and steps the hunting loop by hand, so the eat / crush / pull / grow rules are
checked without launching the game.

## Tuning

Every number lives in the `STAGES` table at the top of
`behavior_packs/anaconda_bp/scripts/main.js` — radii, squeeze damage, drag strength, the
health at which something can be swallowed whole, healing, and meals per growth. Health,
bite damage, model scale and collision box per stage live in the matching
`anaconda:size_*` component groups in `behavior_packs/anaconda_bp/entities/anaconda.json`.
Keep the two in sync: the script infers a snake's stage from its max health the first time
it sees it.

To make the snake far less dangerous, raise `swallowHealth` down to `0` (nothing is ever
swallowed whole, only crushed) or shrink `lure` to the same value as `gulp` (no dragging).
To stop it spawning naturally, delete `behavior_packs/anaconda_bp/spawn_rules/anaconda.json`
and use the spawn egg instead.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0`. The entity format is `1.16.0`, the
  client entity `1.10.0`, the geometry `1.12.0` and the animations `1.8.0` — all long-term
  stable formats, none of them experimental.
- **No custom sounds:** the snake borrows vanilla sound events (`random.fizz` for its hiss,
  `mob.ravager.bite` and `random.eat` when it swallows, `mob.ravager.roar` when it grows)
  rather than shipping a `sounds.json`, which would override the vanilla one wholesale.
- **Animation state without experiments:** the swallow bulge is driven by
  `minecraft:mark_variant`, flipped by a behaviour event and reset by a component timer, so
  no entity properties or experimental toggles are involved.
- **Bone scale compensation:** bones inherit their parent's scale, so each segment's bulge
  keyframes are paired with an inverse keyframe on the following segment. Without that, one
  segment swelling would inflate the entire rest of the snake.
- **Defensive scripting:** every sound, particle and effect call is individually wrapped,
  the knockback call falls back to the newer vector signature if the four-argument one is
  gone, and every entity lookup is guarded — an entity that unloads mid-pass is skipped, not
  a crash.

---

# Arcane Arsenal

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack) that adds six
legendary weapons with scripted magic effects.

Built and tested against the format versions available in **Bedrock 1.21.0** — the build
running in the attached screenshot (`1.21.0.26`, Android / Pocket Edition). It uses only
**stable** item components and the **stable** `@minecraft/server 1.11.0` scripting module,
so **no experimental toggles are required** and it works on phones and tablets.

---

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
tools/
  gen_textures.py        regenerates every icon (stdlib only)
  build.py               validates the packs and writes the .mcaddon
dist/ArcaneArsenal.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_textures.py      # redraw the icons (add --preview for ASCII art)
python3 tools/build.py             # validate + repackage dist/ArcaneArsenal.mcaddon
```

`build.py` fails loudly if any JSON is malformed, if manifest UUIDs collide, if the
behaviour pack loses its resource-pack dependency, if an item icon does not resolve to a
real PNG, if a recipe produces an item that does not exist, or if an item has no name in
`en_US.lang`.

## Tuning

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
- Mobs that pick up these weapons get the effects too — the script reads the attacker's
  main hand rather than assuming a player.
