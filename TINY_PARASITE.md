# Tiny Parasite

A survival-horror mode for **Minecraft Bedrock 1.21.0** on Android. Release one
tiny parasite and it hunts the nearest living thing, burrows inside it, and a
few seconds later the host bursts open — and **two** more crawl out.

Download: **[`dist/Tiny_Parasite.mcaddon`](dist/Tiny_Parasite.mcaddon)** (17 KB)

---

## Installation

1. Download **`Tiny_Parasite.mcaddon`**
2. Tap the file
3. Open it with **Minecraft**
4. Wait for both packs to import
5. Create a new world
6. Activate **Tiny Parasite BP** and **Tiny Parasite RP**
7. Enter the world
8. Find the **Tiny Parasite Spawn Egg** and the **Antiparasitic Serum** in the
   Creative inventory

No experimental toggles are required.

---

## The life cycle

**1. It hunts.** A six-legged parasite about half a block wide scuttles after
anything alive within 16 blocks — players, animals, mobs, villagers, other
add-ons' mobs. It ignores its own kind, items and armour stands.

**2. It burrows in.** One hit is all it needs. The parasite rears back, lunges,
then drills down into the host, shrinking and spinning until it vanishes. The
host is now infected.

**3. It incubates.** The host is visibly sick: angry particles that thicken as
it worsens, slowness, and a countdown. Mobs get a `☣ 5s` name tag; players get
an action-bar warning and a dose of nausea near the end.

| | Incubation |
|---|---|
| Mobs | **8 seconds** |
| Players | **16 seconds** |

**4. It bursts.** An explosion that damages but **never breaks blocks**, a
spray of gore particles, and **2 new parasites** crawl out of the remains. Mobs
die. Players take 12 damage plus nausea and slowness, but survive — the mode
stays playable.

Each newborn spends **2 seconds dormant** before it starts hunting, so an
outbreak builds rather than detonating all at once.

---

## Fighting back

- **Antiparasitic Serum** — use it to cure yourself and every infected host
  within 8 blocks. Consumes one vial. This is the only way to stop an infection
  once it has started.
- **Fire** hurts parasites **three times over**. Flint and steel, lava, a
  campfire — all far more effective than a sword.
- **Kill an infected host early** and it still bursts, but only **1** parasite
  escapes instead of 2. Culling the sick is worth it.
- They only have 6 health and no knockback resistance, so they die easily —
  the danger is the numbers, not the individual.

### Crafting the serum

```
  G        G = glowstone dust
  F        F = fermented spider eye     -> 2 serum
  B        B = glass bottle
```

---

## Safety valves

A self-replicating mob can run a phone into the ground, so the spread is
bounded in three separate ways:

| Guard | What it does |
|---|---|
| **Population cap** | **40 parasites per dimension.** Past that, bursts produce no offspring and the swarm is announced as capped. |
| **Despawn** | Parasites more than 54–96 blocks from any player clean themselves up, so long sessions do not accumulate thousands in abandoned chunks. |
| **Purge** | `/function parasite_purge` removes every parasite in every dimension and cures every host, immediately. It always works. |

The burst explosion is created with `breaksBlocks: false`, so an outbreak can
never eat your base. All four of these are enforced by the build script — it
refuses to package the add-on if the cap is raised above 100, the purge
function is missing, the despawn component is removed, or the explosion is
allowed to break blocks.

---

## Commands

| Command | Effect |
|---|---|
| `/function parasite_spawn` | Release one parasite next to you |
| `/function parasite_cure` | Cure every infection within 12 blocks |
| `/function parasite_purge` | **Panic button** — wipe every parasite, cure every host |
| `/function parasite_status` | Parasite count per dimension and infected host count |
| `/function parasite_help` | List everything |

---

## Technical notes

- **Format:** one `.mcaddon` containing `Tiny_Parasite_BP` and
  `Tiny_Parasite_RP` at the archive root.
- **`min_engine_version`:** `1.21.0` on both packs.
- **Script module:** `@minecraft/server` 1.11.0 only — the stable release that
  ships with 1.21.0. No `server-ui`, no experiments.
- **Original art.** The 32×32 skin, both item icons and the pack icons are
  generated from scratch by `tools/gen_parasite_textures.py`.
- **Animations:** idle (breathing, twitching mandibles, swaying tail), crawl
  (six legs alternating, driven by distance moved), lunge (rear back and snap)
  and burrow (spin, shrink and sink). Two animation controllers pick between
  them — one on movement speed, one on the entity's variant.
- **Infection state lives on the entity as a tag**, not only in script memory,
  so a `/reload` or an unloaded chunk cannot strand a host mid-infection; the
  script re-adopts anything tagged every five seconds.
- **Sounds** use built-in Bedrock sound events played through the script, so
  the pack ships no audio files.

### Plays well with Builder Buddy

Both add-ons can run in the same world. The parasite is in the `monster`
family, so a Builder Buddy will fight parasites on sight — and can itself be
infected and burst, after which it re-summons itself as normal.

---

## Building from source

```bash
python3 tools/gen_parasite_textures.py   # regenerate all art
node    tools/test_parasite.mjs          # simulate the whole life cycle
python3 tools/build_parasite.py          # validate + package
```

`test_parasite.mjs` runs `scripts/main.js` against a mock of the Bedrock
scripting API and drives the full cycle: infect, incubate, burst, spread. It
asserts that exactly two parasites emerge, that an early kill yields one, that
the cap holds under pressure, that parasites never infect each other or dropped
items, that the serum cures and consumes exactly one vial, that a player
survives their own burst, and that the purge really empties the world.
36 assertions.

Both this and the Builder Buddy build script are thin drivers over
`tools/packlib.py`, which holds the shared manifest, UUID, resource-pack
wiring, language and packaging checks. Each add-on adds its own rules on top —
Builder Buddy checks the `rightItem` bone and the anti-griefing guards; Tiny
Parasite checks the four safety valves above.
