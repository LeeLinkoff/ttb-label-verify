# TTB Label Verification — Frontend

React + Vite. See Structure below for the full component layout,
current and planned, and Status for what's actually running right
now.

## Status

Skeleton. `App.jsx` pings `/mvps/label-verify/api/health` on load
(built from `BASE_URL`, not hardcoded), shows live/error status, and
links to `/mvps/label-verify/api/docs`. No label upload or results UI
yet.

## Structure

All frontend source lives under `src/`:

- **`main.jsx`** — Entry point, mounts App.

- **`App.jsx`** — Shared-state owner for the full upload/verify/results
  flow, same pattern as insight-engine-rag's `App.jsx`.

- **`App.css`** — Design tokens and base styles, reused directly
  from insight-engine-rag for visual consistency across MVPs (same
  `--accent`, `--card`, `--border`, `--radius`, etc).

- **`api/client.js`** — All backend communication (verify, batch,
  health). Builds every request path from
  `import.meta.env.BASE_URL`, the `API_BASE` pattern established in
  `App.jsx`, not hardcoded `/api/...` paths. That pattern exists
  specifically because this app is deployed under
  `/mvps/label-verify/`, not the domain root, alongside
  insight-engine-rag at `/mvps/rag/` on the same VPS, a hardcoded
  `/api/...` path would silently break in production the same way a
  bug was already caught and fixed once in this project. Centralizing
  requests here instead of scattering `fetch()` calls across
  components is what makes that pattern enforceable in one place
  rather than something every new component has to remember.

- **`components/LabelUploadCard.jsx`** — Label image upload UI.

- **`components/ApplicationDataForm.jsx`** — Form for the
  application data fields (brand name, class/type, alcohol content,
  net contents) a label gets matched against.

- **`components/MatchResultCard.jsx`** — Displays a single
  verification result: per-field match status, any fields flagged
  for human review.

- **`components/BatchResultsTable.jsx`** — Displays results for a
  batch upload, one row per label.

## Why the theme is reused, not new

Color tokens, card/button/input styling, and the light-only color
scheme are copied from insight-engine-rag's `App.css` rather than
designed fresh. See the top-level `README.md`'s "Why reuse, not
reinvent" section for the reasoning.

## Dev server

```
npm install
npm run dev
```

Or `..\dev_scripts\run_front.bat` on Windows. Requires the backend
running first (`run_back.bat`), since this proxies
`/mvps/label-verify/api/*` to `http://127.0.0.1:3002` (stripping the
`/mvps/label-verify` prefix before forwarding, see `vite.config.js`),
not a bare `/api/*`, matching the same path the production Apache
rule uses so dev and prod behave identically.

Runs at `http://localhost:5174`.

## Production build (local / CI only, not what runs on the VPS)

```
npm run build
```

Or `..\dev_scripts\build_front.bat` on Windows. Output goes to
`dist/`. `vite.config.js` sets `base: '/mvps/label-verify/'` to match
the actual deployed subpath, live at
`https://leelinkoff.com/mvps/label-verify/`, alongside
insight-engine-rag's `/mvps/rag/`.

**This exact command is not what runs on the actual VPS.** Both
above (a plain `npm run build`) work here because your machine and
GitHub's CI runner both have a working Node install. The VPS does
not, its host Node environment is broken (see
`ARCHITECTURE_AND_DEPLOYMENT.md` section 1.2). For a real deploy, the
identical `npm install && npm run build` runs inside a throwaway
Docker container instead, see that same document's section 2.1 and
2.3 for the exact command. The build step is the same either way,
only where it executes differs.
