# Clawd video edit

Compositor that adds a dancing Clawd, titling and cinematic polish to the Y2K
lyric-meme clip, without disturbing the original footage or its art style.

## Output

`dist/clawd_dance_opus5.mp4` — 1704x1436 (2x the 852x718 source), 30 fps,
H.264 CRF 16, original audio preserved.

## What gets added

| Element | Treatment |
| --- | --- |
| **Clawd** | The supplied artwork rebuilt as a clean 12x8 pixel sprite, then animated: beat-locked hop, squash/stretch, body tilt, alternating arm raises and a 4-step leg cycle. Rendered with a 3-sample shutter for real motion blur, a contact shadow that tightens as it lands, a cast shadow for separation, a soft reflection and a coral rim glow. |
| **"Claude Opus 5"** | Neon tubing — hot white filament inside a magenta tube with a layered magenta/cyan halo. A small always-on bug sits top-left; the outro gets the full framed sign with rounded tube border and mounting stems, flickering as it warms up then breathing on the beat. |
| **"IMRAN"** | Chunky pixel type set in the background plane at 30% opacity, light fill inside a dark outline so it holds up over both the white pastel outro and the night-sky scenes. Drifts on a slow parallax with a shimmer sweeping across it. |
| **"imran cute"** | Handwritten (Caveat) watermark, bottom-right, soft drop shadow, deliberately small. |
| **Polish** | Saturation/contrast grade, threshold bloom, four-point Y2K sparkles and drifting pixel motes on a seeded system, soft diagonal light streaks, and a gentle vignette. |

Clawd's position is keyed to the clip's own scene cuts (`CHOREO`) so it never
lands on a lyric, and the additive light plate is held out of Clawd's
silhouette so the glow never bleaches the coral flat.

## Timing

Tempo was measured off the track's spectral-flux onset envelope: **152 BPM**,
first downbeat at **0.325 s**. Every hop, flicker and sparkle burst is derived
from that, so the animation stays locked to the music.

## Running it

```sh
pip install pillow numpy          # plus ffmpeg on PATH
python3 tools/clawd_video/render.py INPUT.mp4 OUTPUT.mp4

# preview window: [duration] [start], both in seconds
python3 tools/clawd_video/render.py INPUT.mp4 preview.mp4 1.0 34.5
```

Fonts (Caveat, Audiowide, Press Start 2P) are vendored under `fonts/` and are
all SIL Open Font License.
