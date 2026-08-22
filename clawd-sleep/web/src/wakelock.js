/*
 * Keeping the screen on, on the web.
 *
 * The Screen Wake Lock API is the only supported way. Two things about it trip
 * people up, and both are handled here:
 *
 *   1. The lock is released automatically whenever the page stops being visible,
 *      and it is NOT restored for you. Without the visibilitychange re-request
 *      below, the screen starts timing out again the first time the user glances
 *      at a notification.
 *   2. It can be refused (battery saver, unsupported browser, insecure origin).
 *      We surface that honestly instead of pretending it worked.
 *
 * There is a folk remedy involving a hidden looping <video>. We do not use it:
 * it burns a decoder and several percent of battery all night, breaks when the
 * page is backgrounded anyway, and is exactly the kind of trick that gets an app
 * throttled. On Android the real app uses FLAG_KEEP_SCREEN_ON, which actually
 * does guarantee this.
 */

export const WAKE = {
  UNSUPPORTED: 'unsupported',
  IDLE: 'idle',
  HELD: 'held',
  DENIED: 'denied',
};

export function createWakeLock(onStatus = () => {}) {
  const supported = 'wakeLock' in navigator;
  let sentinel = null;
  let wanted = false;
  let status = supported ? WAKE.IDLE : WAKE.UNSUPPORTED;
  let lastError = null;

  const set = (s, err = null) => {
    if (s === status && err === lastError) return;
    status = s; lastError = err;
    onStatus(status, lastError);
  };

  async function acquire() {
    if (!supported || !wanted || sentinel) return;
    if (document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
        // Released by the system (tab hidden, power save). If we still want it,
        // visibilitychange will bring it back; otherwise report honestly.
        if (wanted && document.visibilityState === 'visible') set(WAKE.IDLE);
      });
      set(WAKE.HELD);
    } catch (err) {
      sentinel = null;
      set(WAKE.DENIED, err?.message || String(err));
    }
  }

  async function release() {
    const s = sentinel;
    sentinel = null;
    if (s) { try { await s.release(); } catch {} }
    if (!wanted) set(supported ? WAKE.IDLE : WAKE.UNSUPPORTED);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && wanted) acquire();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get supported() { return supported; },
    get status() { return status; },
    get error() { return lastError; },
    get active() { return !!sentinel; },
    async enable() { wanted = true; await acquire(); },
    async disable() { wanted = false; await release(); },
    /** Remove listeners. Safe to call more than once. */
    dispose() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    },
  };
}
