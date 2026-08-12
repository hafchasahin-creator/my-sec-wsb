# Clear vanilla effects plus the add-on's own status tracks
effect @s clear
scriptevent fungi:cure
tellraw @s {"rawtext":[{"text":"\u00a7a[Fungi] \u00a77Effects, contamination and infection cleared."}]}
