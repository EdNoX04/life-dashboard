# Study-guide builder

Generates the subject-wise revision guides served at `/study/*.html` and embedded
in the dashboard's Study tab. Retro CRT theme, offline (zero network calls),
no checkboxes — a reference document, not a task list.

## Build

```
cd tools/study-guide
node build.mjs           # writes ../../public/study/{slug}.html
```

## Structure

- `shell.mjs`   — the one HTML/CSS/JS template every subject shares. Countdown,
                  search, Full/Cram toggle, scrollspy, table of contents. Nothing
                  subject-specific lives here.
- `blocks.mjs`  — content-block helpers: card / def / edge / trap / ask / table /
                  code / fig. The visual vocabulary; keeps all subjects identical.
- `data/*.mjs`  — one file per subject. This is the ONLY thing that changes.
- `build.mjs`   — renders each data file through the shell and sanity-checks anchors.

## For the major exam

More modules, more material. Do NOT touch shell.mjs or blocks.mjs — just extend
each `data/*.mjs` with the extra module sections (and update `examISO`/`examLabel`).
Filenames (slugs) are matched by src/lib/exams.js and must stay:
advanced-network-security · blockchain · iot-system-design.

## Tags (in card `tags:[]`)

- `high-yield` — likely to be asked; shown in Cram mode.
- `added`      — filled from outside the college decks (web / standard sources)
                 because the decks skip it; every one is deliberate, not padding.
- `past-paper` — drawn from an actual prior CSE337/CSE475/20CIC08 paper.
