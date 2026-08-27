# ADR 0002: Keep provider secrets and external processing in the main process

- Status: accepted
- Date: 2026-08-27
- Scope: SupplierOps Lab desktop runtime

## Context

SupplierOps Lab is local-first, but an optional semantic interpretation
provider is useful for genuinely ambiguous invoice/purchase-order descriptions.
Electron exposes several powerful capabilities, and source documents can
contain arbitrary text, including prompt-injection attempts. A provider key or
raw document payload must not become renderer state, persisted diagnostics, or
an approval input.

## Decision

The Electron main process is the only secret and external-processing boundary.

- `src/main/env.ts` reads only the allowlisted `DEEPSEEK_API_KEY` value from
  the process environment or main-owned `.env.local` parsing.
- `ProviderBoundary` constructs the semantic adapter in main and registers the
  configured key with main-owned persistence redaction. The key is never
  returned by an IPC handler, written to a projection, or exposed by preload.
- The renderer receives only the frozen, typed `window.supplierOps` bridge.
  Vite's renderer env configuration allows only `VITE_PUBLIC_` names and uses
  an empty renderer env directory.
- Provider requests contain bounded invoice and purchase-order line objects
  (`lineId`, description, validated evidence IDs) only. They are sent only for
  provider-mode ambiguous semantic matching. Quarantined source content,
  amounts, totals, policy, approval, commands, submission instructions, and
  credentials are excluded.
- Provider responses are treated as untrusted. Main parses the JSON envelope,
  validates `ModelOutputSchema`, and lets the deterministic engine revalidate
  IDs, evidence, quantity, price, amount, and currency before any workspace
  decision. Invalid, unavailable, or rate-limited results become bounded
  stable failures.
- Persisted trace metadata is a sanitized projection: provider/model/operation,
  attempts, status class, latency, observed token counts, and explicitly
  labeled cost estimate. Request/response text and authentication material are
  not recorded.

## Consequences

Positive consequences:

- A compromised or buggy renderer cannot read the provider key, open arbitrary
  files, call arbitrary IPC channels, or issue provider requests directly.
- Offline mode is fully local, and no-key provider mode degrades explicitly to
  a stable provider-unavailable result without making a network call.
- External processing is narrow and explainable when it occurs; the
  deterministic engine remains the decision authority.
- Redacted error envelopes and bounded projections make diagnostics useful
  without retaining original payloads or stacks.

Costs and limits:

- Semantic interpretation depends on the configured provider and network only
  for the bounded ambiguous case; it can fail or be unavailable.
- Main-process code owns more orchestration and must maintain the IPC/runtime
  validation boundary.
- Local SQLite persistence is intentionally a bounded workspace projection,
  not a general document archive.

## Rejected alternatives

- Loading `DEEPSEEK_API_KEY` in the renderer or passing it through `contextBridge`
  would expand the page's authority and violate the secret boundary.
- Sending complete source files or raw document excerpts to the provider would
  widen external processing and allow untrusted instructions to influence the
  provider prompt.
- Letting model output directly choose amounts, policy, approval, or submission
  would bypass deterministic controls and the human approval gate.
- Adding an SDK or native SQLite dependency would expand the production
  surface; built-in fetch and Node `node:sqlite` are sufficient here.

## Verification

The decision is exercised by provider/security tests and the production
Electron smoke path, which asserts the real preload bridge and drives the
draft/approval/submission controls through the DOM. `npm run verify:secrets` checks that non-example env files
are not tracked, `.env.local` is ignored without reading its value, and
renderer/source outputs do not contain provider-key or credential patterns.
