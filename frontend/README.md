# TTB Label Verification — Frontend

React + Vite. Currently a single-component skeleton; this document
will grow into a fuller architecture writeup (component breakdown,
state ownership, data flow) once the label upload and results UI are
built, following the same structure as
[insight-engine-rag's frontend README](https://github.com/LeeLinkoff/insight-engine-rag/blob/main/frontend/README.md).

## Status

Skeleton. `App.jsx` pings `/api/health` on load, shows live/error
status, and links to `/api/docs`. No label upload or results UI yet.

## Structure

```
src/
  main.jsx     Entry point, mounts App.
  App.jsx      Currently owns all state (just the health check result).
                Will become the shared-state owner for the full
                upload/verify/results flow, same pattern as
                insight-engine-rag's App.jsx.
  App.css      Design tokens and base styles, reused directly from
                insight-engine-rag for visual consistency across
                MVPs (same --accent, --card, --border, --radius, etc).
```

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
running first (`run_back.bat`), since this proxies `/api/*` to
`http://127.0.0.1:3002` (see `vite.config.js`).

Runs at `http://localhost:5174`.

## Production build

```
npm run build
```

Or `..\dev_scripts\build_front.bat` on Windows. Output goes to
`dist/`. `vite.config.js` sets `base: '/mvps/label-verify/'` to match
the intended deployment subpath alongside insight-engine-rag's
`/mvps/rag/`.

## Planned structure (not yet built)

Once the upload/verify flow is built, expect this to split into
focused components under `components/`, plus an `api/` folder for
backend calls, mirroring insight-engine-rag's separation of
networking from presentation:

```
src/
  api/
    client.js          All backend communication (verify, batch, health)
  components/
    LabelUploadCard.jsx
    ApplicationDataForm.jsx
    MatchResultCard.jsx
    BatchResultsTable.jsx
  App.jsx              Shared state owner, calls into api/client.js
  App.css
  main.jsx
```
