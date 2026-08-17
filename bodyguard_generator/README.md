# Bodyguard Companion — MCAddon Generator

`bodyguard_mcaddon_generator.html` is a single self-contained page (no internet needed,
no libraries) with one big **Generate Bodyguard MCAddon** button. Each tap builds a
complete Bedrock addon in the browser — behavior pack + resource pack with fresh UUIDs —
and downloads it as `Bodyguard_Companion.mcaddon`.

A prebuilt copy is committed at `../dist/BodyguardCompanion.mcaddon`.

Targets **Bedrock 1.21.0.26 beta** (min engine 1.20.60), stable formats only —
no Experiments toggle required.

## The bodyguard (`bgc:bodyguard`)

- Custom spawn egg (navy/gold) in the Creative spawn-egg section, or
  `/give @s bgc:bodyguard_spawn_egg` / `/summon bgc:bodyguard`
- **Bond it with one tap** while holding any food, emerald, iron/gold ingot, diamond,
  stick or bone (it walks toward you when you hold one — vanilla Bedrock cannot assign
  an owner at spawn without experimental scripting, so bonding is a single tame-tap)
- After bonding: follows its owner, engine-teleports to them when far or stuck,
  attacks whatever damages the owner or whatever the owner attacks, hunts hostile
  mobs (family `monster`) on sight within 20 blocks, and never targets players
- 300 HP, 12 attack damage, 0.85 knockback resistance, immune to fall damage,
  persistent (never despawns), leashable, heal by feeding food
- Boss-bar style health indicator while bonded
- Custom humanoid knight model with modeled sword; head-tracking, idle, walk,
  attack and hurt animations; iron-golem sound set

## Layout of the generated .mcaddon

Plain pack folders inside a single STORE-mode zip (no nested zips), which Minecraft
imports directly:

```
Bodyguard_BP/  manifest.json, pack_icon.png, entities/bodyguard.json
Bodyguard_RP/  manifest.json, pack_icon.png, entity/, models/entity/,
               animations/, render_controllers/, textures/entity/, sounds.json, texts/
```

The behavior pack declares the resource pack as a dependency, so activating the
behavior pack on a world pulls the resource pack in automatically.
