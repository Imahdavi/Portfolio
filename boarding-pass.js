/* Boarding pass — 21st.dev's "Lunar Boarding Pass", the invoice's second design.

   A two-sided ticket. The cover is a black pass with a halftone Moon in the
   stub — its seas and bright craters placed from real selenographic
   coordinates, the landing site marked — lit through its phases as the
   pointer sweeps across, in a star field with a clarinet that plays and a
   Saturn V that fires when pointed at. The other side is a silver pass with
   a perforated stub that tears off. Click the ticket, or the switch under
   it, to turn it over.

   This site has no React, TypeScript or build step, so it is the source's
   own maths, drawing and stylesheet with the types taken out and the JSX
   written as markup. Every number is the source's. What is new is what the
   invoice needs:

   - It is filled from a model rather than props, and filling it again only
     rewrites the text. The art, the Moon's lattice and the flip are built
     once: the form calls update() on every keystroke, and rebuilding the
     Moon each time would stall typing.
   - The stamp shows the invoice's status rather than waiting for the stub
     to be torn; tearing it is still there, as play.
   - snapshot() hands back the side that is showing, flat, with the Moon
     copied into an image, for the PNG and PDF exports.
   - Class names start rc-tk-, so the exports' stylesheet copier (which
     takes every .inv-paper and .rc- rule) carries them across.
   - The field labels are a fifth larger (.72cqw for .6): on a ticket they
     are flavour, on an invoice they say which number is the total.

   Use: BoardingPass.mount(host) → { update(model), snapshot(), destroy() }. */
(function () {
  "use strict";

  // #region pass — pure: coordinates, the Moon's surface and light, stars, drag maths.

  const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);

  const smoothstep = (a, b, x) => {
    if (a === b) return x < a ? 0 : 1;
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  const finite = v => (Number.isFinite(v) ? v : 0);

  /** 0.67416 → 0°40'27"N. Seconds are rounded and carry into minutes and degrees. */
  const toDMS = (deg, pos, neg) => {
    const d = finite(deg);
    let s = Math.round(Math.abs(d) * 3600);
    const D = Math.floor(s / 3600);
    s -= D * 3600;
    const M = Math.floor(s / 60);
    s -= M * 60;
    const pad = n => (n < 10 ? "0" : "") + n;
    return D + "°" + pad(M) + "'" + pad(s) + '"' + (d < 0 ? neg : pos);
  };

  const coordsDMS = (lat, lon) => toDMS(lat, "N", "S") + " " + toDMS(lon, "E", "W");

  /** Selenographic lat/lon (degrees) → unit vector, viewer-facing: x right, y down, z toward us. */
  const project = (lat, lon) => {
    const a = (finite(lat) * Math.PI) / 180;
    const b = (finite(lon) * Math.PI) / 180;
    return [Math.cos(a) * Math.sin(b), -Math.sin(a), Math.cos(a) * Math.cos(b)];
  };

  /** Great-circle distance in degrees. */
  const angDist = (lat1, lon1, lat2, lon2) => {
    const p = project(lat1, lon1);
    const q = project(lat2, lon2);
    const d = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    return (Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * 180) / Math.PI;
  };

  const hash2 = (i, j) => {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  const valueNoise = (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j);
    const b = hash2(i + 1, j);
    const c = hash2(i, j + 1);
    const d = hash2(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  /** The dark seas: lat, lon, radius (degrees), depth. Rough, but where they really are. */
  const MARIA = [
    [18, -57, 26, 0.7], // Oceanus Procellarum
    [33, -16, 17, 0.85], // Imbrium
    [28, 17.5, 9.5, 0.85], // Serenitatis
    [8.5, 31, 11, 0.85], // Tranquillitatis
    [17, 59, 7, 0.9], // Crisium
    [-8, 51, 9, 0.7], // Fecunditatis
    [-15, 35, 5, 0.7], // Nectaris
    [-21, -17, 10, 0.65], // Nubium
    [-24, -39, 5, 0.75], // Humorum
    [-10, -23, 6, 0.6], // Cognitum
    [13, 4, 4, 0.6], // Vaporum
    [57, 0, 8, 0.6], // Frigoris
    [56, -30, 7, 0.55],
    [56, 28, 6, 0.5],
  ];

  /** Bright young craters: lat, lon, radius, brightness. Tycho, Copernicus, Kepler, Aristarchus. */
  const BRIGHT = [
    [-43.3, -11.2, 5, 0.45],
    [9.6, -20.1, 3.5, 0.35],
    [8.1, -38, 2.5, 0.3],
    [23.7, -47.4, 2.5, 0.4],
  ];

  /** How much light the surface returns at a point, 0 → 1. */
  const albedo = (lat, lon) => {
    let keep = 1;
    for (const m of MARIA) {
      const t = angDist(lat, lon, m[0], m[1]) / m[2];
      if (t < 1) {
        const w = 1 - t * t;
        keep *= 1 - m[3] * w * w;
      }
    }
    let a = 0.22 + 0.66 * keep;
    for (const b of BRIGHT) {
      const t = angDist(lat, lon, b[0], b[1]) / b[2];
      if (t < 1) a += b[3] * (1 - t) * (1 - t);
    }
    a += (valueNoise(lat * 0.21 + 40, lon * 0.21 + 40) - 0.5) * 0.18;
    a += (valueNoise(lat * 0.9, lon * 0.9) - 0.5) * 0.08;
    return clamp01(a);
  };

  /** How far to turn the Moon so a landing site sits on the face the stub shows.
      The stub crops the western limb, so a site west of 12°E is turned east. */
  const turnFor = lon => Math.max(0, Math.min(60, 12 - finite(lon)));

  /** The halftone grid: every dot inside a disc of radius r at (cx, cy), spaced
      `cell` apart on a hex lattice, the globe turned east by `turn` degrees.
      Flat: x, y, nx, ny, nz, albedo per dot. */
  const moonDots = (cx, cy, r, cell, turn) => {
    const out = [];
    if (!(r > 0) || !(cell > 0)) return out;
    const row = cell * 0.866;
    let k = 0;
    for (let y = cy - r; y <= cy + r; y += row, k++) {
      for (let x = cx - r + (k % 2 ? cell / 2 : 0); x <= cx + r; x += cell) {
        const nx = (x - cx) / r;
        const ny = (y - cy) / r;
        const q = nx * nx + ny * ny;
        if (q >= 1) continue;
        const nz = Math.sqrt(1 - q);
        const lat = (Math.asin(-ny) * 180) / Math.PI;
        const lon = (Math.atan2(nx, nz) * 180) / Math.PI - finite(turn);
        out.push(x, y, nx, ny, nz, albedo(lat, lon));
      }
    }
    return out;
  };

  /** Pointer across the ticket (0 → 1) → light direction. Left edge: crescent lit
      from the left; centre: full; right: lit from the right. */
  const lightFrom = (px, py) => {
    const phi = ((clamp01(finite(px)) - 0.5) * 2 * 150 * Math.PI) / 180;
    const v = [Math.sin(phi), (clamp01(finite(py)) - 0.5) * 0.9, Math.cos(phi)];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  };

  /** Where the light rests when no one is pointing: a slow sway around a waning gibbous. */
  const idleAt = seconds => 0.56 + Math.sin((finite(seconds) * Math.PI * 2) / 26) * 0.07;

  /** Dot radius for one surface point under light l. Never negative, never wider than a cell. */
  const dotRadius = (alb, nx, ny, nz, l, cell) => {
    const lit = smoothstep(-0.08, 0.32, nx * l[0] + ny * l[1] + nz * l[2]);
    const b = clamp01(alb) * (0.07 + 0.93 * lit) * (0.7 + 0.3 * nz);
    return cell * 0.46 * Math.pow(b, 0.8);
  };

  /** Pointer (0 → 1) → [rotateX, rotateY] in degrees. */
  const tiltFrom = (px, py, max) => [
    -(clamp01(finite(py)) - 0.5) * 2 * max,
    (clamp01(finite(px)) - 0.5) * 2 * max,
  ];

  /** A drag past a fifth of the stub, or a quick flick, tears it. */
  const tearDecision = (dx, v, w) => dx > w * 0.2 || (v > 0.5 && dx > w * 0.05);

  /** The stub follows the finger freely at first, then stiffens like paper. */
  const resist = (dx, w) => {
    const d = Math.max(0, finite(dx));
    const lim = Math.max(1, w) * 0.12;
    return d < lim ? d : lim + (d - lim) * 0.22;
  };

  const mulberry = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** n stars in a box: x, y, radius, twinkles (0/1), delay (s). Same seed, same sky. */
  const starField = (seed, n, x0, x1, y0, y1) => {
    const rnd = mulberry(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const big = rnd() < 0.12;
      out.push([
        x0 + rnd() * (x1 - x0),
        y0 + rnd() * (y1 - y0),
        big ? 0.9 + rnd() * 0.8 : 0.3 + rnd() * 0.5,
        big || rnd() < 0.1 ? 1 : 0,
        Math.round(rnd() * 40) / 10,
      ]);
    }
    return out;
  };
  // #endregion

  const VIEW_W = 1000;
  const VIEW_H = 330;
  /** The Moon in the front stub (226 wide): centre and radius in stub fractions. */
  const MOON = { x: 53 / 226, y: 201 / 330, r: 128 / 226 };
  /** Tranquility Base: printed on the cover and marked on the Moon. */
  const LAT = 0.67416, LON = 23.47314;
  const TILT = 6;

  const NIGHT = "#0b0b0c", STAR_INK = "#f1f0eb";

  const pts = a => a.map(p => p[0] + "," + p[1]).join(" ");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const STARS = starField(1969, 120, 240, 990, 10, 320);

  /* The source's stylesheet, renamed lbp- → rc-tk-. Two additions at the
     end: the invoice's own stamp colours and Persian type. */
  const CSS = [
    ".rc-tk{position:relative;width:100%;margin:0 auto;",
    "--rc-tk-night:" + NIGHT + ";--rc-tk-star:" + STAR_INK + ";--rc-tk-paper:#c9c9c6;--rc-tk-ink:#1b1b1b;",
    "--rc-tk-rule:color-mix(in srgb,#1b1b1b 55%,transparent);--rc-tk-stamp:#a3362a;",
    '--rc-tk-cond:"Oswald","Bebas Neue","Avenir Next Condensed","Helvetica Neue","Arial Narrow","Roboto Condensed","Liberation Sans Narrow","DejaVu Sans Condensed",sans-serif;',
    '--rc-tk-mono:"Courier Prime","IBM Plex Mono","Courier New",ui-monospace,monospace;',
    '--rc-tk-disp:"Futura","Century Gothic","Avenir Next","Josefin Sans","Quicksand",ui-sans-serif,sans-serif}',
    ".rc-tk-stage{position:relative;width:100%;aspect-ratio:1000/330;container-type:inline-size;perspective:1800px;touch-action:pan-y}",
    ".rc-tk-tilt,.rc-tk-flip{position:absolute;inset:0;transform-style:preserve-3d}",
    ".rc-tk-tilt{transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .6s cubic-bezier(.2,.8,.2,1)}",
    ".rc-tk-flip{cursor:pointer;transition:transform 1.05s cubic-bezier(.65,-0.2,.25,1.2)}",
    ".rc-tk-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;",
    "filter:drop-shadow(0 1.4cqw 1.8cqw rgba(0,0,0,.2)) drop-shadow(0 .25cqw .35cqw rgba(0,0,0,.14))}",
    ".rc-tk-back{transform:rotateY(180deg)}",
    ".rc-tk-night{position:absolute;inset:0;overflow:hidden;border-radius:.35cqw;background:var(--rc-tk-night);color:var(--rc-tk-star);",
    "box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc-tk-star) 9%,transparent)}",
    ".rc-tk-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;max-width:none}",
    ".rc-tk-grain{opacity:.16;mix-blend-mode:screen}",
    ".rc-tk-piece .rc-tk-grain{opacity:.3;mix-blend-mode:multiply}",
    ".rc-tk-glow{background:radial-gradient(circle at var(--mx,50%) var(--my,40%),color-mix(in srgb,var(--rc-tk-star) 12%,transparent),transparent 42%)}",
    ".rc-tk-piece{position:absolute;top:0;bottom:0;overflow:hidden;color:var(--rc-tk-ink);box-sizing:border-box;",
    "background:linear-gradient(162deg,color-mix(in srgb,var(--rc-tk-paper) 82%,#fff) 0%,var(--rc-tk-paper) 48%,color-mix(in srgb,var(--rc-tk-paper) 88%,#000) 100%)}",
    ".rc-tk-main{left:0;width:77.4%;border-radius:.35cqw 0 0 .35cqw;padding:2.3cqw 2.6cqw 2.1cqw;display:flex;flex-direction:column;",
    "-webkit-mask:radial-gradient(circle at 100% 50%,#0000 .2cqw,#000 .24cqw) 0 0/100% .86cqw repeat-y;",
    "mask:radial-gradient(circle at 100% 50%,#0000 .2cqw,#000 .24cqw) 0 0/100% .86cqw repeat-y}",
    ".rc-tk-stub{left:77.4%;width:22.6%;border-radius:0 .35cqw .35cqw 0;padding:2.3cqw 1.9cqw 2.1cqw;display:flex;flex-direction:column;",
    "font:inherit;text-align:left;border:0;margin:0;cursor:grab;touch-action:pan-y;transform-origin:0 100%;",
    "transition:transform .75s cubic-bezier(.2,.9,.25,1.25);",
    "-webkit-mask:radial-gradient(circle at 0 50%,#0000 .2cqw,#000 .24cqw) 0 0/100% .86cqw repeat-y;",
    "mask:radial-gradient(circle at 0 50%,#0000 .2cqw,#000 .24cqw) 0 0/100% .86cqw repeat-y}",
    ".rc-tk-stub:active{cursor:grabbing}",
    ".rc-tk-stub:focus-visible{outline:2px solid var(--rc-tk-stamp);outline-offset:-4px}",
    ".rc-tk-stub.is-torn{transform:translate(2.4cqw,1.1cqw) rotate(4deg);cursor:pointer}",
    ".rc-tk-foil{background:linear-gradient(115deg,transparent calc(var(--mx,50%) - 24%),rgba(255,255,255,.62) var(--mx,50%),transparent calc(var(--mx,50%) + 24%)) no-repeat;mix-blend-mode:soft-light}",
    ".rc-tk-main .rc-tk-foil{background-size:129.2% 100%;background-position:0 0}",
    ".rc-tk-stub .rc-tk-foil{background-size:442.5% 100%;background-position:100% 0}",
    ".rc-tk-c{font-family:var(--rc-tk-cond);font-weight:700;font-stretch:condensed;text-transform:uppercase;line-height:1;letter-spacing:.01em}",
    ".rc-tk-m{font-family:var(--rc-tk-mono);text-transform:uppercase;line-height:1.05;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".rc-tk-d{font-family:var(--rc-tk-disp);font-weight:300;text-transform:uppercase;letter-spacing:.16em;line-height:1;white-space:nowrap}",
    ".rc-tk-l{display:block;font-family:var(--rc-tk-cond);font-weight:600;font-stretch:condensed;text-transform:uppercase;font-size:.72cqw;letter-spacing:.07em;line-height:1;opacity:.82;margin-bottom:.45cqw;white-space:nowrap}",
    ".rc-tk-at{position:absolute;white-space:nowrap}",
    ".rc-tk-pre{white-space:pre-line}",
    ".rc-tk-head{display:flex;align-items:baseline;justify-content:space-between;gap:1.5cqw;padding-bottom:1cqw;border-bottom:1px solid var(--rc-tk-rule)}",
    ".rc-tk-head>:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".rc-tk-grid{display:grid;grid-template-columns:1.08fr 1fr .78fr;border-bottom:1px solid var(--rc-tk-rule)}",
    ".rc-tk-cell{padding:1cqw 1.2cqw 1cqw 0;min-width:0}",
    ".rc-tk-cell+.rc-tk-cell,.rc-tk-grid>:nth-child(5),.rc-tk-grid>:nth-child(6){border-left:1px solid var(--rc-tk-rule);padding-left:1.2cqw}",
    ".rc-tk-grid>:nth-child(4){border-left:0;padding-left:0}",
    ".rc-tk-grid>:nth-child(5),.rc-tk-grid>:nth-child(6){border-top:1px solid var(--rc-tk-rule)}",
    ".rc-tk-row{display:flex;gap:2.4cqw}",
    ".rc-tk-foot{flex:1;display:flex;align-items:center;gap:2cqw;padding-top:1.1cqw;min-height:0}",
    ".rc-tk-sf{margin-top:1.45cqw;min-width:0}",
    ".rc-tk-stamp{position:absolute;left:33%;top:52%;padding:.35cqw;border:.2cqw solid var(--rc-tk-stamp);border-radius:.45cqw;color:var(--rc-tk-stamp);",
    "opacity:.86;transform:rotate(-9deg);pointer-events:none;mix-blend-mode:multiply}",
    ".rc-tk-stamp>span{display:block;padding:.45cqw 1.1cqw;border:.08cqw solid var(--rc-tk-stamp);border-radius:.25cqw;text-align:center}",
    ".rc-tk-stamp.is-new{animation:rc-tk-stamp .5s cubic-bezier(.3,1.6,.5,1) both}",
    "@keyframes rc-tk-stamp{0%{opacity:0;transform:rotate(-4deg) scale(1.9)}100%{opacity:.86;transform:rotate(-9deg) scale(1)}}",
    ".rc-tk-hint{position:absolute;left:77.4%;bottom:1.6cqw;transform:translateX(-50%) rotate(180deg);writing-mode:vertical-rl;font-family:var(--rc-tk-cond);",
    "font-size:.5cqw;letter-spacing:.3em;text-transform:uppercase;color:var(--rc-tk-ink);opacity:.45;pointer-events:none;white-space:nowrap;transition:opacity .3s}",
    ".rc-tk-back.is-torn .rc-tk-hint{opacity:0}",
    ".rc-tk-printing .rc-tk-v{animation:rc-tk-type .8s steps(14,end) both}",
    "@keyframes rc-tk-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}",
    ".rc-tk-tw{animation:rc-tk-tw 3.4s ease-in-out infinite}",
    "@keyframes rc-tk-tw{0%,100%{opacity:1}50%{opacity:.2}}",
    ".rc-tk-ship{transition:transform .9s cubic-bezier(.2,.8,.2,1)}",
    ".rc-tk-rocket:hover .rc-tk-ship{transform:translateX(14px)}",
    ".rc-tk-flame{opacity:0;transform-box:fill-box;transform-origin:100% 50%;transform:scaleX(.2);transition:opacity .25s,transform .35s}",
    ".rc-tk-rocket:hover .rc-tk-flame{opacity:1;transform:scaleX(1);animation:rc-tk-flick .09s steps(2) infinite alternate}",
    "@keyframes rc-tk-flick{to{transform:scaleX(1.18) scaleY(1.06)}}",
    ".rc-tk-note{opacity:0}",
    ".rc-tk-clarinet:hover .rc-tk-note{animation:rc-tk-note 2.2s ease-out infinite}",
    "@keyframes rc-tk-note{0%{opacity:0;transform:translate(0,0) scale(.5)}18%{opacity:1}100%{opacity:0;transform:translate(var(--tx),var(--ty)) rotate(-16deg) scale(1.1)}}",
    ".rc-tk-body{transform-box:fill-box;transform-origin:85% 50%;transition:transform .5s}",
    ".rc-tk-clarinet:hover .rc-tk-body{transform:rotate(-1.2deg)}",
    // The switch under the ticket, in the site's quiet small caps.
    ".rc-tk-sides{margin-top:18px;display:flex;align-items:center;justify-content:center;gap:24px}",
    ".rc-tk-side{display:flex;align-items:center;gap:8px;padding:0;border:0;background:none;cursor:pointer;",
    "font-family:'Fira Code',ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.24em;color:#9a948e;transition:color .2s}",
    ".rc-tk-side:hover,.rc-tk-side[aria-pressed=true]{color:#1a1a1a}",
    ".rc-tk-side i{display:block;height:1px;width:8px;background:currentColor;opacity:.5;transition:width .5s,opacity .5s}",
    ".rc-tk-side[aria-pressed=true] i{width:24px;opacity:1}",
    "body.dark .rc-tk-side{color:var(--d-text-3,#7c7e81)}",
    "body.dark .rc-tk-side:hover,body.dark .rc-tk-side[aria-pressed=true]{color:var(--d-text,#eaebec)}",
    // The invoice's status colours on the source's stamp.
    ".rc-tk-stamp.paid{--rc-tk-stamp:#1f7a45}.rc-tk-stamp.unpaid{--rc-tk-stamp:#a3362a}",
    // Persian: Vazirmatn throughout, no capitals or letter-spacing (they
    // tear joined letters apart), and every line set in its own direction.
    ".rc-tk.is-fa{--rc-tk-cond:'Vazirmatn',Tahoma,sans-serif;--rc-tk-mono:'Vazirmatn',Tahoma,sans-serif;--rc-tk-disp:'Vazirmatn',Tahoma,sans-serif}",
    ".rc-tk.is-fa .rc-tk-c,.rc-tk.is-fa .rc-tk-m,.rc-tk.is-fa .rc-tk-d,.rc-tk.is-fa .rc-tk-l,.rc-tk.is-fa .rc-tk-hint{text-transform:none;letter-spacing:0}",
    ".rc-tk.is-fa .rc-tk-m{line-height:1.35}",
    "@media (prefers-reduced-motion: reduce){.rc-tk-tilt,.rc-tk-flip,.rc-tk-stub,.rc-tk-ship,.rc-tk-body{transition-duration:.01ms}",
    ".rc-tk-tw,.rc-tk-flame,.rc-tk-v,.rc-tk-stamp,.rc-tk-note{animation:none!important}.rc-tk-rocket:hover .rc-tk-flame{transform:none}}",
  ].join("");

  function injectCss() {
    if (document.getElementById("rc-tk-css")) return;
    const s = document.createElement("style");
    s.id = "rc-tk-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function star(size) {
    const p = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 ? 0.34 : 1;
      p.push([Math.round((12 + Math.cos(a) * r * 11) * 100) / 100, Math.round((12 + Math.sin(a) * r * 11) * 100) / 100]);
    }
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" style="display:inline-block;max-width:none;vertical-align:-0.1em">' +
      '<polygon points="' + pts(p) + '" fill="currentColor"/></svg>';
  }

  /** A Saturn V, nose to the right, engraved in white. Stages to scale, more or less. */
  function rocket(ink, night, font) {
    const y = 214, R1 = 21, R3 = 14, R5 = 8.2;
    const seam = (x, h) => '<line x1="' + x + '" x2="' + x + '" y1="' + (y - h) + '" y2="' + (y + h) + '" stroke="' + night + '" stroke-width="0.7"/>';
    const poly = (p, extra) => '<polygon points="' + pts(p) + '" ' + extra + "/>";
    const rect = (x, yy, w, h, extra) => '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + h + '" ' + extra + "/>";
    const truss = [];
    for (let x = 907, k = 0; x <= 934; x += 4.5, k++) truss.push([x, y + (k % 2 ? 2.4 : -2.4)]);
    let s = '<g class="rc-tk-rocket">' + rect(320, y - 42, 650, 84, 'fill="transparent"') + '<g class="rc-tk-ship">';
    s += '<g class="rc-tk-flame">' +
      poly([[402, y - 19], [366, y - 13], [318, y], [366, y + 13], [402, y + 19]], 'fill="' + ink + '" opacity="0.92"') +
      poly([[402, y - 10], [378, y - 6], [350, y], [378, y + 6], [402, y + 10]], 'fill="' + night + '" opacity="0.55"') + "</g>";
    [-12, 12, 0].forEach(o => {
      s += poly([[419, y + o - 5], [419, y + o + 5], [402, y + o + 8.5], [402, y + o - 8.5]], 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.8"');
    });
    s += poly([[410, y - R1 - 12], [424, y - R1 - 12], [454, y - R1], [419, y - R1]], 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += poly([[410, y + R1 + 12], [424, y + R1 + 12], [454, y + R1], [419, y + R1]], 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    // S-IC, interstage, S-II
    s += rect(418, y - R1, 304, R1 * 2, 'fill="' + ink + '"');
    s += rect(418, y - R1, 30, R1, 'fill="' + night + '"');
    s += rect(564, y, 30, R1, 'fill="' + night + '"');
    s += rect(448, y - R1 + 3, 116, 2, 'fill="' + night + '"');
    s += rect(448, y + R1 - 5, 116, 2, 'fill="' + night + '"');
    s += '<text x="474" y="' + (y + 2.8) + '" font-size="7.5" letter-spacing="1.9" fill="' + night + '" font-family="' + esc(font) + '" font-weight="700">UNITED STATES</text>';
    s += rect(704, y - R1, 12, R1 * 2, 'fill="' + night + '"');
    [448, 500, 548, 564, 594, 605, 617, 642, 667, 692].forEach(x => { s += seam(x, R1); });
    // interstage taper, S-IVB, instrument unit
    s += poly([[722, y - R1], [746, y - R3], [746, y + R3], [722, y + R1]], 'fill="' + ink + '"');
    s += rect(746, y - R3, 79, R3 * 2, 'fill="' + ink + '"');
    s += rect(746, y - R3, 22, R3, 'fill="' + night + '"');
    s += rect(798, y - R3, 6, R3 * 2, 'fill="' + night + '"');
    [734, 768, 784, 821, 825].forEach(x => { s += seam(x, x < 746 ? 17.5 : R3); });
    // adapter, service module, command module
    s += poly([[825, y - R3], [861, y - R5], [861, y + R5], [825, y + R3]], 'fill="' + ink + '"');
    s += '<path d="M825 ' + (y - R3) + " L861 " + y + " M825 " + (y + R3) + " L861 " + y + '" stroke="' + night + '" stroke-width="0.6"/>';
    s += rect(861, y - R5, 31, R5 * 2, 'fill="' + ink + '"');
    s += rect(871, y - R5, 8, 4, 'fill="' + night + '"');
    [861, 876, 892].forEach(x => { s += seam(x, R5); });
    s += poly([[892, y - R5], [907, y - 2], [907, y + 2], [892, y + R5]], 'fill="' + ink + '"');
    // launch escape tower
    s += '<polyline points="' + pts(truss) + '" fill="none" stroke="' + ink + '" stroke-width="0.9"/>';
    s += '<path d="M907 ' + (y - 2.4) + " H934 M907 " + (y + 2.4) + ' H934" stroke="' + ink + '" stroke-width="0.8"/>';
    s += rect(934, y - 2.3, 16, 4.6, 'fill="' + ink + '"');
    s += poly([[950, y - 2.3], [958, y], [950, y + 2.3]], 'fill="' + ink + '"');
    s += poly([[942, y - 2.3], [946, y - 4.6], [947, y - 2.3]], 'fill="' + ink + '"');
    s += poly([[942, y + 2.3], [946, y + 4.6], [947, y + 2.3]], 'fill="' + ink + '"');
    s += '<path d="M418 ' + (y - R1) + " H722 L746 " + (y - R3) + " H825 L861 " + (y - R5) + " H892 L907 " + (y - 2) + " V" + (y + 2) +
      " L892 " + (y + R5) + " H861 L825 " + (y + R3) + " H746 L722 " + (y + R1) + ' H418 Z" fill="none" stroke="' + ink + '" stroke-width="1"/>';
    return s + "</g></g>";
  }

  /** A B♭ clarinet, bell to the left, keywork in black. Point at it and it plays. */
  function clarinet(ink, night) {
    const y = 96;
    const holes = [392, 418, 446, 474, 502, 530, 610, 640, 668, 696, 724];
    const rings = [446, 474, 502, 640, 668, 696];
    const pads = [404, 460, 488, 520, 620, 654, 702, 738];
    const notes = [
      { x: 300, d: 0, tx: "-34px", ty: "-52px" },
      { x: 310, d: 0.75, tx: "-12px", ty: "-64px" },
      { x: 296, d: 1.5, tx: "-48px", ty: "-30px" },
    ];
    const rect = (x, yy, w, h, extra) => '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + h + '" ' + extra + "/>";
    let s = '<g class="rc-tk-clarinet">' + rect(260, y - 60, 630, 90, 'fill="transparent"');
    notes.forEach((n, i) => {
      s += '<g class="rc-tk-note" style="animation-delay:' + n.d + "s;--tx:" + n.tx + ";--ty:" + n.ty + '">' +
        '<g transform="translate(' + n.x + " " + (y - 14) + ')">' +
        '<ellipse cx="0" cy="0" rx="3.6" ry="2.6" transform="rotate(-20)" fill="' + ink + '"/>' +
        '<path d="' + (i === 1 ? "M3.2 -1 V-15 L13 -18 V-4" : "M3.2 -1 V-15 Q9 -12 9.5 -6") + '" fill="none" stroke="' + ink + '" stroke-width="1.2"/>' +
        (i === 1 ? '<ellipse cx="9.8" cy="-3" rx="3.6" ry="2.6" transform="rotate(-20 9.8 -3)" fill="' + ink + '"/>' : "") +
        "</g></g>";
    });
    s += '<g class="rc-tk-body">';
    s += '<path d="M300 ' + (y - 22) + " Q322 " + (y - 10) + " 353 " + (y - 8.5) + " L353 " + (y + 8.5) + " Q322 " + (y + 10) + " 300 " + (y + 22) + ' Z" fill="' + ink + '"/>';
    s += rect(297, y - 22.5, 4, 45, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += rect(352, y - 10, 6, 20, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += rect(358, y - 8.5, 217, 17, 'fill="' + ink + '"');
    s += rect(575, y - 10, 5, 20, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += rect(580, y - 10, 5, 20, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += rect(585, y - 8, 185, 16, 'fill="' + ink + '"');
    s += rect(770, y - 9.5, 6, 19, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += '<rect x="776" y="' + (y - 9.5) + '" width="42" height="19" rx="2" fill="' + ink + '" stroke="' + night + '" stroke-width="0.4"/>';
    s += rect(818, y - 9, 4, 18, 'fill="' + ink + '" stroke="' + night + '" stroke-width="0.6"');
    s += '<path d="M822 ' + (y - 8) + " L864 " + (y - 6) + " Q878 " + (y - 5) + " 882 " + (y + 1) + " L882 " + (y + 3) + " L822 " + (y + 8) + ' Z" fill="' + ink + '"/>';
    s += '<path d="M842 ' + (y + 7.4) + " L885 " + (y + 3.4) + " L885 " + (y + 5) + " L842 " + (y + 9) + ' Z" fill="' + ink + '" stroke="' + night + '" stroke-width="0.5"/>';
    s += rect(836, y - 7.9, 4, 16.2, 'fill="' + night + '" stroke="' + ink + '" stroke-width="0.6"');
    s += rect(852, y - 7.2, 4, 14.6, 'fill="' + night + '" stroke="' + ink + '" stroke-width="0.6"');
    // turned shading along the underside
    s += '<path d="M358 ' + (y + 5.2) + " H770 M358 " + (y + 6.8) + ' H770" stroke="' + night + '" stroke-width="0.5" opacity="0.45"/>';
    // keywork
    s += '<path d="M384 ' + (y - 5) + " H564 M598 " + (y - 5) + " H758 M360 " + (y + 5.6) + ' H386" stroke="' + night + '" stroke-width="0.8"/>';
    holes.forEach(x => { s += '<circle cx="' + x + '" cy="' + y + '" r="2.2" fill="' + night + '"/>'; });
    rings.forEach(x => { s += '<circle cx="' + x + '" cy="' + y + '" r="4.3" fill="none" stroke="' + night + '" stroke-width="0.9"/>'; });
    pads.forEach(x => { s += '<ellipse cx="' + x + '" cy="' + (y - 5) + '" rx="3.3" ry="1.9" fill="' + night + '"/>'; });
    s += '<ellipse cx="370" cy="' + (y + 5.6) + '" rx="3.3" ry="1.9" fill="' + night + '"/>';
    s += '<path d="M748 ' + (y - 8) + " L764 " + (y - 11.5) + " L778 " + (y - 9.5) + '" fill="none" stroke="' + ink + '" stroke-width="1.1"/>';
    return s + "</g></g>";
  }

  function grain(id) {
    return '<svg class="rc-tk-layer rc-tk-grain" aria-hidden="true"><filter id="' + id + '">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#' + id + ')"/></svg>';
  }

  /** One labelled value: the source's Field. `d` staggers the type-in. */
  function field(f, i) {
    if (!f) return "";
    return '<span style="display:block;min-width:0"><span class="rc-tk-l">' + esc(f.l) + "</span>" +
      '<span class="rc-tk-m rc-tk-v" dir="auto" style="display:block;font-size:' + f.size + "cqw;animation-delay:" + (0.1 + i * 0.12).toFixed(2) + 's">' +
      esc(f.v) + "</span></span>";
  }

  const at = (x, y) => "left:" + x / 10 + "%;top:" + ((y / VIEW_H) * 100).toFixed(3) + "%;";

  let seq = 0;

  function mount(host) {
    injectCss();
    const uid = "rctk" + (++seq);
    const stars = STARS.map(s => '<circle cx="' + s[0].toFixed(2) + '" cy="' + s[1].toFixed(2) + '" r="' + s[2].toFixed(2) + '" fill="' + STAR_INK + '"' +
      (s[3] ? ' class="rc-tk-tw" style="animation-delay:' + s[4] + 's"' : "") + "/>").join("");

    host.innerHTML =
      '<div class="rc-tk">' +
        '<div class="rc-tk-stage">' +
          '<div class="rc-tk-tilt">' +
            '<div class="rc-tk-flip">' +
              // ---------------- cover ----------------
              '<div class="rc-tk-face rc-tk-front">' +
                '<div class="rc-tk-night">' +
                  '<div class="rc-tk-layer" style="width:22.6%"><canvas class="rc-tk-layer rc-tk-moon" aria-hidden="true"></canvas></div>' +
                  '<svg class="rc-tk-layer" viewBox="0 0 ' + VIEW_W + " " + VIEW_H + '" style="pointer-events:auto" aria-hidden="true">' +
                    stars +
                    '<line x1="226" x2="226" y1="0" y2="' + VIEW_H + '" stroke="' + STAR_INK + '" stroke-width="1" stroke-dasharray="3 3.5" opacity="0.75"/>' +
                    clarinet(STAR_INK, NIGHT) +
                    rocket(STAR_INK, NIGHT, "Arial Narrow, Helvetica, sans-serif") +
                  "</svg>" +
                  grain(uid + "gf") +
                  '<div class="rc-tk-layer rc-tk-glow"></div>' +
                  '<div class="rc-tk-cover"></div>' +
                "</div>" +
              "</div>" +
              // ---------------- invoice ----------------
              '<div class="rc-tk-face rc-tk-back">' +
                '<div class="rc-tk-piece rc-tk-main">' +
                  grain(uid + "gm") +
                  '<div class="rc-tk-layer rc-tk-foil"></div>' +
                  '<div class="rc-tk-head"></div>' +
                  '<div class="rc-tk-grid"></div>' +
                  '<div class="rc-tk-foot"></div>' +
                  '<div class="rc-tk-stamp-slot"></div>' +
                "</div>" +
                '<button type="button" class="rc-tk-piece rc-tk-stub" aria-pressed="false">' +
                  grain(uid + "gs") +
                  '<span class="rc-tk-layer rc-tk-foil"></span>' +
                  '<span class="rc-tk-stub-in" style="display:contents"></span>' +
                "</button>" +
                '<span class="rc-tk-hint" aria-hidden="true"></span>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="rc-tk-sides" role="group"></div>' +
      "</div>";

    const root = host.querySelector(".rc-tk");
    const stage = root.querySelector(".rc-tk-stage");
    const tilt = root.querySelector(".rc-tk-tilt");
    const flipEl = root.querySelector(".rc-tk-flip");
    const front = root.querySelector(".rc-tk-front");
    const back = root.querySelector(".rc-tk-back");
    const main = root.querySelector(".rc-tk-main");
    const stub = root.querySelector(".rc-tk-stub");
    const canvas = root.querySelector(".rc-tk-moon");
    const sides = root.querySelector(".rc-tk-sides");

    let turns = 0, torn = false, printed = false, model = null;
    let pointer = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const side = () => (turns % 2 ? "back" : "front");

    // ---- the Moon: a halftone redrawn from a cached lattice whenever the light moves.
    const ctx = canvas.getContext("2d");
    let dots = [], cell = 1, W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
    const turn = turnFor(LON);
    const here = project(LAT, LON + turn);
    let light = lightFrom(idleAt(0), 0.38);
    let raf = 0, visible = false, alive = true;

    const draw = pulse => {
      if (!W || !ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = STAR_INK;
      ctx.beginPath();
      for (let i = 0; i < dots.length; i += 6) {
        const r = dotRadius(dots[i + 5], dots[i + 2], dots[i + 3], dots[i + 4], light, cell);
        if (r < 0.3) continue;
        ctx.moveTo(dots[i] + r, dots[i + 1]);
        ctx.arc(dots[i], dots[i + 1], r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (here[2] > 0.05) {
        const mx = cx + R * here[0], my = cy + R * here[1], s = R * 0.034;
        ctx.lineWidth = 3.2 * dpr; ctx.strokeStyle = NIGHT;
        ctx.beginPath(); ctx.arc(mx, my, s, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = STAR_INK; ctx.stroke();
        ctx.fillStyle = STAR_INK;
        ctx.beginPath(); ctx.arc(mx, my, 1.2 * dpr, 0, Math.PI * 2); ctx.fill();
        if (pulse > 0) {
          ctx.globalAlpha = 1 - pulse;
          ctx.beginPath(); ctx.arc(mx, my, s + R * 0.1 * pulse, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    };
    const build = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h || (w === W && h === H)) return;
      W = w; H = h;
      canvas.width = W; canvas.height = H;
      R = W * MOON.r; cx = W * MOON.x; cy = H * MOON.y;
      cell = Math.max(2.1 * dpr, R / 36);
      dots = moonDots(cx, cy, R, cell, turn);
      draw(0);
    };
    const target = t => (pointer ? lightFrom(pointer[0], pointer[1]) : lightFrom(idleAt(t), 0.38));
    const tick = now => {
      raf = requestAnimationFrame(tick);
      if (side() !== "front") return;
      const to = target(now / 1000);
      for (let k = 0; k < 3; k++) light[k] += (to[k] - light[k]) * 0.09;
      const n = Math.hypot(light[0], light[1], light[2]) || 1;
      light = [light[0] / n, light[1] / n, light[2] / n];
      draw(((now / 1000) % 2.4) / 2.4);
    };
    const start = () => { if (!raf && visible && !reduced && alive) raf = requestAnimationFrame(tick); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    // Reduced motion: no drift and no pulse, but the light still follows the
    // pointer, because that motion is the reader's own.
    const redraw = () => { if (raf) return; light = target(0); draw(0); };

    const ro = new ResizeObserver(build);
    ro.observe(canvas);
    // The invoice view hides with display:none, which this reads as off screen.
    const io = new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; if (visible) { build(); start(); } else stop(); });
    io.observe(canvas);

    // ---- turning over
    const paintSides = () => {
      const s = side();
      flipEl.style.transform = "rotateY(" + turns * 180 + "deg)";
      front.setAttribute("aria-hidden", String(s !== "front"));
      back.setAttribute("aria-hidden", String(s !== "back"));
      stub.tabIndex = s === "back" ? 0 : -1;
      sides.querySelectorAll(".rc-tk-side").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.side === s)));
      // The first time the invoice side shows, its values type themselves
      // in; after that they are left alone, or every keystroke in the form
      // would replay it.
      if (s === "back" && !printed) {
        printed = true;
        back.classList.add("rc-tk-printing");
        setTimeout(() => back.classList.remove("rc-tk-printing"), 2600);
      }
      if (s === "front") start();
    };
    const flip = () => { turns++; paintSides(); };
    flipEl.addEventListener("click", flip);
    sides.addEventListener("click", e => {
      const b = e.target.closest(".rc-tk-side");
      if (b && b.dataset.side !== side()) flip();
    });

    // ---- light, sheen and tilt follow the pointer
    stage.addEventListener("pointermove", e => {
      const r = stage.getBoundingClientRect();
      const px = clamp01((e.clientX - r.left) / r.width);
      const py = clamp01((e.clientY - r.top) / r.height);
      tilt.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      tilt.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      if (!reduced && e.pointerType === "mouse") {
        const a = tiltFrom(px, py, TILT);
        tilt.style.setProperty("--rx", a[0].toFixed(2) + "deg");
        tilt.style.setProperty("--ry", a[1].toFixed(2) + "deg");
      }
      pointer = [px, py];
      redraw();
    });
    stage.addEventListener("pointerleave", () => {
      tilt.style.setProperty("--rx", "0deg");
      tilt.style.setProperty("--ry", "0deg");
      pointer = null;
      redraw();
    });

    // ---- the stub: drag it off, or click / Enter
    let drag = null, swallow = false;
    const setTorn = v => {
      torn = v;
      stub.classList.toggle("is-torn", v);
      back.classList.toggle("is-torn", v);
      stub.setAttribute("aria-pressed", String(v));
      if (model) stub.setAttribute("aria-label", v ? model.L.reattach : model.L.tear);
    };
    stub.addEventListener("pointerdown", e => {
      if (torn || e.button !== 0) return;
      drag = { x: e.clientX, t: performance.now(), dx: 0, v: 0, moved: false };
      stub.setPointerCapture(e.pointerId);
    });
    stub.addEventListener("pointermove", e => {
      if (!drag) return;
      const now = performance.now();
      const dx = Math.max(0, e.clientX - drag.x);
      drag.v = (dx - drag.dx) / Math.max(1, now - drag.t);
      drag.t = now; drag.dx = dx;
      if (dx > 4) drag.moved = true;
      const w = stub.offsetWidth, shown = resist(dx, w);
      stub.style.transition = "none";
      stub.style.transform = "translateX(" + shown.toFixed(1) + "px) rotate(" + ((shown / Math.max(1, w)) * 7).toFixed(2) + "deg)";
    });
    const up = () => {
      const d = drag;
      drag = null;
      if (!d) return;
      stub.style.transition = "";
      stub.style.transform = "";
      if (d.moved) {
        swallow = true;
        if (tearDecision(d.dx, d.v, stub.offsetWidth)) setTorn(true);
      }
    };
    stub.addEventListener("pointerup", up);
    stub.addEventListener("pointercancel", up);
    stub.addEventListener("click", e => {
      e.stopPropagation();
      if (swallow) { swallow = false; return; }
      setTorn(!torn);
    });

    // ---- the words: everything the invoice puts on it
    let lastStamp = "";
    function update(m) {
      model = m;
      root.classList.toggle("is-fa", !!m.fa);
      const F = m.front, B = m.back, L = m.L;
      const shade = "text-shadow:0 0 .5cqw " + NIGHT + ",0 0 1.2cqw " + NIGHT + ";";
      root.querySelector(".rc-tk-cover").innerHTML =
        '<div class="rc-tk-at rc-tk-c" style="' + at(22, 23) + 'font-size:2.7cqw;display:flex;align-items:center;gap:.55cqw">' + star("0.92em") + esc(F.tier) + "</div>" +
        '<div class="rc-tk-at rc-tk-c rc-tk-pre" dir="auto" style="left:2.4%;bottom:6.5%;font-size:2.15cqw;line-height:0.98;max-width:20%;overflow:hidden;' + shade + '">' + esc(F.welcome) + "</div>" +
        '<div class="rc-tk-at rc-tk-c rc-tk-pre" dir="auto" style="' + at(256, 22) + 'font-size:.8cqw;line-height:1.2">' + esc(F.eyebrow) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" dir="auto" style="' + at(590, 22) + 'transform:translateX(-50%);font-size:2.75cqw;max-width:42%;overflow:hidden;text-overflow:ellipsis">' + esc(F.title) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" style="right:2.8%;top:' + ((22 / VIEW_H) * 100).toFixed(3) + '%;font-size:2.75cqw">' + esc(F.date) + "</div>" +
        '<div class="rc-tk-at rc-tk-d" dir="auto" style="right:6%;top:33%;font-size:2.35cqw;font-weight:400">' + esc(F.words[0]) + "</div>" +
        '<div class="rc-tk-at rc-tk-d" dir="auto" style="' + at(268, 142) + 'font-size:2.35cqw;font-weight:400">' + esc(F.words[1]) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" dir="auto" style="' + at(256, 296) + 'font-size:.85cqw">' + esc(F.notes[0]) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" dir="auto" style="' + at(452, 296) + 'font-size:.85cqw">' + esc(F.notes[1]) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" dir="auto" style="' + at(650, 296) + 'font-size:.85cqw;max-width:14%;overflow:hidden;text-overflow:ellipsis">' + esc(F.site) + "</div>" +
        '<div class="rc-tk-at rc-tk-c" style="right:2.8%;top:' + ((296 / VIEW_H) * 100).toFixed(3) + '%;font-size:.85cqw">[' + coordsDMS(LAT, LON) + "]</div>";

      main.querySelector(".rc-tk-head").innerHTML =
        '<span class="rc-tk-c" style="font-size:1.65cqw">' + esc(B.head[0]) + "</span>" +
        '<span class="rc-tk-c" dir="auto" style="font-size:2.75cqw">' + esc(B.head[1]) + "</span>" +
        '<span class="rc-tk-c" dir="ltr" style="font-size:2.3cqw">' + esc(B.head[2]) + "</span>";

      let n = 0;
      main.querySelector(".rc-tk-grid").innerHTML = B.cells.map((c, i) => {
        const row = c.length > 1;
        return '<div class="rc-tk-cell' + (row ? " rc-tk-row" : "") + '"' + (i === 4 ? ' style="gap:1.6cqw"' : "") + ">" +
          c.map(f => field(f, n++)).join("") + "</div>";
      }).join("");

      const svc = B.services.map(s =>
        '<div class="rc-tk-m rc-tk-v" style="display:flex;gap:.8cqw;font-size:1.15cqw;margin-top:.3cqw;animation-delay:' + (0.1 + n++ * 0.12).toFixed(2) + 's">' +
          '<span dir="auto" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(s[0]) + "</span>" +
          '<span dir="ltr" style="flex:none">' + esc(s[1]) + "</span></div>").join("");
      main.querySelector(".rc-tk-foot").innerHTML =
        '<div style="min-width:0;flex:0 0 42%">' +
          '<span class="rc-tk-l">' + esc(B.servicesLabel) + "</span>" + svc +
          (B.seq ? '<span class="rc-tk-l" dir="auto" style="margin-top:.7cqw;margin-bottom:0;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis">' + esc(B.seq) + "</span>" : "") +
        "</div>" +
        '<div style="flex:1;min-width:0;text-align:center">' +
          '<div class="rc-tk-c" style="font-size:1.2cqw;margin-bottom:.9cqw">' + esc(B.featuring) + "</div>" +
          '<div class="rc-tk-d" dir="ltr" style="font-size:' + B.headlineSize + 'cqw;overflow:hidden;text-overflow:ellipsis">' + esc(B.headline) + "</div>" +
        "</div>";

      // The stamp is the invoice's status. It thumps down when it changes,
      // not on every keystroke.
      const st = B.stamp;
      const key = st ? st.kind + st.text : "";
      main.querySelector(".rc-tk-stamp-slot").innerHTML = st
        ? '<div class="rc-tk-stamp ' + st.kind + (key !== lastStamp ? " is-new" : "") + '" aria-hidden="true"><span>' +
            '<span class="rc-tk-c" style="display:block;font-size:2.2cqw;letter-spacing:.18em">' + esc(st.text) + "</span>" +
            '<span class="rc-tk-m" dir="ltr" style="display:block;font-size:.75cqw;margin-top:.35cqw">' + esc(st.sub) + "</span>" +
          "</span></div>"
        : "";
      lastStamp = key;

      const S = m.stub;
      stub.querySelector(".rc-tk-stub-in").innerHTML =
        '<span class="rc-tk-c" style="display:block;font-size:1.65cqw;padding-bottom:1cqw;border-bottom:1px solid var(--rc-tk-rule)">' + esc(S.label) + "</span>" +
        S.rows.map(r => '<span class="rc-tk-sf' + (r.length > 1 ? " rc-tk-row" : "") + '" style="display:' + (r.length > 1 ? "flex;gap:1.3cqw" : "block") + '">' +
          r.map(f => field(f, n++)).join("") + "</span>").join("");
      stub.setAttribute("aria-label", torn ? L.reattach : L.tear);
      back.querySelector(".rc-tk-hint").textContent = L.tearHere;

      sides.setAttribute("aria-label", L.sides);
      sides.innerHTML = ["front", "back"].map((s, i) =>
        '<button type="button" class="rc-tk-side" data-side="' + s + '" aria-pressed="' + (side() === s) + '">' +
          '<i></i><span>0' + (i + 1) + '</span><span dir="auto">' + esc(m.sideLabels[i]) + "</span></button>").join("");
    }

    /* The side that is showing, flat, for the exports: no 3D, the Moon
       copied into an image (an SVG image can't run a canvas), and the
       stub where it is now. */
    function snapshot() {
      const showing = side() === "back" ? back : front;
      const face = showing.cloneNode(true);
      face.style.transform = "none";
      face.removeAttribute("aria-hidden");
      face.classList.remove("rc-tk-printing");
      face.querySelectorAll(".is-new").forEach(e => e.classList.remove("is-new"));
      const c = face.querySelector("canvas");
      if (c) {
        build();
        draw(0);
        const img = document.createElement("img");
        img.className = c.className;
        try { img.src = canvas.toDataURL("image/png"); } catch (e) {}
        c.replaceWith(img);
      }
      const wrap = document.createElement("div");
      wrap.className = "rc-tk" + (root.classList.contains("is-fa") ? " is-fa" : "");
      const st = document.createElement("div");
      st.className = "rc-tk-stage";
      st.style.perspective = "none";
      st.appendChild(face);
      wrap.appendChild(st);
      return wrap;
    }

    function destroy() {
      alive = false;
      stop();
      ro.disconnect();
      io.disconnect();
      host.innerHTML = "";
    }

    paintSides();
    return { update, snapshot, destroy, side };
  }

  window.BoardingPass = { mount, coordsDMS, moonDots, lightFrom, dotRadius, tearDecision, resist, starField };
})();
