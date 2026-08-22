/*
 * Persistence.
 *
 * Settings live in localStorage — a few hundred bytes, synchronous, and it
 * survives everything. The chosen audio file is a harder problem on the web:
 *
 *   - Chromium: we keep the FileSystemFileHandle in IndexedDB and re-open it next
 *     launch (one permission tap). This actually works.
 *   - Everyone else: a File from <input> cannot be re-opened later; the browser
 *     deliberately forbids it. We remember the NAME so the UI can say "last night
 *     you played X" and offer to pick it again, and we say so plainly rather than
 *     silently losing it.
 *
 * The Android build has no such limitation — it takes a persistable URI grant.
 */

const KEY = 'clawd-sleep/v1';
const DB = 'clawd-sleep';
const STORE = 'handles';

export const DEFAULTS = {
  musicVolume: 0.7,
  ambienceVolume: 0.5,
  ambienceId: 'rain',
  loop: true,
  timerMinutes: 0,          // 0 = never
  clockVisible: true,
  clock24: false,
  amoled: false,
  dimOverlay: 0.35,
  alarmEnabled: false,
  alarmTime: '07:00',
  releaseScreenOnTimerEnd: false,
  reducedMotion: null,      // null = follow the system
  warnedAboutBattery: false,
  favourites: [],           // [{id, name, ambienceId, ambienceVolume, musicVolume, trackName}]
  lastTrackName: null,
  lastSession: null,        // {startedAt, endedAt, minutes}
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Merge rather than replace, so a new key added in a later version gets its
    // default instead of undefined.
    return { ...DEFAULTS, ...parsed, favourites: Array.isArray(parsed.favourites) ? parsed.favourites : [] };
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer = null;
export function saveSettings(s) {
  if (saveTimer) clearTimeout(saveTimer);
  // Coalesce: dragging a volume slider must not hit localStorage 200 times.
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    saveTimer = null;
  }, 400);
}

export function saveSettingsNow(s) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/* ------------------------------------------------------- file handles ----- */

function idb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export const canRememberFiles = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export async function rememberHandle(handle) {
  if (!canRememberFiles || !handle) return false;
  const db = await idb();
  if (!db) return false;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, 'lastTrack');
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch { res(false); }
  });
}

export async function recallHandle() {
  if (!canRememberFiles) return null;
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get('lastTrack');
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

export async function forgetHandle() {
  const db = await idb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('lastTrack');
  } catch {}
}
