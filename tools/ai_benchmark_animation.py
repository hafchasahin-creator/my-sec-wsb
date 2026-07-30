"""Render an animated AI-model benchmark comparison to MP4.

Scene-based horizontal bar race: each scene is one benchmark, bars grow with a
staggered ease-out, values count up, then the scene cross-fades to the next.

Palette: dark-surface categorical slots (blue/yellow/magenta/green) validated
all-pairs for CVD separation, plus a neutral for pooled "Other" vendors.
Vendor colour is fixed per entity and never follows rank.

Usage: python3 tools/ai_benchmark_animation.py [output.mp4]
"""

import subprocess
import sys
from dataclasses import dataclass

import matplotlib
matplotlib.use("Agg")

import matplotlib.patches as mpatches
import numpy as np
from matplotlib.figure import Figure
from matplotlib.path import Path

# ---------------------------------------------------------------- appearance

W, H, DPI, FPS = 1920, 1080, 100, 30

SURFACE = "#141414"
INK = "#ffffff"
INK_2 = "#c3c2b7"
MUTED = "#898781"
GRID = "#2c2c2a"
AXIS = "#383835"

VENDOR_COLOR = {
    "Anthropic": "#c98500",
    "OpenAI": "#008300",
    "Google": "#3987e5",
    "xAI": "#d55181",
    "Other": "#6f6e69",
}

FONT = ["DejaVu Sans"]


@dataclass
class Bar:
    label: str
    value: float
    vendor: str


@dataclass
class Scene:
    title: str
    subtitle: str
    unit: str
    bars: list
    note: str
    lower_is_better: bool = False
    decimals: int = 1


# -------------------------------------------------------------------- data
# Figures are as published/reported by the sources listed in the README; several
# are vendor-reported and not independently replicated.

SCENES = [
    Scene(
        title="SWE-bench Verified",
        subtitle="Real GitHub issues resolved",
        unit="%",
        note="Vendor-reported. Fable 5's 95.0 is single-sourced.",
        bars=[
            Bar("Claude Opus 5", 96.0, "Anthropic"),
            Bar("Claude Fable 5", 95.0, "Anthropic"),
            Bar("Claude Opus 4.7", 83.5, "Anthropic"),
            Bar("Gemini 3.1 Pro", 80.6, "Google"),
            Bar("GPT-5.5", 80.6, "OpenAI"),
            Bar("DeepSeek V4-Pro", 80.6, "Other"),
            Bar("Gemini 3.5 Flash", 79.3, "Google"),
        ],
    ),
    Scene(
        title="SWE-bench Pro",
        subtitle="Harder, contamination-resistant repo tasks",
        unit="%",
        note="The one coding eval where GPT-5.6 trails the Claude models.",
        bars=[
            Bar("Claude Fable 5", 80.3, "Anthropic"),
            Bar("Claude Opus 5", 79.2, "Anthropic"),
            Bar("Claude Opus 4.8", 69.2, "Anthropic"),
            Bar("Grok 4.5", 64.7, "xAI"),
            Bar("GPT-5.6 Sol", 64.6, "OpenAI"),
            Bar("GPT-5.6 Terra", 63.4, "OpenAI"),
            Bar("GPT-5.6 Luna", 62.7, "OpenAI"),
        ],
    ),
    Scene(
        title="Terminal-Bench 2.1",
        subtitle="End-to-end command-line workflows",
        unit="%",
        note="Sol in ultra mode is the highest recorded score on this eval.",
        bars=[
            Bar("GPT-5.6 Sol (ultra)", 91.9, "OpenAI"),
            Bar("GPT-5.6 Sol", 88.8, "OpenAI"),
            Bar("Claude Fable 5", 88.0, "Anthropic"),
            Bar("GPT-5.6 Terra", 87.4, "OpenAI"),
            Bar("GPT-5.6 Luna", 84.7, "OpenAI"),
        ],
    ),
    Scene(
        title="GPQA Diamond",
        subtitle="Graduate-level science questions",
        unit="%",
        note="The frontier is saturating here — the top six sit within 2.3 points.",
        bars=[
            Bar("GPT-5.6 Sol", 94.6, "OpenAI"),
            Bar("GPT-5.4 Pro", 94.6, "OpenAI"),
            Bar("Gemini 3.1 Pro", 94.3, "Google"),
            Bar("GPT-5.5", 94.0, "OpenAI"),
            Bar("Claude Fable 5", 92.6, "Anthropic"),
            Bar("GPT-5.6 Luna", 92.3, "OpenAI"),
        ],
    ),
    Scene(
        title="Artificial Analysis Intelligence Index",
        subtitle="Composite score across ten evaluations",
        unit="",
        decimals=0,
        note="Sol lands one point behind Fable 5 at roughly a third of the cost.",
        bars=[
            Bar("Claude Fable 5", 60, "Anthropic"),
            Bar("GPT-5.6 Sol", 59, "OpenAI"),
            Bar("GPT-5.6 Terra", 55, "OpenAI"),
            Bar("GPT-5.6 Luna", 51, "OpenAI"),
        ],
    ),
    Scene(
        title="ARC-AGI-3",
        subtitle="Novel problem-solving — where everything still breaks",
        unit="%",
        decimals=2,
        note="Scores collapse by an order of magnitude versus the coding evals.",
        bars=[
            Bar("Claude Opus 5", 30.2, "Anthropic"),
            Bar("GPT-5.6 Sol", 7.78, "OpenAI"),
            Bar("Claude Opus 4.8", 1.5, "Anthropic"),
            Bar("GPT-5.5", 0.43, "OpenAI"),
        ],
    ),
    Scene(
        title="Cost per task",
        subtitle="USD per Intelligence Index task",
        unit="$",
        decimals=2,
        lower_is_better=True,
        note="Capability per dollar moved further this cycle than raw capability.",
        bars=[
            Bar("GPT-5.6 Luna", 0.21, "OpenAI"),
            Bar("GPT-5.6 Terra", 0.55, "OpenAI"),
            Bar("GPT-5.6 Sol", 1.04, "OpenAI"),
            Bar("Grok 4.5", 1.12, "xAI"),
            Bar("Claude Opus 4.8", 8.26, "Anthropic"),
        ],
    ),
]

TITLE_FRAMES = 96
SCENE_FRAMES = 216
OUTRO_FRAMES = 132
FADE = 18


# ------------------------------------------------------------------ helpers

def ease_out_cubic(t):
    t = min(max(t, 0.0), 1.0)
    return 1.0 - (1.0 - t) ** 3


def ease_in_out(t):
    t = min(max(t, 0.0), 1.0)
    return 3 * t * t - 2 * t * t * t


def new_figure():
    fig = Figure(figsize=(W / DPI, H / DPI), dpi=DPI)
    fig.patch.set_facecolor(SURFACE)
    return fig


BAR_RADIUS_PX = 5


def rounded_bar(ax, y, width, height, color, alpha, xrange_, yrange_, box):
    """A bar with a 5px rounded data-end, square at the baseline.

    The corner radius is converted to data units per axis from the axes' pixel
    size, so the arc stays circular on screen regardless of the value scale.
    """
    if width <= 0:
        return
    rx = BAR_RADIUS_PX * xrange_ / (box[0] * W)
    ry = BAR_RADIUS_PX * yrange_ / (box[1] * H)
    rx = min(rx, width)
    y0, y1 = y - height / 2, y + height / 2

    verts = [
        (0, y0), (width - rx, y0),
        (width, y0), (width, y0 + ry),
        (width, y1 - ry),
        (width, y1), (width - rx, y1),
        (0, y1), (0, y0),
    ]
    codes = [
        Path.MOVETO, Path.LINETO,
        Path.CURVE3, Path.CURVE3,
        Path.LINETO,
        Path.CURVE3, Path.CURVE3,
        Path.LINETO, Path.CLOSEPOLY,
    ]
    ax.add_patch(mpatches.PathPatch(Path(verts, codes), linewidth=0,
                                    facecolor=color, alpha=alpha))


def draw_legend(fig, vendors, alpha):
    x = 0.055
    for vendor in vendors:
        fig.patches.append(
            mpatches.Circle(
                (x, 0.075), 0.007,
                transform=fig.transFigure, figure=fig,
                facecolor=VENDOR_COLOR[vendor], linewidth=0, alpha=alpha,
            )
        )
        fig.text(x + 0.016, 0.075, vendor, color=INK_2, alpha=alpha,
                 fontsize=15, va="center", ha="left", fontfamily=FONT)
        x += 0.02 + 0.0088 * len(vendor)


def draw_progress(fig, done, alpha):
    """A thin scene-progress rule along the bottom edge."""
    fig.patches.append(
        mpatches.Rectangle((0, 0), 1.0, 0.005, transform=fig.transFigure,
                           figure=fig, facecolor=AXIS, linewidth=0, alpha=alpha)
    )
    fig.patches.append(
        mpatches.Rectangle((0, 0), done, 0.005, transform=fig.transFigure,
                           figure=fig, facecolor="#3987e5", linewidth=0, alpha=alpha)
    )


# -------------------------------------------------------------------- frames

def render_title(i):
    fig = new_figure()
    a = ease_in_out(i / 26)
    out = 1.0 if i < TITLE_FRAMES - FADE else 1.0 - (i - (TITLE_FRAMES - FADE)) / FADE
    a = min(a, out)
    rise = (1 - ease_out_cubic(i / 34)) * 0.035

    fig.text(0.5, 0.60 - rise, "The Frontier, Measured", color=INK, alpha=a,
             fontsize=76, ha="center", va="center", fontfamily=FONT, weight="bold")
    fig.text(0.5, 0.495 - rise * 0.6,
             "GPT-5.6  ·  Claude Fable 5  ·  Claude Opus 5  ·  Gemini  ·  Grok  ·  DeepSeek",
             color=INK_2, alpha=min(a, ease_in_out((i - 10) / 30)),
             fontsize=30, ha="center", va="center", fontfamily=FONT)
    fig.text(0.5, 0.40, "Seven benchmarks  ·  July 2026", color=MUTED,
             alpha=min(a, ease_in_out((i - 20) / 30)),
             fontsize=22, ha="center", va="center", fontfamily=FONT)

    rule_w = 0.30 * ease_out_cubic((i - 8) / 40)
    fig.patches.append(
        mpatches.Rectangle((0.5 - rule_w / 2, 0.66), rule_w, 0.0035,
                           transform=fig.transFigure, figure=fig,
                           facecolor="#3987e5", linewidth=0, alpha=a)
    )
    return fig


def render_scene(scene, i, scene_index):
    fig = new_figure()
    fade_in = ease_in_out(i / FADE)
    fade_out = 1.0 if i < SCENE_FRAMES - FADE else 1.0 - (i - (SCENE_FRAMES - FADE)) / FADE
    a = min(fade_in, fade_out)

    box = (0.60, 0.60)  # axes width, height as figure fractions
    ax = fig.add_axes([0.275, 0.135, box[0], box[1]])
    ax.set_facecolor(SURFACE)
    for spine in ax.spines.values():
        spine.set_visible(False)

    bars = scene.bars
    n = len(bars)
    vmax = max(b.value for b in bars)
    axis_max = vmax * 1.16

    ax.set_xlim(0, axis_max)
    ax.set_ylim(n - 0.5, -0.5)
    ax.set_yticks([])
    ax.tick_params(axis="x", colors=MUTED, labelsize=15, length=0, pad=10)
    for lbl in ax.get_xticklabels():
        lbl.set_fontfamily(FONT)
        lbl.set_alpha(a)
    ax.grid(axis="x", color=GRID, linewidth=1, alpha=a * 0.9)
    ax.set_axisbelow(True)

    # Baseline.
    ax.add_line(matplotlib.lines.Line2D([0, 0], [-0.5, n - 0.5], color=AXIS,
                                        linewidth=2, alpha=a, zorder=3))

    # Bar thickness leaves a clear surface gap between adjacent bars.
    height = 0.46 if n <= 5 else 0.42
    yrange_ = n
    for idx, bar in enumerate(bars):
        stagger = idx * 6
        t = ease_out_cubic((i - FADE - stagger) / 52)
        if t <= 0:
            continue
        shown = bar.value * t
        rounded_bar(ax, idx, shown, height, VENDOR_COLOR[bar.vendor],
                    a, axis_max, yrange_, box)

        # Model name, right-aligned outside the plot.
        ax.text(-axis_max * 0.018, idx, bar.label, color=INK, alpha=a,
                fontsize=24, va="center", ha="right", fontfamily=FONT)
        # Direct value label at the data end — identity is never colour-alone.
        fmt = f"{shown:.{scene.decimals}f}"
        text = f"{scene.unit}{fmt}" if scene.unit == "$" else f"{fmt}{scene.unit}"
        ax.text(shown + axis_max * 0.022, idx, text, color=INK_2, alpha=a * t,
                fontsize=23, va="center", ha="left", fontfamily=FONT)

    # Headline block.
    slide = (1 - ease_out_cubic(i / 30)) * 0.02
    fig.text(0.055, 0.885 - slide, scene.title, color=INK, alpha=a,
             fontsize=52, ha="left", va="center", fontfamily=FONT, weight="bold")
    fig.text(0.055, 0.815 - slide * 0.5, scene.subtitle, color=INK_2, alpha=a,
             fontsize=26, ha="left", va="center", fontfamily=FONT)
    fig.text(0.945, 0.885, f"0{scene_index + 1} / 0{len(SCENES)}", color=MUTED,
             alpha=a, fontsize=26, ha="right", va="center", fontfamily=FONT)
    if scene.lower_is_better:
        fig.text(0.945, 0.815, "lower is better", color=MUTED, alpha=a,
                 fontsize=22, ha="right", va="center", fontfamily=FONT)

    fig.text(0.055, 0.032, scene.note, color=MUTED,
             alpha=min(a, ease_in_out((i - 55) / 30)),
             fontsize=19, ha="left", va="center", fontfamily=FONT)

    draw_legend(fig, sorted({b.vendor for b in bars}), a)
    draw_progress(fig, (scene_index + i / SCENE_FRAMES) / len(SCENES), a)
    return fig


def render_outro(i):
    fig = new_figure()
    a = min(ease_in_out(i / 24), 1.0 if i < OUTRO_FRAMES - FADE
            else 1.0 - (i - (OUTRO_FRAMES - FADE)) / FADE)

    fig.text(0.5, 0.78, "What the numbers say", color=INK, alpha=a,
             fontsize=54, ha="center", va="center", fontfamily=FONT, weight="bold")

    takeaways = [
        ("Claude Opus 5 / Fable 5", "lead repo-level engineering — 96.0 / 95.0 SWE-bench Verified"),
        ("GPT-5.6 Sol", "owns the terminal — 91.9% Terminal-Bench, and the cost curve"),
        ("GPQA Diamond", "is saturated — the top six models sit within 2.3 points"),
        ("ARC-AGI-3", "is not — the best score in this set is 30.2%"),
    ]
    y = 0.615
    for k, (head, tail) in enumerate(takeaways):
        ta = min(a, ease_in_out((i - 14 - k * 11) / 26))
        fig.patches.append(
            mpatches.Rectangle((0.145, y - 0.028), 0.0035, 0.056,
                               transform=fig.transFigure, figure=fig,
                               facecolor="#3987e5", linewidth=0, alpha=ta)
        )
        fig.text(0.168, y + 0.012, head, color=INK, alpha=ta, fontsize=28,
                 ha="left", va="center", fontfamily=FONT, weight="bold")
        fig.text(0.168, y - 0.026, tail, color=INK_2, alpha=ta, fontsize=23,
                 ha="left", va="center", fontfamily=FONT)
        y -= 0.115

    fig.text(0.5, 0.075,
             "Figures as published July 2026 · many are vendor-reported and not independently replicated",
             color=MUTED, alpha=min(a, ease_in_out((i - 60) / 30)),
             fontsize=18, ha="center", va="center", fontfamily=FONT)
    return fig


# ----------------------------------------------------------------- pipeline

def frames():
    for i in range(TITLE_FRAMES):
        yield render_title(i)
    for s, scene in enumerate(SCENES):
        for i in range(SCENE_FRAMES):
            yield render_scene(scene, i, s)
    for i in range(OUTRO_FRAMES):
        yield render_outro(i)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "dist/ai-model-benchmarks-2026.mp4"
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    total = TITLE_FRAMES + SCENE_FRAMES * len(SCENES) + OUTRO_FRAMES
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    for k, fig in enumerate(frames()):
        canvas = matplotlib.backends.backend_agg.FigureCanvasAgg(fig)
        canvas.draw()
        proc.stdin.write(np.asarray(canvas.buffer_rgba()).tobytes())
        del fig
        if k % 120 == 0:
            print(f"  frame {k}/{total}", flush=True)

    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print(f"wrote {out}  ({total} frames, {total / FPS:.1f}s)")


if __name__ == "__main__":
    import matplotlib.backends.backend_agg  # noqa: F401
    main()
