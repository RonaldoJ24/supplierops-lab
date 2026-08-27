# ADR 0001: Hybrid deterministic reconciliation with bounded semantic assistance

- **Status:** Accepted
- **Date:** 2026-08-27
- **Scope:** SupplierOps shared domain, provider boundary, and write-action workflow

## Context

Supplier invoice exception handling combines exact financial controls with a
small amount of language ambiguity. Arithmetic, duplicate detection, policy,
and write authorization must be reproducible without a model. Descriptions and
contract language can still require a semantic suggestion, but a suggestion is
not evidence that a financial correction is safe.

The shared layer is deliberately browser-safe and strict. Source content is
data, not instructions; provider output is untrusted until it passes its
schema. The six replay fixtures and their measured results are documented in
[`docs/EVALUATIONS.md`](../EVALUATIONS.md).

## Decision

Use a hybrid boundary with deterministic control ownership:

| Responsibility                                    | Owner                         | Rule                                                                                                                                                                                                         |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema and boundary validation                    | Shared Zod schemas            | Strict objects, bounded lists/text, controlled IDs, integer amounts, and explicit output validation.                                                                                                         |
| Arithmetic                                        | Deterministic engine          | Compute line amounts, subtotals, tax in basis points, and totals with safe integer minor units. No floating-point currency arithmetic.                                                                       |
| Duplicate controls                                | Deterministic engine          | Compare known invoice identifiers and deterministic invoice fingerprints; duplicates block write actions.                                                                                                    |
| Currency, quantity, price, and tolerance controls | Deterministic engine          | Require matching currencies with no inferred conversion; compare controlled integer quantities; apply absolute minor-unit and relative basis-point price tolerances.                                         |
| Exception classification and policy               | Deterministic engine          | Emit discrepancy codes with severity, confidence, evidence, and control boundary; choose `clear`, `draft_allowed`, `escalate`, or `blocked`.                                                                 |
| Semantic ambiguity                                | Bounded provider suggestion   | The provider may suggest line mappings, contract interpretations, classifications, or explanations with evidence and confidence. It cannot choose amounts, totals, policy, approval, commands, or execution. |
| Verification after a suggestion                   | Deterministic engine          | Validate referenced line/evidence IDs, then re-run currency, quantity, unit-price tolerance, amount, and total controls. An unverified suggestion escalates to human review.                                 |
| Approval                                          | Human operator                | A draft is a reviewable correction projection. Explicit approval is required and is recorded in the trace.                                                                                                   |
| Submission/execution                              | Controlled local/mock adapter | Submission is a separate operation after approval. Idempotent mock execution is the only implemented execution path; no external supplier system is contacted.                                               |
| Idempotency and replay identity                   | Shared deterministic IDs      | Draft, approval, execution, failure, evidence, and trace identities derive from controlled inputs. Repeated keys return the existing result; conflicting keys are rejected.                                  |

## Source and provider boundary

The main process owns source selection. The shared import input contains only
case metadata and time; the renderer cannot send a source packet. Main-owned
selection strips paths, bounds file count/size and previews, classifies by
filename only as a non-authoritative hint, and records every entry as
untrusted data with evidence.

The provider receives only bounded invoice/purchase-order line identities,
descriptions, and evidence IDs for semantic interpretation. The provider
result is parsed through `ProviderAdapterResultSchema`; model output is parsed
through `ModelOutputSchema`. A provider failure or invalid output produces a
stable failure identity and never authorizes a write.

## Decision flow

```text
source_loaded -> parsed -> reconciled
                         |
                         +-- clear ------------------------------> no write
                         +-- draft_allowed -> drafted -> approved
                                                   |
                                                   +-> submitted (local/mock only)
                         +-- escalate / blocked ------------------> human review
```

`semantic-match` illustrates the boundary: offline mode does not infer a
mapping and escalates. Provider mode can supply an evidence-backed semantic
mapping, but the engine must verify it deterministically before the policy can
clear the case. `prompt-injection` illustrates the safety boundary: detected
instruction-like document text is quarantined, and draft/approval/submission
remain unavailable regardless of its wording.

## Idempotency and failure replay

The same draft idempotency key returns the existing draft; another key cannot
create a second draft for that case. Approval is explicit and tied to the
draft. The same submission key returns the existing execution; another key is
rejected after submission. Provider outage and invalid-output failures derive
stable IDs from controlled case/failure inputs. `replayFailure` requires the
stored failure ID and a schema-validated replacement result; replay is not an
implicit draft or submission.

## Consequences

Positive consequences:

- The financial-control core remains useful offline and is replayable without
  AI or network access.
- Reviewers can distinguish engine decisions, provider suggestions, and human
  approvals in the workspace trace and evidence projection.
- Malformed model output, prompt injection, duplicate inputs, and provider
  outages degrade to explicit review paths instead of silently changing policy.
- Repeated draft/submission/replay requests have deterministic outcomes.

Known trade-offs:

- Ambiguous descriptions remain escalated in offline mode; availability of the
  provider does not remove the deterministic verification step.
- Curated fixture extraction is not a production PDF/JSON/CSV parser.
- The shared Lab evaluation reports observed counts and sample sizes, not
  generalized accuracy or fabricated token/cost values.
- The local/mock submission path proves state gating and idempotency, not an
  integration with a supplier or ERP system.

## Rejected boundaries

- A model must not compute or overwrite invoice amounts, totals, tax, currency,
  tolerance, duplicate status, or policy outcome.
- Document text must not be treated as an instruction channel.
- The renderer must not choose files by sending paths or source packet content
  through the shared import contract.
- Approval and submission must not be combined into one operation, and a
  provider retry must not duplicate a correction draft or execution.
