# TTB Label Verification — Frontend

React + Vite frontend for the TTB Label Verification prototype.

The frontend provides single-label and batch verification workflows for comparing alcohol label images against submitted application data. It is intentionally kept separate from the verification business logic: the browser owns user input, workflow state, API communication, and result presentation, while extraction and matching remain authoritative in the backend.

The frontend follows the same general separation used in [insight-engine-rag's frontend README](https://github.com/LeeLinkoff/insight-engine-rag/blob/main/frontend/README.md): backend communication is isolated from presentation components, and larger workflows are split into focused components rather than accumulated in `App.jsx`.

## Status

Implemented.

The frontend currently supports:

- Backend health/status checking.
- Single-label image verification.
- Batch verification of multiple label images.
- Separate application data for each batch item.
- Field-level comparison of extracted and submitted values.
- Match, mismatch, and human-review presentation.
- Per-item batch success/failure reporting.
- Expandable technical details for errors and backend health.
- Production builds through Vite.

`App.jsx` checks backend health when the application loads and provides the top-level Single Label / Batch navigation.

The verification workflows call the backend through `src/api/client.js`; extraction and matching are not implemented a second time in browser code.

## Structure

```text
frontend/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── README.md
└── src/
    ├── api/
    │   └── client.js
    ├── components/
    │   ├── ApplicationDataForm.jsx
    │   ├── BatchResultsTable.jsx
    │   ├── BatchVerifyPanel.jsx
    │   ├── ErrorMessage.jsx
    │   ├── ImageDropzone.jsx
    │   ├── MatchResultCard.jsx
    │   ├── SingleVerifyPanel.jsx
    │   ├── StatusCard.jsx
    │   └── Tabs.jsx
    ├── App.jsx
    ├── App.css
    └── main.jsx
```

`node_modules/` and `dist/` are omitted above. Both are generated locally rather than being part of the source structure.

- **`main.jsx`** — Frontend entry point. Mounts the React application.

- **`App.jsx`** — Top-level application composition. Owns backend health/status and the currently selected Single Label / Batch tab. Workflow-specific state is intentionally delegated to the corresponding panel rather than accumulating all state here.

- **`api/client.js`** — Centralized backend communication. Health, single-verification, and batch-verification requests go through this module instead of placing networking logic throughout presentation components.

- **`components/SingleVerifyPanel.jsx`** — Owns the complete single-label workflow: selected image, application data, submission state, returned result, and request errors.

- **`components/BatchVerifyPanel.jsx`** — Owns the batch workflow. Each uploaded image is paired with its own application-data object, preserving the positional relationship expected by the batch API.

- **`components/ApplicationDataForm.jsx`** — Controlled form for the application values against which extracted label fields are compared. Reused by both verification workflows.

- **`components/ImageDropzone.jsx`** — Reusable image selector supporting both single and multiple file selection. The parent owns the actual file state; the component reports selection and removal events.

- **`components/MatchResultCard.jsx`** — Presents the field-level verification result returned by the backend, including extracted and applied values and match/review status.

- **`components/BatchResultsTable.jsx`** — Presents batch results in a compact table and allows an individual item to be expanded into its full match result or processing error.

- **`components/StatusCard.jsx`** — Displays backend reachability without exposing raw diagnostic data by default. Technical details remain available on demand.

- **`components/ErrorMessage.jsx`** — Reusable plain-language error presentation with expandable technical details.

- **`components/Tabs.jsx`** — Minimal reusable tab control used to switch between the single and batch workflows.

- **`App.css`** — Shared design tokens and application styles.

- **`vite.config.js`** — Vite development/build configuration, including backend API proxying and the production base path.

## Why state and API concerns are split out

The original frontend skeleton placed the small amount of available state directly in `App.jsx`. That was appropriate while the only behavior was a backend health check.

Once the upload and verification workflows were implemented, keeping all state in `App.jsx` would have made the top-level component responsible for unrelated details from both single and batch verification.

Instead:

```text
App
 |
 +-- backend health/status
 +-- active workflow
 |
 +-- SingleVerifyPanel
 |      +-- image
 |      +-- application data
 |      +-- submission/result/error state
 |
 +-- BatchVerifyPanel
        +-- image/application pairs
        +-- submission/result/error state
```

Networking is separated again through `api/client.js`.

This keeps presentation components focused on UI behavior and prevents the frontend from duplicating the backend's extraction or regulatory matching logic.

## Data flow

### Backend health

On application load, `App.jsx` calls the health function in `api/client.js`.

The normal UI reports whether the backend is online or unreachable. The complete health response or underlying error is available through the Technical Details control rather than displayed by default.

### Single-label verification

The single-label flow is:

```text
ImageDropzone
      |
      v
SingleVerifyPanel <---- ApplicationDataForm
      |
      | verifyLabel(image, applicationData)
      v
 api/client.js
      |
      v
 Backend API
      |
      v
MatchResultCard
```

The user selects one label image and enters the corresponding application values. Selecting another image replaces the previous selection.

`SingleVerifyPanel` submits both through the API client and renders the returned `MatchResult`.

### Batch verification

Batch mode maintains one application-data object per uploaded image:

```text
Image 0 <--> Application 0
Image 1 <--> Application 1
Image 2 <--> Application 2
              ...
```

The batch API associates `labelImages[]` and application records by position, so that ordering is preserved by the frontend.

After submission, `BatchResultsTable` displays the returned per-item results. An individual row can be expanded to display either the complete `MatchResult` or the processing error for that label.

A failure for one returned batch item can therefore be presented independently from successful items.

## Application data

The frontend collects:

- Brand Name
- Class / Type
- Alcohol Content
- Net Contents
- Producer / Bottler Name
- Producer / Bottler Address
- Country of Origin, for imported products

The backend may additionally return Government Warning verification information as part of the match result.

These values are intentionally collected as application data rather than treated as verification rules in the frontend. The actual comparison behavior remains in the backend.

## Result presentation

`MatchResultCard` consumes the backend `MatchResult` shape and displays each returned field with:

- the value extracted from the label,
- the corresponding submitted application value, and
- its match/review status.

The overall presentation distinguishes among:

- all fields matching,
- a mismatch, and
- a result requiring human review.

The frontend does not independently determine regulatory compliance. It presents the backend result.

This distinction is intentional for the prototype: verification rules have one authoritative implementation rather than separate browser and server versions that could drift apart.

## Error handling

User-facing errors are deliberately separated from technical diagnostic information.

`ErrorMessage` displays a short plain-language failure message first. The underlying error can be expanded through a Details control when troubleshooting is necessary.

`StatusCard` follows the same approach for backend health: the default display communicates online/unreachable state, while Technical Details exposes the complete health response or error.

The frontend therefore retains useful diagnostic information without making raw API errors the normal user experience.

## Why the theme is reused, not new

Color tokens, card/button/input styling, and the light-only color scheme were reused from insight-engine-rag's `App.css` rather than designed from scratch.

This was intentional. The prototype work was focused on the label-verification workflow, backend integration, AI extraction, matching behavior, and batch processing rather than spending assessment time creating another visual design system.

See the top-level `README.md` section "Why reuse, not reinvent" for the broader reasoning.

## CI

The repository-level `.github/workflows/code-checks.yml` includes an independent frontend build job.

The frontend CI check installs its dependencies, performs a real Vite production build, and confirms that the expected `dist/index.html` output exists.

This verifies that the frontend source can actually be bundled for production rather than only checking source syntax.

The frontend CI job runs independently from the backend type-check and boot-test jobs.

## Development

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Or on Windows:

```text
..\dev_scripts\run_front.bat
```

The backend should be running first through `run_back.bat` because frontend `/api/*` requests are proxied to the backend according to `vite.config.js`.

The development frontend runs at:

```text
http://localhost:5174
```

## Production build

Build the frontend with:

```bash
npm run build
```

Or on Windows:

```text
..\dev_scripts\build_front.bat
```

Vite writes the generated static application to:

```text
dist/
```

The production build is static frontend content; it does not contain or run the Node/Express backend.

`vite.config.js` sets:

```text
base: '/mvps/label-verify/'
```

to match the intended deployment subpath alongside insight-engine-rag's `/mvps/rag/`.

## Backend integration

During development, Vite proxies `/api/*` requests to the backend at:

```text
http://127.0.0.1:3002
```

The frontend therefore uses relative `/api/...` paths rather than embedding a separate backend host throughout the component code.

The backend provides the actual health, verification, and batch-verification endpoints. Full backend endpoint and request/response documentation is maintained separately in:

```text
../backend/README.md
```

and in the running Swagger UI at `/api/docs`.

## Deployment

Unlike the backend, the frontend does not require a long-running Node process in production.

`npm run build` produces the static files under `dist/`. Those files are the deployable frontend artifact and can be served by the web server under the configured `/mvps/label-verify/` base path.

The frontend communicates with the separately deployed backend through `/api/*`.

This keeps the production responsibilities separate:

```text
Browser
   |
   v
Static React/Vite build
   |
   | /api/*
   v
Backend API
   |
   v
Extraction / matching services
```

## Environment/configuration

The frontend does not contain the OpenAI API key or model configuration.

Those values belong exclusively to the backend.

Frontend runtime behavior is primarily controlled through `vite.config.js`, including:

- the development API proxy,
- development server behavior, and
- the production base path.

Keeping model credentials out of the browser is required because frontend JavaScript and its bundled configuration are delivered to the user and cannot safely contain secrets.

## Known limitations

- No frontend authentication or authorization; consistent with the prototype scope.
- Application state is transient and is lost on page refresh.
- Uploaded images and verification results are not persisted by the frontend.
- Batch application data is entered separately for each selected image; there is no CSV/import workflow.
- Batch requests are submitted as one workflow; backend processing behavior and scalability are documented in the backend README.
- The frontend relies on the backend for all extraction and matching decisions and cannot perform verification independently if the API is unavailable.
- The UI is prototype-oriented rather than a production accessibility/usability certification effort.