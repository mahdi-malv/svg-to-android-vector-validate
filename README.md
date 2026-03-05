# Android SVG Compatibility Checker

A static, browser-based validator for checking whether an SVG is likely compatible with Android VectorDrawable / Compose workflows.

## What it does

- Accepts SVG input via:
  - Paste SVG content
  - Upload an `.svg` file
  - Fetch SVG from a URL (when CORS allows)
- Runs heuristic validation rules against common Android VectorDrawable limitations
- Produces a verdict:
  - `PASS`
  - `WARN`
  - `FAIL`
- Shows grouped issues (`error`, `warning`, `info`) with why-it-matters and suggestions
- Displays SVG stats (size, viewBox, element/path complexity, gradients, transforms, colors)
- Provides:
  - Copyable `report.json`
  - Download `report.json`
  - Export `sanitized.svg`
  - Sample SVG quick-load presets

## Important limitation

This tool uses heuristics. For absolute certainty, import the SVG into Android Studio as Vector Asset and verify visually.

This validator is not Android Studio's converter.

## CORS and URL fetch behavior

URL fetching is performed directly in the browser with `fetch()`. If the remote host blocks cross-origin requests, fetch can fail even for valid URLs.

When that happens, the app shows:

> Cannot fetch due to CORS or network restrictions. Download the SVG and upload it, or paste its contents.

No proxy is used.

## Local development

```bash
npm install
npm run dev
```

### Run tests

```bash
npm test -- --run
```

### Build

```bash
npm run build
```

## GitHub Pages deployment

This repo includes `.github/workflows/deploy.yml` that:

1. Installs dependencies
2. Runs tests
3. Builds the app
4. Deploys `dist/` to the `gh-pages` branch

### Repo settings

- Ensure GitHub Pages is enabled and configured to serve from the `gh-pages` branch.
- Push to `main` or `master` to trigger deployment.

## Vite base path

`vite.config.ts` derives `base` from `GITHUB_REPOSITORY` in CI, and uses `/` locally.

If you deploy under a different path, update `base` logic accordingly.

## Suggested Android source-of-truth workflow

1. Run this checker to catch common incompatibilities quickly.
2. Clean up warnings/errors in your design tool.
3. Import SVG in Android Studio (`Vector Asset`).
4. Verify visual fidelity in previews and on device.
5. Treat Android Studio output as final authority.
