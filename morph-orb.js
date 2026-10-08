/* MorphOrb — vanilla port of the 21st.dev "ai thinking orb and input" (MorphOrb) component.
   The timeline engine, easing curves, track data and the dotted canvas orb are the original's;
   what changed is the starting shape: instead of the component's own pill input, the flight
   starts from any element (the Ticket composer), and the "answer" is whatever the caller resolves.

   window.MorphOrb.run({
     from:      HTMLElement   — the box that turns into the ball (hidden while the orb runs)
     submit:    () => Promise — the real work; resolve {title, body} to show, reject to bail out
     labels:    ["Sending", …] — status words cycled under the orb while thinking
     minThink:  ms the orb thinks at least (default 1800)
     resetText: label of the button that brings the box back
   }) → Promise<boolean> (true = answered, false = aborted/failed; the box is visible again either way)
*/
(function () {
  "use strict";

  /* ─────────────────────────── geometry ─────────────────────────── */
  var BALL_SMALL = 60, ORB_D = 132, ORB_R = 66, CANVAS = 220, FLY_D = 138;
  var cardW = function () { return Math.min(340, window.innerWidth - 32); };

  /* ───────────────────────── math + easing ───────────────────────── */
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var fmt = function (v) { return String(Math.round(v * 1e4) / 1e4); };
  var TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cubicBezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var sx = function (t) { return ((ax * t + bx) * t + cx) * t; };
    var sy = function (t) { return ((ay * t + by) * t + cy) * t; };
    var dx = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
    var solve = function (x) {
      var t = x, i, e, d;
      for (i = 0; i < 8; i++) { e = sx(t) - x; if (Math.abs(e) < 1e-6) return t; d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 40; i++) { e = sx(t); if (Math.abs(e - x) < 1e-6) break; if (x > e) lo = t; else hi = t; t = (hi - lo) / 2 + lo; }
      return t;
    };
    return function (x) { return x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)); };
  }
  var E = {
    out: cubicBezier(0.22, 1, 0.36, 1), io: cubicBezier(0.65, 0, 0.35, 1), in: cubicBezier(0.4, 0, 1, 1),
    fly: cubicBezier(0.5, 0, 0.1, 1), grow: cubicBezier(0.3, 0, 0.2, 1), vortex: cubicBezier(0.6, 0, 0.2, 1),
    spring: cubicBezier(0.34, 1.4, 0.64, 1), card: cubicBezier(0.65, 0, 0.2, 1), lin: function (t) { return t; }
  };
  var bez = function (t, p0, c, p2) { return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * c + t * t * p2; };

  /* ───────────────────────── timeline data ───────────────────────── */
  function T(ch, from, to, t0, t1, ease) { return { ch: ch, from: from, to: to, t0: t0, t1: t1, ease: ease || E.io }; }

  // launch: the box squeezes, collapses into the ball, which flies up and grows into the orb
  function launchTracks(g) {
    return [
      T("w", g.bw, g.bw - 12, 0, 100, E.out),
      T("h", g.bh, g.bh - 6, 0, 100, E.out),
      T("oGlow", 1, 0, 0, 300, E.out),
      T("w", g.bw - 12, BALL_SMALL, 100, 560, E.io),
      T("h", g.bh - 6, BALL_SMALL + 6, 100, 500, E.io),
      T("h", BALL_SMALL + 6, BALL_SMALL, 500, 620, E.out),
      T("r", g.br, BALL_SMALL / 2, 100, 560, E.io),
      T("oPill", 1, 0, 300, 560, E.out),
      T("oBall", 0, 1, 300, 560, E.out),
      T("u", 0, 1, 620, 1500, E.fly),
      T("w", BALL_SMALL, FLY_D, 620, 1300, E.grow),
      T("h", BALL_SMALL, FLY_D, 620, 1300, E.grow),
      T("r", BALL_SMALL / 2, FLY_D / 2, 620, 1300, E.grow),
      T("w", FLY_D, ORB_D, 1300, 1500, E.out),
      T("h", FLY_D, ORB_D, 1300, 1500, E.out),
      T("r", FLY_D / 2, ORB_D / 2, 1300, 1500, E.out),
      T("cHalo", 0, 0.6, 620, 1500, E.out),
    ];
  }
  var ASSEMBLE = [
    T("oRing", 1, 0, 0, 300, E.out), T("oBall", 1, 0, 0, 260, E.out),
    T("orb.k", 0, 1, 0, 800, E.out), T("orb.alpha", 0, 1, 0, 800, E.out), T("orb.spin", 0, 0.9, 0, 800, E.out),
    T("orb.pop", 1, 1.05, 0, 420, E.out), T("orb.pop", 1.05, 1, 420, 800, E.io),
    T("sOp", 0, 1, 300, 620, E.out), T("sTy", 6, 0, 300, 620, E.out)
  ];
  var RESOLVE = [
    T("orb.sweep", 0, 1, 0, 700, E.io), T("orb.spin", 0.9, 0.3, 0, 700, E.out), T("orb.gain", 1, 0, 0, 700, E.out),
    T("orb.floor", 0, 0.95, 400, 900, E.out), T("orb.rad", 0, 0.15, 400, 900, E.out),
    T("orb.pop", 1, 1.04, 600, 800, E.out), T("orb.pop", 1.04, 1, 800, 900, E.out)
  ];
  var CONDENSE = [
    T("orb.pop", 1, 1.06, 0, 120, E.out), T("sOp", 1, 0, 0, 160, E.in), T("sTy", 0, -6, 0, 160, E.in),
    T("orb.k", 1, 0, 120, 640, E.vortex), T("orb.vortex", 0, 1.6, 120, 640, E.vortex),
    T("oGreen", 0, 1, 260, 700, E.spring), T("gs", 0.55, 1, 260, 700, E.spring),
    T("pulse", 0, 1, 320, 760, E.out), T("oHalo", 0, 0.35, 380, 700, E.out), T("orb.alpha", 1, 0, 500, 800, E.out)
  ];
  function unfoldTracks(g, tw) {
    return [
      T("w", ORB_D, 124, 0, 90, E.in), T("h", ORB_D, 124, 0, 90, E.in),
      T("w", 124, g.cw, 90, 700, E.card), T("h", 124, g.ch, 90, 700, E.out),
      T("r", ORB_D / 2, 20, 90, 700, E.io),
      T("oGreen", 1, 0, 200, 560, E.out), T("oCard", 0, 1, 200, 560, E.out),
      T("oHalo", 0.35, 0, 300, 700, E.out), T("cHalo", 0.6, 0.22, 300, 700, E.out),
      T("hOp", 0, 1, 520, 840, E.out), T("dotS", 0, 1, 520, 840, E.spring),
      T("wp", 0, 1, 600, 600 + tw, E.lin), T("bloom", 1, 0.625, 700, 1200, E.io),
      T("rOp", 0, 1, 900, 1200, E.out)
    ];
  }

  /* ───────────────────────────── dotted orb (original) ───────────────────────────── */
  var RINGS = 16;
  var DOTS = (function () {
    var rand = mulberry32(7), out = [];
    for (var k = 0; k < RINGS; k++) {
      var y = 1 - ((k + 0.5) / RINGS) * 2, r = Math.sqrt(1 - y * y), m = Math.max(4, Math.round(30 * r));
      for (var j = 0; j < m; j++) { var a = (j / m) * TAU + k * 0.35; out.push({ x: Math.cos(a) * r, y: y, z: Math.sin(a) * r, u: (1 - y) / 2, seed: rand() * 6.283 }); }
    }
    return out;
  })();
  var N = DOTS.length;
  var DXa = Float32Array.from(DOTS, function (d) { return d.x; }), DYa = Float32Array.from(DOTS, function (d) { return d.y; });
  var DZa = Float32Array.from(DOTS, function (d) { return d.z; }), DUa = Float32Array.from(DOTS, function (d) { return d.u; });
  var DSa = Float32Array.from(DOTS, function (d) { return d.seed; });
  var G_STEPS = 24, A_STEPS = 48;
  function palette(dark) {
    var out = [], base = dark ? [235, 235, 235] : [26, 26, 26];
    for (var gi = 0; gi <= G_STEPS; gi++) {
      var g = gi / G_STEPS;
      var r = Math.round(lerp(base[0], 52, g)), gg = Math.round(lerp(base[1], 211, g)), b = Math.round(lerp(base[2], 153, g));
      for (var ai = 0; ai <= A_STEPS; ai++) out.push("rgba(" + r + "," + gg + "," + b + "," + (ai / A_STEPS).toFixed(3) + ")");
    }
    return out;
  }
  var ORB_KEYS = ["k", "alpha", "spin", "sweep", "pop", "vortex", "gain", "floor", "rad"];

  function createOrb(canvas, dark) {
    var COLORS = palette(dark);
    var P = { k: 0, alpha: 0, spin: 0, rot: 0, sweep: 0, pop: 1, vortex: 0, gain: 1, floor: 0, rad: 0, prog: 0 };
    var ctx = canvas.getContext("2d");
    var lit = new Float32Array(N), SX = new Float32Array(N), SY = new Float32Array(N), SR = new Float32Array(N), SD = new Float32Array(N), SC = new Int16Array(N);
    var pw = [1, 0, 0, 0], time = 0, raf = 0, last = 0, dead = false;
    if (!ctx) return { P: P, ensure: function () {}, destroy: function () {} };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(CANVAS * dpr); canvas.height = Math.round(CANVAS * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var S = 0.6, CP = Math.cos(0.35), SP = Math.sin(0.35), C0 = CANVAS / 2;

    function draw(dt) {
      ctx.clearRect(0, 0, CANVAS, CANVAS);
      time += dt; P.rot += P.spin * dt;
      var yaw = P.rot + P.vortex, cyw = Math.cos(yaw), syw = Math.sin(yaw), stepW = dt / 0.35, q, n;
      for (q = 0; q < 4; q++) { var d = (q === P.prog ? 1 : 0) - pw[q]; pw[q] += Math.abs(d) <= stepW ? d : d > 0 ? stepW : -stepW; }
      var decay = Math.exp(-dt / 0.5), h0 = (time * 300) % N, h3 = (time * 480) % N;
      var a1 = time * 0.8, b1 = Math.sin(time * 0.5) * 0.9, f1x = Math.cos(b1) * Math.cos(a1), f1y = Math.sin(b1), f1z = Math.cos(b1) * Math.sin(a1);
      var a2 = time * 0.55 + 2.1, b2 = Math.cos(time * 0.42) * 0.9, f2x = Math.cos(b2) * Math.cos(a2), f2y = Math.sin(b2), f2z = Math.cos(b2) * Math.sin(a2);
      var lat = Math.sin(time * 2.2), swirlK = P.vortex * 1.5;
      for (n = 0; n < N; n++) {
        var dx = DXa[n], dy = DYa[n], dz = DZa[n], u = DUa[n], pulse = 0, dd, v;
        if (pw[0] > 0.001) { dd = Math.abs(n - h0); if (dd > N - dd) dd = N - dd; v = Math.max(0, 1 - dd / 16); pulse = Math.max(pulse, v * v * pw[0]); }
        if (pw[1] > 0.001) { var v1 = Math.max(0, (dx * f1x + dy * f1y + dz * f1z - 0.72) / 0.28), v2 = Math.max(0, (dx * f2x + dy * f2y + dz * f2z - 0.72) / 0.28); v = Math.max(v1, v2); pulse = Math.max(pulse, v * v * pw[1]); }
        if (pw[2] > 0.001) { var e = dy - lat; v = Math.max(0, 1 - (e * e) / 0.02); pulse = Math.max(pulse, v * v * pw[2]); }
        if (pw[3] > 0.001) { dd = Math.abs(n - h3); if (dd > N - dd) dd = N - dd; v = Math.max(0, 1 - dd / 22); pulse = Math.max(pulse, v * v * pw[3]); }
        var l = Math.max(lit[n] * decay, pulse * P.gain); lit[n] = l;
        var ki = clamp01(P.k * (1 + S) - S * u);
        if (ki <= 0.001) { SC[n] = -1; continue; }
        var eo = E.out(ki), kk = eo * P.pop;
        var x1 = dx * cyw + dz * syw, z1 = -dx * syw + dz * cyw, y2 = dy * CP - z1 * SP, z2 = dy * SP + z1 * CP;
        var f = 2.8 / (2.8 - z2), depth = (z2 + 1) / 2;
        var ox = x1 * ORB_R * kk * f, oy = -y2 * ORB_R * kk * f;
        if (swirlK > 0.001) { var sw = (1 - ki) * swirlK, cc = Math.cos(sw), ss = Math.sin(sw), tx = ox * cc - oy * ss; oy = ox * ss + oy * cc; ox = tx; }
        var g = clamp01((P.sweep * 1.4 - u) / 0.4);
        var a = 0.1 + 0.035 * Math.sin(DSa[n] + time * 1.6) * (1 - g) + 0.32 * depth * depth + 0.75 * l * (1 - g) + g * (0.55 + 0.4 * depth) + 2 * g * (1 - g);
        a = Math.max(a, P.floor * (0.7 + 0.3 * depth)); if (a > 1) a = 1; a *= eo * P.alpha;
        SX[n] = C0 + ox; SY[n] = C0 + oy; SD[n] = depth;
        SR[n] = (1.15 * (0.45 + 0.75 * depth) * f + 0.9 * l + g * 0.25) * (1 + P.rad) * (0.4 + 0.6 * eo);
        var ai = Math.round(a * A_STEPS), gi = Math.round(g * G_STEPS);
        SC[n] = ai <= 0 ? -1 : gi * (A_STEPS + 1) + ai;
      }
      for (var pass = 0; pass < 2; pass++) for (n = 0; n < N; n++) {
        var c = SC[n]; if (c < 0) continue; if ((SD[n] >= 0.5) !== (pass === 1)) continue;
        ctx.fillStyle = COLORS[c]; ctx.beginPath(); ctx.arc(SX[n], SY[n], SR[n], 0, TAU); ctx.fill();
      }
    }
    function frame(now) {
      raf = 0; if (dead) return;
      var dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      draw(dt);
      if (P.alpha > 0.002) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, CANVAS, CANVAS);
    }
    return {
      P: P,
      ensure: function () { if (raf || dead || P.alpha <= 0.002) return; last = performance.now(); raf = requestAnimationFrame(frame); },
      destroy: function () { dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
  }

  /* ───────────────────────────── styles ───────────────────────────── */
  var CSS = [
    ".mo-layer{position:fixed;inset:0;z-index:9000;pointer-events:none;--oCenter:0}",
    ".mo-halo{position:absolute;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;opacity:var(--oCenter);",
    "background:radial-gradient(closest-side,rgba(52,211,153,.18),rgba(52,211,153,0));}",
    ".mo-mover{position:absolute;width:0;height:0;will-change:transform}",
    ".mo-trail{position:absolute;left:0;top:0;width:100px;height:100px;border-radius:50%;background:#1a1a1a;opacity:0;will-change:transform,opacity}",
    ".mo-actor{position:absolute;left:0;top:0;width:var(--w);height:var(--h);border-radius:var(--r);transform:translate(-50%,-50%);",
    "--oPill:1;--oBall:0;--oGreen:0;--oCard:0;--oRing:1;--oGlow:1;--oHalo:0;--gs:.55;--hOp:0;--dotS:0;--bloom:1;--rOp:0}",
    ".mo-actor>*{position:absolute;inset:0;border-radius:inherit}",
    ".mo-glow{inset:-10px;border-radius:calc(var(--r) + 10px);opacity:var(--oGlow);box-shadow:0 6px 22px rgba(0,0,0,.07)}",
    ".mo-surface{background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 6px 22px rgba(0,0,0,.07);opacity:var(--oPill)}",
    ".mo-ball{background:#1a1a1a;opacity:var(--oBall);box-shadow:0 10px 30px rgba(0,0,0,.18)}",
    ".mo-halo-green{inset:-28px;border-radius:50%;opacity:var(--oHalo);background:radial-gradient(closest-side,rgba(52,211,153,.55),rgba(52,211,153,0))}",
    ".mo-green{background:#34d399;opacity:var(--oGreen);transform:scale(var(--gs));display:flex;align-items:center;justify-content:center;",
    "box-shadow:0 10px 30px rgba(52,211,153,.35)}",
    ".mo-green svg{width:44%;height:44%;stroke:#fff}",
    ".mo-card{background:#fff;border:1px solid rgba(0,0,0,.08);opacity:var(--oCard);",
    "box-shadow:0 calc(14px * var(--bloom)) calc(40px * var(--bloom)) rgba(0,0,0,calc(.1 * var(--bloom)))}",
    ".mo-ring{inset:-1px;border:1px solid rgba(0,0,0,.08);opacity:var(--oRing);background:transparent}",
    ".mo-orb{inset:auto;left:50%;top:50%;width:" + CANVAS + "px;height:" + CANVAS + "px;margin:" + (-CANVAS / 2) + "px 0 0 " + (-CANVAS / 2) + "px;border-radius:0}",
    ".mo-pulse{inset:-2px;border-radius:50%;border:2px solid #34d399;opacity:0}",
    ".mo-answer{inset:0;padding:18px 20px;opacity:var(--hOp);display:flex;flex-direction:column;gap:8px;text-align:left;border-radius:0;overflow:hidden}",
    ".mo-a-head{display:flex;align-items:center;gap:8px;font:600 13px/1.2 var(--font-body,Inter,sans-serif);color:#1a1a1a}",
    ".mo-a-dot{width:8px;height:8px;border-radius:50%;background:#34d399;transform:scale(var(--dotS));flex:none}",
    ".mo-a-body{font:400 14px/1.5 var(--font-body,Inter,sans-serif);color:rgba(26,26,26,.7);margin:0}",
    ".mo-w{display:inline-block;opacity:0}",
    ".mo-status{position:absolute;transform:translate(-50%,calc(var(--sTy,6) * 1px));opacity:var(--sOp,0);height:20px;min-width:160px;",
    "font:500 13px/20px var(--font-body,Inter,sans-serif);color:rgba(26,26,26,.6);text-align:center}",
    ".mo-lab{position:absolute;left:0;right:0;top:0;white-space:nowrap}",
    ".mo-lab.mo-in{animation:mo-in .32s cubic-bezier(.22,1,.36,1) both}",
    ".mo-lab.mo-out{animation:mo-out .22s cubic-bezier(.4,0,1,1) both}",
    ".mo-dots i{display:inline-block;width:3px;height:3px;margin-left:2px;border-radius:50%;background:currentColor;vertical-align:middle;animation:mo-dot 1.2s infinite}",
    ".mo-dots i:nth-child(2){animation-delay:.15s}.mo-dots i:nth-child(3){animation-delay:.3s}",
    ".mo-lab-done{color:#10b981}",
    ".mo-reset{margin-left:auto;opacity:var(--rOp,0);pointer-events:auto;cursor:pointer;",
    "font:500 12px/1 var(--font-body,Inter,sans-serif);color:rgba(26,26,26,.7);background:rgba(0,0,0,.04);border:0;",
    "border-radius:999px;padding:7px 12px}",
    ".mo-reset:hover{color:#1a1a1a;background:rgba(0,0,0,.07)}",
    ".mo-reset[hidden]{display:none}",
    "body.dark .mo-surface,body.dark .mo-card{background:var(--d-surface,#1d1e20);border-color:var(--d-line,rgba(255,255,255,.1));box-shadow:0 10px 30px rgba(0,0,0,.45)}",
    "body.dark .mo-ball,body.dark .mo-trail{background:#eaebec}",
    "body.dark .mo-ring{border-color:var(--d-line,rgba(255,255,255,.1))}",
    "body.dark .mo-a-head{color:var(--d-text,#eaebec)}body.dark .mo-a-body{color:var(--d-text-2,#a9abad)}",
    "body.dark .mo-status{color:var(--d-text-2,#a9abad)}",
    "body.dark .mo-reset{background:rgba(255,255,255,.07);color:var(--d-text-2,#a9abad)}body.dark .mo-reset:hover{color:var(--d-text,#eaebec)}",
    "@keyframes mo-dot{0%,80%,100%{opacity:.25}40%{opacity:1}}",
    "@keyframes mo-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
    "@keyframes mo-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-6px)}}"
  ].join("");
  var styled = false;
  function injectCSS() { if (styled) return; styled = true; var s = document.createElement("style"); s.id = "morph-orb-css"; s.textContent = CSS; document.head.appendChild(s); }

  /* ───────────────────────────── helpers ───────────────────────────── */
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }
  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var running = false;

  /* ───────────────────────────── run ───────────────────────────── */
  function run(opts) {
    if (running) return Promise.resolve(false);
    var from = opts.from, labels = opts.labels || ["Sending", "Delivering", "Almost there"];
    if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // no motion: just do the work
      return Promise.resolve().then(opts.submit).then(function () { return true; }, function () { return false; });
    }
    running = true;
    injectCSS();
    var dark = document.body.classList.contains("dark");
    var rect = from.getBoundingClientRect();
    var br = parseFloat(getComputedStyle(from).borderTopLeftRadius) || 24;
    var home = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    // the orb thinks where the box was: the ball arcs up and lands back on that spot
    var stage = { x: home.x, y: home.y };
    var geo = { bw: rect.width, bh: rect.height, br: br, cw: cardW(), ch: 116, dir: Math.random() < 0.5 ? -1 : 1 };

    /* DOM */
    var layer = el("div", "mo-layer", document.body);
    layer.setAttribute("aria-hidden", "true");
    var halo = el("div", "mo-halo", layer);
    halo.style.left = stage.x + "px"; halo.style.top = stage.y + "px";
    var mover = el("div", "mo-mover", layer);
    mover.style.left = stage.x + "px"; mover.style.top = stage.y + "px";
    var ghosts = [];
    for (var i = 0; i < 6; i++) ghosts.push(el("span", "mo-trail", mover));
    var actor = el("div", "mo-actor", mover);
    el("div", "mo-glow", actor);
    el("div", "mo-halo-green", actor);
    el("div", "mo-surface", actor);
    el("div", "mo-ball", actor);
    var green = el("div", "mo-green", actor);
    green.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    el("div", "mo-card", actor);
    el("div", "mo-ring", actor);
    var canvas = el("canvas", "mo-orb", actor);
    var pulse = el("div", "mo-pulse", actor);
    var answer = el("div", "mo-answer", actor);
    var status = el("div", "mo-status", layer);
    status.style.left = stage.x + "px"; status.style.top = (stage.y + ORB_R + 22) + "px";
    var resetBtn = el("button", "mo-reset");
    resetBtn.type = "button"; resetBtn.textContent = opts.resetText || "Send another";
    resetBtn.hidden = true;

    var orb = createOrb(canvas, dark);
    var vals = {}, dirty = {}, CH = {};
    var curX = 0, curY = 0, curD = BALL_SMALL, trailVis = 0, hist = [], wStagger = 45, wDur = 320;

    /* flight path + comet trail (original) */
    function sampleAt(t, out) {
      var n = hist.length;
      if (!n) { out.x = 0; out.y = 0; out.d = 0; return; }
      if (t <= hist[0].t) { out.x = hist[0].x; out.y = hist[0].y; out.d = hist[0].d; return; }
      for (var j = n - 1; j > 0; j--) {
        var a = hist[j - 1], b = hist[j];
        if (t >= a.t) { if (t >= b.t) { out.x = b.x; out.y = b.y; out.d = b.d; return; } var k = (t - a.t) / (b.t - a.t || 1); out.x = lerp(a.x, b.x, k); out.y = lerp(a.y, b.y, k); out.d = lerp(a.d, b.d, k); return; }
      }
      out.x = hist[n - 1].x; out.y = hist[n - 1].y; out.d = hist[n - 1].d;
    }
    var tmp = { x: 0, y: 0, d: 0 };
    function renderTrail() {
      if (trailVis <= 0.001) { ghosts.forEach(function (g) { g.style.opacity = "0"; }); return; }
      var now = performance.now();
      for (var j = 0; j < ghosts.length; j++) {
        sampleAt(now - (j + 1) * 45, tmp);
        var k = (tmp.d * (1 - 0.08 * (j + 1))) / 100;
        ghosts[j].style.transform = "translate3d(" + (tmp.x - curX).toFixed(2) + "px," + (tmp.y - curY).toFixed(2) + "px,0) translate(-50%,-50%) scale(" + k.toFixed(3) + ")";
        ghosts[j].style.opacity = (0.28 * Math.pow(1 - j / 6, 1.5) * trailVis).toFixed(3);
      }
    }
    var span = 0;   // the box turns into the orb in place, no flight
    function applyPath() {
      var u = vals.u || 0;
      curX = bez(u, 0, geo.dir * 0.3 * span, 0);
      curY = bez(u, 0, -span, 0);
      mover.style.transform = "translate3d(" + curX.toFixed(2) + "px," + curY.toFixed(2) + "px,0)";
      var now = performance.now();
      hist.push({ t: now, x: curX, y: curY, d: curD });
      while (hist.length > 2 && hist[0].t < now - 500) hist.shift();
      renderTrail();
    }
    function applyWords(v) {
      var nodes = answer.querySelectorAll(".mo-w");
      var total = (nodes.length - 1) * wStagger + wDur, time = v * total;
      for (var j = 0; j < nodes.length; j++) {
        var p = E.out(clamp01((time - j * wStagger) / wDur));
        nodes[j].style.opacity = fmt(p);
        nodes[j].style.transform = p >= 0.999 ? "none" : "translateY(" + fmt((1 - p) * 4) + "px)";
        nodes[j].style.filter = p >= 0.999 ? "none" : "blur(" + fmt((1 - p) * 4) + "px)";
      }
    }

    /* channels (original, minus the input-only ones) */
    ["oGlow", "oHalo", "oPill", "oBall", "oGreen", "oCard", "oRing", "gs", "hOp", "dotS", "bloom"].forEach(function (n) { CH[n] = function (v) { actor.style.setProperty("--" + n, fmt(v)); }; });
    ["w", "h", "r"].forEach(function (n) { CH[n] = function (v) { actor.style.setProperty("--" + n, fmt(v) + "px"); if (n === "w") curD = v; }; });
    CH.sOp = function (v) { status.style.setProperty("--sOp", fmt(v)); };
    CH.sTy = function (v) { status.style.setProperty("--sTy", fmt(v)); };
    CH.cHalo = function (v) { layer.style.setProperty("--oCenter", fmt(v)); };
    CH.u = applyPath;
    CH.trail = function (v) { trailVis = v; renderTrail(); };
    CH.pulse = function (v) { if (v < 0) { pulse.style.opacity = "0"; return; } pulse.style.opacity = fmt(0.5 * (1 - v)); pulse.style.transform = "scale(" + fmt(1 + v) + ")"; };
    CH.wp = applyWords;
    CH.rOp = function (v) { actor.style.setProperty("--rOp", fmt(v)); };
    ORB_KEYS.forEach(function (name) { CH["orb." + name] = function (v) { orb.P[name] = v; if (name === "alpha") orb.ensure(); }; });

    function set(ch, v) { vals[ch] = v; dirty[ch] = 1; }
    function flush() { for (var ch in dirty) if (CH[ch]) CH[ch](vals[ch]); dirty = {}; }
    function setNow(ch, v) { vals[ch] = v; if (CH[ch]) CH[ch](v); }

    function play(tracks) {
      return new Promise(function (res) {
        var end = 0; tracks.forEach(function (k) { end = Math.max(end, k.t1); });
        var done = [], t = 0, last = performance.now();
        function step(now) {
          var dt = Math.max(0, Math.min(100, now - last)); last = now; t += dt;
          for (var j = 0; j < tracks.length; j++) {
            var k = tracks[j];
            if (done[j] || t < k.t0) continue;
            var p = Math.min(1, (t - k.t0) / Math.max(1, k.t1 - k.t0));
            set(k.ch, k.from + (k.to - k.from) * k.ease(p));
            if (p === 1) done[j] = 1;
          }
          flush();
          if (t >= end) res(); else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }

    /* status label swap (original's label loop) */
    var curLab = null;
    function swapLabel(name, isDone) {
      if (curLab) { curLab.className = "mo-lab mo-out"; var old = curLab; setTimeout(function () { old.remove(); }, 240); }
      curLab = el("span", "mo-lab mo-in", status);
      curLab.innerHTML = isDone ? '<span class="mo-lab-done">' + escapeHTML(name) + "</span>" : escapeHTML(name) + '<span class="mo-dots"><i></i><i></i><i></i></span>';
    }

    /* start state: an exact stand-in for the box */
    setNow("w", geo.bw); setNow("h", geo.bh); setNow("r", geo.br);
    ["oGlow", "oPill", "oRing"].forEach(function (c) { setNow(c, 1); });
    ["oBall", "oGreen", "oCard", "oHalo", "hOp", "dotS", "u", "trail", "cHalo", "sOp", "rOp"].forEach(function (c) { setNow(c, 0); });
    setNow("gs", 0.55); setNow("bloom", 1); setNow("sTy", 6); setNow("pulse", -1);
    from.style.transition = "none";
    from.style.visibility = "hidden";
    var others = (opts.hide || []).filter(Boolean);
    others.forEach(function (o) { o.style.transition = "opacity .22s ease"; o.style.opacity = "0"; o.style.pointerEvents = "none"; });

    function teardown() {
      orb.destroy(); layer.remove(); running = false;
      from.style.visibility = ""; from.style.opacity = "0";
      others.forEach(function (o) { o.style.transition = "opacity .32s cubic-bezier(.22,1,.36,1)"; o.style.opacity = ""; o.style.pointerEvents = ""; });
      from.style.transition = "opacity .32s cubic-bezier(.22,1,.36,1)";
      requestAnimationFrame(function () { from.style.opacity = "1"; setTimeout(function () { from.style.transition = ""; from.style.opacity = ""; }, 380); });
    }
    function fadeOut() {
      var outT = [T("cHalo", vals.cHalo || 0, 0, 0, 220, E.out), T("rOp", vals.rOp || 0, 0, 0, 160, E.out)];
      ["oGlow", "oPill", "oBall", "oGreen", "oCard", "oRing", "oHalo", "sOp", "orb.alpha", "trail", "hOp"].forEach(function (ch) { var v = vals[ch] || 0; if (v > 0.001) outT.push(T(ch, v, 0, 0, 220, E.out)); });
      return play(outT);
    }

    var work = Promise.resolve().then(opts.submit), t0 = 0;
    var stopLabels = false;

    return (async function () {
      await play(launchTracks(geo));
      await play(ASSEMBLE);
      swapLabel(labels[0]);
      t0 = performance.now();
      // think until the work has settled and the minimum time is up
      (async function () { var i = 0; for (;;) { await sleep(1150); if (stopLabels) return; i = (i + 1) % labels.length; orb.P.prog = i % 4; swapLabel(labels[i]); } })();
      var result, failed = false;
      try { result = await work; } catch (e) { failed = true; }
      await sleep((opts.minThink || 2300) - (performance.now() - t0));
      stopLabels = true;
      if (failed) { await fadeOut(); teardown(); return false; }

      var title = (result && result.title) || "Sent", body = (result && result.body) || "";
      var words = body.split(/\s+/).filter(Boolean), n = Math.max(1, words.length);
      swapLabel(opts.doneText || "Done", true);
      await play(RESOLVE);
      await play(CONDENSE);
      wStagger = n > 1 ? Math.min(45, 280 / (n - 1)) : 0;
      answer.innerHTML = '<div class="mo-a-head"><i class="mo-a-dot"></i><span>' + escapeHTML(title) + '</span></div><p class="mo-a-body">' +
        words.map(function (w) { return '<span class="mo-w">' + escapeHTML(w) + "</span>"; }).join(" ") + "</p>";
      answer.querySelector(".mo-a-head").appendChild(resetBtn);
      // card height follows the message
      geo.ch = Math.max(96, Math.min(220, 18 + 20 + 8 + Math.ceil(body.length * 7.2 / (geo.cw - 40)) * 21 + 18));
      resetBtn.hidden = false;
      // listen from the moment the button exists, so a click during the unfold is not lost
      var asked = new Promise(function (res) {
        function done() { document.removeEventListener("keydown", onKey); res(); }
        function onKey(e) { if (e.key === "Escape") done(); }
        resetBtn.addEventListener("click", done, { once: true });
        document.addEventListener("keydown", onKey);
      });
      await play(unfoldTracks(geo, (n - 1) * wStagger + wDur));

      // answered: wait for the button (or Escape), then hand the box back
      await asked;
      await fadeOut();
      teardown();
      return true;
    })();
  }

  window.MorphOrb = { run: run };
})();
