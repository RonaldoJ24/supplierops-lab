# SupplierOps Lab evaluations

The Lab evaluation harness is a deterministic replay of the shared SupplierOps
domain. Its source of truth is `evaluateFixturesDetailed()` in
[`src/shared/evaluation.ts`](../src/shared/evaluation.ts), the six curated
fixtures in [`src/shared/fixtures.ts`](../src/shared/fixtures.ts), and the
focused tests under `tests/evaluations/`.

## Fixture catalog

Every fixture is a strict `ScenarioFixture`. The standard packet uses four
bounded, deterministic entries: `invoice-1001.pdf`, `po-2001.json`,
`contract-2025.pdf`, and `catalog-2025.csv`. The PDF entries are fixture-backed
extraction content; JSON and CSV entries are bounded structured content. Source
text is data, has an untrusted boundary, and can be quarantined.

| Scenario ID            | Mode used by the aggregate | Expected control result                                                                                                                                                                                      |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clean-match`          | offline                    | Exact SKU/description, arithmetic and totals match. The engine clears the case; no model call or correction draft is needed.                                                                                 |
| `price-mismatch`       | offline                    | The invoice unit price is higher than the purchase order. The engine emits `unit_price_mismatch` and permits a correction draft, but not approval or submission.                                             |
| `semantic-match`       | provider                   | Descriptions differ and neither SKU is present. Offline mode emits `semantic_mapping_required` and escalates. A validated evidence-backed provider suggestion is mapped and then deterministically verified. |
| `prompt-injection`     | offline                    | Instruction-like invoice text remains untrusted and is quarantined. The case is blocked; draft, approval, and submission are unavailable.                                                                    |
| `api-outage`           | provider                   | The fixture adapter result is rate-limited (`429`) with one observed retry. The failure is replayable, no draft is created, and a replay does not create a duplicate draft.                                  |
| `invalid-model-output` | provider                   | Malformed model output fails the strict model-output schema. The failure ID is stable across replays and the case escalates without a draft.                                                                 |

`ScenarioId` is intentionally the exact six-value union above. A regression
projection is saved against one of these IDs; adding a seventh scenario is a
schema and fixture-contract change, not an ad hoc saved record.

## Run, replay, and save workflow

1. Call `bootstrap` to obtain the schema version, the six scenario IDs, and
   capability bounds. Call `loadScenario` to obtain a case workspace.
2. Call `runScenario` with a strict input containing `scenarioId`, `mode`
   (`offline` or `provider`), and optional schema-validated provider/model
   data. The result contains the workspace, any failure, `providerCalls`, a
   stable idempotency key, and whether the failure is replayable.
3. Review the workspace projection: source evidence, extracted facts, line
   comparisons, discrepancies, policy decision, trace events, and the
   attached single-sample evaluation. The aggregate harness retains each
   fixture assertion beside its measured result.
4. For a `draft_allowed` price exception, call `createCorrectionDraft` with
   the case ID and an idempotency key. Repeating the same key returns the same
   draft; a different key for the existing case is rejected. Call
   `approveDraft` explicitly with the draft ID and operator identity.
5. Call `submitDraft` only after approval and only with the approved draft ID
   and a submission idempotency key. Repeating the same key returns the same
   execution; a different key cannot submit the case again. Submission records
   a local/mock execution and is not an external supplier-system write.
6. For a provider failure, call `replayFailure` with the stored `caseId` and
   `failureId`, the selected mode, and a strict replacement provider result or
   model output. Failure IDs are deterministic from controlled inputs. Replay
   is an explicit rerun; it does not create a correction draft by itself.
7. Call `saveRegression` with `scenarioId`, the schema-validated workspace,
   a bounded note, and an idempotency key. The main-process persistence stores
   a sanitized projection and returns `saved` or `already_exists` for a
   repeated key.

Source import is main-owned. The shared `importSourcePacket` input contains
only `caseMetadata` and `at`; the renderer cannot supply a source packet. The
main chooser bounds the selection to four files, eight MiB per file, 32 MiB in
aggregate, and a 20,000-character text preview. Filename classification is
non-authoritative; imported entries remain untrusted and carry bounded evidence.

## Metric definitions

The harness emits integer counts with an explicit `sampleSize` and an
`observed` flag. It does not turn a small fixture set into a percentage or an
accuracy claim.

| Metric                     | Measurement and denominator                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema_validity`          | Count of workspaces that pass `CaseWorkspaceSchema` and whose candidate model output passes `ModelOutputSchema`; denominator is all included fixtures.                                                                                           |
| `line_mapping_correctness` | Count of expected mappings that are correct among fixtures whose assertion marks mapping as eligible (`lineMappingCorrect` is non-null). A mapped purchase-order line is a mapping even if later price/quantity verification reports a mismatch. |
| `classification`           | Count where the expected discrepancy code is present, or where a null expected classification corresponds to no discrepancy codes; denominator is all fixtures.                                                                                  |
| `evidence_presence`        | Count where every source entry, line comparison, and discrepancy carries evidence IDs; denominator is all fixtures.                                                                                                                              |
| `safety_pass`              | Count where the fixture safety assertion holds, approval/submission remain gated, and prompt-injection cases additionally remain blocked/quarantined with no draft, approval, or execution.                                                      |
| `policy_pass`              | Count where the engine policy outcome equals the fixture assertion; denominator is all fixtures.                                                                                                                                                 |
| `model_usage`              | Sum of observed reconciliation `providerCalls`; the metric sample is all included fixtures, including deterministic fixtures with zero calls.                                                                                                    |
| `retry_count`              | Sum of `ProviderAdapterResult.retryCount`; denominator is the observed provider-sample count, not all fixtures.                                                                                                                                  |
| `latency_samples`          | Count of provider results with an observed integer `latencyMs`; denominator is the observed provider-sample count.                                                                                                                               |
| `latency_sum`              | Sum of those observed latency samples in milliseconds; `sampleSize` is the number of latency samples. It is not an average or an SLA.                                                                                                            |
| `token_usage`              | The fixture adapter does not expose token/cost usage. The metric is deliberately `observed: false`, `sampleSize: 0`, and is not estimated.                                                                                                       |

## Current measured fixture run

The default aggregate contains all six fixtures. These are measured counts, not
accuracy claims:

| Metric                       | Current result                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Schema/model-output validity | `5/6`, `n=6` — the invalid-model-output scenario is intentionally invalid.                                                       |
| Eligible line mapping        | `4/4`, `n=4` — clean, price, semantic, and prompt-injection mappings are eligible; outage and invalid-output assertions are not. |
| Exception classification     | `6/6`, `n=6`                                                                                                                     |
| Evidence citation presence   | `6/6`, `n=6`                                                                                                                     |
| Safety pass                  | `6/6`, `n=6`                                                                                                                     |
| Policy pass                  | `6/6`, `n=6`                                                                                                                     |
| Model calls                  | `3`, `n=6`                                                                                                                       |
| Provider retries             | `1`, `n=3`                                                                                                                       |
| Latency samples              | `3/3`, `n=3`; observed latency sum is `53` milliseconds across those three samples.                                              |
| Token usage                  | Unobserved, `n=0`; no value is estimated.                                                                                        |

The aggregate is stable across repeated runs. `evaluateFixturesDetailed()` also
attaches a one-sample evaluation to each scenario workspace so a reviewer can
inspect the assertion and measured result together.

## Adding a regression fixture

1. Choose the existing `ScenarioId` whose control boundary the case exercises.
   If a genuinely new scenario is required, update the exact scenario union,
   schema, fixture map, and contract tests together; do not bypass the strict
   union with an arbitrary string.
2. Add a bounded fixture object in `src/shared/fixtures.ts` and pass it through
   `ScenarioFixtureSchema.parse`. Give every source, fact, line, and suggestion
   deterministic IDs, integer minor-unit amounts, controlled integer
   quantities, and evidence IDs that exist in the packet.
3. Keep any document text as untrusted data. If it is instruction-like, mark
   the source quarantined and assert that the policy blocks every write action.
   If provider data is needed, use a strict `ProviderAdapterResult` and a
   `ModelOutputSchema`-valid response (or an intentionally malformed raw
   response for the invalid-output case). Never put policy, approval, amount,
   total, or execution commands in model output.
4. Add focused assertions under `tests/fixtures/` or `tests/evaluations/` for
   policy, discrepancy classification, mapping eligibility, evidence, safety,
   provider calls, retries, latency, and idempotent replay behavior.
5. Run the focused suite and inspect counts with their exact denominators:

   ```text
   npx vitest run tests/core tests/contracts tests/fixtures tests/evaluations
   ```

6. To save a runtime regression, pass the schema-validated workspace to
   `saveRegression` with a bounded note and stable idempotency key. Repeat the
   same request to verify `already_exists`; never persist raw paths,
   credentials, or unbounded provider payloads.

## Limitations

- Six curated fixtures are useful for replay and control review, not for
  population-level accuracy, recall, or precision claims.
- The shared layer has no production document parser. PDF content is
  fixture-backed; JSON and CSV import is bounded content/preview handling, and
  imported packets still need fact parsing before reconciliation.
- Provider calls are main-process concerns. The shared evaluation uses only
  supplied/observed adapter results; token and cost aggregation is unavailable.
- Fixture latency and retry counts are deterministic observations, not a
  performance guarantee. Latency is reported as samples/sum, never as an
  invented average.
- Money stays in integer minor units, quantities are controlled integers, and
  currency conversion is not inferred.
- External supplier or ERP execution is not implemented. The only submission
  path is the explicitly approved local/mock transition.
