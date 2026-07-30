# Claude Opus 5 — stone plate

A rebuild of the "Claude Fable 5" plate with the wordmark reading **Claude Opus**
and the numeral built from stones instead of butterflies.

| file | what it is |
| --- | --- |
| `claude-opus-5.html` | the piece itself — self-contained, animated; click once for sound |
| `claude-opus-5.mp4` | 24s H.264/AAC render: the 5 assembling, then the colour washing in |
| `claude-opus-5.png` | still frame at full wing colour, 2048x1214 |

Everything is generated at runtime, no external assets: the font and the original
asterisk mark are embedded, and the stones, their granite texture, the shimmer and
every sound are synthesised in the page.

## How the numeral is made

The digit is rasterised to a mask, distance-transformed, then packed with pebbles —
thick parts of the stroke take big stones, tips take small ones. `GAP` in
`packStones()` is the one knob worth turning: it is centre-to-centre spacing as a
multiple of stone radius, so values above 1 leave cream showing between every
stone. Raise it for fewer, further-apart stones; drop it toward 1 to close up.

Stones arrive in pen order along `STROKE` (right end of the top bar, left along it,
down the stem, round the bowl, out to the tail), so the 5 writes itself in granite.
Once the last stone lands, butterfly-wing colour — sampled from the original plate —
washes in and drifts diagonally across the numeral on a 22.5s loop, locked so the
colour drift, the rocking and the breathing all close the loop together.

## Sound

Synthesised in the page, nothing sampled: one clack per stone as it lands, pitched
and panned by that stone's size and position; a low drone under the whole thing;
filtered air rising through the formation; then a pad swell and soft bells over the
shimmer.

## Rebuilding the video

Recorded from the page with Chromium's MediaRecorder (canvas video track plus the
Web Audio destination), then transcoded to H.264/AAC.
