# Graveyard Horror

A Minecraft **Bedrock Edition** add-on (behaviour pack + resource pack): consecrate a
graveyard, and after dark something starts walking toward you. It only moves when you are
not looking at it.

Built against **Bedrock 1.21.0** — the build in your screenshot (`1.21.0.26`, Android /
Pocket Edition). Stable components and the stable `@minecraft/server 1.11.0` module only,
so **no experimental toggles are required**.

---

## The rule

The wraith **never moves while you can see it**. Look at it and it stops dead, turns its
hood toward you and waits. Turn around, look at your inventory, walk into a doorway — and
when you look back it is closer.

"Seeing it" means all three of:

- it is inside your view cone (about 56° off centre),
- within 64 blocks,
- and nothing solid is in the way.

A wall counts. Your own back counts. Distance counts.

When it reaches you it lunges once: 3 hearts, blindness and slowness for 4 seconds, and
then it is gone — standing 15 blocks away, waiting out its cooldown, watching. It cannot
be fought off. The only thing that stops it is light.

---

## What is in the add-on

| Thing | What it is |
| --- | --- |
| **Gravekeeper's Ledger** | Consecrates a full graveyard in front of you: fenced plot, two blocks of graves, a crypt with grave goods, dead trees, and lit wards. The ground it makes is **haunted ground** |
| **Wraith** | The stalker. Spawns after dark on haunted ground, behind you, never in view |
| **Grave Lantern** | The ward. Wraiths will not come within 10 blocks of one, and are destroyed outright within 5. The graveyard builds itself six of them |
| **Tombstone** | A real carved model that turns to face you when you place it. **Breaking one has consequences** |
| **Grave Soil / Crypt Stone** | Building blocks for your own graveyards |

### Digging up a grave

Break a tombstone and it is a coin flip: a little over half the time something claws its
way out behind you, and the rest of the time you get grave goods — bones, gold, an
emerald, soul sand. There is no third outcome.

### After dark

Stand anywhere within 44 blocks of consecrated ground at night and:

- the **fog closes in** to 22 blocks, colour-drained and grey,
- you hear things moving in directions you cannot see,
- cold motes drift up off the ground,
- and up to two wraiths come looking for you.

At dawn all of it lifts, and every wraith burns away.

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/GraveyardHorror.mcaddon`** onto the device.
2. Tap the file. Minecraft imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Graveyard Horror BP**.
4. Leave every experimental toggle **off**.

On joining you will see:

```
[Graveyard Horror] v1.0.0 loaded - craft a Gravekeeper's Ledger, or /function graveyard_help.
```

## Getting started

`/function graveyard_help` hands you a ledger and reminds you of the rules. Otherwise:

```
/give @s grave:gravekeepers_ledger
/give @s grave:grave_lantern 8
/summon grave:wraith            (if you want to meet one on your own terms)
```

**Crafting** (crafting table):

| Result | Recipe |
| --- | --- |
| Gravekeeper's Ledger | Bone, Paper, Bone / Paper, **Soul Sand**, Paper / Bone, Paper, Bone |
| Grave Lantern | Iron Nugget above, below and either side of a **Soul Lantern** |
| Tombstone ×2 | Eight Stone around one Bone |
| Grave Soil ×4 | Two Dirt and two Soul Soil, diagonally |
| Crypt Stone ×4 | Two Stone Bricks and two Vines, diagonally |

To consecrate: hold the ledger, face the direction the graveyard should run, and tap Use.
It builds a 25 × 25 plot about 16 blocks ahead of you and registers it as haunted ground.

**Do not consecrate next to your base** unless that is the point.

---

## Surviving it

- **Light the wards.** Grave Lanterns are the only hard counter. Ring your camp with them
  and nothing gets in. The graveyard's own lanterns make the path and the crypt safe.
- **Keep it in view.** It cannot move while you watch it. Backing away with your eyes on it
  works — until you have to turn around.
- **Watch the fog.** If the fog is up you are on haunted ground, and something is on its
  way.
- **Do not break lanterns at night.** The action bar will tell you the light has gone out.
  That is not flavour text.

---

## Tuning

All of it is in the `CONFIG` object at the top of
`behavior_packs/graveyard_horror_bp/scripts/main.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `stalker.observeCone` | 0.55 | Cosine of the half-angle that counts as looking. Raise it and it moves even while half in view |
| `stalker.approach` | 1.7 | Blocks per think while unwatched. This is the dial for how frightening it is |
| `stalker.strikeDamage` | 6 | Three hearts |
| `stalker.strikeCooldown` | 160 | It keeps its distance for eight seconds after a hit |
| `ward.radius` / `ward.burnRadius` | 10 / 5 | How far a lantern holds it off, and where it is destroyed |
| `haunt.radius` | 44 | How far a graveyard's influence reaches |
| `haunt.maxWraiths` | 2 | Per player |
| `haunt.spawnChance` | 0.35 | Per haunt tick (every 2 seconds) when under the cap |
| `haunt.nightStart` / `nightEnd` | 13000 / 23000 | What counts as after dark |
| `build.blocksPerTick` | 250 | Lower it if consecrating stutters on an old phone |

---

## Repository layout

```
behavior_packs/graveyard_horror_bp/
  manifest.json
  blocks/                         grave soil, crypt stone, grave lantern, tombstone
  items/gravekeepers_ledger.json
  entities/wraith.json            no gravity, no AI - the script drives it
  recipes/                        5 shaped recipes
  functions/graveyard_help.mcfunction
  scripts/main.js                 observation, stalking, wards, haunting, the builder
resource_packs/graveyard_horror_rp/
  entity/wraith.entity.json
  models/entity/wraith.geo.json   hooded, armed, no legs
  models/blocks/tombstone.geo.json
  animations/wraith.animation.json           drift, stare, lunge
  animation_controllers/                     driven by query.variant
  fogs/haunted.json               the fog the script pushes onto you
  textures/blocks, textures/items, textures/entity
tools/
  gen_graveyard_textures.py       regenerates every texture (stdlib only)
  build.py                        validates the packs and writes the .mcaddon
  verify_graveyard/               haunts a mock world and checks the rules hold
dist/GraveyardHorror.mcaddon
```

## Rebuilding

```bash
python3 tools/gen_graveyard_textures.py   # redraw the textures (--preview for ASCII art)
python3 tools/build.py graveyard          # validate + repackage
node tools/verify_graveyard/verify.mjs    # haunt a mock world without launching the game
```

`build.py` resolves every reference these packs depend on — client entity, model, textures,
render controllers, animations, spawn egg, **and the tombstone's custom block geometry**,
which is the one that renders as an invisible block with nothing useful in the content log
if the name is wrong.

## Verified before shipping

`verify.mjs` runs the real `main.js` against a stand-in for the scripting API with actual
terrain, a clock the test can set to night or day, and walls it can raise to break line of
sight. It checks that:

- watched, the wraith moves **exactly zero blocks**, and stares back;
- looking away lets it close, and it drifts while it does;
- your back, a wall, and 80 blocks of distance all count as not looking;
- it will not strike while watched, does strike when you look away at arm's length, blinds
  you, and then backs off for its cooldown instead of hovering at your shoulder;
- a lantern holds it at the edge of the light, destroys one that gets too close, and
  breaking that lantern is what lets it reach you;
- dawn ends it;
- the ledger builds tombstones, soil, a crypt and six wards, and registers itself;
- the fog is pushed on haunted ground at night and removed at dawn;
- digging a grave always does exactly one of the two things;
- and that none of this happens anywhere that has not been consecrated.

The last one matters as much as the rest: a horror mod that haunts you everywhere is just
a nuisance.
