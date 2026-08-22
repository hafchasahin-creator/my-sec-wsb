# Bodyguard

A premium bodyguard companion for **Minecraft Bedrock Edition**, built and verified
against **1.21.0** (the release that ships as `1.21.0.26` on Android / Pocket Edition).

No experimental toggles. No `/function` commands. Everything is reachable from the
Creative inventory or a crafting table.

---

## Getting a bodyguard

**Creative**

1. Open the Creative inventory and find the **Bodyguard Spawn Egg** (Items → Spawn Eggs).
2. Tap a block. A **Bodyguard Recruit** appears.
3. Hold a **gold ingot** and tap the recruit. They are now yours.

**Survival**

1. Craft a **Bodyguard Contract**:

   ```
    G       G = Gold Ingot
   PEP      P = Paper
    G       E = Emerald
   ```

2. Tap a block with the Contract. A recruit appears.
3. Hold a **gold ingot** and tap them to hire.

Recruits walk toward anyone holding gold or a Contract, so on touch controls the
**Tame** button is right there. Once hired they get a codename, a mode badge over
their head, and start following you.

> Hiring costs the gold ingot. That is `minecraft:tameable`'s own behaviour and it is
> what binds the engine-level owner, which is what makes ownership reliable in
> multiplayer. The Contract is never consumed — it is the reusable command tool.

---

## Commanding

Hold the **Bodyguard Contract**:

| What you tap | What happens |
| --- | --- |
| Your bodyguard | Opens their command panel |
| Empty air | Opens the squad panel for your whole detail |
| A block | Summons a new recruit |

On touch controls, tapping a bodyguard while holding the Contract shows a **Command**
button. Everything is a menu — no chat commands, no hidden gestures.

### Modes

| Mode | Behaviour |
| --- | --- |
| **FOLLOW** | Escorts you closely and kills anything hostile that comes near. The default. |
| **STAY** | Holds the spot you set. Watches distant threats, fights what comes to it, and does not chase. |
| **GUARD** | Owns the area around the post (12 blocks by default) and intercepts anything hostile that enters it. |
| **PASSIVE** | Escorts you but never starts a fight. Still defends itself if attacked. |
| **AGGRESSIVE** | Ranges further ahead, spots threats out to 20 blocks and intercepts before they reach you. |

The mode is always visible in the name over their head, e.g. `Kane [Iron] | FOLLOW`.

The squad panel can set every bodyguard's mode at once, recall the whole detail, and
shows each one's health, mode and distance.

### The rest of the panel

* **Equipment** — hand over the item you are holding, or take everything back.
* **Rename** — give them any codename you like.
* **Come Here** — pull them to you.
* **Dismiss** — retire them; their gear comes back to you.

---

## Gear

Bodyguards use **real vanilla equipment**, rendered through the game's own attachable
system — not a painted-on approximation.

* **Weapons** — swords, axes and tridents add damage on top of the tier damage.
* **Armour** — any vanilla armour set. Armour points decide the **gear tier**, which
  changes health, damage, knockback resistance, movement speed *and* the uniform they
  wear.
* **Shields** — go in the off hand.
* **Bows and crossbows** — a bodyguard with a bow in its off hand draws it when a fight
  stalls out of reach, and holsters it again when things close in. Put a bow in its main
  hand instead and you have a dedicated marksman.

| Tier | Armour points | Health | Attack | Knockback resist |
| --- | --- | --- | --- | --- |
| Recruit | 0 | 40 | 5 | 0.20 |
| Leather | 1–6 | 52 | 6 | 0.32 |
| Iron | 7–12 | 68 | 8 | 0.48 |
| Diamond | 13–18 | 84 | 10 | 0.64 |
| Netherite | 19+ | 104 | 12 | 0.80 |

A tier change keeps the current health *fraction*, so upgrading never full-heals and
downgrading never kills.

---

## Combat

Target priority, highest first:

1. Whatever just hurt you
2. Whatever you are attacking
3. **Creepers** — killed and punted before they reach you
4. **Ranged attackers** — skeletons, strays, bogged, pillagers, witches, blazes, ghasts, breezes, shulkers
5. **Heavy hitters** — ravagers, vindicators, evokers, piglin brutes, hoglins, zoglins, wither skeletons, vexes, wardens
6. Everything else hostile

Never targeted: players, other bodyguards, villagers, iron and snow golems, wandering
traders, and neutral mobs that have not been provoked (endermen, zombified piglins,
pacified piglins). Those are handled by retaliation instead, so your bodyguard does not
start fights with things that were minding their own business.

On top of the native melee:

* **Combos** — consecutive hits on the same target escalate; the third lands a finisher
  with extra damage, a heavier shove and a shockwave.
* **Criticals** — chance scales with gear tier; adds damage, particles and a sharp hit sound.
* **Guard Breaker** — when two or more hostiles crowd it and the 14 s cooldown is up, it
  winds up and slams the ground for area damage and a hard knockback.
* **Raised guard** — below 38% health it braces, gaining Resistance II for a moment.
* **Dodging** — a heavy hit makes it step sideways out of the arc.
* **Sprinting** — it runs, not walks, whenever it has a target.
* **Victory** — after a fight it kills, it takes a beat to sheathe and salute.

Out of combat it regenerates about 20 health per minute, starting 8 seconds after the
last hit.

---

## Never turns on you

Four independent layers, because "my pet killed me" is the worst possible bug:

1. Target-selection filters exclude the `player` family entirely.
2. `attack_owner` and `hurt_owner` are explicitly `false`, so neither auto-targeting nor
   retaliation can pick the owner.
3. A `damage_sensor` with an `is_owner` filter means the owner's hits do it no damage —
   you cannot accidentally kill your own bodyguard either.
4. If a hit on the owner somehow lands anyway, the script heals it straight back.

---

## Multiplayer

Ownership is set by the engine at the moment of hiring, through `minecraft:tameable`.
That is what makes `follow_owner`, `owner_hurt_by_target` and `owner_hurt_target` bind to
the right player — it is not a guess.

The script records the same player independently, resolving in order: who summoned the
recruit, who used a gold ingot next to it, then who is nearest and facing it. The durable
key is the player name, so ownership survives rejoining and world reloads.

Only the owner can open the command panel. Anyone else is told whose bodyguard it is.

---

## Performance on phones

* One 5 Hz interval. Each bodyguard is updated on a fixed **2 Hz** schedule regardless of
  how many exist, with a hard ceiling of four updates per run — a crowd updates less
  often rather than costing more.
* The registry is maintained by spawn/load/remove events. A full re-scan runs once every
  10 seconds and only in dimensions that contain players.
* No entity search runs on a timer. Searches happen only on a landed hit, on a special
  attack, or during that 10 second reconcile.
* All targeting, pathfinding and melee are native AI goals, which are far cheaper than
  any script equivalent and are what make the movement look natural.
* `minecraft:conditional_bandwidth_optimization` is set, so distant bodyguards cost less
  network traffic.
* Particles are short one-shot bursts of 6–26 particles. No looping emitters, no helper
  entities, nothing to clean up.

`tools/test_scripts.mjs` asserts the idle search budget, so a regression here fails the
build rather than someone's frame rate.

---

## Genuine Bedrock 1.21.0 limitations

These are real constraints of the target version, not things left undone.

* **Hiring needs a second tap.** `@minecraft/server` 1.11.0 has no
  `EntityTameableComponent`, so a script cannot set an entity's engine-level owner. The
  only way to establish it is a real tame interaction. Skipping that would mean giving up
  `follow_owner`, `owner_hurt_by_target`, `owner_hurt_target`, the `is_owner` damage
  filter and reliable multiplayer ownership — a much worse trade than one extra tap.
* **Hiring consumes a gold ingot.** `minecraft:tameable` always consumes the tame item.
  This is why the tame item is gold and not the Contract.
* **No custom audio.** Shipping new sounds means shipping `.ogg` files. Every sound here
  is an existing Bedrock sound event chosen to fit, referenced by name — so nothing can
  be missing on any device, and the pack stays under 45 KB.
* **A script cannot read or set a mob's current target.** All targeting is data-driven.
  The script influences fights by marking combat, granting Speed, pulling a straggler
  back, and toggling the ranged goal — not by pointing the mob at an entity.
* **A script cannot make a mob walk somewhere.** There is no navigation API in 1.11.0.
  Long-range repositioning is therefore a teleport, used only when the engine has already
  failed: 38 blocks away, a different dimension, or genuinely stuck.
* **`query.is_sitting` cannot be set from a script**, so the STAY "at ease" posture is
  driven by `mark_variant` instead of the sittable component.
* **Armour hides the uniform's flair.** Vanilla armour attachables render over the model,
  so the pauldrons, visor and cap scale away when the matching armour piece is worn. That
  is correct behaviour, not clipping.
* **Enchantments are preserved only on the API path.** If `setEquipment` is unavailable on
  a device, the fallback is `/replaceitem`, which can only place a plain item.
* **`query.state_time` is experimental in 1.21.0** and is not used anywhere, so the
  animation controllers work with experiments off.

---

## Files

```
behavior_packs/bodyguard_bp/
  manifest.json                 min_engine_version 1.21.0, server 1.11.0, server-ui 1.1.0
  entities/bodyguard.json       16 component groups, 22 events
  items/contract.json           bg:contract
  recipes/contract.json
  scripts/main.js               ownership, modes, UI, combat, recovery, gear
  texts/
resource_packs/bodyguard_rp/
  manifest.json
  entity/bodyguard.entity.json  attachables enabled, custom spawn egg
  models/entity/bodyguard.geo.json
  animations/bodyguard.animation.json            15 animations
  animation_controllers/…                        3 controllers
  render_controllers/…
  particles/                    oath_seal, guard_slam, alert_ping
  sounds.json
  textures/entity/bodyguard/    5 gear-tier skins
  textures/items/               contract + spawn egg icons
  texts/
```

## Rebuilding

```bash
python3 tools/gen_entity.py           # regenerate the entity definition
python3 tools/gen_bodyguard_art.py    # redraw every texture (--preview for ASCII)
python3 tools/preview_model.py        # render the model to dist/ for art review
python3 tools/build.py                # validate + package both add-ons
node    tools/test_scripts.mjs        # run the pack scripts against a mock 1.21.0 API

python3 tools/fetch_reference.py                            # optional, once
BEDROCK_REFERENCE=.bedrock-reference python3 tools/build.py  # adds sound-id checks
BEDROCK_REFERENCE=.bedrock-reference python3 tools/verify_bedrock.py
```

## Tuning

Every number lives in the `CONFIG` object at the top of
`behavior_packs/bodyguard_bp/scripts/main.js` (combat, regeneration, leashes, caps) and
in the tables at the top of `tools/gen_entity.py` (tier stats, threat ladder, mode
loadouts). Edit, re-run `tools/gen_entity.py` if you touched the entity, then
`tools/build.py`.
