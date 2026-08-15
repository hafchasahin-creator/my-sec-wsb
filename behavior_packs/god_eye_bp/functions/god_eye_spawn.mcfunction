# /function god_eye_spawn
#
# Calls a God Eye and bonds it to whoever ran the command. The behaviour
# script watches for this tag, does the summoning and the bonding, then
# clears the tag again - that way the eye always knows its owner, which a
# bare /summon cannot guarantee.
tag @s add ge_cmd_spawn
