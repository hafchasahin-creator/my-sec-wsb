# ASKOR ALI — *Chapriya Gondho Futkiya*

A 30 second procedurally generated documentary about a professor of everything.

| file | what it is |
| --- | --- |
| `askor-ali-documentary.html` | the whole film in one self-contained HTML file — no assets, no libraries |
| `askor-ali-documentary.mp4` | the rendered film, 1280×720, 30 fps, H.264 + AAC |
| `tools/render-mp4.mjs` | offline renderer that produced the MP4 |

## Watching it

Open `askor-ali-documentary.html` in a browser and press **Play 30s**. Every frame is
drawn on a canvas at runtime and the score is synthesised with WebAudio, so the file
is fully offline.

## Getting an MP4 out of the page

Press **Record MP4**. The page captures the canvas plus the score with `MediaRecorder`
and downloads the result — `.mp4` in browsers that support MP4 recording (recent
Chrome, Safari), `.webm` otherwise. This is a real-time capture, so it takes 30 seconds.

## Re-rendering offline (deterministic, higher quality)

`renderAt(t)` is a pure function of time, exposed as `window.__doc.renderAt`, so the
film can be stepped frame by frame in a headless browser instead of recorded live.

```sh
npm i playwright                       # needs a chromium build
FFMPEG=/path/to/ffmpeg node tools/render-mp4.mjs [out.mp4]
```

The script steps all 900 frames, pipes them into ffmpeg (`libx264`, CRF 17), and muxes
them with a WAV score synthesised in Node that mirrors the in-page WebAudio one — same
chords, same heartbeat, same impacts on the cuts. Needs an ffmpeg with `libx264` and
`aac`; `pip install imageio-ffmpeg` provides one if the system ffmpeg is minimal.

## Cut list

| in | scene |
| --- | --- |
| 00:00 | cold open — "This is a true story." |
| 00:04 | main title |
| 00:10 | the chalkboard |
| 00:15 | the lecture hall, with statistics |
| 00:21 | the man himself |
| 00:26 | end card |

Cuts at 4.2 s, 9.6 s, 15.4 s, 21.0 s and 26.0 s are shared by the picture and the score,
so the impacts land on the splices.
