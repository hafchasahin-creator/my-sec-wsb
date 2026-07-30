# Minecraft Bedrock add-ons

Two self-contained add-ons, each a behaviour pack + resource pack. Both target
**Bedrock 1.21.0**, use only **stable** components and script APIs, need **no experimental
toggles**, and are built for phones and tablets.

| Add-on | What it adds | Download |
| --- | --- | --- |
| **[Skyline Parkour](#skyline-parkour)** | Tap a compass and a parkour course is built in the sky above you: checkpoints, timer, personal bests | `dist/SkylineParkour.mcaddon` (or the two `.mcpack` files) |
| **[Bodyguard](#bodyguard)** | Hire a suited bodyguard with a rocket launcher who follows you, fights anything that attacks you, and fetches food on command | `dist/Bodyguard.mcaddon` |
| **[Arcane Arsenal](#arcane-arsenal)** | Six legendary weapons with scripted magic effects | `dist/ArcaneArsenal.mcaddon` |

---

# Skyline Parkour

A parkour minigame that builds its own courses. Tap **New course**, pick a difficulty,
and a course of floating pads rises into the sky above you — gold checkpoints along the
way, an emerald finish pad at the end, a timer and your personal best on screen.

Falling off never kills you: you are put straight back on your last checkpoint.

## Play it on your phone — 4 steps

1. Download **`dist/SkylineParkour.mcaddon`** onto the phone or tablet.
2. **Tap the file.** Minecraft opens and imports both packs by itself.
   (Prefer them separately? `dist/SkylineParkour_BP.mcpack` and
   `dist/SkylineParkour_RP.mcpack` are the same two packs as single-pack files —
   tap the RP first, then the BP.)
3. Create or edit a world → **Behaviour Packs** → activate **Skyline Parkour BP**.
   (The resource pack comes along automatically. Leave every experimental toggle **off**.)
4. Join the world. All three items — **Parkour Compass**, **Checkpoint Marker**, **Leap
   Charm** — are handed to you the first time you join. Hold the compass, tap the **use
   button** on the right of the screen, then tap **New course → Submit**.

That is it. The course builds, you are placed on the diamond start pad, and the timer
starts. Run to the emerald pad to finish.

If tapping the `.mcaddon` file does nothing, rename it to `SkylineParkour.zip` and copy
the two folders inside it into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/skyline_parkour_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/skyline_parkour_rp
```

On Windows those two folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

## The three items

| Item | Tap it to | Craft |
| --- | --- | --- |
| **Parkour Compass** | Open the menu: new course, replay, records, teleport to checkpoint, clear course | Compass + 4 gold ingots |
| **Checkpoint Marker** | Tap blocks to build your own course by hand. Sneak + tap the air to clear the markers | 4 wool + gold nugget + 2 sticks |
| **Leap Charm** | Launch yourself forward — handy for practising a jump. 3s cooldown, no fall damage | 3 feathers + rabbit's foot + gold ingot |

Everything is also reachable without the items — see [Commands](#commands).

## Difficulties

| Difficulty | Pads | Jumps | Extras |
| --- | --- | --- | --- |
| **Easy** | 3×3 | 3 blocks apart, 1 block up or down | — |
| **Normal** | 2×2 | 3 blocks, sometimes 4 | — |
| **Hard** | single block | 3–4 blocks, drops of up to 2 | 10% packed-ice pads |
| **Insane** | single block | 4 blocks, 5 when falling | 22% packed-ice pads |

Every jump in every table is one a Bedrock player can actually make: the generator never
asks for more than one block of height gain, never a 4-block jump upwards, and only uses
5-block gaps when you are dropping two blocks at the same time.

Course length is a slider: **5 to 60 jumps**, with a checkpoint every 5 jumps.

## While you are running

The action bar shows `Time · CP 2/4 · PB 1:20.0 · Falls 3`.

- **Gold pad** = checkpoint. Touch it and that becomes your respawn point.
- **Emerald pad** = finish. Touching it stops the clock and saves your time.
- **Falling** puts you back on your last checkpoint (or the start, if you have not reached
  one). While a run is active you get hidden Resistance and Saturation, so you cannot die
  on a course and hunger cannot stop you sprinting.
- Turn checkpoints **off** in the setup form for a hardcore run: any fall restarts the
  timer from the start pad.

Times are stored per difficulty *and* length, so `hard · 20 jumps` keeps its own record.
Personal bests live on you, the best time on the world — **Records** in the menu shows both.

## Seeds

Every course has a seed, printed in chat when it is built. Type that seed into the setup
form and you get the exact same course again — same pads, same turns — so you can race a
friend on identical ground. **Rebuild & replay saved course** in the menu regenerates your
last course from its seed, which also repairs anything you broke.

## Building a course by hand

1. Hold the **Checkpoint Marker**.
2. Tap the block you want to start on, then tap blocks along your route.
3. The last block you tap is the finish.
4. Open the compass menu → **Build your own course** → **Start custom run**.

Your markers get the same timer, checkpoint and fall-recovery behaviour as a generated
course. Sneak + tap the air to clear them.

## Commands

Chat (no cheats needed):

```
!pk                                  open the menu
!pk start hard 30                    start a course (difficulty, jumps, optional seed)
!pk replay                           rebuild and rerun your saved course
!pk cp                               go back to your last checkpoint
!pk stop                             stop the run
!pk clear                            delete the course blocks
!pk custom                           run your marker course
!pk kit                              give yourself the three items
```

The same things work as script events, for command blocks and buttons:

```
/scriptevent pk:menu
/scriptevent pk:start hard 30 12345
/scriptevent pk:clear
```

## Where courses get built

Courses are placed **30 blocks above you by default** (a slider in the setup form, 8–90).
Nothing is ever built over your base: the whole course is planned in memory first and
every single block — plus 3 blocks of head-room over each pad — is checked for air. If
anything is in the way the course is lifted 12 blocks and re-checked up to three times,
and if it still does not fit nothing is placed at all and the game tells you to move.

**Clear the course blocks** in the menu removes every block it placed, and building a new
course clears the previous one first unless you turn that off.

## Troubleshooting

When you join a world with the pack active, chat shows:

```
[Skyline Parkour] v1.0.2 loaded - tap the Parkour Compass to play. (no compass? type !pk kit in chat)
```

**Nothing happened at all?** Turn cheats on for the world and run this in chat:

```
/give @s parkour:course_compass
```

- **"Unknown item"** → the behaviour pack is not active on this world. Re-check
  *Edit World → Behaviour Packs → Skyline Parkour BP → Activate*. If the pack is greyed
  out there, the game is older than `min_engine_version` (1.21.0).
- **You get the compass, but there was no chat line on join** → the pack is active but its
  scripts are not running. Turn on **Settings → Creator → Content Log GUI**; it names the
  file and the error.
- **You get the compass and the chat line** → everything works; type `!pk` to open the menu.

Two more:

- Items look like blank squares → the resource pack is off. **Edit World → Resource Packs
  → Skyline Parkour RP → Activate**.
- Re-installing an older copy? Delete the old **Skyline Parkour BP** and **RP** first
  (Settings → Storage → Packs). Importing over a cached copy can keep the old files.

The greeting and the starter kit are handled twice over — once from `playerSpawn`, and
again from a sweep of the player list every 5 seconds — because on a single-player world
the host can finish spawning *before* the script starts, and then `playerSpawn` never
fires for them.

## Tuning

Every number lives in `behavior_packs/skyline_parkour_bp/scripts/config.js` — jump tables,
pad sizes, checkpoint spacing, fall grace, block palettes, the Leap Charm's power. Edit it
and re-run `python3 tools/build_parkour.py`.

## Layout and rebuilding

```
behavior_packs/skyline_parkour_bp/
  manifest.json          BP manifest, min_engine_version 1.21.0
  items/*.json           3 item definitions, format_version 1.21.0
  recipes/*.json         3 shaped recipes
  scripts/config.js      all tuning
  scripts/util.js        helpers (positions, time, seeded random)
  scripts/course.js      plan -> check for air -> build -> clear, and saving a course
  scripts/run.js         the run: falls, checkpoints, finish, HUD
  scripts/records.js     personal bests and world records
  scripts/game.js        the actions behind the menu
  scripts/menu.js        the tap menus (@minecraft/server-ui)
  scripts/main.js        event wiring only
resource_packs/skyline_parkour_rp/
  textures/items/*.png   3 hand-made 16x16 icons
  texts/en_US.lang       item display names
tools/
  gen_parkour_textures.py   regenerates the icons (stdlib only)
  build_parkour.py          validates the packs and writes the .mcaddon
dist/SkylineParkour.mcaddon        both packs, one tap
dist/SkylineParkour_BP.mcpack      behaviour pack on its own
dist/SkylineParkour_RP.mcpack      resource pack on its own
```

```bash
python3 tools/gen_parkour_textures.py   # redraw the icons (add --preview for ASCII art)
python3 tools/build_parkour.py          # validate + repackage the .mcaddon
```

`build_parkour.py` fails loudly if any JSON is malformed, if UUIDs collide (including with
Arcane Arsenal, so both add-ons can be installed at once), if the behaviour pack loses its
resource-pack or module dependencies, if any `import` in the scripts does not resolve to a
real file, if a script file is unreachable from `main.js`, if an item icon does not resolve
to a PNG, if a recipe pattern and key disagree, or if an item has no name in `en_US.lang`.

## Compatibility notes

- **Modules:** `@minecraft/server 1.11.0` and `@minecraft/server-ui 1.2.0`, both stable in
  1.21.0. No experiments, no beta APIs.
- **Touch first:** every feature is reachable by tapping. Forms are retried when the game
  reports `UserBusy`, which is what happens if a menu is asked for while another screen is
  still closing.
- **API drift:** `applyKnockback` changed shape between script API versions, so the Leap
  Charm tries both forms; `itemUseOn` is subscribed defensively; every sound, particle and
  title call is wrapped, so a device missing one cosmetic id loses that effect only.
- **Never blocks the tick:** courses are built and cleared at 48 blocks per tick, so even a
  60-jump course never stalls the game.

---

# Bodyguard

A hired bodyguard in a black suit, white shirt, red tie and sunglasses, carrying a
shoulder-fired launcher. He follows you, blows up anything that attacks you, fetches food
when you ask, and cannot be hurt by you.

**This add-on has no scripts at all.** Everything is done with vanilla entity behaviours,
so there is no script module version to get wrong and nothing that can fail to load on a
1.21.0 device.

## Play it on your phone — 4 steps

1. Download **`dist/Bodyguard.mcaddon`** onto the phone.
2. **Tap the file.** Minecraft imports both packs.
3. Create or edit a world → **Behaviour Packs** → activate **Bodyguard BP**.
4. Join, get a bodyguard (below), and **tap him while holding a gold ingot** to hire him.

## Getting one

Three ways, use whichever suits the world:

| Way | How |
| --- | --- |
| **Craft a contract** | 1 paper between 2 gold ingots, in a row, on a crafting table. Tap the ground with the **Bodyguard Contract** and he appears. |
| **Spawn egg** | Creative inventory → search **Bodyguard**. |
| **Command** | `/summon bodyguard:bodyguard` |

Then **hire him**: hold a **gold ingot** (or an **emerald**) and tap him. He is yours from
that moment - he knows who his owner is, and only follows that player.

## What he does

- **Follows you.** Starts moving when you get 5 blocks away, stops 2 blocks from you.
- **Fires explosive shells.** Anything he is angry at, from 7 to 24 blocks away, gets a
  shell with a **power 12** explosion - three times TNT. Read the warning below.
- **Punches** at close range instead of shooting, so he does not level the ground you are
  standing on.
- **Fights whatever attacks you.** Anything that hurts you becomes his target, instantly.
- **Fights what you fight.** Hit a mob and he joins in.
- **Hunts monsters near you.** Zombies, skeletons, creepers, spiders and slimes within
  16 blocks, on sight.
- **Fetches food** - see below.
- **Cannot be hurt by you**, and is immune to explosions, including his own.
- **Heals.** Feed him cooked beef (+10) or a golden apple (+20) when he is hurt.
- **Takes a name tag**, and never despawns.

Monsters treat him as a villager, which is what makes them come for him instead of you.

| | |
| --- | --- |
| Health | 40 (20 hearts) - twice a player |
| Melee damage | 7 per hit |
| Shell damage | 14 on impact, plus a power 12 explosion |
| Firing range | 7 to 24 blocks, a shot every 2.5-4 seconds |
| Speed | 0.3 walking, 1.25x while following you |
| Knockback resistance | 60% |
| Doors | He opens and closes them to keep up |

## Ordering food - double tap

Look at him and **tap twice, quickly** (within 1.5 seconds). The button on screen says
**Order** on the first tap and **Find Food** on the second.

He then goes looking, and 5-11 seconds later drops **2 bread and a steak** at his feet -
and since he is following you, that is at your feet. After 14 seconds he goes back to
normal and you can order again.

A single tap does nothing, on purpose: it only opens the 1.5 second window that the second
tap needs. That is how the double tap is detected without any scripting.

## Careful: he really does blow things up

A power 12 shell leaves a crater far bigger than TNT. He will fire it at a zombie standing
next to your house, and **you take that damage too** - he is immune, you are not.

Two things worth knowing:

- **Keep your buildings:** run `/gamerule mobGriefing false` in the world. He still fires,
  the shells still hurt monsters, but no blocks break. This is the switch to use if you
  want him around a base.
- **Stand behind him**, not next to his target. He will not fire at anything closer than
  7 blocks, which is what keeps most shots away from your own feet.

To change the blast, open `behavior_packs/bodyguard_bp/entities/cannon_shell.json` and
edit `"power"` in `minecraft:explode`:

| power | roughly |
| --- | --- |
| 4 | one TNT - safe near a base |
| 8 | a small nuke |
| 12 | the default: a crater you can see from far away |
| 20+ | expect the phone to stutter badly and your world to have a hole in it |

`"causes_fire": false` is off deliberately; turning it on sets the landscape alight.

## Layout and rebuilding

```
behavior_packs/bodyguard_bp/
  manifest.json           BP manifest, no script module at all
  entities/bodyguard.json the entity: base state, hired state, the order
                          window and the fetching state, and their events
  entities/cannon_shell.json  the explosive projectile he fires
  items/hire_contract.json    minecraft:entity_placer spawns him
  recipes/hire_contract.json
resource_packs/bodyguard_rp/
  entity/bodyguard.entity.json      model, texture, animations, spawn egg
  models/entity/bodyguard.geo.json  humanoid geometry, 64x64 UV
  animations/bodyguard.animation.json  walk and head-turn, defined here rather
                                    than borrowed from vanilla
  render_controllers/               one plain controller, shared by both entities
  textures/entity/bodyguard.png     the suit and the launcher
  textures/entity/cannon_shell.png  the shell
  textures/items/                   contract icon, spawn egg icon
tools/
  gen_bodyguard_textures.py   redraws the skin, the icon and the pack icons
  build_bodyguard.py          validates the packs and writes the .mcaddon
dist/Bodyguard.mcaddon
```

```bash
python3 tools/gen_bodyguard_textures.py   # redraw (add --preview for ASCII art)
python3 tools/build_bodyguard.py          # validate + repackage
```

`build_bodyguard.py` fails the build if a script module ever appears in the manifest, if
UUIDs clash with either other add-on, if the client entity's identifier, geometry,
texture, render controller or animations do not resolve, if the hired component group
loses `follow_owner` / `owner_hurt_by_target` / `owner_hurt_target`, if the tame event is
not defined, if the contract spawns something that is not the bodyguard, or if any name
is missing from `en_US.lang`. It also rejects `spawn_egg` written with the British
spelling `base_colour`, which the game silently ignores - that alone leaves the egg with
no icon at all.

## Tuning

Open `behavior_packs/bodyguard_bp/entities/bodyguard.json`:

- `minecraft:health` / `minecraft:attack` - how tough and how hard he hits.
- `behavior.follow_owner` - `start_distance` and `stop_distance` for how close he sticks.
- `behavior.ranged_attack` - `attack_radius`, `attack_radius_min` (how close a target has
  to be before he stops shooting and starts punching) and the reload interval.
- `behavior.nearest_attackable_target` - `within_radius`, and the families he hunts.
- `minecraft:tameable` - `tame_items`, what you pay him with.
- The `bodyguard:fetching` group - which food he brings and how much.
- The `bodyguard:order_window` timer - how fast the double tap has to be.

And in `entities/cannon_shell.json`, `minecraft:explode` - the blast itself.

Then re-run `python3 tools/build_bodyguard.py`.

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
[Arcane Arsenal] v1.0.2 loaded - 6 weapons armed.
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
