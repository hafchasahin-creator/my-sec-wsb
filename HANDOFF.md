# Handoff: Imran Mind website — Grok Bot redesign

## The project
A single-file marketing website for **Imran Mind**, a (fictional) AI developer-tools
brand. Dark, futuristic, premium. Everything — HTML, CSS, JavaScript, and the brand
logo as an embedded WebP data URI — lives in one file.

- Repo: `hafchasahin-creator/my-sec-wsb`
- Branch: `claude/modern-website-hero-tz37xm`
- File: `index.html` (~250KB, self-contained; only external request is Google Fonts)

## Already built — please do not rebuild or redesign these
Hero with the headline "Ship software at the speed of thought", a product window whose
side rail is a real tablist, feature sections (AI coding, agents, automation, testing),
a tools grid, pricing with a working monthly/yearly toggle, an FAQ accordion, a sign-up
dialog with email validation and focus trapping, a toast, scrollspy, back-to-top, and a
footer. Plus a two-slide **model carousel**: a Claude card and a Grok Bot banner.

## What I want changed
**Only the Grok Bot character.** Make it look better and closer to the reference image
I'm attaching. Nothing else on the page should change.

### Where the bot lives
- **Markup**: `<div class="gk__botwrap">` inside `<article class="gk" id="grokCard">`.
  It holds an inline `<svg class="gk__bot" viewBox="0 0 240 250">` containing
  `<g class="gk__shadow">` (floor), `<g class="gk__trails">` (tapered colour streaks),
  `<g class="gk__orb">` (body, rim lights, specular), and
  `<g class="gk__eyes"><g class="gk__saccade">` with two `<rect class="gk__eye">`.
- **Second copy**: a simplified `.gk__bot--sm` inside `<span class="gk__mark">` in the
  banner's left column. Keep both variants looking like the same character.
- **CSS**: the `/* --- the bot --- */` block, plus keyframes `gkFloat`, `gkBlink`,
  `gkTrail`, `gkLook`, `gkBreathe`.
- **JS**: sets `--ex` / `--ey` (px, magnitude up to ~15) on
  `#grokCard .gk__botwrap .gk__eyes` for pointer gaze. Tuned by `var reach = 15;`.

### Behaviour that must keep working
- `.gk.is-live` is toggled by an IntersectionObserver and gates **all** bot animation.
- `.gk.in` drives the entrance (scale + fade of `.gk__botwrap`).
- Pointer gaze via `--ex` / `--ey` as above.
- `@media(hover:none)` runs `gkLook` so touch devices get an idle look-around.
- `@media (prefers-reduced-motion:reduce)` leaves the bot visible and static.
- No horizontal overflow at 320, 360, 390, 768, 1440 px.
- Stays inline in the one file. No external assets, no libraries, no base64 images.

### How to check your work
Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; launch Playwright
with `args=["--no-sandbox"]`. To reach the Grok slide: scroll `#models` into view, click
`#carNext`, then wait ~2.5s for the smooth scroll to settle.

The card is taller than a phone viewport, so use a tall viewport (e.g. 390x1250) and
screenshot with an explicit `clip` from `bounding_box()` — `locator.screenshot()`
mis-captures elements inside the horizontal scroll container.

**Actually look at the screenshots** and iterate until the character reads well. Judge
proportions, weight, and how it sits in space, not just whether it renders.

## Note on branding
The Claude and Grok Bot banners present those products as integrations. The names and
marks belong to Anthropic and xAI respectively, so this would need their permission
before any commercial use.
