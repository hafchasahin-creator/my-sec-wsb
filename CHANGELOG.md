# Changelog

## Bodyguard 2.1.0 - Firearms

Bodyguards now carry guns and shoot whoever attacks their owner.

* **Guard Sidearm** and **Guard Carbine**, both craftable, both real 3D models rendered in
  hand through the game's own attachable system rather than flat item sprites.
* Every bodyguard is issued a sidearm the moment it is hired. Guns need no ammunition.
* A new `bg:bullet` projectile: fast, near-flat trajectory, tracer, impact sparks and an
  impact sound.
* A **two-handed aiming stance** driven by `query.facing_target_to_range_attack`, so the
  weapon comes up as the shot is lined up and drops back to a low carry afterwards, plus a
  **recoil kick** on every round.
* A **gunshot assembled per shot** from layered firework and click events at weapon-specific
  volumes and pitches - Bedrock ships no gunfire sample, and shipping one would mean
  shipping audio files.
* **Muzzle flash** and **bullet impact** particles, both short one-shot bursts.
* The shooting AI re-arms itself from whatever is actually in the bodyguard's main hand, so
  it can never fire arrows out of a carbine, and a bodyguard holding a gun no longer does
  the melee bodyguard's bow-holster dance.
* Bullets that somehow reach the owner are refunded, closing the last friendly-fire gap.
* **Players can fire the guns too.** A player's shot is a hitscan raycast - it lands the
  instant you tap and stops at walls - with a visible item cooldown, durability wear and a
  weapon that breaks when it is spent.
* Tooling: `tools/gen_guns.py` generates the firearm models, textures and icons from one
  description so their UVs cannot drift; `tools/preview_pose.py` gained a `--gun` flag that
  binds an attachable into the hand, which is how the carbine was caught clipping through
  the ground when carried muzzle-down. The build now validates attachables end to end.
* 115 scripted behaviour checks, up from 94.

## Bodyguard 2.0.0

The bodyguard rebuilt as a full companion rather than a reskinned mob. Everything below
is verified against Bedrock **1.21.0** — components and fields checked against Mojang's
published 1.21.0 data, script APIs against the `@minecraft/server` **1.11.0** typings.

### Ownership and multiplayer

* Ownership is now established by the engine at the moment of hiring, through
  `minecraft:tameable`. That is what makes `follow_owner`, `owner_hurt_by_target`,
  `owner_hurt_target` and the `is_owner` damage filter bind to the right player instead
  of the nearest one.
* The script records the same owner independently, resolving in order: who summoned the
  recruit, who used a gold ingot beside it, then who is nearest and facing it. Player
  *name* is the durable key, so ownership survives rejoining and reloads.
* Only the owner can command a bodyguard. Anyone else is told whose it is.

### Modes

* Five modes as component groups: **FOLLOW**, **STAY**, **GUARD**, **PASSIVE**,
  **AGGRESSIVE**, each with its own follow distances, aggro radius, scan interval and
  movement goals.
* STAY and GUARD record a post. STAY's `hold_ground` outranks its melee goal, so distant
  targets are watched rather than chased; the script returns it to the post if a fight
  drags it away.
* The active mode is always visible in the name over its head.

### Commanding, on a phone

* A touch-friendly command panel built with `@minecraft/server-ui` 1.1.0: modes,
  equipment, rename, recall and dismiss.
* A squad panel for the whole detail: per-bodyguard health, mode and distance, plus
  recall-all and set-all-modes.
* Four ways in, all reachable with one thumb: long-press a bodyguard with anything in
  hand, long-press a block with the Contract to summon, sneak and long-press a block for
  the squad panel, or long-press empty air. The **Command** button
  `minecraft:interact` puts on screen does not depend on what you are holding, so it
  cannot be broken by a filter that turns out not to match a custom item id.
* Post settings for STAY and GUARD: move the post to where you stand, and set the guard
  radius between 4 and 32 blocks.
* Name tags work: whatever you write becomes the codename, and the mode badge rebuilds
  around it instead of fighting it.
* Each bodyguard keeps a tally of threats stopped.
* Each input path has its own de-duplication gate, so Bedrock delivering one press as
  several events cannot double-fire or cancel itself out.

### Combat

* Prioritised threat ladder — creepers, then ranged attackers, then heavy hitters, then
  everything else hostile — with per-entry distances, visibility rules and speed
  multipliers.
* Players, bodyguards, villagers, golems, wandering traders and unprovoked neutrals are
  never auto-targeted; they are handled by retaliation instead.
* Combos: consecutive hits on one target escalate, the third landing a finisher with
  extra damage, a heavier shove and a shockwave.
* Criticals scaling with gear tier, with particles and a distinct hit sound.
* **Guard Breaker**, a telegraphed area slam on a 14 second cooldown, used when two or
  more hostiles crowd it.
* Raised guard with Resistance II below 38% health; a sideways dodge on a heavy hit.
* Creepers are punted harder than anything else.
* Ranged response: a bow in the off hand is drawn when a fight stalls out of reach and
  holstered when things close in; a bow in the main hand makes a dedicated marksman.
* It sprints, rather than walks, whenever it has a target.
* Four independent guarantees that it can never damage its owner.

### Gear

* Real vanilla equipment rendered through the game's own attachable system — armour,
  held weapons and shields, not a painted-on approximation.
* Armour points determine a gear tier that changes health, damage, knockback resistance,
  movement speed and the uniform texture.
* A tier change preserves the current health fraction, so upgrades never full-heal and
  downgrades never kill.
* Gear is handed over and taken back through the panel, dropped on death, and returned on
  dismissal. Gear changed outside the panel is picked up within a few seconds.

### Reliability

* Teleport-back at 38 blocks, across dimensions, and on genuine pathing failure — and
  never while it is mid-fight.
* Pet-style navigation so it can follow across water; door opening; the engine's own
  `push_towards_closest_space` un-stick helper.
* `push_through` so it never shoves the owner, and `is_pushable` so it never becomes an
  immovable wall in a doorway.
* `follow_range` trimmed to 32 so it stops chasing what it cannot catch.
* Regenerates about 20 health per minute, starting 8 seconds after the last hit.
* Reacts when the owner goes down, and the escort regroups on them when they respawn —
  posted bodyguards keep their post.

### Look and feel

* Custom humanoid model built on the vanilla armour rig, so vanilla attachables line up
  exactly.
* Five gear-tier uniforms, drawn procedurally with the standard library only.
* Fifteen animations — idle, alert stance, at-ease, walk, run, two attack swings, the
  special slam, guard stance, hurt flinch, death collapse, victory salute, owner gaze,
  held-item pose and armour-layer masking — across three animation controllers.
* Three one-shot particles: the hiring oath seal, the Guard Breaker shockwave, an alert ping.
* Entity sounds mapped to existing Bedrock sound events, so nothing can be missing on any
  device.
* A shield pack icon, a charcoal-and-gold spawn egg, and a sealed-parchment Contract icon.

### Performance

* One 5 Hz interval; each bodyguard updated on a fixed 2 Hz schedule with a hard ceiling
  of four updates per run, so a crowd updates less often rather than costing more.
* Registry maintained by spawn/load/remove events; a full re-scan every 10 seconds, only
  in dimensions that contain players.
* No entity search on a timer. Searches happen only on a landed hit, on a special attack,
  or during that reconcile.
* No helper entities, no looping particle emitters, nothing to clean up.
* The idle search budget is asserted by the test suite.

### Tooling

* `tools/build.py` validates and packages both add-ons, with deep cross-reference checks
  across manifests, items, recipes, entities, models, animations, controllers, textures,
  sounds and scripts — including AI goal priority collisions, geometry UV coverage, and
  a per-file-type `format_version` table taken from Mojang's own 1.21.0 packs.
* `tools/verify_bedrock.py` checks every component and field against Mojang's published
  1.21.0 data; `tools/fetch_reference.py` downloads it.
* `tools/test_scripts.mjs` runs the pack scripts against a stand-in for the 1.21.0
  scripting API — 94 checks covering hiring, modes, posts, gear, combat, recovery,
  dimensions, death, respawn, multiplayer refusal, the performance budget, and that the
  update sweep reaches every bodyguard in a crowd.
* `tools/preview_model.py` renders the model to a PNG so the art can be reviewed without
  launching the game; `tools/preview_pose.py` goes further and rasterises a posed frame
  of any animation, which is how the shoulder pads were caught swinging round to the
  elbow during an attack.

---

## Arcane Arsenal 1.0.1

* Fixed invisible item icons: `minecraft:icon` needs the `{"textures": {"default": …}}`
  form at format_version 1.20.60 and above, and the game ignores the old flat field in
  silence. The build now rejects the old form.
* Verified the script module version against the one that ships with 1.21.0.

## Arcane Arsenal 1.0.0

* Six legendary weapons with scripted magic effects, recipes and hand-drawn icons.
