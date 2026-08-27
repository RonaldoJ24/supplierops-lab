# SupplierOps Lab security model

This document describes the security properties implemented in the current
Electron foundation. It is a boundary description, not a claim that the
application replaces operating-system access controls, endpoint protection, or
provider-side security.

## Assets and trust assumptions

Assets include the optional DeepSeek API key, local workspace projections,
source metadata/previews, extracted invoice and purchase-order facts, evidence
links, correction drafts, approvals, idempotency records, and diagnostic
failure IDs.

The renderer is treated as a page-facing boundary. Source documents and all
document-derived text are untrusted data. The main process is the authority for
filesystem selection, provider access, workspace persistence, and downstream
state transitions, but it still validates data at every boundary. The external
provider is untrusted for control decisions: its output is a suggestion that
must pass the shared deterministic engine.

## Threat model

| Threat                                      | Required property                                                 | Implemented response                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer compromise or accidental overreach | Page code must not gain Node or arbitrary IPC authority           | Sandboxed, context-isolated window; no Node integration; frozen narrow preload API; fixed channel allowlist                            |
| Navigation or popup escape                  | The app should remain on its controlled surface                   | `app://bundle` asset resolution; deny window opens, navigation, frame navigation, redirects, and webviews; restrictive CSP             |
| Unauthorized IPC caller                     | Only the trusted main frame should invoke operations              | Sender frame must equal `event.sender.mainFrame`; production app origin or explicitly accepted localhost development origin only       |
| Path disclosure or broad file access        | File paths must stay in main                                      | Main-owned chooser returns only basename, extension, size, and bounded preview; access failures use generic messages                   |
| Oversized or malformed packet               | Import work and persisted projections must remain bounded         | 1–4 supported files, 8 MiB per file, 32 MiB aggregate, 20,000-character preview, 256 KiB persisted projection                          |
| Prompt injection in a document              | Text must not become an instruction or authorize an action        | Shared engine detects instruction-like source text, quarantines it, records evidence, and blocks unsafe workflow decisions             |
| Provider hallucination or malformed output  | AI output must not control reconciliation or writes               | Strict JSON/schema parsing; deterministic line/evidence/quantity/price/amount/currency verification; invalid output is quarantined     |
| Provider outage/rate limit/no key           | Failure should be explicit and replayable without unsafe fallback | Typed unavailable/rate-limited results, stable failure IDs, bounded retry policy, no-key no-network behavior                           |
| Credential leakage in logs or projections   | Secrets and auth material must not be retained or returned        | Main-only key loading, configured-secret redaction, bearer/private-key/token redaction, no raw provider payload or stack in IPC errors |
| Duplicate downstream request                | Retries must not create duplicate mock submissions                | Approval and submission are separate; typed local/mock adapter stores idempotency records and replayable failures                      |

## Electron boundary

The production window is configured with `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, and
`allowRunningInsecureContent: false`. The browser surface uses a minimum width
of 960px for the responsive desktop layout; sizing does not relax security.

Only the privileged `app://bundle` scheme is used for packaged renderer assets.
The main process rejects non-GET or non-bundle protocol requests and resolves
requested assets below the renderer output directory. A localhost HTTP origin
is accepted only when the development renderer URL is explicitly configured and
matches localhost, 127.0.0.1, or ::1.

The default session rejects permission requests and permission checks. The
content-security policy permits same-origin scripts and connections, allows
images from same origin/data URLs, disallows objects, and disallows framing.

`app.requestSingleInstanceLock()` keeps one application instance. A second
instance causes the existing main window to restore, show, and focus. The
single main-owned `WorkspaceStore` uses one serialized write queue.

## IPC contract

The preload surface is exactly the shared `ApiContract` operations:

- bootstrap
- load scenario
- run scenario
- create correction draft
- approve draft
- submit draft
- replay failure
- save regression
- import source packet

`src/main/ipc.ts` validates every request with the shared operation schema and
validates every successful response with its paired output schema. A failure is
reduced to `{ error: { name, message, failureId } }`; preload turns that shape
into a bounded `SupplierOpsIpcError`. No original payload or stack is forwarded.

The import input is deliberately only `{ caseMetadata, at }`. The main dialog
handles file selection and returns no path. Supported extensions are JSON, CSV,
TSV, TXT, XML, Markdown, and PDF. Text is previewed only within the configured
bound. Workspace entries are marked `trustBoundary: untrusted`, and their
bounded-preview evidence is explicitly non-authoritative.

## Secret boundary and external processing

`DEEPSEEK_API_KEY` is read only by main-process environment handling. Main may
read the process value or parse the ignored `.env.local` file; the renderer
does not read it. Renderer Vite configuration accepts only `VITE_PUBLIC_`
variables and uses a separate empty env directory. `.env.example` contains a
placeholder, not a credential.

When provider mode is selected for the ambiguous semantic-match scenario and a
key is configured, main may send the DeepSeek chat-completions request. The
request contains bounded invoice and purchase-order line objects with line IDs,
descriptions, and validated evidence IDs. It does not contain raw paths,
complete source documents, quarantined excerpts, monetary amounts/totals,
policy decisions, approvals, commands, submission instructions, credentials, or
unbounded/private document identifiers; the bounded line/evidence IDs are
included solely for grounding and matching.

The provider is an external processor for that bounded semantic operation. The
application does not claim a live Coupa write. Downstream submission in this
checkpoint is local/mock and separately approval-gated. Offline mode and
non-ambiguous deterministic cases do not call the provider.

## Document and prompt-injection handling

Source content is retained as auditable data with evidence references, never as
an instruction channel. The shared engine quarantines entries containing
instruction-like text and records a `source_quarantined` discrepancy. The
workflow policy blocks draft/approval/submission paths when safety is blocked.

The provider system prompt labels document content as untrusted, tells the
model to ignore embedded instructions, requires JSON matching the model-output
schema, and forbids proposing amounts, totals, policy, approval, access,
commands, or submissions. Provider responses are parsed and strictly validated;
the deterministic engine rechecks the proposed line mapping and evidence
before it can affect a comparison.

## Persistence and diagnostics

The local SQLite database is opened through Node's built-in `node:sqlite` with
foreign keys, a 5-second timeout/busy timeout, WAL journaling, `synchronous =
FULL`, `trusted_schema = OFF`, disabled extension loading, and startup
`quick_check`. The schema version is recorded in `app_meta`; workspace data is
stored in `workspace_records`.

Only sanitized projections are persisted. Redaction covers configured secrets,
bearer values, credential-like assignments, query secrets, token-like values,
and private-key blocks. Error projections retain bounded name/message text and
a stable 16-character failure ID. Provider traces retain only provider/model,
operation, attempts, response status class, latency, observed usage counts, and
an explicitly labeled cost estimate. Missing usage is recorded as not observed;
unavailable provider state is recorded as unavailable.

## Verification and limitations

Security boundary tests cover isolation settings, sender/origin checks, IPC
allowlisting, error envelopes, packet bounds/path isolation, redaction, and
SQLite projection behavior. Provider tests use deterministic fakes and do not
read environment keys or call the network. The Electron smoke path asserts the
real `window.supplierOps` bridge and drives separate draft, approval, and
submission controls through the DOM using a fresh temporary user-data
directory.

The security model does not promise that arbitrary user-selected documents are
truthful, that provider output is correct, or that a local machine is free of
malware. Human review remains required wherever policy marks a case as needing
review or blocked.
