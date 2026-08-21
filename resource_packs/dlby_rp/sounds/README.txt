SOUND DESIGN - DON'T LOOK BEHIND YOU
====================================

This pack ships no .ogg files. Every cue you hear is built in script, by
layering vanilla sound EVENTS at custom pitch and volume - see the SFX table at
the top of behavior_packs/dlby_bp/scripts/main.js.

Why it was done this way
------------------------
Referencing sound events by name (rather than shipping audio, or pointing
sound_definitions.json at vanilla file paths) means nothing can silently fail to
resolve on a phone, and the whole addon stays a few kilobytes. Event names are
also far more stable across Bedrock versions than the underlying file paths.

For example, the attack is three events stacked in one frame:

    mob.endermen.scream   pitch 0.55   volume 1.00
    mob.wither.spawn      pitch 0.45   volume 0.55
    random.breath         pitch 0.30   volume 1.00

...which is not a sound that exists anywhere in vanilla.

Dropping in your own recordings
-------------------------------
1. Put your .ogg files in this folder, e.g.
       sounds/dlby/breath_close.ogg
       sounds/dlby/attack.ogg

2. Create resource_packs/dlby_rp/sounds/sound_definitions.json:

   {
     "format_version": "1.14.0",
     "sound_definitions": {
       "dlby.breath_close": {
         "category": "hostile",
         "sounds": [{ "name": "sounds/dlby/breath_close", "stream": false }]
       },
       "dlby.attack": {
         "category": "hostile",
         "sounds": [{ "name": "sounds/dlby/attack", "stream": false }]
       }
     }
   }

3. Change only the event names in the SFX table in main.js, e.g.

       breathClose: [["dlby.breath_close", 1.0, 0.9]],
       attack:      [["dlby.attack", 1.0, 1.0]],

Nothing else needs to change. Use mono .ogg - Bedrock will not position a
stereo file in 3D space, and the whole point is hearing it behind you.
