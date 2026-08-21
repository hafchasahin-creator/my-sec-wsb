# Don't Look Behind You

A Minecraft **Bedrock Edition** horror add-on (behaviour pack + resource pack) that adds a
single entity — **The Follower** — which moves only while nobody can see it.

Built for **Bedrock Beta 1.21.0.26, Android / Pocket Edition**. It uses only stable JSON
formats and the stable `@minecraft/server 1.10.0` scripting module, so **no experimental
toggles are required**.

**Deliverable:** [`dist/Dont_Look_Behind_You.mcaddon`](dist/Dont_Look_Behind_You.mcaddon) (21 KB)

---

## The rule

> **The Follower can move only when no player is looking at it.**

Freezing is authoritative, not cosmetic. When it is seen, the script swaps the entity onto
a component group that has `minecraft:movement` of `0.0` and **no AI goals at all** — there
is no pathfinding left running to be asked nicely to stop. While frozen it will not walk,
will not teleport, and cannot attack.

It is judged "seen" by three gates, cheapest first:

1. **Distance** — beyond 64 blocks nothing is computed at all.
2. **View cone** — a dot product against the player's `getViewDirection()`. The cone widens
   as it gets closer (0.47 → 0.38 → 0.15) because a three-block-tall figure at five blocks
   fills most of a phone screen even well off-centre.
3. **Line of sight** — only for survivors of the first two: a block-by-block walk from the
   player's eye, capped at 26 samples. Glass, leaves, fences and panes do not block it, so
   it can be seen through a window.

Both its head and, inside 16 blocks, its chest are tested. Reaction time is one 2-tick step
— **100 ms** from you turning around to it being frozen.

Every ambiguity resolves toward *freezing*: an unloaded chunk, a ray that clips a wall
corner, an unrecognised block. Being wrong in that direction makes it hesitate. Being wrong
the other way would break the only rule that matters.

### The stare

The instant it is seen, it is rotated once to face its target — and then **never re-aimed
while you keep watching**. Walk around it and it does not track you; it stays locked in the
pose it was caught in. That is deliberate, and reads as far more wrong than a head that
follows you.

---

## What it does when you are not looking

| Distance | What you get |
| --- | --- |
| **30+ blocks** | Almost silent. A rare swell of low cave tone, and a silhouette you are not sure you saw. |
| **15–30** | Occasional distant footsteps, intermittent so you cannot confirm them. It closes faster while unwatched. |
| **5–15** | Breathing becomes audible. Footsteps sharpen. Occasional 2-second Darkness pulses. |
| **under 5** | Breathing directly behind you. Turn fast enough and it is simply standing there — no jumpscare. Look away and the hunt continues. |

Instead of pathfinding a circle around you, it **relocates behind you while unwatched** — a
rear bearing, a valid floor, and a check that the destination is not visible to anyone
before it moves. This is why turning around is unpredictable, and it is far cheaper than
making the navigator walk the long way.

### Moods

Re-rolled every 20–45 seconds, so nothing about turning around is ever learnable:

| Mood | Behaviour |
| --- | --- |
| `creep` | Never sprints. Walks in deliberately. |
| `rush` | Sprints from as far out as 26 blocks. |
| `silent` | Makes no footstep noise whatsoever. |
| `distant` | Hangs back at 22–34 blocks and just watches. |
| `lurk` | Stays frozen for 3–9 seconds at a time even when unwatched. |
| `haunt` | Parks itself just outside your view — outside the door, at the window. May vanish outright after being spotted. |

`haunt` and the 58-block leash are what keep it around your base rather than wandering off,
and the "find a floor" scan starts above your feet and searches **downward**, so indoors and
underground it lands on your floor rather than on the roof.

Caves fall out of the same rules: mining means facing a wall, which means line of sight is
blocked, which means it is free to close the distance behind you.

### The attack

It may strike only when it is within 3.4 blocks **and** has gone unseen for a continuous
2.2 seconds. A layered scream, a lunge, **9 damage** (4.5 hearts — heavy, never lethal from
full health) and 7 seconds of Darkness. Then it retreats, disappears, and a successor
resumes the hunt 10–18 seconds later. It cannot strike again for 22–35 seconds.

---

## Survival rules

- **60 HP**, immune to knockback — killable, but a real fight.
- **Does not burn in daylight.** Immune to fall, drowning, suffocation, freezing and fire;
  everything else hurts it normally.
- **No random wandering.** It has no stroll goal at any point. It targets players only, and
  never fights other mobs.
- **Cannot open or break doors**, so it will not grief your base. It stands outside instead.
- Killing it drops the **Follower's Eye**. Another Follower begins hunting after 90–150 s.

### Follower's Eye

Use it to look back. For **30 seconds** The Follower cannot move *even while unwatched* —
the only real reprieve on offer. Three-minute cooldown.

---

## Installing on mobile (Android / Pocket Edition)

1. Download **`dist/Dont_Look_Behind_You.mcaddon`** onto the device.
2. Tap the file. Minecraft opens and imports both packs.
3. Create or edit a world → **Behavior Packs** → activate **Don't Look Behind You**.
   The resource pack comes in as a dependency; if it does not, activate it under
   **Resource Packs** too.
4. Leave every experimental toggle **off** — none are required.

If tapping the file does not open Minecraft, rename it to `.zip` and copy the two inner
folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/dlby_bp
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/dlby_rp
```

### Checking it is working

About three seconds after you enter the world, the action bar reads:

```
Something is already here.
```

If that does not appear, the behaviour pack's scripts are not running and nothing else
will happen. Turn on **Settings → Creator → Content Log GUI** to see why.

Within **5–15 seconds** of entering a survival world, The Follower is spawned 25–40 blocks
away, out of your view, on valid ground. You are not told. That is the point.

---

## Performance

Measured over three simulated minutes of a player looking around and moving:

| | |
| --- | --- |
| Block lookups | **~51/second** (≈5 per game tick) |
| Entity scans | **0.2/second** |
| Main loop | every 2 ticks (10 Hz); janitor every 100 ticks |
| Pack size | **21 KB** total |
| Entity texture | 64×64 |
| Particles spawned | none |

Nothing scans the world on a timer. The expensive step — the line-of-sight walk — runs only
after the distance and cone gates have already passed, which is a small fraction of ticks.
At most 4 Followers exist at once regardless of player count, and exactly one per player.

---

## Multiplayer

Each player gets their own Follower, tracked independently, keyed to its owner by entity
tag so it survives a script reload.

Freezing deliberately respects **every** player, not just the owner: if anyone within
64 blocks can see it, it is pinned. One person's camera therefore cannot let a Follower
creep up on someone who is looking straight at it.

One honest caveat: the behaviour-pack navigation goal walks toward the nearest player
carrying the `dlby_hunted` tag rather than strictly its own owner, because entity JSON
filters are static and cannot be re-pointed per entity. The leash keeps the owner nearest
in practice, and all freeze/tension/attack logic is per-owner regardless. Single-player
behaviour is unaffected.

---

## What is in the box

```
behavior_packs/dlby_bp/
  entities/follower.json          5 component groups + the state events
  items/followers_eye.json        the trophy
  loot_tables/entities/follower.json
  scripts/main.js                 spawning, visibility, moods, tension, attack
resource_packs/dlby_rp/
  models/entity/follower.geo.json 13 bones, generated
  animations/follower.animation.json    stare / stalk / sprint / attack
  animation_controllers/...       state machine driven by query.mark_variant
  render_controllers/...
  textures/entity/follower.png    64x64, generated
  textures/items/followers_eye.png
  sounds/README.txt               how to drop in your own .ogg files
```

### Appearance

Roughly **3 blocks tall** and extremely thin: a 7×15×4 torso on 24-unit legs, arms 31 units
long ending in oversized 4×7×5 hands that hang near the shins. The crooked posture is baked
into the geometry — the torso hunches 14° forward while the neck cranes 18° back, so the
head is craned *up at you* while the body stoops, and the two arms hang at deliberately
different angles so the silhouette is never symmetrical.

The body is near-black with a couple of shades of grain. The only pale thing is the face:
a 7×7 mask with two 1-pixel eyes set wide and a mouth you cannot quite resolve. At distance
that silhouette is meant to read, for a second, as another player.

The `stare` animation is not a still frame — it breathes at a 6-second cycle, with rotations
under half a degree and a 1.3% chest expansion. Enough to be alive. Not enough to be moving.

### Sound

**No `.ogg` files ship with this pack.** Every cue is a stack of vanilla sound *events*
layered at custom pitch and volume in script — the attack, for instance, is
`mob.endermen.scream` at pitch 0.55 over `mob.wither.spawn` at 0.45 over `random.breath` at
0.30, which is not a sound that exists anywhere in vanilla.

This was a deliberate trade: referencing event names means nothing can silently fail to
resolve on a phone, and the pack stays 21 KB. If you would rather ship real recordings,
`resource_packs/dlby_rp/sounds/README.txt` walks through it — you change only the names in
the `SFX` table at the top of `main.js`.

---

## Building from source

```
python3 tools/gen_dlby_assets.py    # regenerate geometry, texture and icons
python3 tools/build_dlby.py         # validate everything, then package
```

`gen_dlby_assets.py` writes the model and the texture **from one shared cube table**, so the
box-UV layout and the painted pixels cannot drift apart.

`build_dlby.py` refuses to package on any broken cross-file reference: a geometry the client
entity names but the model does not define, an animation driving a bone that was renamed on
one side, a `mark_variant` the controller waits for that no component group sets, an event
the script triggers that the entity does not declare, a texture whose real dimensions
disagree with the geometry. Each of those ships as an invisible or permanently frozen mob,
so each is a hard error. It is verified against 12 deliberately broken trees.

### Tunables

All at the top of `behavior_packs/dlby_bp/scripts/main.js`:
`FIRST_CONTACT_MIN/MAX`, `SPAWN_DIST_MIN/MAX`, `ATTACK_DAMAGE`, `ATTACK_RANGE`,
`ATTACK_UNSEEN_MS`, `LEASH_MAX`, `EYE_WARD_MS`, `MAX_FOLLOWERS`, and the `SFX` table.

---

## Version notes

- **`@minecraft/server` is pinned to `1.10.0`, not `1.11.0`.** 1.21.0.26 is a *beta* build,
  and the newest stable API version a beta exposes can lag its release. 1.10.0 shipped with
  1.20.80 and is still served by 1.21.x, so it loads on the beta and on release alike.
  Nothing in the script uses anything newer.
- Every engine call goes through a guard that tolerates the signature changes between point
  releases — `Entity.isValid` and `Block.isSolid` are each a method in some versions and a
  property in others, and both forms are handled.
- The **collision box is 2.4 blocks tall** while the model is ~3. That is intentional: it
  lets it follow you through 3-high cave passages instead of getting stuck at every ceiling.
  A model taller than its collision box is normal in Bedrock.
