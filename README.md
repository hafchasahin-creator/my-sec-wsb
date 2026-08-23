# Minecraft Bedrock add-ons

Two self-contained add-ons for **Minecraft Bedrock Edition**, built and tested against
the format versions available in **Bedrock 1.21.0** — the build in the screenshot this
repo was started from (`1.21.0.26`, Android / Pocket Edition).

Both use only **stable** components and the **stable** `@minecraft/server 1.11.0`
scripting module, so **no experimental toggles are required** and both work on phones
and tablets.

| Add-on | What it is | Download |
| --- | --- | --- |
| **[Bloatgrub](#bloatgrub)** | A parasite that lives in your inventory, leaps at you, burrows in, and detonates | `dist/Bloatgrub.mcaddon` |
| **[Arcane Arsenal](#arcane-arsenal)** | Six legendary weapons with scripted magic effects | `dist/ArcaneArsenal.mcaddon` |

They share nothing but the build tooling, so you can install either one on its own.

---

# Bloatgrub

> Something you can pick up. Something you should not.

A **Bloatgrub** is a pale, bloated, six-legged thing with a ring of teeth where its face
should be and one filmy eye that never blinks. Kill one and it curls up into a **dormant
grub** you can carry.

Carrying it is the mistake.

```
   dormant grub in your inventory
        |  you use it, or it simply gets tired of waiting
        v
   live grub on the ground  --leap-->  latched onto you
        |                                   |
        |  you kill it                      |  it burrows in
        v                                   v
   dormant grub drops                  INFESTED (a timer you can hear)
                                            |
                          purge serum <-----+-----> detonation
                          (survive, hurt)          (you die, brood hatches)
```

## The four beats

**1. It waits in your bag.** Every second a dormant grub is in your inventory it gets
more restless: wet noises, a nudge on the action bar, then it starts biting through the
bag for 1 damage at a time. Somewhere between roughly 90 and 240 restlessness points —
randomised, and counted *per grub*, so a stack wakes far sooner than one — it uncurls,
eats itself out of your inventory, and drops onto your shoulders. You can also just
**tap it** to let it out deliberately; used bare-handed it fixates on you for 30 seconds.

**2. It jumps on you.** Once loose it hunts. Inside 5.5 blocks it launches itself at your
chest every 1.3 seconds — a real physics lunge on top of the vanilla leap behaviour, so
it comes at you through the air. It cannot latch during its first 12 ticks alive, which
means you always get to see it coming.

**3. It goes inside you.** Get within 1.75 blocks and it is gone — no more mob, just a
burst of gore, a camera shake, and `IT IS INSIDE YOU` across the screen. Now you have
**11 seconds**, and they are staged:

| Time | What you get |
| --- | --- |
| 0.0s | Nausea. *"Something went in under your skin."* |
| 2.2s | Nausea + Slowness, bites start (2 damage) |
| 4.6s | Nausea II + Weakness, 3 damage. **IT IS EATING** |
| 7.3s | + Blindness + Mining Fatigue, 4 damage. Your ribs creak |
| 9.6s | + Darkness, Slowness III, 5 damage. **IT IS SWELLING** |

A heartbeat plays underneath the whole thing, starting every 26 ticks and accelerating to
every 5. The camera shake grows with it. Damage from inside uses the `magic` cause, so
**armour does not help you**, and by default the bites deliberately stop at 1 HP — the
grub wants the kill for itself.

**4. It blasts.** A radius-3 explosion out of your chest, 8 guaranteed splash damage to
everything within 4 blocks, and a kill that goes through resistance. Then **two fresh
grubs** crawl out of the crater — unless four are already within 16 blocks, so blowing up
beside your own bed cannot compound into a swarm — and chat reads:

```
<name> was hollowed out by a Bloatgrub.
```

## Surviving it

**Purge Serum** is the only real answer, and you need it *before* you get infested — you
have 11 seconds, not enough time to open a crafting table.

- Tapping it while infested rips the grub out: **7 damage** (never lethal), Nausea III,
  Poison, Slowness and Weakness for a while, and the grub lands next to you **enraged**
  (faster, 6 damage). You get 10 seconds where nothing can re-enter you.
- Tapping it when nothing is inside you costs nothing — it just tells you so. Holding
  the button down cannot burn more than one dose either.

Other outs: dying to something else robs it of its meal, respawning always comes back
clean, and `/tag @s remove grub_infested` stops the countdown on the spot — the tag is
what the countdown reads, not a decoration.

**Creative mode is immune** by default — you can carry, build and test with dormant grubs
safely. Set `CONFIG.carry.creativeImmune` to `false` if you would rather not be.

## Items

| Item | How you get it | What tapping it does |
| --- | --- | --- |
| **Bloatgrub (Dormant)** | 60% drop from killing a Bloatgrub | Lets it out; it fixates on **you** |
| **Sealed Grub Jar** | 8 × Glass around 1 dormant grub | Throws it 2.6 blocks away and masks your scent for 10 seconds |
| **Purge Serum** ×2 | Iron Ingot / Fermented Spider Eye + Glistering Melon Slice + Fermented Spider Eye / Glass Bottle | Cuts an infestation out of you |

The jar is the safe way to move one around, and the only sane way to weaponise one
against something that is not you.

## The animal itself

14 HP, 4 melee damage, moves at 0.32 (a little faster than a zombie), climbs nothing,
avoids water, and takes **double damage from fire** — a soft body under a thin shell.
Its hitbox is two boxes shaped to the model rather than the collision box, so a tap on
the teeth or the eye connects — `minecraft:scale` is visual only, and without that the
whole front of the animal was unhittable.
Grubs never hurt each other. When one dies there is a 20% chance it bursts and leaves a
replacement, unless three or more are already within 16 blocks.

They also **spawn naturally**, but rarely: underground only, light level 0–4, below
Y 16, Easy difficulty and up, weight 3, at most 2 per area, in any biome tagged
`monster`. To turn that off entirely, delete
`behavior_packs/bloatgrub_bp/spawn_rules/bloatgrub.json` and rebuild.

```
/give @s grub:dormant_bloatgrub
/give @s grub:grub_jar
/give @s grub:purge_serum
/summon grub:bloatgrub
```

## Tuning it

Every number above sits in the `CONFIG` object at the top of
`behavior_packs/bloatgrub_bp/scripts/main.js`. The knobs most people want:

| Setting | Default | Effect |
| --- | --- | --- |
| `infest.totalTicks` | `220` | Seconds × 20 from burrow to blast |
| `infest.useHeavyScreenEffects` | `true` | Blindness and Darkness during the late stages |
| `infest.bitesCanKill` | `false` | Whether internal bites can finish you before the blast |
| `blast.breaksBlocks` | `true` | Whether the detonation wrecks terrain |
| `blast.brood` | `2` | Grubs that hatch from the crater |
| `blast.broodMaxNearby` | `4` | Ceiling on grubs near the crater, so the brood cannot compound |
| `blast.lethal` | `true` | Turn off for a survivable (still brutal) version |
| `carry.minAgitationToWake` | `90` | How long a dormant grub stays quiet |
| `carry.creativeImmune` | `true` | Creative players are ignored |

Re-run `python3 tools/build.py` after editing.

---

# Arcane Arsenal

A behaviour pack + resource pack that adds six legendary weapons with scripted magic
effects.

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

### Updating from v1.0.0

v1.0.0 shipped with invisible item icons. If you already installed it:

1. In Minecraft go to **Settings → Storage → Resource Packs / Behavior Packs** (or the
   global **Profile → Packs** screen), find the two Arcane Arsenal packs and **delete**
   both. This matters — the old copy is cached, and importing over it can keep the broken
   textures.
2. Import the new `ArcaneArsenal.mcaddon` (now version 1.0.1).
3. Re-activate both packs on your world.

---

# Installing on mobile (Android / Pocket Edition)

1. Download **`dist/Bloatgrub.mcaddon`** (and/or `dist/ArcaneArsenal.mcaddon`) onto the
   device.
2. Tap the file. Minecraft opens and imports both of that add-on's packs automatically.
3. Create or edit a world → **Behavior Packs** → activate the behaviour pack. The
   matching resource pack is pulled in as a dependency; if it is not, activate it under
   **Resource Packs** too.
4. Leave every experimental toggle **off** — none are needed.

If tapping the file does not open Minecraft, rename it to `.zip`, then use a file manager
to copy the two inner folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/<pack>
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/<pack>
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

## Checking it is actually working

When you spawn into a world with a behaviour pack active, chat shows one of:

```
[Bloatgrub] v1.0.0 loaded - do not pick it up.
[Arcane Arsenal] v1.0.1 loaded - 6 weapons armed.
```

If that line does **not** appear, the behaviour pack's scripts are not running and none
of the scripted behaviour will fire — that is the first thing to check. If it does appear
but something looks wrong, the problem is on the resource-pack side instead.

To see exactly what the game thinks is wrong, turn on **Settings → Creator → Content Log
GUI** (and "Content Log File"). It names the pack and file for any load error.

---

# Repository layout

```
behavior_packs/
  bloatgrub_bp/            entity, 3 items, recipes, loot table, spawn rules, script
  arcane_arsenal_bp/       6 items, 6 recipes, script
resource_packs/
  bloatgrub_rp/            client entity, geometry, animations, entity texture, icons
  arcane_arsenal_rp/       6 item icons
tools/
  data/                    vanilla reference data extracted from bedrock-samples
  pixel.py                 stdlib RGBA PNG reader/writer shared by the generators
  gen_bloatgrub.py         model + entity texture + animations + icons, one pass
  gen_textures.py          Arcane Arsenal icons
  build.py                 validates both add-ons and writes the .mcaddon files
  preview_bloatgrub.py     renders the model to a PNG so you can look at it
  sim/mock-server.js       a stand-in for @minecraft/server
  sim/run.mjs              runs the real Bloatgrub script against it, headless
dist/
  Bloatgrub.mcaddon
  ArcaneArsenal.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_bloatgrub.py     # model, entity texture, animations, item icons
python3 tools/gen_textures.py      # Arcane Arsenal icons (--preview for ASCII art)
python3 tools/build.py             # validate + repackage both .mcaddon files
python3 tools/build.py Bloatgrub --check-only    # validate one, write nothing
node tools/sim/run.mjs             # run the behaviour script's scenarios headless
python3 tools/preview_bloatgrub.py grub.png   # look at the model without launching the game
```

### Why the generators exist

`gen_bloatgrub.py` emits the geometry, the entity texture **and** the animations from one
declarative bone/cube table. Each cube's box-UV footprint is packed into the atlas once,
and both the model JSON and the painted pixels come out of that single packing — so the
model and its texture cannot drift apart, and an animation cannot name a bone the model
does not have. That class of mistake produces a mob that renders as a smear or as
nothing at all, with no error message anywhere.

### Looking at the model without launching the game

`python3 tools/preview_bloatgrub.py out.png` renders the geometry straight from
`bloatgrub.geo.json` and `bloatgrub.png` — three orthographic views, painter's algorithm,
sampling the real texture. It is not a renderer; it is a way to catch a model that reads
as a grey lump, or a texture that landed on the wrong faces, before putting it on a phone.

### Testing the behaviour without a phone

`node tools/sim/run.mjs` loads
`behavior_packs/bloatgrub_bp/scripts/main.js` **unmodified** and runs it against
`tools/sim/mock-server.js`, a stand-in for `@minecraft/server` with a manual tick pump.
The mock is deliberately strict — it only implements members the real 1.11.0 module has,
its containers hand back copies the way the real ones do, and `applyImpulse` throws on a
`Player` exactly as the real API does — so a script that reaches for something that does
not exist fails here instead of on someone's phone.

The scenarios drive real situations end to end: carrying a grub until it wakes, a stack
waking sooner than a single one, creative immunity, releasing one by hand, the jar's
scent mask, the leap and the latch, the full countdown into the detonation and its brood,
bites refusing to steal the kill, the serum, dying to something else mid-countdown,
respawning, logging out mid-countdown, walking through a nether portal mid-countdown, two
grubs arriving on the same tick, and two players not bleeding state into each other. One
scenario just counts particles, sounds and commands per event so the effect budget cannot
quietly balloon.

```
$ node tools/sim/run.mjs
...
84 checks passed, 0 failed
```

Add `SIM_VERBOSE=1` to see each individual check, or pass a substring
(`node tools/sim/run.mjs latch`) to run a subset.

### What `build.py` refuses to ship

- malformed JSON, or manifest UUIDs that collide within or across add-ons
- a behaviour pack that lost its resource-pack dependency, or a missing `pack_icon.png`
- a script module with no `@minecraft/server` dependency, or a missing entry point
- an item icon that does not resolve to a real PNG, or that uses the deprecated flat
  `minecraft:icon` `"texture"` field (which the game ignores in silence)
- a recipe producing or consuming a custom item that has no definition
- a behaviour entity with no client entity — or the reverse
- a client entity pointing at a geometry, texture, animation or render controller that
  is not defined anywhere
- a geometry whose declared `texture_width`/`texture_height` disagrees with the actual
  PNG, whose cubes have non-integer sizes, whose UVs run off the texture, or whose UV
  footprints overlap each other
- an animation driving a bone the model does not have
- a `scripts.animate` entry with no matching animation slot
- a custom item, entity or spawn egg with no name in `en_US.lang`
- a loot table or spawn rule pointing at something that does not exist
- a namespaced id in the behaviour script that nothing in the pack defines, and a
  `triggerEvent()` naming something that is not an entity event — both of which fail
  silently in game, since the handler still runs and its branch simply never fires
- a tap-activated custom item with no `minecraft:interact_button` (see below), or an
  `interact_button` label with no matching `en_US.lang` entry
- a particle id that is not a vanilla Bedrock particle, or that is one but needs Molang
  context from a host entity and so renders nothing when spawned on its own — the two
  look identical in game, which is to say invisible. Checked against
  `tools/data/vanilla_particle_ids.txt`; this found Emberfang using the blaze's own
  `minecraft:mobflame_emitter`
- a sound id the engine does not know, checked against
  `tools/data/vanilla_sound_ids.txt` — all 1375 sound events from Mojang's own
  `bedrock-samples` at tag `v1.21.0.3`. `playSound` with a bad id neither throws nor
  logs; it just plays nothing, so a typo deletes an effect with no way to notice from
  inside the game. This check found `mob.silverfish.hurt` on its first run — the real id
  is `mob.silverfish.hit`

---

## The one that would have killed it on a phone

A custom item with no vanilla use behaviour — not food, not a projectile, not a block
placer — shows **no use button at all on touch controls**. The player has no input that
can generate a use action, so `world.afterEvents.itemUse` never fires for them, while the
exact same pack works fine with a mouse. Nothing appears in the content log.

The fix is `minecraft:interact_button`, which is stable at item `format_version` 1.20.30
and ships in 1.21.0's own schema set as
`metadata/json_schemas/InteractButton v1.20.50.json`: *"determines if the interact button
is shown in touch controls and what text is displayed on the button."* All three Bloatgrub
items carry it with a localised label (Release / Throw Jar / Inject), and so do Arcane
Arsenal's two tap-activated weapons (Call Lightning / Call Meteor), which had the same
latent problem. `build.py` now fails any tap-activated item that is missing it.

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
- **Bloatgrub specifics:** the entity uses only stable behaviour components
  (`leap_at_target`, `melee_attack`, `nearest_attackable_target`, `damage_sensor`,
  `navigation.walk`); the client entity blends `idle` and `walk` through
  `scripts.animate` rather than an animation controller; and every sound, particle,
  camera shake and screen effect is wrapped, so a device missing one id loses that
  flourish and nothing else.
- **Command dependence:** camera shake is the one effect that goes through
  `/camerashake`. If a world blocks it, the infestation still runs — it just stops
  rattling the screen.

