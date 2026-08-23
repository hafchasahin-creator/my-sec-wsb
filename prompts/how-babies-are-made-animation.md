You are a senior interactive-explainer developer and science illustrator building a single-file educational web page.

## Deliverable

Produce **one self-contained `.html` file** — an animated, step-through explainer titled something like *"How Babies Are Made"* covering human reproduction from sex cells to birth. All CSS and JS inline. No build step, no CDN, no external assets, no image files. It must work by double-clicking the file offline.

## Audience & tone

- **Default audience: ages 10–14** (upper primary / middle school), the register of a good science textbook or a museum exhibit.
- Anatomically accurate, correct terminology throughout: sperm, egg/ovum, ovary, fallopian tube, uterus, penis, vagina, sexual intercourse, fertilisation, zygote, blastocyst, embryo, fetus, placenta, umbilical cord, labour.
- Warm and matter-of-fact. Never coy, never giggly, never titillating. No euphemisms ("special hug"), no innuendo.
- **All art is schematic/cross-sectional line-art in biology-textbook style.** No nudity, no photorealistic bodies, no explicit or erotic depiction. Diagrams show structures, not people.
- State plainly that intercourse is *one* way conception happens; briefly cover IVF/assisted reproduction. Add a short, non-preachy note that families are formed in many ways — adoption, surrogacy, donors — so no reader feels excluded. Be inclusive of different bodies and family structures in wording (e.g. "people with a uterus" used naturally alongside standard terms) **without turning into a lecture** — one or two sentences, then back to the science.

## Content spine (in this order)

1. **Body basics** — labelled cross-sections of the male and female reproductive systems, side by side.
2. **Sex cells** — how sperm and eggs are made; how they differ in size, number, and lifespan; 23 + 23 = 46 chromosomes.
3. **The menstrual cycle & ovulation, briefly** — why timing matters.
4. **How sperm meet egg** — intercourse described plainly and non-graphically (semen enters the vagina, sperm travel through the cervix); IVF shown as an alternative path.
5. **The journey** — ~300 million sperm, the swim through the uterus into the fallopian tube, only one fuses with the egg, zona pellucida hardens to block the rest.
6. **Fertilisation** — two haploid cells become one zygote; DNA combines; sex determination via X/Y; identical vs fraternal twins as a side note.
7. **Cleavage & implantation** — zygote → morula → blastocyst → burrowing into the uterine lining around day 6–10.
8. **Development timeline** — weeks 1–40 with real milestones: heart beating ~week 6, all organs formed by ~week 12, movement felt ~weeks 18–20, viability ~week 24, full term 37–40 — with an accurate size comparison at every stage.
9. **Life support** — placenta, umbilical cord, amniotic sac and what each does.
10. **Birth** — stages of labour, contractions, baby turning head-down, delivery, cutting the cord; one line on C-sections.
11. **"Questions kids actually ask"** short FAQ, plus a **glossary**.

## Animation & interaction spec

This is the point of the page — be ambitious and concrete.

- **Swimming sperm**: canvas or SVG, sinusoidal tail motion, per-sperm randomised paths, speeds and phase offsets.
- **Fertilisation**: a fusion flash and a visible zona reaction rippling outward, remaining sperm turned away.
- **Cell division**: one circle splits into 2 → 4 → 8 → 16, with easing.
- **Implantation**: blastocyst nestling into a textured uterine wall.
- **Fetal growth**: an illustration that morphs and grows through the trimesters with a live real-scale size readout (mm/cm and inches).
- **Birth sequence**: rotation to head-down, descent, delivery.
- **Navigation**: a sticky progress rail / chapter nav showing current section.
- **Scroll-triggered reveals** via `IntersectionObserver`.
- **Scrubbable week slider (1–40)** driving the fetus illustration, size, weight and milestone text live.
- **Hover/tap labels** on every anatomical structure.
- **Play/pause + replay** on each animation.
- Animate with `requestAnimationFrame` and CSS transforms; **transform and opacity only** for 60fps; no layout thrashing. Pause/teardown animations when off-screen.
- Full **`prefers-reduced-motion`** support: swap motion for static, clearly labelled end states.

## Technical constraints

- Single `.html` file, vanilla HTML/CSS/JS. Inline SVG and/or `<canvas>` for all art — no images, no emoji as illustration, system font stack only.
- Responsive from 360px phone to wide desktop.
- Keyboard accessible with visible focus rings; slider operable by arrow keys.
- Semantic landmarks (`header`, `nav`, `main`, `section`, `footer`), headings in order, ARIA labels / `<title>` + `<desc>` on diagrams, `aria-live` on the week readout.
- `prefers-color-scheme`-aware palette (light and dark).
- No console errors. Keep file size reasonable.

## Visual direction

Calm, modern science-museum aesthetic. Generous whitespace. One warm accent colour against muted anatomical tones (soft corals, dusty rose, warm greys, a cool teal for fluids/motion). Rounded geometric sans typography, clear hierarchy, comfortable line length. Subtle depth — soft borders and low-contrast fills rather than heavy drop shadows. Illustration style strictly consistent across every diagram: same stroke weight, same corner treatment, same label style. **Avoid clip-art cuteness and avoid clinical coldness.**

## Factual bar

Use accurate figures: ~300 million sperm per ejaculation; egg ≈0.1 mm and the largest human cell; sperm ≈0.05 mm; fertilisation in the ampulla of the fallopian tube; implantation day ~6–10; 40 weeks from LMP / ~38 from conception; typical birth weight ~5.5–8.8 lb (2.5–4 kg).

Avoid these common myths:
- The "race" framing where the fastest sperm wins — entry is not a simple sprint.
- Sperm as purely active and egg as purely passive — say explicitly that the egg and the female reproductive tract actively participate (tract contractions and currents move sperm, the egg's surface binds and draws the sperm in).

## Output contract

- Output the **complete file**, top to bottom. No placeholders, no `// rest of the animation here`, no truncation, no "add your own SVG".
- Before finishing, self-check: (1) every section above present, (2) every named animation implemented and running, (3) week slider drives the illustration and stats, (4) reduced-motion path works, (5) keyboard reachable, (6) dark mode legible, (7) no external references anywhere in the file, (8) no console errors.

## Adjustable knobs

- **Audience age** — default 10–14; shift wording up or down.
- **Language** — default English; translate all copy and labels.
- **Depth** — overview vs. full detail (meiosis, hormones, trimester specifics).
- **Colour palette / accent** — swap the warm accent and anatomical tones.
- **Intercourse section** — include, soften, or omit entirely for younger audiences (keep "a sperm from one parent's body reaches an egg in the other's").
- **Structure** — one long scrolling page vs. chaptered step-through with next/back buttons.
