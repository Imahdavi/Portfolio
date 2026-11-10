# Glass reveal (shelved 2026-11-10)

A liquid-glass reveal played in place on a Home board when it is clicked:
a glass droplet lands on the thumb, spreads into a squircle that bends and
splits the picture at its rim, then lets go and the board opens. Ported
without React from 21st.dev's "Liquid Glass Logo Reveal" (shader and spring
timeline from zanwei/glass-icon-reveal, MIT).

- `glass-reveal.js` — the engine. `GlassReveal.play(src, { el, speed, settings })`
  plays it inside `el`; `GlassReveal.preload(src)` warms a thumb.
- `wire-into-home.patch` — the site side: a "Glass reveal" On/Off tile in home
  edit (saved as settings.glassReveal), the board click going through the
  glass, and the click web held off while it is on.

To bring it back, from the repo root:

    cp kits/glass-reveal/glass-reveal.js .
    git apply --3way kits/glass-reveal/wire-into-home.patch
