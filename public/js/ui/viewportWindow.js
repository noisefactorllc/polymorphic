/**
 * Viewport window module.
 *
 * Opens a popup browser window that mirrors the live canvas at cover-mode
 * scale. Intended for full-screen display on a secondary monitor (projector,
 * external display).
 *
 * @module ui/viewportWindow
 */

let _ctx = null
let _win = null
let _rafId = null
let _cancel = null

// XSS gate: POPUP_HTML is written via document.write into a freshly-opened
// window and contains an inline <script>. It MUST remain a static string —
// never interpolate user input, DSL, program titles, or anything dynamic
// into this template. If you need to pass data to the popup, do it via
// postMessage AFTER load.
const POPUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Polymorphic — Viewport</title>
<!-- Handfish tokens so the popup's --hf-* references resolve to the real
     theme values; the var() fallbacks keep it working before/without CSS. -->
<link rel="stylesheet" href="https://handfish.noisefactor.io/0/styles/tokens.css">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: var(--hf-bg-base, #000); overflow: hidden; cursor: none; }
  canvas { width: 100vw; height: 100vh; display: block; }
  .hint {
    position: fixed; bottom: var(--hf-space-2, 8px); right: var(--hf-space-3, 12px);
    color: var(--hf-text-muted, rgba(255,255,255,0.3)); font-family: var(--hf-font-family-mono, monospace); font-size: var(--hf-size-xs, 11px);
    pointer-events: none; transition: opacity 1s ease 3s; opacity: 1;
  }
  body.played .hint { opacity: 0; }
</style>
</head>
<body class="played">
<canvas id="out"></canvas>
<div class="hint">drag to projector · press F for fullscreen · close to detach</div>
<script>
  const out = document.getElementById('out');
  const ctx = out.getContext('2d');
  let stopped = false;
  function fit() { out.width = window.innerWidth; out.height = window.innerHeight; }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
  });
  window._polymorphicViewport = {
    draw(source) {
      if (stopped) return;
      // Letterbox fill: resolve the theme token each frame so the bars around
      // the mirrored canvas follow --hf-bg-base (never a hard-coded black).
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, out.width, out.height);
      if (!source) return;
      const sw = source.width || 1280;
      const sh = source.height || 720;
      const ar = sw / sh;
      const cw = out.width;
      const ch = out.height;
      let dw, dh;
      if (cw / ch > ar) { dw = cw; dh = cw / ar; }
      else { dh = ch; dw = ch * ar; }
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      try { ctx.drawImage(source, dx, dy, dw, dh); } catch {}
    },
    stop() { stopped = true; }
  };
</script>
</body>
</html>`

/**
 * Receives the source canvas reference. Called by embed.js on setup.
 *
 * @param {{canvas: HTMLCanvasElement}} ctx
 */
export function configureViewportWindow(ctx) {
    _ctx = ctx
}

/**
 * @returns {boolean} true if the popup is open and not closed by the user.
 */
export function isViewportWindowOpen() {
    return !!_win && !_win.closed
}

/**
 * Open the viewport popup. If already open, focus it. Idempotent.
 */
export function openViewportWindow() {
    if (isViewportWindowOpen()) {
        try { _win.focus() } catch {}
        return
    }
    _doOpen()
}

/**
 * Close the popup if open. Used by teardown paths.
 */
export function closeViewportWindow() {
    if (_rafId && _cancel) {
        try { _cancel(_rafId) } catch {}
    }
    _rafId = null
    _cancel = null
    if (_win && !_win.closed) {
        try { _win._polymorphicViewport?.stop() } catch {}
        _win.close()
    }
    _win = null
}

function _doOpen() {
    if (!_ctx?.canvas) return
    const w = window.open('', 'polymorphic-viewport', 'width=1280,height=720,popup=yes')
    if (!w) {
        alert('Viewport window blocked. Allow pop-ups for Polymorphic to use the secondary output.')
        return
    }
    w.document.open()
    w.document.write(POPUP_HTML)
    w.document.close()
    _win = w

    // rAF bound to the popup's window — calling unbound throws Illegal
    // invocation in strict mode.
    const popupWin = _win
    const raf = popupWin.requestAnimationFrame
        ? popupWin.requestAnimationFrame.bind(popupWin)
        : window.requestAnimationFrame.bind(window)
    _cancel = popupWin.cancelAnimationFrame
        ? popupWin.cancelAnimationFrame.bind(popupWin)
        : window.cancelAnimationFrame.bind(window)

    const tick = () => {
        if (!isViewportWindowOpen()) {
            _rafId = null
            return
        }
        try {
            _win._polymorphicViewport?.draw(_ctx.canvas)
        } catch {}
        _rafId = raf(tick)
    }
    // Defer one tick so the popup's inline script has time to attach.
    setTimeout(tick, 50)
}
