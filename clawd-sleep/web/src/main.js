/*
 * Clawd Sleep — application wiring.
 *
 * The render loop is the spine: it advances the scene, the sleep-mode
 * transition, and the burn-in drift from one clock, so nothing can drift out of
 * step with anything else. CSS transitions handle only the chrome, which is
 * never on screen at the same time as the parts that must stay in sync.
 *
 * Frame rates are deliberate. Awake: 30fps — every motion in this app has a
 * period measured in seconds, and 60fps buys nothing but heat. Sleep Mode: 8fps.
 * Hidden: nothing at all.
 */

import { createScene } from './scene.js';
import { createAudioEngine } from './audio.js';
import { createWakeLock, WAKE } from './wakelock.js';
import { createSleepMode, HOLD_MS } from './sleepmode.js';
import { createTimer, createAlarm, TIMER_OPTIONS } from './timer.js';
import { PRESETS } from './ambience.js';
import * as store from './store.js';
import { clamp01, lerp } from './ease.js';

const $ = (id) => document.getElementById(id);
const FPS = { awake: 30, asleep: 8, reduced: 12 };
const CHROME_HIDE_MS = 12_000;
const DROWSY_MS = 90_000;
const SESSION_KEY = 'clawd-sleep/session';

/* ------------------------------------------------------------------ boot -- */

const settings = store.loadSettings();
const scene = createScene($('sky'), { reducedMotion: false });
const audio = createAudioEngine();
const wakeLock = createWakeLock(onWakeStatus);
const sleep = createSleepMode({ scene, audio, wakeLock, onChange: onSleepChange });
const alarm = createAlarm(audio);
const timer = createTimer({ audio, onTick: onTimerTick, onExpire: onTimerExpire });

const mq = {
  reduce: matchMedia('(prefers-reduced-motion: reduce)'),
};

let lastTouch = performance.now();
let chromeHidden = false;
let sheet = null;              // 'sounds' | 'mix' | 'about' | null
let toastTimer = null;
let pendingSleepPress = false;
let tracks = [];               // {id, name, file?, handle?, duration}
let currentTrackId = null;
let heartbeat = null;

/* ------------------------------------------------------------- settings -- */

function applySettings() {
  document.documentElement.dataset.amoled = settings.amoled ? '1' : '0';
  sleep.setAmoled(settings.amoled);
  sleep.setDimOverlay(settings.dimOverlay / 100);
  scene.view.amoled = settings.amoled;

  audio.setMusicVolume(settings.musicVolume, 0);
  audio.setAmbienceVolume(settings.ambienceVolume, 0);
  audio.setLoop(settings.loop);

  const reduced = settings.reducedMotion ?? mq.reduce.matches;
  scene.setReducedMotion(reduced);

  $('clock').dataset.off = settings.clockVisible ? '0' : '1';
  $('sleep-clock').dataset.off = settings.clockVisible ? '0' : '1';

  $('opt-amoled').checked = settings.amoled;
  $('opt-clock').checked = settings.clockVisible;
  $('opt-screen').checked = settings.screenOn !== false;
  $('opt-dim').value = settings.dimOverlay;
  $('opt-dim-out').value = settings.dimOverlay;
  $('opt-alarm').checked = settings.alarmEnabled;
  $('alarm-time').value = settings.alarmTime;
  $('loop').checked = settings.loop;
  $('vol-music').value = Math.round(settings.musicVolume * 100);
  $('vol-music-out').value = Math.round(settings.musicVolume * 100);
  $('vol-amb').value = Math.round(settings.ambienceVolume * 100);
  $('vol-amb-out').value = Math.round(settings.ambienceVolume * 100);
}

const save = () => store.saveSettings(settings);

/* ---------------------------------------------------------- render loop -- */

let raf = 0, lastT = 0, acc = 0, running = false;

function targetFps() {
  if (settings.reducedMotion ?? mq.reduce.matches) return FPS.reduced;
  return sleep.state.t > 0.5 ? FPS.asleep : FPS.awake;
}

function frame(msNow) {
  raf = requestAnimationFrame(frame);
  const now = msNow / 1000;
  if (!lastT) lastT = now;
  let dt = now - lastT;
  lastT = now;
  // A tab that was throttled or a device that slept can hand back a huge dt.
  // Clamping keeps every easing well-behaved instead of snapping to its target.
  if (dt > 0.25) dt = 0.25;

  acc += dt;
  const step = 1 / targetFps();
  if (acc < step) return;
  acc %= step;

  sleep.update(dt);
  scene.update(now, dt);
  scene.draw(now);
  paintSleepLayer(now, msNow);
  drowsyCheck(msNow);
}

function start() {
  if (running) return;
  running = true; lastT = 0; acc = 0;
  raf = requestAnimationFrame(frame);
}
function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/** The sleep layer is DOM, so it needs the same burn-in drift the canvas gets. */
let driftAt = 0;
function paintSleepLayer(now, msNow) {
  const l = $('sleep-layer');
  const scrim = $('sleep-scrim');
  const on = sleep.state.t > 0.02;
  if (on && l.hidden) { l.hidden = false; $('sleep-catch').hidden = false; }
  if (!on && !l.hidden) { l.hidden = true; $('sleep-catch').hidden = true; }
  l.dataset.on = sleep.state.active ? '1' : '0';

  // scrim = the user's dim preference, arrived at over the whole transition
  scrim.style.opacity = String(sleep.state.t * (0.12 + settings.dimOverlay / 100 * 0.88));

  if (msNow - driftAt > 1000) {          // 1Hz is plenty for a 7-minute period
    driftAt = msNow;
    const dx = Math.round(Math.sin((now / 420) * Math.PI * 2) * 10);
    const dy = Math.round(Math.sin((now / 660) * Math.PI * 2 + 2.2) * 8);
    l.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  const mark = $('mark-mark') || $('sleep-mark');
  const lit = sleep.state.revealUntil > msNow;
  mark.dataset.lit = lit ? '1' : '0';
  $('sleep-hint').dataset.on = lit && (settings.sleepHints ?? 0) < 3 ? '1' : '0';
  const arc = $('mark-arc');
  arc.style.strokeDashoffset = String(119.38 * (1 - sleep.state.holdProgress));
}

function drowsyCheck(msNow) {
  if (sleep.state.active) return;
  const idle = msNow - lastTouch;
  if (!chromeHidden && idle > CHROME_HIDE_MS && !sheet && audio.state.playing) {
    chromeHidden = true;
    $('chrome').dataset.hidden = '1';
  }
  const want = idle > DROWSY_MS && audio.state.playing ? 'drowsy' : 'awake';
  if (scene.clawd.mode !== want && scene.clawd.mode !== 'asleep') {
    scene.clawd.setMode(want, msNow / 1000);
  }
}

function touched() {
  lastTouch = performance.now();
  if (chromeHidden) { chromeHidden = false; $('chrome').dataset.hidden = '0'; }
}

/* --------------------------------------------------------------- clock --- */

function fmtClock(d = new Date()) {
  const h24 = settings.clock24 ?? !new Intl.DateTimeFormat().resolvedOptions().hour12;
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}:${m}`;
  const mer = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return `${h}:${m} ${mer}`;
}
function tickClock() {
  const s = fmtClock();
  $('clock-time').textContent = s;
  $('sleep-clock').textContent = s;
}
setInterval(tickClock, 10_000);

const fmtDur = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
const fmtSpan = (ms) => {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

/* --------------------------------------------------------------- toast --- */

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.dataset.on = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.on = '0'; }, ms);
}

/* -------------------------------------------------------------- sheets --- */

function openSheet(which) {
  sheet = which;
  touched();
  const el = $('sheet');
  el.hidden = false; el.dataset.closing = '0';
  $('scrim').hidden = false; $('scrim').dataset.closing = '0';
  $('tab-sounds').hidden = which !== 'sounds';
  $('tab-mix').hidden = which !== 'mix';
  $('tab-about').hidden = which !== 'about';
  $('sheet-title').textContent = which === 'sounds' ? 'sounds' : which === 'mix' ? 'playing' : 'about';
  if (which === 'sounds') renderSounds();
  if (which === 'mix') renderMix();
  if (which === 'about') renderAbout();
  // Move focus into the dialog for screen readers, but onto the container —
  // focusing the close button paints a ring the moment a sheet opens.
  el.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheet) return;
  sheet = null;
  const el = $('sheet'), sc = $('scrim');
  el.dataset.closing = '1'; sc.dataset.closing = '1';
  setTimeout(() => { el.hidden = true; sc.hidden = true; }, 300);
}

/* ------------------------------------------------------------- sounds ---- */

function renderSounds() {
  const ul = $('ambience-list');
  ul.textContent = '';
  for (const p of PRESETS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'row';
    b.setAttribute('aria-selected', settings.ambienceId === p.id ? 'true' : 'false');
    b.innerHTML = `<span class="row-main"><span class="row-name"></span><span class="row-meta"></span></span><span class="row-dot"></span>`;
    b.querySelector('.row-name').textContent = p.name;
    b.querySelector('.row-meta').textContent = p.hint;
    b.addEventListener('click', () => {
      const next = settings.ambienceId === p.id ? null : p.id;
      settings.ambienceId = next; save();
      audio.setAmbience(next);
      if (next && !audio.state.playing) audio.play();
      renderSounds(); updateNowLine();
    });
    li.append(b); ul.append(li);
  }

  const tl = $('track-list');
  tl.textContent = '';
  for (const t of tracks) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'row';
    b.setAttribute('aria-selected', currentTrackId === t.id ? 'true' : 'false');
    b.innerHTML = `<span class="row-main"><span class="row-name"></span><span class="row-meta"></span></span><span class="row-dot"></span>`;
    b.querySelector('.row-name').textContent = t.name;
    b.querySelector('.row-meta').textContent = t.duration ? fmtDur(t.duration) : 'your audio';
    b.addEventListener('click', () => selectTrack(t));
    li.append(b); tl.append(li);
  }

  const fl = $('fav-list');
  fl.textContent = '';
  if (!settings.favourites.length) {
    const li = document.createElement('li');
    li.innerHTML = `<p class="row-meta" style="padding:12px 24px">nothing saved yet</p>`;
    fl.append(li);
  }
  for (const f of settings.favourites) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'row';
    b.innerHTML = `<span class="row-main"><span class="row-name"></span><span class="row-meta"></span></span><span class="row-x">remove</span>`;
    b.querySelector('.row-name').textContent = f.name;
    b.querySelector('.row-meta').textContent =
      `${f.ambienceId ?? 'no ambience'} · music ${Math.round(f.musicVolume * 100)} · ambience ${Math.round(f.ambienceVolume * 100)}`;
    b.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('row-x')) {
        settings.favourites = settings.favourites.filter((x) => x.id !== f.id);
        save(); renderSounds(); return;
      }
      applyFavourite(f);
    });
    li.append(b); fl.append(li);
  }
}

function applyFavourite(f) {
  settings.ambienceId = f.ambienceId;
  settings.musicVolume = f.musicVolume;
  settings.ambienceVolume = f.ambienceVolume;
  save(); applySettings();
  audio.setAmbience(f.ambienceId);
  if (!audio.state.playing) audio.play();
  renderSounds(); updateNowLine();
  toast(`loaded “${f.name}”`);
}

/* -------------------------------------------------------------- tracks --- */

async function pickFile() {
  touched();
  if (store.canRememberFiles) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'audio', accept: { 'audio/*': ['.mp3', '.m4a', '.flac', '.ogg', '.wav', '.opus', '.aac'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      await store.rememberHandle(handle);
      addTrack(file, handle);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      // fall through to <input type=file>
    }
  }
  $('file').click();
}

function addTrack(file, handle) {
  const id = `${file.name}:${file.size}`;
  let t = tracks.find((x) => x.id === id);
  if (!t) { t = { id, name: file.name.replace(/\.[^.]+$/, ''), file, handle, duration: 0 }; tracks.unshift(t); }
  else { t.file = file; t.handle = handle; }
  tracks = tracks.slice(0, 8);
  settings.lastTrackName = t.name; save();
  selectTrack(t);
}

async function selectTrack(t) {
  if (!t.file && t.handle) {
    try { t.file = await t.handle.getFile(); }
    catch { toast('that file has moved — pick it again'); return; }
  }
  currentTrackId = t.id;
  await audio.setTrack(t.file, t.name);
  await audio.play();
  renderSounds(); updateNowLine(); renderMix();
}

/* ---------------------------------------------------------------- mix ---- */

function renderMix() {
  const t = tracks.find((x) => x.id === currentTrackId);
  $('mix-track').textContent = t ? t.name : (settings.ambienceId ? PRESETS.find(p=>p.id===settings.ambienceId)?.name ?? '—' : '—');
  const playing = audio.state.playing;
  $('ico-play').hidden = playing;
  $('ico-pause').hidden = !playing;
  $('playpause').setAttribute('aria-label', playing ? 'pause' : 'play');

  const finite = audio.state.duration > 0 && Number.isFinite(audio.state.duration);
  $('seek-wrap').hidden = !finite;
  if (finite) {
    const s = $('seek');
    if (document.activeElement !== s) s.value = String(Math.round((audio.state.position / audio.state.duration) * 1000));
    $('t-now').textContent = fmtDur(audio.state.position);
    $('t-left').textContent = '−' + fmtDur(audio.state.duration - audio.state.position);
  }

  const chips = $('timer-chips');
  if (!chips.childElementCount) {
    for (const m of TIMER_OPTIONS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = m === 0 ? 'never' : m >= 60 ? `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
      b.dataset.min = String(m);
      b.addEventListener('click', () => { setTimerMinutes(m); });
      chips.append(b);
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = 'custom'; b.dataset.min = 'custom';
    b.addEventListener('click', () => {
      const v = prompt('stop after how many minutes?', String(settings.timerMinutes || 45));
      const n = Math.max(1, Math.min(720, parseInt(v ?? '', 10) || 0));
      if (n) setTimerMinutes(n);
    });
    chips.append(b);
  }
  for (const b of chips.children) {
    const m = b.dataset.min;
    const on = m === 'custom'
      ? settings.timerMinutes > 0 && !TIMER_OPTIONS.includes(settings.timerMinutes)
      : Number(m) === settings.timerMinutes;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function setTimerMinutes(m) {
  settings.timerMinutes = m; save();
  timer.set(m);
  renderMix();
  toast(m ? `stopping in ${m >= 60 ? fmtSpan(m * 60000) : m + 'm'}` : 'timer off');
}

function onTimerTick(info) {
  const out = $('timer-left');
  if (!info) { out.value = ''; return; }
  const s = Math.round(info.remainingMs / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  out.value = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
                : `${m}:${String(sec).padStart(2, '0')}`;
}

async function onTimerExpire() {
  await audio.pause(0.5);
  settings.timerMinutes = 0; save();
  renderMix();
  if (settings.releaseScreenOnTimerEnd && sleep.active) sleep.exit();
}

/* ------------------------------------------------------------- about ----- */

function renderAbout() {
  const n = $('wake-note');
  if (!wakeLock.supported) {
    n.textContent = 'this browser cannot keep the screen on. the android app can — audio will still play here.';
  } else if (wakeLock.status === WAKE.DENIED) {
    n.textContent = 'the browser refused to keep the screen on, usually because of battery saver.';
  } else {
    n.textContent = 'a browser tab can be interrupted by the system. for a guaranteed all-night screen, use the android app.';
  }
  $('alarm-note').textContent = settings.alarmEnabled
    ? 'the browser may delay this if the tab is in the background.'
    : '';
}

/* --------------------------------------------------------- now playing --- */

function updateNowLine() {
  const t = tracks.find((x) => x.id === currentTrackId);
  const amb = settings.ambienceId ? PRESETS.find((p) => p.id === settings.ambienceId)?.name : null;
  let s;
  if (t && amb) s = `${amb} + ${t.name}`;
  else if (t) s = t.name;
  else if (amb) s = amb;
  else s = 'choose a sound';
  $('now-line').textContent = s;
  $('sleep-now').textContent = audio.state.playing ? s : '';
  $('sleep-btn').disabled = !audio.hasSource;
}

/* --------------------------------------------------------- sleep mode ---- */

function onWakeStatus(status) {
  if (status === WAKE.DENIED && sleep.active) {
    toast('the browser would not keep the screen on — audio will keep playing');
  }
}

function onSleepChange(st) {
  $('chrome').dataset.sleeping = st.active ? '1' : '0';
  document.body.dataset.sleeping = st.active ? '1' : '0';
  if (st.active) {
    closeSheet();
    settings.sleepHints = (settings.sleepHints ?? 0) + 1;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ startedAt: st.startedAt, beat: Date.now() }));
    heartbeat = setInterval(() => {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ startedAt: sleep.state.startedAt, beat: Date.now() }));
      } catch {}
    }, 30_000);
  } else {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    finishSession(st.startedAt, Date.now());
    localStorage.removeItem(SESSION_KEY);
  }
  save();
  updateNowLine();
}

async function requestSleep() {
  touched();
  if (!audio.hasSource) { toast('choose a sound first'); return; }
  if (!settings.warnedAboutBattery) {
    if (!pendingSleepPress) {
      pendingSleepPress = true;
      $('notice').hidden = false;
      return;
    }
  }
  $('notice').hidden = true;
  pendingSleepPress = false;
  await audio.unlock();
  if (!audio.state.playing) await audio.play();
  await sleep.enter();
}

/* Qualified tap: ≤400ms, ≤12px of travel, and (via .sleep-catch's 12px inset)
   never from a screen edge. A duvet settling holds far longer than 400ms; a
   brush travels much further than 12px. Two of them are required to wake. */
let tapAt = 0, tapX = 0, tapY = 0, firstTapAt = 0;

function armCatch() {
  const c = $('sleep-catch');
  c.addEventListener('pointerdown', (e) => {
    tapAt = performance.now(); tapX = e.clientX; tapY = e.clientY;
  });
  c.addEventListener('pointerup', (e) => {
    const dt = performance.now() - tapAt;
    const dist = Math.hypot(e.clientX - tapX, e.clientY - tapY);
    if (dt > 400 || dist > 12) return;                 // not a deliberate tap
    const now = performance.now();
    if (firstTapAt && now - firstTapAt < 4000) { firstTapAt = 0; sleep.exit(); return; }
    firstTapAt = now;
    sleep.poke();
  });
  c.addEventListener('pointercancel', () => { tapAt = 0; });

  // Holding the mark is the second way out, for anyone who prefers it.
  const m = $('sleep-mark');
  const down = (e) => { e.stopPropagation(); sleep.poke(); sleep.beginHold(); };
  const up = () => sleep.endHold();
  m.addEventListener('pointerdown', down);
  m.addEventListener('pointerup', up);
  m.addEventListener('pointerleave', up);
  m.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------ session ---- */

function finishSession(startedAt, endedAt) {
  if (!startedAt) return;
  const ms = endedAt - startedAt;
  if (ms < 60_000) return;
  const amb = settings.ambienceId ? PRESETS.find((p) => p.id === settings.ambienceId)?.name : null;
  const t = tracks.find((x) => x.id === currentTrackId);
  settings.lastSession = {
    startedAt, endedAt, ms,
    sound: [amb, t?.name].filter(Boolean).join(' + ') || null,
  };
  save();
  const hour = new Date(endedAt).getHours();
  if (ms >= 45 * 60_000 && hour >= 4 && hour < 12) showMorning(settings.lastSession);
}

function showMorning(s) {
  $('morning-sub').textContent = s.sound
    ? `you slept with ${s.sound} for ${fmtSpan(s.ms)}.`
    : `you slept for ${fmtSpan(s.ms)}.`;
  const rows = $('morning-rows');
  rows.textContent = '';
  const add = (k, v) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.className = 'tabular'; dd.textContent = v;
    d.append(dt, dd); rows.append(d);
  };
  add('asleep', fmtClock(new Date(s.startedAt)));
  add('awake', fmtClock(new Date(s.endedAt)));
  if (s.sound) add('sound', s.sound);
  $('morning').hidden = false;
}

/** A session interrupted by the app being killed is recovered from its heartbeat. */
function recoverSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const { startedAt, beat } = JSON.parse(raw);
    localStorage.removeItem(SESSION_KEY);
    if (!startedAt || !beat) return;
    const ms = beat - startedAt;
    if (ms < 45 * 60_000) return;
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 12) {
      showMorning({ startedAt, endedAt: beat, ms, sound: settings.lastSession?.sound ?? null });
    }
  } catch {}
}

/* ------------------------------------------------------------- events ---- */

function wire() {
  $('sounds-open').addEventListener('click', () => openSheet('sounds'));
  $('about-open').addEventListener('click', () => openSheet('about'));
  $('sheet-close').addEventListener('click', closeSheet);
  $('scrim').addEventListener('click', closeSheet);
  $('now-line').addEventListener('click', () => audio.hasSource && openSheet('mix'));
  $('clock').addEventListener('click', () => {
    settings.clockVisible = !settings.clockVisible; save(); applySettings();
  });

  $('sleep-btn').addEventListener('click', requestSleep);
  $('notice-ok').addEventListener('click', () => {
    settings.warnedAboutBattery = true; save(); requestSleep();
  });
  $('notice-alt').addEventListener('click', () => {
    settings.warnedAboutBattery = true; settings.screenOn = false; save();
    $('opt-screen').checked = false;
    requestSleep();
  });

  $('pick-file').addEventListener('click', pickFile);
  $('file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) addTrack(f, null);
    e.target.value = '';
  });

  $('playpause').addEventListener('click', async () => {
    touched();
    if (audio.state.playing) await audio.pause(); else await audio.play();
    renderMix(); updateNowLine();
  });

  $('seek').addEventListener('input', (e) => {
    if (!audio.state.duration) return;
    audio.seek((Number(e.target.value) / 1000) * audio.state.duration);
  });

  const bindVol = (id, outId, setter, key) => {
    const el = $(id);
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      $(outId).value = e.target.value;
      setter(v, 0.045);          // 45ms: fast enough to feel instant, slow enough not to zipper
      settings[key] = v; save();
    });
  };
  bindVol('vol-music', 'vol-music-out', audio.setMusicVolume, 'musicVolume');
  bindVol('vol-amb', 'vol-amb-out', audio.setAmbienceVolume, 'ambienceVolume');

  $('loop').addEventListener('change', (e) => { settings.loop = e.target.checked; save(); audio.setLoop(settings.loop); });
  $('opt-amoled').addEventListener('change', (e) => { settings.amoled = e.target.checked; save(); applySettings(); });
  $('opt-clock').addEventListener('change', (e) => { settings.clockVisible = e.target.checked; save(); applySettings(); });
  $('opt-screen').addEventListener('change', (e) => { settings.screenOn = e.target.checked; save(); });
  $('opt-dim').addEventListener('input', (e) => {
    settings.dimOverlay = Number(e.target.value); $('opt-dim-out').value = e.target.value; save();
  });
  $('opt-alarm').addEventListener('change', (e) => {
    settings.alarmEnabled = e.target.checked; save(); syncAlarm(); renderAbout();
  });
  $('alarm-time').addEventListener('change', (e) => {
    settings.alarmTime = e.target.value; save(); syncAlarm();
  });

  $('fav-save').addEventListener('click', () => {
    const t = tracks.find((x) => x.id === currentTrackId);
    const amb = settings.ambienceId ? PRESETS.find((p) => p.id === settings.ambienceId)?.name : null;
    const name = [amb, t?.name].filter(Boolean).join(' + ') || 'silence';
    settings.favourites.unshift({
      id: String(Date.now()), name,
      ambienceId: settings.ambienceId,
      musicVolume: settings.musicVolume,
      ambienceVolume: settings.ambienceVolume,
      trackName: t?.name ?? null,
    });
    settings.favourites = settings.favourites.slice(0, 12);
    save(); renderSounds(); toast('saved');
  });

  $('morning-done').addEventListener('click', () => { $('morning').hidden = true; });

  // Any interaction anywhere counts as "awake at the controls".
  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, () => { if (!sleep.active) touched(); }, { passive: true });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (sleep.active) sleep.exit(); else closeSheet(); }
    if (e.key === ' ' && !/input|button|select/i.test(e.target.tagName)) {
      e.preventDefault();
      audio.state.playing ? audio.pause() : audio.play();
    }
  });

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  screen.orientation?.addEventListener?.('change', () => setTimeout(onResize, 120));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      timer.resync();
      tickClock();
      start();
    } else {
      // Rendering while hidden is pure waste. Audio is untouched.
      stop();
    }
  });

  // Persist immediately on the way out — a backgrounded tab may never run again.
  window.addEventListener('pagehide', () => store.saveSettingsNow(settings));

  mq.reduce.addEventListener('change', () => applySettings());

  audio.onChange(() => { renderMix(); updateNowLine(); });
}

function syncAlarm() {
  if (settings.alarmEnabled) alarm.schedule(settings.alarmTime, () => toast('good morning'));
  else alarm.cancel();
}

function onResize() {
  document.documentElement.style.setProperty('--hairline-w', 1 / (window.devicePixelRatio || 1) + 'px');
  scene.resize();
  if (running) scene.draw(performance.now() / 1000);
}

/* --------------------------------------------------------------- init ---- */

async function init() {
  onResize();
  applySettings();
  tickClock();
  wire();
  armCatch();
  syncAlarm();
  updateNowLine();
  recoverSession();

  // Restore last night's file where the platform allows it.
  const handle = await store.recallHandle();
  if (handle) {
    try {
      const perm = await handle.queryPermission?.({ mode: 'read' });
      const name = handle.name.replace(/\.[^.]+$/, '');
      tracks.unshift({ id: `restored:${handle.name}`, name, handle, duration: 0 });
      if (perm !== 'granted') settings.needsFilePermission = true;
    } catch {}
  } else if (settings.lastTrackName) {
    // Honest: on this browser a file cannot be reopened without the user.
    $('now-line').textContent = `last night: ${settings.lastTrackName}`;
  }

  // Fade the night in rather than snapping it on.
  start();
  const t0 = performance.now();
  const reveal = () => {
    const p = clamp01((performance.now() - t0) / 1400);
    scene.view.reveal = p * p * (3 - 2 * p);
    if (p < 1) requestAnimationFrame(reveal);
  };
  reveal();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

// Expose a handle for the visual test harness. Harmless in production.
window.__clawd = { scene, audio, sleep, settings, timer, start, stop, openSheet, closeSheet };
