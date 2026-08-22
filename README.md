# Bedrock Add-ons

Two Minecraft **Bedrock Edition** add-ons, both built and verified against **1.21.0** —
the release that ships as `1.21.0.26` on Android / Pocket Edition.

Neither needs an experimental toggle, and neither needs `/function` commands for normal
play.

| Add-on | What it adds | Download |
| --- | --- | --- |
| **[Bodyguard](docs/bodyguard.md)** | A companion that follows, protects and fights for you: five command modes, real gear progression, a touch-friendly command panel. | `dist/Bodyguard.mcaddon` |
| **[Arcane Arsenal](docs/arcane-arsenal.md)** | Six legendary weapons with scripted magic effects. | `dist/ArcaneArsenal.mcaddon` |

---

## Installing on Android

1. Download the `.mcaddon` onto the device.
2. Tap the file. Minecraft imports both packs automatically.
3. Create or edit a world → **Behavior Packs** → activate the add-on. The resource pack
   comes in as a dependency; if it does not, activate it under **Resource Packs** too.
4. Leave every experimental toggle **off**.

If tapping the file does not open Minecraft, rename it to `.zip` and copy the two inner
folders into:

```
Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs/
Android/data/com.mojang.minecraftpe/files/games/com.mojang/resource_packs/
```

On Windows the same folders live under
`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`.

To see what the game thinks is wrong with a pack, turn on
**Settings → Creator → Content Log GUI**.

---

## Building

```bash
python3 tools/build.py           # validate everything, write both .mcaddon files
node    tools/test_scripts.mjs   # run the Bodyguard scripts against a mock 1.21.0 API
```

Optional, and worth it — Mojang's own published 1.21.0 sample packs as ground truth:

```bash
python3 tools/fetch_reference.py
BEDROCK_REFERENCE=.bedrock-reference python3 tools/build.py
BEDROCK_REFERENCE=.bedrock-reference python3 tools/verify_bedrock.py
```

### What the build checks

The point of these checks is that Bedrock fails *quietly*. A mistyped texture key does
not error — the item just renders as nothing. A component that does not exist in 1.21.0
is skipped in silence. So the build refuses to package when:

* any JSON fails to parse, or a manifest UUID is reused anywhere in the repository
* a behaviour pack loses its resource-pack dependency, or the versions drift apart
* `min_engine_version` moves off `1.21.0`, or a script module version is not one that
  actually ships with 1.21.0
* a script imports a module the manifest does not declare
* an item icon does not resolve item → `item_texture.json` → a real PNG
* an item uses the pre-1.20.60 flat `minecraft:icon` form, which the game ignores silently
* a file uses a `format_version` its schema does not understand in 1.21.0 — the game
  silently falls back to a different parse rather than complaining
* a recipe produces an item that does not exist, or its pattern and key disagree
* a custom item or entity has no display name in `en_US.lang`
* a client entity references geometry, a texture, an animation, an animation controller
  or a render controller that is not defined
* an animation controller plays an animation the client entity does not map, or
  transitions to a state that does not exist
* a render controller references a `Texture.`/`Geometry.`/`Material.` the entity does not map
* a geometry bone has a missing parent, a UV box runs off the texture, or a visible cube
  face has transparent pixels behind it
* two AI goals that can be active at the same time share a priority
* a script triggers an entity event, or spawns a custom particle, that does not exist
* an entity event adds or removes a component group that does not exist
* *(with a reference tree)* a component, a component field, or a sound id does not exist
  in 1.21.0

`tools/test_scripts.mjs` goes further and actually runs the pack scripts against a
stand-in for the 1.21.0 scripting API, driving them through hiring, mode switching, gear,
combat, dimension changes, death and player departure — including a budget assertion on
how many entity searches run while idle.

---

## Layout

```
behavior_packs/     bodyguard_bp, arcane_arsenal_bp
resource_packs/     bodyguard_rp, arcane_arsenal_rp
docs/               per-add-on documentation
dist/               packaged .mcaddon files
tools/
  build.py                  validate + package everything
  verify_bedrock.py         check components/fields against Mojang's 1.21.0 data
  fetch_reference.py        download that data
  test_scripts.mjs          run the scripts against a mock 1.21.0 API
  mock/                     the stand-in @minecraft/server modules
  gen_entity.py             generate the bodyguard entity definition
  gen_bodyguard_art.py      draw every bodyguard texture
  gen_textures.py           draw every Arcane Arsenal icon
  preview_model.py          render the bodyguard model to a PNG
  preview_pose.py           render a frame of any animation, posed, to a PNG
```

Every texture in this repository is generated by a Python script using nothing but the
standard library, so the packs can be rebuilt anywhere with no image tooling installed.

See [CHANGELOG.md](CHANGELOG.md) for what changed and when.
