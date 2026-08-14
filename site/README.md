# Profile page

A recreation of the crax.lol profile page as a self-contained page: full-screen
black-and-white artwork, a dark glass profile card, social icons, a working
music player and a floating volume / effects panel.

## Files

| File | What it is |
| --- | --- |
| `index.html` | **The standalone build.** Every asset (background, avatar, font, cover, song) is inlined as a data URI, so this single file works on its own — open it straight from the filesystem, no server, no network. ~13 MB. |
| `index-linked.html` | Same page, but loads the files from `assets/`. ~47 KB, much faster to load — use this one when hosting the folder. |
| `template.html` | The source both builds are generated from. **Edit this**, then rebuild. |
| `build.py` | Generates the two builds from `template.html` + `assets/`. |
| `assets/` | Background image, avatar, fonts, song and cover placeholder. |

**Fonts.** `Angel_wish.ttf` is the gothic username face. `mono.woff2` is
Liberation Mono (SIL OFL 1.1), subset to the glyphs this page renders — 6.8 KB.
It is metric-compatible with Courier New, so the body text keeps the reference's
exact widths on every device instead of whatever monospace a phone substitutes.

## Rebuilding

```sh
python3 build.py            # both builds
python3 build.py --linked   # just the small one
```

### Swapping the background

Drop a file into `assets/` named `background.mp4`, `.webm`, `.jpg` or `.png` and
rebuild — the build picks it up and the page renders a muted looping inline
video or a still to match. A video takes precedence over an image when both are
present, so to go back to the still just delete the clip.

Video is always streamed from `assets/` even in the inlined build; base64-ing
tens of megabytes of footage would make the single file unusable. So a video
background means shipping the `assets/` folder alongside the HTML.

## Configuration

Everything you would normally want to change sits in the `CONFIG` block at the
top of the `<script>` in `template.html`:

```js
const CONFIG = {
    theme: { accent, glow, beat, accentStatus },   // whole palette, see below
    badges: [ { icon, label, color } ],            // emblems beside the name
    ambient: { enabled, particles, bloom },        // drifting layer behind the card
    magneticIcons: true,                           // icons lean toward the cursor
    clickSpark: true,                              // burst when an icon is hit
    keyboard: true,                                // space / arrows / M
    ogImage: "", ogDescription: "",                // link embed
    favicon: "auto",                               // "auto" | "avatar"
    faviconPulse: false,                           // redraw the icon on the beat
    enterSubtitle: "",                             // second entry line
    username: "imran",
    pageTitle: "",              // browser tab; "" uses the username
    status: "dnd",              // any STATUS_MODES key, or a list to cycle
    statusText: "",             // "" uses the mode's own label
    statusInterval: 5000,       // ms per mode when status is a list
    discordUserId: "...",       // live presence via lanyard; "" disables it
    bio: [ ... ],               // one string, or several to cycle through
    profilePicture: ...,        // one source, or a list to pick from at random
    backgroundImage: ...,       // same, and .mp4 / .webm render as video
    viewCount: 1073,
    viewCountAPI: "",           // optional POST endpoint returning { count }
    discordURL / githubURL / telegramURL / robloxURL / youtubeURL / tiktokURL,
    playlist: [ { file, title, artist, cover } ],
    enterText: "click to enter",
    volume: 0.3,                // 0 - 1
    cardOpacity: 0.4,           // 0 - 1, the "eye" slider default
    loop: true,
    shuffle: false,             // start on a random track
    tilt: true
};
```

Notes:

- Setting a social URL to `""` hides that icon.
- `profilePicture`, `backgroundImage`, `playlist[].file` and `playlist[].cover`
  accept a URL, a relative path, or a data URI. In the generated builds the
  asset tokens are already filled in — change them there or in `template.html`
  and rebuild.
- **Album art:** the supplied MP3 has no embedded cover, so
  `assets/cover-placeholder.jpg` (a crop of the background) is used. Drop a real
  cover into `assets/`, point `playlist[0].cover` at it and rebuild.
- Add more objects to `playlist` and the previous / next buttons cycle through
  them. With a single track those buttons restart it.

## Palette

Three colours in `CONFIG.theme` re-theme the page. They are published as CSS
custom properties at boot, so every tinted rule resolves back to them:

| Value | Drives |
| --- | --- |
| `accent` | slider fill tint, spark bursts, status ring, badges, ambient bloom, `theme-color` |
| `glow` | card and avatar rim glow, slider fill and thumbs, mote colour |
| `beat` | the audio-reactive pulse on the card and avatar ring |

`accentStatus: true` makes the status dot use the accent instead of the status
mode's own colour.

## Badges

`CONFIG.badges` renders inline-SVG emblems beside the name, each with a hover
tooltip (a tap shows it on touch). Available `icon` keys: `verified`, `owner`,
`star`, `bolt`, `dev`, `music`. `color` is optional and defaults to the accent.

```js
badges: [
    { icon: "verified", label: "Verified" },
    { icon: "owner",    label: "Owner", color: "#f0b232" }
],
```

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | play / pause |
| `←` `→` | seek 5 seconds |
| `Shift` + `←` `→` | previous / next track |
| `M` | mute |

Keys are ignored while a slider or link has focus, so tabbing through the page
still behaves normally. Set `keyboard: false` to disable.

## Ambient layer

Drifting motes and two slow colour blooms sit between the artwork and the card,
fading up faintly with the beat. Everything animates transform and opacity only,
and the phone count is thinned to 60% of `particles`.

Two constraints shaped this, both worth keeping if you edit it:

- The blooms use a soft radial gradient with **no blur filter and no scaling**.
  A blurred layer that scales re-rasterises every frame; translation alone stays
  on the GPU.
- The beat is applied to the `#ambient` wrapper, **not inside the mote
  keyframes**. A custom property referenced inside a keyframe drops that
  animation off the compositor onto the main thread — doing it the obvious way
  cost more than half the frame rate.

## Background: clip and still

With `backgroundVideo` set, the two backdrops alternate:

```
clip plays ─▶ ends ─▶ still fades up over it ─▶ holds ─▶
clip restarts underneath ─▶ still fades away ─▶ repeat
```

`backgroundCycle` controls it: `photoHold` (ms the still stays) and `fade`
(cross-fade duration). Set `enabled: false` and the clip simply loops; clear
`backgroundVideo` and the still stays put.

The clip restarts *before* the still fades out, so the photo dissolves onto
moving footage rather than a frozen last frame.

If the clip fails to load or decode, the still is shown permanently — so the
page still looks right wherever the video can't play.

**Size note.** Video is inlined into the standalone build only while it stays
under 8 MB; past that it streams from `assets/` and the single file falls back
to the still. The bundled clip is 5.5 MB, so `index.html` is ~19.7 MB and fully
self-contained (measured at ~0.8s to first paint). Drop the clip to get back to
~12.6 MB.

## Status picker

Tapping the status opens a menu of `statusPicker.options`. Each mode animates
its dot differently:

| Mode | Dot |
| --- | --- |
| Do Not Disturb | sharp outward ping, red |
| Silent Mode | no ring; the dot dims and lifts in a slow breath, grey |
| Normal Mode | a calm swell with a soft halo, green |

Choosing Silent Mode also mutes the player and Normal Mode unmutes it
(`silentMutes: false` turns that off). A manual pick is final — live Discord
presence stops overwriting the status, which it would otherwise do on its next
poll. The picker is disabled automatically when `status` is a cycling list,
since the two would fight.

Keyboard: `Enter`/`Space` opens it, `↑`/`↓` walk the options, `Escape` closes.
While the menu is open the playback shortcuts stand down.

## Status modes

`status` takes any key from the `STATUS_MODES` table, each carrying its own dot
colour and wording, so switching your status is one word:

| Key | Shows | Key | Shows |
| --- | --- | --- | --- |
| `online` | Online · green | `gaming` | Gaming · green |
| `idle` | Idle · amber | `streaming` | Streaming · purple |
| `dnd` | Do Not Disturb · red | `away` | Away · amber |
| `offline` | Offline · grey, no glow | `sleeping` | Sleeping · indigo |
| `invisible` | Invisible · grey, no glow | `touchGrass` | Touching Grass · green |
| `busy` | Busy · red | `doNotPerceiveMe` | Do Not Perceive Me · violet |
| `focus` | Focus Mode · blurple | | |
| `working` | Working · cyan | | |

Add your own by putting a `label` and `color` in the table. `statusText`
overrides the wording for a single mode.

Give it a list and the status cycles, fading between modes every
`statusInterval`:

```js
status: ["dnd", "gaming", "sleeping"],
```

A cycling status turns live Discord presence off — the rotation is an explicit
choice, and the two would otherwise overwrite each other.

## Living like the real page

The live site does several things a static copy normally loses. These are
reproduced, and every one of them falls back cleanly when there is no network,
so the page is still complete opened straight off a phone.

| Feature | How it behaves |
| --- | --- |
| **Discord presence** | `discordUserId` polls lanyard.rest every 30s and drives the dot and label — including `Online · Playing X` and `Do Not Disturb · Listening to X by Y`, the same format the live site uses. Unreachable, blocked, or `""` → the configured `status` stays. |
| **Rotating artwork** | `profilePicture` and `backgroundImage` accept a list and pick one per load, the way the live site rotates its avatars and backgrounds. |
| **Video backgrounds** | An `.mp4` / `.webm` background renders as a muted looping inline video instead of an image. |
| **View counter** | `viewCountAPI` is POSTed on load and its `{ count }` replaces the number; otherwise `viewCount` is shown. |
| **Shuffle** | `shuffle: true` starts on a random track when the playlist has more than one. |
| **Tab identity** | Favicon is generated from the avatar, plus `og:` / `twitter:` tags so a shared link embeds properly. |
| **Lock screen** | Media Session metadata means the track shows on the phone's lock screen and notification shade. |

Presence and the counter are the only network calls the page ever makes, and both
are opt-out: set `discordUserId` and `viewCountAPI` to `""` for a page that
touches the network zero times.

## Behaviour

- A black **click to enter** screen is shown first. Tapping it fades the screen
  out, reveals the card and starts the song — playback begins inside that tap so
  browser autoplay rules are satisfied. If a browser still blocks it, the player
  simply stays paused with the play button showing.
- The player supports play / pause, seek (tap the bar to glide, or drag the
  thumb), previous / next, elapsed and total time, volume drag and mute.
- The eye slider controls the glass: background opacity and blur of all three
  panels, from fully transparent to solid.
- The card tilts slightly toward the pointer or finger; tilting is suspended
  while a slider is being dragged.

## Animation

At rest the page looks exactly like the reference — all of this is motion layered
on top.

- **Entry:** the prompt breathes, then scales away as the screen blurs out.
- **Reveal:** panels rise in sequence (card, player, controls), then the pieces
  inside the card follow — avatar, name, status, bio, the divider drawing outward
  from its centre, the six icons dropping in one after another, and the view
  counter rolling up to its number.
- **Ambient:** the artwork holds a 42s zoom and drifts behind the card as the
  pointer moves; a reflection sweeps across the glass every 11s; the icons float
  on staggered offsets.
- **Music reactive:** the avatar ring and card glow pulse with the low end of the
  track, the album art swells slightly on the beat, and an equaliser runs on the
  artwork — all of it stops when the track pauses.

Two notes on how this is built, because both are easy to break later:

- The beat comes from a Web Audio analyser, but one is only attached when the
  audio is provably same-origin (a data URI, or a same-origin URL over http/s).
  Chrome silences a `MediaElementSource` fed by an opaque resource — which is what
  a plain `file://` mp3 is — and that routing **cannot be undone**. So the
  `file://` linked build deliberately falls back to a time-based pulse rather than
  risk silent audio. See `canAnalyse()`.
- Glow intensity animates the *opacity* of a static shadow rather than the shadow
  itself, and pointer moves are coalesced into one update per frame. Doing it the
  obvious way costs roughly half the frame rate on a mid-range phone.

Everything heavy is disabled under `prefers-reduced-motion`.

No frameworks and no external requests — all icons are inline SVG.
