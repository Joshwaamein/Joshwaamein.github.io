/* =====================================================================
 * Matrix-style digital rain background.
 * Lightweight: single canvas, requestAnimationFrame, throttled to ~30 fps.
 * Theme-reactive (reads --bg + --accent), respects prefers-reduced-motion,
 * pauses when tab hidden, disabled in a11y mode or when toggled off.
 * ===================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('matrix-rain');
  if (!canvas) return;

  var ctx = canvas.getContext('2d', { alpha: true });
  var root = document.documentElement;
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)');

  var GLYPHS = (
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
    '$+-*/=%"\'#&_(){}[]<>:;.,'
  ).split('');

  var FONT_SIZE = 16;
  var TARGET_FPS = 30;
  var FRAME_MS = 1000 / TARGET_FPS;

  var dpr = 1, columns = 0, drops = [], speeds = [];
  var running = true, lastFrame = 0, raf = null;

  function getVar(name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hexToRgba(hex, a) {
    hex = (hex || '').replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.slice(0, 2), 16) || 0;
    var g = parseInt(hex.slice(2, 4), 16) || 0;
    var b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    columns = Math.ceil(w / FONT_SIZE);
    drops = new Array(columns); speeds = new Array(columns);
    for (var i = 0; i < columns; i++) {
      drops[i] = Math.random() * -50;
      speeds[i] = 0.5 + Math.random() * 0.7;
    }
  }

  function draw(ts) {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    if (ts - lastFrame < FRAME_MS) return;
    lastFrame = ts;

    var w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.fillStyle = hexToRgba(getVar('--bg', '#0d1117'), 0.08);
    ctx.fillRect(0, 0, w, h);

    var accent = getVar('--accent', '#00ff41');
    ctx.font = FONT_SIZE + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = accent;
    ctx.shadowBlur = 6;
    ctx.shadowColor = accent;

    for (var i = 0; i < columns; i++) {
      var x = i * FONT_SIZE;
      var y = drops[i] * FONT_SIZE;
      var ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      ctx.fillText(ch, x, y);
      if (y > h && Math.random() > 0.965) drops[i] = -Math.random() * 20;
      else drops[i] += speeds[i];
    }
    ctx.shadowBlur = 0;
  }

  function shouldRun() {
    if (rm.matches) return false;
    if (root.getAttribute('data-rain') === 'off') return false;
    if (root.getAttribute('data-a11y') === 'true') return false;
    if (document.hidden) return false;
    return true;
  }
  function start() { if (raf) return; running = true; lastFrame = 0; raf = requestAnimationFrame(draw); }
  function stop()  { running = false; if (raf) cancelAnimationFrame(raf); raf = null; if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function sync()  { shouldRun() ? start() : stop(); }

  window.addEventListener('resize', function () { resize(); }, { passive: true });
  document.addEventListener('visibilitychange', sync);
  if (rm.addEventListener) rm.addEventListener('change', sync);

  new MutationObserver(sync).observe(root, {
    attributes: true,
    attributeFilter: ['data-rain', 'data-a11y', 'data-theme']
  });

  resize();
  sync();
})();
