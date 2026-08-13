# Onetap Armory

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack): five weapons that
kill anything they touch in a single hit, each with its own first-person animation, its own
kill effect, and its own ability.

Built against **Bedrock 1.21.0** — the build in your screenshot (`1.21.0.26`, Android /
Pocket Edition). Stable item components and the stable `@minecraft/server 1.11.0` module
only, so **no experimental toggles are required**.

---

## The five weapons

| Weapon | Held animation | One-tap kill effect | Ability (tap Use) | Cooldown |
| --- | --- | --- | --- | --- |
| **Reaper's Edge** | sweeping brush motion | soul torn upward out of the body | **Soul Harvest** — a wave rolls out to 14 blocks and takes everything it touches; each soul feeds you Absorption and Regeneration | 12s |
| **Void Lance** | trident-style raise | void implosion collapsing into the wound | **Void Beam** — a beam races out 48 blocks, erasing everything within 2 blocks of it, and bursts on the first wall | 8s |
| **Judgment Hammer** | two-handed guard | ground-level flame ring | **Judgment Slam** — three shockwaves roll out to 16 blocks, throwing everything caught into the air before it dies | 14s |
| **Whisper Dagger** | raised to the eye | silent black burst | **Shadow Step** — blink to whatever you are looking at (up to 40 blocks), kill it, and walk away invisible and fast for 4s | 6s |
| **Doom Cannon** | bow-style draw | point-blank detonation | **Annihilation Bolt** — a bolt flies out to 64 blocks and detonates on the first thing it meets, killing everything within 5 blocks | 10s |

Every one of them also kills **in melee, in one tap**, whatever it is — creeper, Wither,
Ender Dragon, a mob with 100,000 health. Armour, resistance and immunity do not matter.

None of them ever break: they have no durability at all.

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/OnetapArmory.mcaddon`** onto the device.
2. Tap the file. Minecraft imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Onetap Armory BP**.
   The resource pack comes along as a dependency.
4. Leave every experimental toggle **off**.

On joining you will see:

```
[Onetap Armory] v1.0.0 loaded - 5 weapons armed. Try /function onetap_kit
```

If that line does not appear the behaviour pack is not running, and nothing will happen
when you hit anything. **Settings → Creator → Content Log GUI** will name the problem.

## Getting all five at once

With cheats on:

```
/function onetap_kit
```

That drops all five weapons straight into your inventory. Individually:

```
/give @s onetap:reapers_edge
/give @s onetap:void_lance
/give @s onetap:judgment_hammer
/give @s onetap:whisper_dagger
/give @s onetap:doom_cannon
```

In creative, search `onetap` in the inventory — they all sit in the **Equipment** tab next
to the swords.

### Crafting them in survival

Every recipe needs a **Nether Star**, so they stay end-game items. Crafting table only,
unlocked from the start.

| Weapon | Recipe (top row → bottom row) |
| --- | --- |
| Reaper's Edge | ` ` Netherite Netherite / ` ` Nether Star Netherite / ` ` Bone ` ` |
| Void Lance | ` ` ` ` Ender Eye / ` ` Nether Star Obsidian / Stick ` ` ` ` |
| Judgment Hammer | Gold Block, Netherite, Gold Block / Gold Block, Nether Star, Gold Block / ` ` Stick ` ` |
| Whisper Dagger | ` ` ` ` Netherite / ` ` Nether Star Netherite / Echo Shard ` ` ` ` |
| Doom Cannon | Netherite, Iron Block, Netherite / Redstone Block, Nether Star, Redstone Block / ` ` Iron Block ` ` |

---

## Using them

**Melee:** just tap the mob. That is the whole thing — no charge-up, no aiming.

**Abilities:** hold the weapon and tap the **Use** button on the right of the HUD (each
weapon carries a use duration, which is what makes that button appear on touch controls,
and what plays its animation). On keyboard/controller it is right-click / left trigger.

The action bar tells you when an ability is still cooling down, and chat reports what each
ability killed.

A few things worth knowing:

- **The Ender Dragon** ignores melee on its body — vanilla only lets you hurt it at the
  head. The abilities have no such restriction: Void Beam, Soul Harvest, Judgment Slam and
  Annihilation Bolt all kill it outright wherever it is.
- **Loot and XP behave normally.** The kill is dealt as damage credited to you first, so
  drops, looting and experience work exactly as they would from a normal kill. The direct
  `kill()` call is only a fallback for anything that survives a million damage.
- **Other players die in one tap too**, by default. See below if you do not want that.

---

## Tuning

All of it sits in the `CONFIG` object at the top of
`behavior_packs/onetap_armory_bp/scripts/main.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `killPlayers` | `true` | Set `false` for a mob-only armoury — useful on a server with friends |
| `killTamed` | `true` | Set `false` to spare tamed wolves, cats and horses. **Worth changing if you keep pets** — one stray tap deletes them |
| `killNamed` | `true` | Set `false` to spare name-tagged mobs |
| `reaper.radius` | 14 | Soul Harvest reach |
| `lance.range` / `lance.width` | 48 / 2.2 | Beam length and kill radius around it |
| `hammer.radius` / `hammer.launch` | 16 / 1.6 | Shockwave reach and how hard it throws |
| `dagger.range` | 40 | How far you can blink |
| `cannon.range` / `cannon.blastRadius` | 64 / 5 | Bolt distance and blast size |
| `cooldowns` | per weapon | Ability cooldowns in ticks (20 ticks = 1 second) |

Creative-mode players are always immune, and the weapon never kills its own wielder,
regardless of settings.

---

## Repository layout

```
behavior_packs/onetap_armory_bp/
  manifest.json               BP manifest, min_engine_version 1.21.0
  items/*.json                5 item definitions, format_version 1.21.0
  recipes/*.json              5 shaped recipes
  functions/onetap_kit.mcfunction   /function onetap_kit
  scripts/main.js             kills, flourishes, five abilities
  texts/                      pack name strings
resource_packs/onetap_armory_rp/
  manifest.json               RP manifest
  textures/item_texture.json, textures/items/*.png   5 hand-made 16x16 icons
  texts/en_US.lang            item display names
tools/
  gen_onetap_textures.py      regenerates every icon (stdlib only)
  build.py                    validates the packs and writes the .mcaddon
  verify_armory/              runs the weapons against a mock API
dist/OnetapArmory.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_onetap_textures.py   # redraw the icons (add --preview for ASCII art)
python3 tools/build.py onetap          # validate + repackage dist/OnetapArmory.mcaddon
node tools/verify_armory/verify.mjs    # exercise the weapons without launching the game
```

`verify.mjs` runs the real `main.js` against a stand-in for the scripting API and checks
that one hit kills a 100,000 health mob with every weapon, that each ability fires, emits
particles and clears its targets, that cooldowns gate them, that a single tap cannot
double-fire through both `itemUse` and `itemUseOn`, and that the wielder and creative
players are never the victim.

The mock deliberately re-raises `entityHurt` from inside `applyDamage`, the way the real
game does, because that is the trap in a weapon like this: the finishing blow lands back
in your own melee handler and recurses forever. The guard against it is the `executing`
set in `annihilate()`, and the test asserts a single swing produces no more than two
damage events.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0`. Every component used
  (`icon`, `display_name`, `damage`, `use_animation`, `use_modifiers`, `cooldown`,
  `hand_equipped`, `glint`, `tags`, `max_stack_size`) is stable in that release, as is
  `@minecraft/server 1.11.0`.
- **Animations** come from `minecraft:use_animation`, which is why each weapon moves
  differently in first person: `brush`, `spear`, `block`, `spyglass` and `bow` are all
  vanilla animations that exist in 1.21.
- **Defensive effects:** every particle and sound call is wrapped individually, so a
  device or build missing one cosmetic id loses that single effect rather than the kill.
- **Mobs wielding them** get the same one-tap kill — the handler reads the attacker's main
  hand rather than assuming a player.
