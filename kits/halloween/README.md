# Halloween mode (archived 2026-11-09)

Pumpkin button, dark Halloween theme, ghost, bats, button moon with needle and
thread, music and laugh, plus the colour and size controls in home edit.

To bring it back, from the repo root:

    git apply --3way kits/halloween/restore-halloween.patch

This restores the code in index.html and the files sfx/ghost-boo.mp3,
sfx/halloween-loop.mp3, sfx/coraline-loop.mp3 and hw-bat.json. The full state is
also in git history: tag `halloween-2026`, the commit before it was removed.
