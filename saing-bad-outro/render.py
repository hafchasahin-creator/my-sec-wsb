"""Deterministically render saing-bad-outro/index.html to PNG frames.

CSS animations are stepped via the Web Animations API and the canvas haze via a
stubbed requestAnimationFrame, so frame N always looks the same regardless of
how fast the machine actually runs.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

SRC = pathlib.Path("/home/user/my-sec-wsb/saing-bad-outro/index.html")
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "frames")
FPS = 30
SECONDS = 9.0
FRAMES = int(FPS * SECONDS)
RAF_PER_FRAME = 2  # haze motion was tuned at 60fps

# Capture-only layout: fixed 1280x720 stage, no page chrome.
CAPTURE_CSS = """
  body { padding: 0 !important; gap: 0 !important; background: #000 !important; }
  .bar { display: none !important; }
  .theater {
    width: 1280px !important;
    height: 720px !important;
    aspect-ratio: auto !important;
    border: 0 !important;
  }
"""

# Installed before any page script runs.
STUB_RAF = """
  window.__rafQueue = [];
  window.requestAnimationFrame = (cb) => {
    window.__rafQueue.push(cb);
    return window.__rafQueue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__stepRaf = (t) => {
    const queue = window.__rafQueue;
    window.__rafQueue = [];
    for (const cb of queue) cb(t);
  };
"""

SEEK = """
  ([ms, rafSteps]) => {
    for (let i = 0; i < rafSteps; i++) window.__stepRaf(ms + i * 8.333);
    for (const a of document.getAnimations()) {
      a.pause();
      try { a.currentTime = ms; } catch (e) { /* finished animation */ }
    }
    return document.getAnimations().length;
  }
"""

OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        args=["--force-color-profile=srgb", "--disable-lcd-text"],
    )
    page = browser.new_context(
        viewport={"width": 1280, "height": 760},
        device_scale_factor=1.5,          # 1280x720 CSS -> 1920x1080 pixels
        color_scheme="dark",
        reduced_motion="no-preference",
    ).new_page()

    page.add_init_script(STUB_RAF)
    page.goto(SRC.as_uri())
    page.add_style_tag(content=CAPTURE_CSS)
    page.wait_for_timeout(300)

    stage = page.query_selector(".theater")
    box = stage.bounding_box()
    clip = {"x": box["x"], "y": box["y"], "width": 1280, "height": 720}

    for i in range(FRAMES):
        ms = (i / FPS) * 1000.0
        count = page.evaluate(SEEK, [ms, RAF_PER_FRAME])
        page.screenshot(path=str(OUT / f"f{i:04d}.png"), clip=clip, animations="allow")
        if i == 0:
            print(f"animations tracked: {count}")

    browser.close()

print(f"wrote {FRAMES} frames to {OUT}")
