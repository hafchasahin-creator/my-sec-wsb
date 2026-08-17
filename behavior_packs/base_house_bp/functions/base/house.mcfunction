# ============================================================
#  Beautiful Base House  -  /function base/house
#  Builds an 11x9 cozy cottage next to you.
#  The house extends toward +X / +Z from where you stand,
#  with the front door 2 blocks away on the +Z side.
#  Needs cheats (Activate Cheats) enabled in world settings.
# ============================================================

# --- clear the building area (including roof space) ---
fill ~-1 ~0 ~1 ~11 ~7 ~11 air

# --- foundation and floor ---
fill ~0 ~-1 ~2 ~10 ~-1 ~10 cobblestone
fill ~1 ~-1 ~3 ~9 ~-1 ~9 spruce_planks

# --- front porch and path ---
fill ~2 ~-1 ~0 ~8 ~-1 ~1 cobblestone

# --- walls ---
fill ~0 ~0 ~2 ~10 ~3 ~2 oak_planks
fill ~0 ~0 ~10 ~10 ~3 ~10 oak_planks
fill ~0 ~0 ~3 ~0 ~3 ~9 oak_planks
fill ~10 ~0 ~3 ~10 ~3 ~9 oak_planks

# --- log corner pillars ---
fill ~0 ~0 ~2 ~0 ~3 ~2 oak_log
fill ~10 ~0 ~2 ~10 ~3 ~2 oak_log
fill ~0 ~0 ~10 ~0 ~3 ~10 oak_log
fill ~10 ~0 ~10 ~10 ~3 ~10 oak_log

# --- windows ---
fill ~2 ~1 ~2 ~3 ~2 ~2 glass_pane
fill ~7 ~1 ~2 ~8 ~2 ~2 glass_pane
fill ~2 ~1 ~10 ~3 ~2 ~10 glass_pane
fill ~7 ~1 ~10 ~8 ~2 ~10 glass_pane
fill ~0 ~1 ~4 ~0 ~2 ~5 glass_pane
fill ~0 ~1 ~7 ~0 ~2 ~8 glass_pane
fill ~10 ~1 ~4 ~10 ~2 ~5 glass_pane
fill ~10 ~1 ~7 ~10 ~2 ~8 glass_pane

# --- doorway and door ---
fill ~5 ~0 ~2 ~5 ~1 ~2 air
setblock ~5 ~0 ~2 wooden_door ["direction"=1]
setblock ~5 ~1 ~2 wooden_door ["direction"=1,"upper_block_bit"=true]

# --- stepped gable roof with 1-block overhang ---
fill ~-1 ~4 ~1 ~11 ~4 ~2 spruce_planks
fill ~-1 ~4 ~10 ~11 ~4 ~11 spruce_planks
fill ~-1 ~5 ~3 ~11 ~5 ~4 spruce_planks
fill ~-1 ~5 ~8 ~11 ~5 ~9 spruce_planks
fill ~-1 ~6 ~5 ~11 ~6 ~7 spruce_planks
fill ~-1 ~6 ~6 ~11 ~6 ~6 oak_log ["pillar_axis"="x"]

# --- gable end infill above the side walls ---
fill ~0 ~4 ~3 ~0 ~4 ~9 oak_planks
fill ~10 ~4 ~3 ~10 ~4 ~9 oak_planks
fill ~0 ~5 ~5 ~0 ~5 ~7 oak_planks
fill ~10 ~5 ~5 ~10 ~5 ~7 oak_planks

# --- interior: workshop corner ---
setblock ~1 ~0 ~9 crafting_table
setblock ~2 ~0 ~9 furnace
setblock ~3 ~0 ~9 smoker
setblock ~8 ~0 ~9 chest
setblock ~9 ~0 ~9 chest

# --- interior: reading corner ---
setblock ~1 ~0 ~3 bookshelf
setblock ~2 ~0 ~3 bookshelf
setblock ~9 ~0 ~3 bookshelf
setblock ~1 ~1 ~3 torch
setblock ~9 ~1 ~3 torch

# --- lighting ---
setblock ~5 ~5 ~6 lantern ["hanging"=true]
setblock ~2 ~1 ~9 torch
setblock ~8 ~1 ~9 torch

# --- exterior lantern posts by the door ---
setblock ~3 ~0 ~1 cobblestone_wall
setblock ~7 ~0 ~1 cobblestone_wall
setblock ~3 ~1 ~1 lantern
setblock ~7 ~1 ~1 lantern

# --- done! ---
tellraw @s {"rawtext":[{"text":"§a✔ Your base house is ready! §eWalk around to the +Z side to find the front door."}]}
