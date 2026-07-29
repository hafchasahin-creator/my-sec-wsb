# Mirinda campaign renderer

Procedural renderer for a 25-spot Mirinda animated ad campaign. Each spot runs
50 seconds; the full film is **20 minutes 50 seconds**.

    dist/ads/mirinda_campaign_20min.mp4   the full campaign
    dist/ads/mirinda_ep01_pour.mp4        a single 50-second spot

## Running it

    cd tools/adgen
    npm install
    node render.js --smoke        # 3-second pipeline check
    node render.js --ep 4         # one spot -> dist/ads/episodes/ep04.mp4
    node render.js --all          # every spot, then concatenate
    node render.js --preview 7 --at 33   # single frame to PNG

`--all --resume` skips spots that are already rendered, so a long render can be
picked up after an interruption.

## How it works

Frames are drawn headless with `@napi-rs/canvas` and pushed as raw RGBA straight
into `ffmpeg`'s stdin — no PNG round-trip and no temporary frame files, which is
what makes a 37,500-frame render practical. `ffmpeg` comes from
`@ffmpeg-installer/ffmpeg`, which ships the binary inside the npm tarball rather
than downloading it separately.

Every particle system is **stateless**: a particle's position is a pure function
of global time and its own seeded constants. Nothing accumulates between frames,
so any frame can be rendered in isolation and the output is byte-reproducible.

The soundtrack is synthesised from scratch in `src/audio.js` — drums, sub bass,
plucked arpeggio and pad, plus the ad SFX vocabulary (pour, fizz, whoosh, glass
chime, logo sting). Tempo, key, scale and instrument voicing are derived from the
episode index, so no two spots share a soundtrack.

## Layout

    src/brand.js          palette, MIRINDA wordmark, splash blob, end lockup
    src/audio.js          procedural soundtrack synthesis
    src/render.js         frame loop, ffmpeg muxing, concat, probing
    src/lib/              ease, rng, shapes, liquid, particles, text, camera, transitions
    src/episodes/ep01..25 one module per spot
    src/episodes/_kit.js  shared beat structure and closing lockup
    render.js             CLI

## Brand notes

The wordmark is drawn as **vector strokes**, not set in a typeface: no rounded
display font is installed, and stroking round-capped paths at three decreasing
widths gives the correct letterform weight plus exact control over the green fill
inside its white outline. Body copy uses Liberation Sans.

Colour references used for this campaign:

| Element | Value |
|---|---|
| Brand orange | `#F07C50`, tints `#F28962 → #F39673 → #F5A385 → #F6B096` |
| Wordmark green | `#0F8A3D` on white outline |
| Soda liquid | `#FF7A1A` core, `#FFB347` highlight, `#E85D04` shadow |

## Structure of a spot

All 25 share a four-beat structure, defined once in `src/episodes/_kit.js`:

| Beat | Time |
|---|---|
| Hook | 0–8s |
| Build | 8–30s |
| Product hero | 30–42s |
| Logo lockup | 42–50s |

Everything else — staging, palette, camera language, particle physics and
typography treatment — is authored per spot.
