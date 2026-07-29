# Lithos — hero section

Full-screen, dark hero for the Lithos geology brand. Built with React 18 + TypeScript +
Vite + Tailwind CSS, with icons from `lucide-react`.

The signature feature is a **cursor-following spotlight**: a second image is revealed
through a soft circular mask laid over the base image. The mask is a radial gradient
painted onto an offscreen canvas, exported with `toDataURL()` and applied as the reveal
layer's `mask-image`. The cursor position is eased toward the raw pointer at `0.1` per
animation frame, so the spotlight trails the mouse instead of snapping to it.

## Running it

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
npm run preview  # serve the production build
```

## Layout

| File | Contents |
| --- | --- |
| `src/App.tsx` | Root wrapper |
| `src/components/Hero.tsx` | Section, image layers, headline, copy blocks, pointer smoothing |
| `src/components/RevealLayer.tsx` | Canvas-driven spotlight mask (`SPOTLIGHT_R = 260`) |
| `src/components/Navigation.tsx` | Fixed nav — logo, centre pill, Sign Up, mobile hamburger |
| `src/index.css` | Font imports, Tailwind layers, on-load animation keyframes |

Load animations (`hero-reveal`, `hero-fade`, `hero-zoom`) are staggered by inline
`animationDelay` and are disabled entirely under `prefers-reduced-motion: reduce`.
The section uses `100dvh` so mobile browser chrome doesn't clip it.
