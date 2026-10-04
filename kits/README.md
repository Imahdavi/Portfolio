# Kits

Component sources handed over to be used later, kept as reference rather
than wired into the site. The site is one vanilla HTML file with no build
step, so a React component is never dropped in as-is: the parts that are
plain DOM get ported into index.html, in the site's own idiom, and the
React wrapper is left behind.

- `thinking-orbs.tsx` — 21st.dev's Thinking Orbs (@yogesharc): an animated
  dotted sphere with one look per state an agent can be in (base, working,
  reasoning, searching, background, retrying, compacting, waiting), several
  with variants. `mountOrb(svg, options)` is already framework-free — it
  writes SVG circles directly and runs its own rAF loop — so only the `Orb`
  wrapper is React. It draws in `currentColor`, is tuned to read at 20px,
  honours prefers-reduced-motion, and only animates while on screen.
