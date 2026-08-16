# Minecraft Bedrock add-ons

Two self-contained add-ons for **Minecraft Bedrock Edition**, both targeting **1.21.0**
(built against `1.21.0.26`, Android / Pocket Edition) and both using only **stable** item
components and the **stable** scripting modules — **no experimental toggles required**.

| Add-on | File | What it is |
| --- | --- | --- |
| **Luxury Tech House** | `dist/LuxuryTechHouse.mcaddon` | A functional futuristic smart mansion you build from a creative item |
| **Arcane Arsenal** | `dist/ArcaneArsenal.mcaddon` | Six legendary weapons with scripted magic effects |

---

# Luxury Tech House

A 2050-style billionaire smart home that builds itself from one creative item and then
actually runs: proximity sliding doors, day/night lighting scenes, two working lifts, a
secret command centre, a vault with an iris door, a hidden escape tunnel, a retractable
helipad and a full security lockdown.

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/LuxuryTechHouse.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate **Luxury Tech House BP**.
   The resource pack comes in as a dependency; if it does not, activate
   **Luxury Tech House RP** under **Resource Packs** too.
4. Leave every experimental toggle **off**.

If tapping the file does not open Minecraft, rename it to `LuxuryTechHouse.zip` and copy
the two inner folders into
`Android/data/com.mojang.minecraftpe/files/games/com.mojang/{behavior_packs,resource_packs}/`.

## Building the mansion

Two items appear in the creative inventory:

| Item | Tab | Use |
| --- | --- | --- |
| **Luxury Tech House Builder** | Construction | Builds the whole estate around you |
| **Mansion Tech Remote** | Items | Opens the smart-home control panel |

Stand on **flat, open ground with room in every direction**, hold the Builder and use it.
The estate is placed over about ten seconds with a progress bar on the action bar, then you
are set down on the driveway facing the entrance.

The lot is **64 x 72 blocks**, reaching 27 blocks up and 20 down, and the escape tunnel
runs a further ~100 blocks west. Everything inside that footprint is replaced, so build
somewhere you do not mind flattening. `/give @s lux:house_builder` works too.

Using the Builder again builds a fresh estate at the new location; the smart systems follow
the newest one.

## What is in it

**Exterior** — three storeys of white, black, stone and glass with floor-to-ceiling curtain
walling, cantilevered balconies on both upper floors and across the rear, a rooftop deck
with a pergola lounge, fire pit and plunge spa, a raised **retractable helipad**, an
entrance canopy, a tiered **fountain**, a circular **driveway**, an **infinity pool** with a
glass edge and catch channel, an outdoor lounge with a pergola and kitchen bar, hedging,
specimen trees and lit pathways.

**Ground floor** — grand foyer with a reception desk and media wall, a 19x14 living room
with a sunken conversation pit and piano corner, a **walk-through aquarium** (a glazed
corridor between two stocked tanks), an indoor **swimming pool** with loungers and a steam
room, a kitchen with an island and pantry, a twelve-seat dining room, a guest bathroom and
a gym with a mirrored wall.

**First floor** — master suite with headboard media wall and dressing run, master bathroom
with a sunken tub, an office, two further bedrooms, a family bathroom, and a **library** —
which is where the concealed lift lives.

**Second floor** — a private **cinema** with three tiers of recliners and a projection
booth, a **gaming room** with a battlestation row, arcade wall and neon ceiling grid, a sky
bar, and an observatory lounge with a glass floor panel.

**Atrium** — a three-storey void with glass balustrades, a **waterfall spanning all three
floors** into a lit catch basin, the glass lift and a sculptural stair.

**Underground garage** — five marked bays with a stylised supercar and charge post in each,
a security gate, a **vehicle platform** that raises and lowers between the driveway and the
garage, a workshop (anvil, smithing table, grindstone, stonecutter, loom, cartography and
fletching tables, enchanting table, stocked barrels) and a storage room.

**Command centre** — behind the library bookshelf wall, down the secure lift: a video wall
with a stylised world map and monitor banks, a console horseshoe, a briefing table with a
holographic centre, server racks and a redstone plant.

**Vault** — through a blast door, a scanner airlock and a four-ring **iris door**: four
armour display stands (netherite, diamond, gold, iron — each with a weapon), bullion
shelving, a display case, weapon racks and stocked chests.

**Escape tunnel** — from the command centre, running ~100 blocks west with running lights,
a switchback stair and a disguised boulder exit in the trees.

## What actually works

### Automatic sliding doors

**36 doors**, 33 of them proximity-operated. No pressure plates anywhere.

- Walk within ~3.4 blocks (4.2 for the main entrance) and the door opens.
- The leaves **slide apart from the centre**, one column per frame, with a half-frame in
  between where the leading column becomes a thin pane — a four-wide entrance plays five
  distinct frames, so the travel reads as a slide rather than a pop.
- It **stays open** while you are near and for 1.5 s after you leave.
- It **will not close on you**: a player standing in the reveal vetoes the close and
  refreshes the hold.
- Subtle shulker-shell hiss for glass doors, piston thump for the heavy ones.
- The main entrance is a pair of 2x3 glass leaves; interior doors are 2x3; the garage gate
  is 6x4 steel.

### Night mode

Sampled every two seconds. At dusk the estate transforms: facade strips light up, pool and
pathway lighting comes on, the interior shifts from white to warm, neon channels glow, and
the helipad markings illuminate. At dawn it reverses.

The trick that makes this cheap enough for a phone: every fitting is one of six reserved
block ids, and a transition is about a dozen `/fill … replace` calls over two big volumes —
not thousands of individual block writes. It only ever scans for the state the estate is
leaving.

Tap the **lighting button** in the foyer (or use the remote) to cycle
**auto → force night → force day**.

### Security lockdown

The **panic button** is the red key on the command centre console. It also lives on the
remote. When triggered:

- every lockable door slams shut and stays shut (main entrance, terrace, garage gate,
  secure lift, command hall, vault blast door);
- the vault iris closes and the bookshelf wall seals;
- all lighting switches to emergency red-orange, inside and out, so the whole property is
  lit;
- a two-tone alarm sounds on a loop with a flashing action bar;
- **SECURITY LOCKDOWN ACTIVE** appears on screen.

The green **disarm** key beside it (or the remote) releases it, and lighting returns to
whatever the clock says it should be.

### Lifts, platform, helipad, vault

- **Glass lift** — garage, ground, first, second, roof. Call buttons at each landing and
  inside the cab. The cab floor and lamp travel with you; the shaft doors only open when
  the cab is actually there, so you cannot walk into an empty shaft.
- **Secure lift** — library vestibule to the command centre, behind the bookshelf wall.
- **Vehicle platform** — a 6x6 deck that carries you and anything on it between the
  driveway and the garage tunnel.
- **Helipad** — panels peel back from the centre line to reveal the lit service bay, and
  extend again on a second press.
- **Vault** — the blast door slides, then the iris retracts ring by ring with rising
  clanks and a final chime.

### Concealed controls

Every secret has a disguised trigger, a discreet physical button **and** a remote entry, so
it stays reachable even if a device does not deliver block-interact events:

| Secret | Disguised trigger | Backup button |
| --- | --- | --- |
| Command centre wall | Lectern (and the odd shelf beside it) in the library | Button in the east bookshelf run |
| Vault | Lodestone in the airlock | Gold key on the command console |
| Escape tunnel | Flower pot beside the hatch | Lapis key on the command console |

## Performance

Written for a phone, not a desktop:

- One master loop every **3 ticks** that returns immediately unless a player is within 96
  blocks of the estate. No polling, no per-tick command spam.
- Doors write **only the columns that changed** — at most two per leaf per frame — and the
  first-load repaint is metered across several ticks.
- The clock is sampled every 40 ticks; a lighting transition is ~14 `/fill` calls.
- Animations run on their own short intervals and clear themselves the moment they finish.
- The build is metered at 12 commands per tick.
- Deliberately small entity budget: 4 armour stands and 10 fish.

## Verifying it loaded

Turn on **Settings → Creator → Content Log GUI**. If a block id had to be substituted for
your build, the log names it — the add-on resolves its whole palette against the engine at
startup and downgrades gracefully rather than leaving holes.

---

# Arcane Arsenal

Six legendary weapons with scripted magic effects.

| Weapon | Type | Effect on use |
| --- | --- | --- |
| **Frostbite Blade** | Sword (8 dmg) | Hits apply **Slowness III for 5s** plus bonus **freeze damage** (4), with an ice-shatter burst |
| **Emberfang** | Sword (8 dmg) | Sets the target **on fire for 8s** and detonates a **small flame burst** within 2.5 blocks |
| **Stormcaller** | Trident-style (9 dmg) | **Summons a lightning strike** on what it hits — or long-press to call lightning up to 40 blocks |
| **Voidreaper** | Sword (8 dmg) | **Heals the wielder for 35%** of the damage dealt |
| **Cataclysm Hammer** | Maul (11 dmg) | **Terrain-breaking explosion** on impact (radius 4); the wielder is shielded |
| **Meteor Staff** | Ranged (3 dmg melee) | Long-press to drop a **falling meteor**: radius-4 fiery explosion plus 20 area damage |

Stormcaller and Meteor Staff have visible cooldowns (4s and 6s). All recipes are shaped and
crafting-table only:

| Weapon | Recipe (top → bottom) |
| --- | --- |
| Frostbite Blade | Blue Ice / Diamond / Stick |
| Emberfang | Magma Block / Blaze Powder / Blaze Rod |
| Stormcaller | Prismarine Shard + Heart of the Sea + Prismarine Shard, then Stick, Stick |
| Voidreaper | Eye of Ender / Netherite Ingot / Blaze Rod |
| Cataclysm Hammer | Obsidian + TNT + Obsidian, Obsidian + Stick + Obsidian, then Stick |
| Meteor Staff | Fire Charge / Magma Cream / Blaze Rod |

Install exactly as above using `dist/ArcaneArsenal.mcaddon`. On spawn, chat shows
`[Arcane Arsenal] v1.0.1 loaded - 6 weapons armed.` — if that line is missing, the
behaviour pack's scripts are not running.

Every number sits in the `CONFIG` object at the top of
`behavior_packs/arcane_arsenal_bp/scripts/main.js`. Set `hammer.breaksBlocks` and
`staff.breaksBlocks` to `false` to stop terrain damage.

### Updating from Arcane Arsenal v1.0.0

v1.0.0 shipped with invisible icons. **Delete both old packs** under
**Settings → Storage** before importing v1.0.1 — importing over the cached copy can keep
the broken textures.

---

# Repository layout

```
behavior_packs/
  luxury_tech_house_bp/
    manifest.json        BP manifest, min_engine_version 1.21.0
    items/*.json         Builder + Remote, format_version 1.21.0
    scripts/
      main.js            entry point: item use, block interaction, persistence
      config.js          block palette, vertical stack, plan constants, tuning
      plan.js            pure estate description: doors, zones, lifts, controls
      blueprint.js       construction - every room, floor and grounds feature
      builder.js         command queue + relative-coordinate drawing surface
      doors.js           the sliding door system
      systems.js         lighting, lockdown, lifts, helipad, vault, tunnel
      ui.js              the Mansion Tech Remote's control panel
      util.js            guarded sound/title/block helpers
  arcane_arsenal_bp/     six weapons, recipes and effect logic
resource_packs/
  luxury_tech_house_rp/  two 16x16 icons + names
  arcane_arsenal_rp/     six 16x16 icons + names
tools/
  gen_luxury_textures.py  redraws the Luxury Tech House icons (stdlib only)
  gen_textures.py         redraws the Arcane Arsenal icons (stdlib only)
  build_luxury_house.py   validates + packages LuxuryTechHouse.mcaddon
  build.py                validates + packages ArcaneArsenal.mcaddon
  sim/                    offline validation harness (see below)
dist/
  LuxuryTechHouse.mcaddon
  ArcaneArsenal.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_luxury_textures.py   # redraw icons (--preview for ASCII art)
python3 tools/build_luxury_house.py    # validate + repackage
python3 tools/build.py                 # same for Arcane Arsenal
```

## How the mansion is validated

A thousand hand-written coordinates cannot be checked by reading them. `tools/sim/` stubs
`@minecraft/server` and `@minecraft/server-ui` and runs the add-on's own modules under
Node, so `tools/build_luxury_house.py` fails the build rather than shipping a mansion with
a door in the wrong wall. It checks that:

- every emitted command parses, names a block id the engine knows, stays inside Bedrock's
  32768-block `/fill` limit, and contains no `undefined` or `NaN`;
- the whole build lands inside the ticking areas the builder claims, and each of those
  areas is under the 100-chunk limit;
- the **smart-lighting invariant** holds — no lighting group's night or lockdown block is
  ever placed inside that group's own volume, and no two groups sharing a volume share a
  block id, which is what would weld two fittings together on the first transition;
- every door animates monotonically from fully shut to fully open, no two door openings
  overlap, and the build seals each one with its own panel;
- **replaying every command into a voxel grid**, each doorway has jambs on both sides and
  clear standing room on both faces, every button hangs on a solid block and faces open
  space, every hidden trigger is a real block, every teleport target has a floor and two
  blocks of headroom, and each lift can physically reach every stop it serves;
- the dressing lands where it should — armour stands on plinths, loot in containers, fish
  in water;
- **driving the live systems**: a player approaching opens the entrance, standing in the
  reveal vetoes the close, walking away shuts it, dusk switches the lighting, lockdown
  seals every lockable door and arms the alarm, release restores it, the lift completes a
  garage-to-roof trip, each concealed system toggles, and the saved record round-trips.

The current run reports 2282 build commands over ~453k blocks, 36 doors, 25 buttons,
7 lighting zones and 2 lifts, in about 9.5 s of in-game build time.

This is static and simulated validation, not a playtest — it proves the geometry and the
command stream are self-consistent, not that Bedrock renders every fitting exactly as
intended.

## Compatibility notes

- **Version floor:** `min_engine_version` is `1.21.0` for every pack.
- **Stable modules only:** `@minecraft/server 1.11.0` and `@minecraft/server-ui 1.2.0`.
- **Block ids:** Bedrock has been renaming aggregate block ids batch by batch across the
  1.21 line. Rather than betting on which batch a given id landed in, `config.js` lists a
  substitute chain for every id that has ever lived inside an aggregate, and the add-on
  asks the engine at startup which one exists. A renamed id costs a little polish instead
  of leaving a hole in the mansion.
- **Icon syntax:** `minecraft:icon` must use `{"textures": {"default": "<key>"}}` at
  `format_version` 1.20.60 and above. The flat `{"texture": "<key>"}` field is ignored
  silently and renders a blank icon; both build scripts fail if it reappears.
- **Defensive scripting:** sounds, titles, block writes and commands are individually
  guarded. A command that fails is retried without its block states before being logged,
  so an unsupported state costs one block rather than the build.
```
