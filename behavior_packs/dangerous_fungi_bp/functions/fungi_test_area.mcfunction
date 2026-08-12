# Flatten a 49x49 plot, floor it, and let the script place the exhibits
tellraw @s {"rawtext":[{"text":"\u00a7a[Fungi] \u00a77Building the testing field... stand still for a moment."}]}
fill ~-24 ~-1 ~-24 ~24 ~-1 ~24 minecraft:polished_andesite
fill ~-24 ~ ~-24 ~24 ~9 ~24 air
fill ~-25 ~ ~-25 ~25 ~9 ~-25 minecraft:glass hollow
scriptevent fungi:test_area
