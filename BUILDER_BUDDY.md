# Builder Buddy

A friendly human-like companion for **Minecraft Bedrock 1.21.0** on Android.
He follows you, fights off hostile mobs, and builds you a complete two-storey
house — stage by stage, while you watch.

Download: **[`dist/Builder_Buddy.mcaddon`](dist/Builder_Buddy.mcaddon)** (25 KB)

---

## Installation

1. Download **`Builder_Buddy.mcaddon`**
2. Tap the file
3. Open it with **Minecraft**
4. Wait for both packs to import
5. Create a new world
6. Activate **Builder Buddy BP** and **Builder Buddy RP**
7. Enter the world
8. Find the **Builder Buddy Spawn Egg** and the **House Builder Remote** in the
   Creative inventory

The behaviour pack lists the resource pack as a dependency, so switching on
"Builder Buddy BP" in **Behavior Packs** will pull the resource pack in
automatically. No experimental toggles are required.

---

## The companion

Spawn him with the **Builder Buddy Spawn Egg** (Spawn Eggs tab in Creative).

| | |
|---|---|
| **Health** | 40 (20 hearts), shown as a name-plate above his head |
| **Armour** | Full diamond set |
| **Weapon** | Diamond sword, 8 damage |
| **Follows** | The nearest player, automatically |
| **Doors** | Opens and closes wooden doors on his way through |
| **Stuck / left behind** | Teleports back to you after 3 seconds stuck, or if you get more than 26 blocks away |
| **On death** | Announces it and re-summons himself after 10 seconds |

He **defends** you from zombies, skeletons, creepers, spiders, pillagers,
vindicators, witches and other hostile mobs.

He will **never** attack you, villagers, wolves, cats, iron golems or any
passive animal — the melee behaviour is filtered to the `monster`, `illager`
and `pillager` families only, with endermen and wardens explicitly excluded.
He is also immune to damage from players, so you cannot kill your own buddy by
accident.

### Controls

| Do this | He does this |
|---|---|
| Give him an **emerald** | Follows you (and tames, so he keeps a proper follow distance) |
| Give him a **stick** | Stays where he is |
| Give him a **diamond** | Starts building a house |
| **Sneak + tap** him | Opens the control menu |
| **Sneak + use** the House Builder Remote | Opens the control menu |

The menu has **Follow**, **Stay**, **Defend**, **Build House** and
**Cancel Building**.

### Animations

Walking, idling, attacking, building and celebrating, plus head tracking so he
looks at whoever he is talking to. Two animation controllers drive them: one
switches idle/walk on movement speed, the other picks the action pose.

### He talks to you

> I'm following you!
> Enemy nearby! Stay behind me.
> I'll build the house here. Clearing the ground first!
> House completed! Come and have a look inside.

…plus a line for every construction stage.

---

## Building a house

Hold the **House Builder Remote** near your buddy and use it. Or run
`/function builder_buddy_house`. Or pick **Build House** from the menu. Or hand
him a diamond.

He finds a safe spot 10–18 blocks away, walks over, and builds in **eight
visible stages** — never instantly:

1. Clearing and levelling the ground
2. Laying the foundation
3. Raising the walls
4. Fitting windows and doors
5. Building the roof
6. Moving the furniture in
7. Putting the lights in
8. Fencing the plot and planting the farm

He stands beside whichever section he is working on and plays the building
animation, then celebrates when it is done. The whole build takes about
**20–25 seconds**.

### What you get

A 15×15 fenced plot containing a 9×9, two-storey house:

- Oak plank exterior with oak-log corner posts, on a stone-brick foundation
- Front door, with a cobblestone path out to the garden gate
- Glass windows on both floors
- Internal staircase up to the first floor
- **Ground floor** — crafting table, furnace, double chest, bookshelves, table
- **Upper floor** — bedroom with a bed, bookshelves, chest, crafting table
- Stepped oak-stair roof
- Torches inside, hanging lanterns, porch lamps and corner lamps
- Oak fence around the whole plot with a gate
- A small wheat farm with its own water source

### Where he refuses to build

Site checks run before a single block is placed. He will not build:

- in water or lava
- in a cave or under an overhang (needs 18 blocks of clear sky)
- on a mountainside (more than 4 blocks of height variation across the plot)
- inside or **on top of** an existing structure
- on top of you or any other player

If nothing nearby qualifies, he says so and stays put. Move somewhere more
open and try again.

### Cooldown

**120 seconds** between builds, per player, plus a 3-second cooldown on the
remote itself so a double-tap cannot fire twice. Only one build runs at a time.

---

## Commands

| Command | Effect |
|---|---|
| `/function builder_buddy_house` | Build a house |
| `/function builder_buddy_cancel` | Stop the build in progress |
| `/function builder_buddy_summon` | Summon or recall your buddy |
| `/function builder_buddy_follow` | Follow you |
| `/function builder_buddy_stay` | Hold position |
| `/function builder_buddy_defend` | Guard this spot |
| `/function builder_buddy_menu` | Open the control menu |
| `/function builder_buddy_help` | List everything |

### Crafting

The House Builder Remote is craftable in Survival:

```
  R        R = redstone
G D G      G = gold ingot
  S        D = diamond
           S = stick
```

---

## Technical notes

- **Format:** one `.mcaddon` containing `Builder_Buddy_BP` and
  `Builder_Buddy_RP` at the archive root.
- **`min_engine_version`:** `1.21.0` on both packs.
- **Script modules:** `@minecraft/server` 1.11.0 and `@minecraft/server-ui`
  1.2.0 — the stable releases that ship with 1.21.0, so **no experimental
  features** are needed.
- **Bedrock only.** No `.jar`, no BlockLauncher, no Java, no Forge, no Fabric,
  no external apps.
- **Original art.** The skin, both item icons and the pack icons are generated
  from scratch by `tools/gen_builder_buddy_textures.py`; nothing is copied from
  vanilla or from anyone else.
- **Mobile performance.** The build places 30 blocks every 3 ticks and the
  companion loop runs every 10 ticks. Site searching is spread one candidate
  per tick so it never stalls a frame. Only one build can run at a time.
- **Sounds** use built-in Bedrock sound events played through the script, so
  the pack ships no audio files and stays at 25 KB.

### Version compatibility

Several Bedrock block ids were flattened at different points (`minecraft:fence`
to `minecraft:oak_fence`, `minecraft:wooden_door` to `minecraft:oak_door`, and
so on). The block palette in `scripts/main.js` lists candidates newest-first and
falls back to the older id if the new one does not resolve, so the house builds
correctly on 1.21.0 and keeps working on later versions.

---

## Building from source

```bash
python3 tools/gen_builder_buddy_textures.py   # regenerate all art
node    tools/test_builder_buddy.mjs          # simulate a full build
python3 tools/build_builder_buddy.py          # validate + package
```

`test_builder_buddy.mjs` runs `scripts/main.js` against a mock of the Bedrock
scripting API: it builds a real house in a simulated world and then inspects
it — walls with no gaps, the door and bed present, the farm watered, the buddy
moved and celebrating — and checks that bad sites (water, caves, existing
buildings) are refused. 67 assertions.

`build_builder_buddy.py` checks the things that cause import failures:

| Error you would have seen | What the build script checks |
|---|---|
| Failed to import / Not a valid ZIP archive | Re-opens the finished archive, runs `testzip()`, rejects unsafe paths and junk files |
| Missing dependency | BP's resource-pack dependency UUID **and version** match the RP header |
| Unknown pack name | `pack.name` present in both `en_US.lang` files |
| Manifest validation failed | `format_version` 2, all header fields, 3-part versions, `min_engine_version` exactly `[1, 21, 0]`, well-formed UUIDs |
| Duplicate UUID | All five UUIDs distinct, and checked against the other add-on in this repo |
| Function not found | Every `scriptevent` fired by a function or by the entity has a handler in `main.js`, and every entity event `main.js` triggers exists |
| Invisible entity / blank icon | Geometry, textures, animations, controllers and render controllers all resolve; animation bone names exist in the model; item icons resolve through `item_texture.json` to a real PNG |

All JSON is validated by parsing it, and the PNGs are checked for a real PNG
header and the correct skin dimensions.
