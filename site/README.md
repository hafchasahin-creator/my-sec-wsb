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
| `assets/` | Background image, avatar, gothic font, song and cover placeholder. |

## Rebuilding

```sh
python3 build.py            # both builds
python3 build.py --linked   # just the small one
```

## Configuration

Everything you would normally want to change sits in the `CONFIG` block at the
top of the `<script>` in `template.html`:

```js
const CONFIG = {
    username: "imran",
    status: "dnd",              // online | idle | dnd | offline
    statusText: "",             // "" uses the default label for `status`
    bio: [ ... ],               // one string, or several to cycle through
    profilePicture: ...,
    backgroundImage: ...,
    viewCount: 1073,
    discordURL / githubURL / telegramURL / robloxURL / youtubeURL / tiktokURL,
    playlist: [ { file, title, artist, cover } ],
    enterText: "click to enter",
    volume: 0.3,                // 0 - 1
    cardOpacity: 0.4,           // 0 - 1, the "eye" slider default
    loop: true,
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
