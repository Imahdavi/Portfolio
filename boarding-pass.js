/* Boarding pass — the invoice's second design, after 21st.dev's
   "Lunar Boarding Pass".

   Only the pass itself: a silver ticket with a perforated stub that tears
   off, the invoice printed across it and its status stamped on. The
   source's other side — the black cover with the halftone Moon, the
   clarinet and the Saturn V — and the flip between them were taken off;
   the whole port, cover included, is kept in kits/lunar-boarding-pass.js.

   This site has no React, TypeScript or build step, so it is the source's
   own drag maths and stylesheet with the types taken out and the JSX
   written as markup. Every number is the source's, except:

   - It is filled from a model rather than props, and filling it again only
     rewrites the text, so typing in the form doesn't restart anything.
   - The stamp shows the invoice's status rather than waiting for the stub
     to be torn; tearing it is still there, as play.
   - snapshot() hands back the pass flat, for the PNG and PDF exports.
   - Class names start rc-tk-, so the exports' stylesheet copier (which
     takes every .inv-paper and .rc- rule) carries them across.
   - The field labels are a fifth larger (.72cqw for .6): on a ticket they
     are flavour, on an invoice they say which number is the total.

   Use: BoardingPass.mount(host) → { update(model), snapshot(), destroy() }. */
(function () {
  "use strict";

  const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
  const finite = v => (Number.isFinite(v) ? v : 0);

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

  const TILT = 6;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* The source's stylesheet for the pass, renamed lbp- → rc-tk-. The
     invoice's stamp colours and Persian type are added at the end. */
  const CSS = [
    ".rc-tk{position:relative;width:100%;margin:0 auto;",
    "--rc-tk-paper:#c9c9c6;--rc-tk-ink:#1b1b1b;--rc-tk-rule:color-mix(in srgb,#1b1b1b 55%,transparent);--rc-tk-stamp:#a3362a;",
    '--rc-tk-cond:"Oswald","Bebas Neue","Avenir Next Condensed","Helvetica Neue","Arial Narrow","Roboto Condensed","Liberation Sans Narrow","DejaVu Sans Condensed",sans-serif;',
    '--rc-tk-mono:"Courier Prime","IBM Plex Mono","Courier New",ui-monospace,monospace;',
    '--rc-tk-disp:"Futura","Century Gothic","Avenir Next","Josefin Sans","Quicksand",ui-sans-serif,sans-serif}',
    ".rc-tk-stage{position:relative;width:100%;aspect-ratio:1000/330;container-type:inline-size;perspective:1800px;touch-action:pan-y}",
    ".rc-tk-tilt{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .6s cubic-bezier(.2,.8,.2,1)}",
    ".rc-tk-face{position:absolute;inset:0;",
    "filter:drop-shadow(0 1.4cqw 1.8cqw rgba(0,0,0,.2)) drop-shadow(0 .25cqw .35cqw rgba(0,0,0,.14))}",
    ".rc-tk-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;max-width:none}",
    ".rc-tk-grain{opacity:.3;mix-blend-mode:multiply}",
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
    ".rc-tk-face.is-torn .rc-tk-hint{opacity:0}",
    ".rc-tk-printing .rc-tk-v{animation:rc-tk-type .8s steps(14,end) both}",
    "@keyframes rc-tk-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}",
    // The invoice's status colours on the source's stamp.
    ".rc-tk-stamp.paid{--rc-tk-stamp:#1f7a45}.rc-tk-stamp.unpaid{--rc-tk-stamp:#a3362a}",
    // Persian: Vazirmatn throughout, no capitals or letter-spacing (they
    // tear joined letters apart), and every line set in its own direction.
    ".rc-tk.is-fa{--rc-tk-cond:'Vazirmatn',Tahoma,sans-serif;--rc-tk-mono:'Vazirmatn',Tahoma,sans-serif;--rc-tk-disp:'Vazirmatn',Tahoma,sans-serif}",
    ".rc-tk.is-fa .rc-tk-c,.rc-tk.is-fa .rc-tk-m,.rc-tk.is-fa .rc-tk-d,.rc-tk.is-fa .rc-tk-l,.rc-tk.is-fa .rc-tk-hint{text-transform:none;letter-spacing:0}",
    ".rc-tk.is-fa .rc-tk-m{line-height:1.35}",
    "@media (prefers-reduced-motion: reduce){.rc-tk-tilt,.rc-tk-stub{transition-duration:.01ms}.rc-tk-v,.rc-tk-stamp{animation:none!important}}",
  ].join("");

  function injectCss() {
    if (document.getElementById("rc-tk-css")) return;
    const s = document.createElement("style");
    s.id = "rc-tk-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function grain(id) {
    return '<svg class="rc-tk-layer rc-tk-grain" aria-hidden="true"><filter id="' + id + '">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#' + id + ')"/></svg>';
  }

  /** One labelled value: the source's Field. `i` staggers the type-in. */
  function field(f, i) {
    if (!f) return "";
    return '<span style="display:block;min-width:0"><span class="rc-tk-l">' + esc(f.l) + "</span>" +
      '<span class="rc-tk-m rc-tk-v" dir="auto" style="display:block;font-size:' + f.size + "cqw;animation-delay:" + (0.1 + i * 0.12).toFixed(2) + 's">' +
      esc(f.v) + "</span></span>";
  }

  let seq = 0;

  function mount(host) {
    injectCss();
    const uid = "rctk" + (++seq);
    host.innerHTML =
      '<div class="rc-tk">' +
        '<div class="rc-tk-stage">' +
          '<div class="rc-tk-tilt">' +
            '<div class="rc-tk-face">' +
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
      "</div>";

    const root = host.querySelector(".rc-tk");
    const stage = root.querySelector(".rc-tk-stage");
    const tilt = root.querySelector(".rc-tk-tilt");
    const face = root.querySelector(".rc-tk-face");
    const main = root.querySelector(".rc-tk-main");
    const stub = root.querySelector(".rc-tk-stub");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let torn = false, model = null, lastStamp = "";

    // The first fill types its values in; after that they are left alone,
    // or every keystroke in the form would replay it.
    face.classList.add("rc-tk-printing");
    setTimeout(() => face.classList.remove("rc-tk-printing"), 2600);

    // ---- sheen and tilt follow the pointer
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
    });
    stage.addEventListener("pointerleave", () => {
      tilt.style.setProperty("--rx", "0deg");
      tilt.style.setProperty("--ry", "0deg");
    });

    // ---- the stub: drag it off, or click / Enter
    let drag = null, swallow = false;
    const setTorn = v => {
      torn = v;
      stub.classList.toggle("is-torn", v);
      face.classList.toggle("is-torn", v);
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
    stub.addEventListener("click", () => {
      if (swallow) { swallow = false; return; }
      setTorn(!torn);
    });

    // ---- the words: everything the invoice puts on it
    function update(m) {
      model = m;
      root.classList.toggle("is-fa", !!m.fa);
      const B = m.back, L = m.L;

      main.querySelector(".rc-tk-head").innerHTML =
        '<span class="rc-tk-c" style="font-size:1.65cqw">' + esc(B.head[0]) + "</span>" +
        '<span class="rc-tk-c" dir="auto" style="font-size:2.75cqw">' + esc(B.head[1]) + "</span>" +
        '<span class="rc-tk-c" dir="ltr" style="font-size:2.3cqw">' + esc(B.head[2]) + "</span>";

      let n = 0;
      main.querySelector(".rc-tk-grid").innerHTML = B.cells.map((c, i) =>
        '<div class="rc-tk-cell' + (c.length > 1 ? " rc-tk-row" : "") + '"' + (i === 4 ? ' style="gap:1.6cqw"' : "") + ">" +
          c.map(f => field(f, n++)).join("") + "</div>").join("");

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
      face.querySelector(".rc-tk-hint").textContent = L.tearHere;
    }

    /* The pass, flat, for the exports: no tilt, the stub where it is now. */
    function snapshot() {
      const f = face.cloneNode(true);
      f.classList.remove("rc-tk-printing");
      f.querySelectorAll(".is-new").forEach(e => e.classList.remove("is-new"));
      const wrap = document.createElement("div");
      wrap.className = "rc-tk" + (root.classList.contains("is-fa") ? " is-fa" : "");
      const st = document.createElement("div");
      st.className = "rc-tk-stage";
      st.style.perspective = "none";
      st.appendChild(f);
      wrap.appendChild(st);
      return wrap;
    }

    function destroy() { host.innerHTML = ""; }

    return { update, snapshot, destroy };
  }

  window.BoardingPass = { mount, tearDecision, resist };
})();
