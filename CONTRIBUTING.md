# Contributing to SupplierOps Lab

Contributions should keep the lab understandable, auditable, and safe to run
locally. Keep changes focused and preserve the typed renderer → preload → main
boundary.

## Development setup

Use the pinned Node.js version and install the locked dependency tree:

```bash
nvm use
npm install
npm run dev
```

If `nvm` is unavailable, use Node.js `24.18.0` as specified by [`.nvmrc`](.nvmrc).

## Quality gates

Before opening a pull request, run the configured project gate and the Electron
smoke/screenshot checks when the change affects runtime or UI:

```bash
npm run check
npm run e2e
npm run screenshots
```

The individual checks are also useful while iterating:

```bash
npm test
npm run typecheck
npm run typecheck:web
npm run lint
npm run format:check
npm run verify:secrets
npm run verify:database
```

`npm run check` includes typecheck, lint, formatting, tests, database
verification, a production build, and the secret-boundary scan. `npm run e2e`
builds before running the Playwright Electron smoke test. `npm run screenshots`
rebuilds and updates the two sanitized images under `docs/screenshots/`.

## Secret and data safety

- Keep real credentials in an ignored `.env.local`; start from `.env.example` and
  never commit the value.
- `DEEPSEEK_API_KEY` is a main-process-only setting. Do not read environment
  values, import Node/Electron modules, or expose provider request/response
  bodies from the renderer.
- Use fixture or synthetic supplier data in tests and screenshots. Do not add
  customer documents, supplier credentials, authorization headers, or raw model
  payloads to traces, snapshots, or logs.
- Run `npm run verify:secrets` before requesting review.

## Branches and commits

- Work on a focused feature or fix branch; do not push directly to `main`.
- Keep commits small and descriptive in the imperative mood (for example,
  `Add outage replay disclosure`).
- Do not commit build output, local databases, `.env.local`, or generated files
  unless a checked-in screenshot is intentionally part of the change.
- Explain behavior changes, safety implications, and verification commands in
  the pull request.

## Adding or changing a regression fixture

Keep fixture truth and measured evaluation together:

1. Update the scenario input/assertions in [`src/shared/fixtures.ts`](src/shared/fixtures.ts).
2. Update the measured projection in [`src/shared/evaluation.ts`](src/shared/evaluation.ts) only when the metric or observation changes; retain explicit sample sizes and observed flags.
3. Add or update assertions in [`tests/evaluations/evaluation.test.ts`](tests/evaluations/evaluation.test.ts) and the relevant core/security/UI test.
4. Run `npm test`, `npm run verify:secrets`, and `npm run check`.
5. If the UI changes, run `npm run screenshots` and inspect both committed images.

The README links the architecture, security, and evaluation implementation
references. Use the [demo walkthrough](docs/DEMO.md) to check that the scenario
still communicates a safe next action.
