# Testing aid: tags nearby World Eaters so the script grants them growth.
# The script consumes and clears this tag on its next scheduler pass.
# Usage:  /function we/grow
tag @e[type=we:world_eater,r=64] add we_force_grow
