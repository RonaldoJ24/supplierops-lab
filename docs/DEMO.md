# SupplierOps Lab demo walkthrough

This walkthrough is designed for a 5–8 minute product or engineering demo. It
uses the checked-in fixtures and keeps all downstream effects in the local/mock
sandbox.

## Start (0:00–0:45)

```bash
npm install
npm run dev
```

Point out the **Local sandbox** indicator, current case, scenario switcher, and
the **Offline** provider mode. Explain that selecting DeepSeek changes intent
only; a provider call happens only after the operator presses **Run**. The
source packet, reconciliation review, and agent trace are separate surfaces so
an operator can inspect evidence without exposing raw provider payloads.

## Walk the six scenarios

### 1. Clean match (0:45–1:15)

Select `clean-match` and press **Run**. Show that the invoice and purchase order
agree through deterministic controls and that the Agent run labels the case
**AI not needed**. Open a page citation to show focused evidence disclosure.

**Proves:** the default path does not manufacture an AI call for a deterministic
match.

### 2. Price mismatch (1:15–2:30)

Select `price-mismatch`, press **Run**, and point to the unit-price variance,
policy rationale, and source citation. Choose **Create corrected draft**, inspect
the changes, and choose **Approve explicitly**. In the approval dialog, confirm
that approval is a separate human action. Only after the approval state changes,
choose **Submit · local/mock**.

**Proves:** evidence-backed correction, explicit approval, and separately
controlled local/mock submission. There is no live supplier-system write.

### 3. Semantic match (2:30–3:45)

Select `semantic-match` and run the default Offline mode. The workspace should
show **Semantic mapping requires escalation** because offline reconciliation does
not infer an ambiguous description match. Change the selector to **DeepSeek
provider** and show **provider selected · not run** plus the bounded-excerpt
disclosure. Press **Run**. When provider configuration is available, show the
AI-proposed mapping, confidence/evidence, and the deterministic verification
that still decides the result. Without configuration, show the safe unavailable
state instead.

**Proves:** provider use is opt-in and gated by Run; a suggestion remains subject
to deterministic checks.

### 4. Prompt injection (3:45–4:30)

Select `prompt-injection`. Show the quarantined instruction-like source entry,
blocked workflow, and disabled correction/submit actions. The provider selector
stays locked to Offline; do not attempt to override it.

**Proves:** document text is treated as untrusted data, not as control input, and
the safety boundary prevents provider or write actions.

### 5. API outage (4:30–5:15)

Select `api-outage`, choose DeepSeek provider, and press **Run**. Show the
rate-limited/unavailable status, retained local evidence, retry/replay affordance,
and stable failure identity where present. No draft or submission action becomes
available from a failed provider check.

**Proves:** failure is visible and replayable rather than silently replaced by a
successful-looking fallback.

### 6. Invalid model output (5:15–6:00)

Select `invalid-model-output`, choose DeepSeek provider, and press **Run**. Show
the invalid-output/quarantined state and the trace note that raw rejected
payloads are omitted. Keep the case in human review; do not create or submit a
draft.

**Proves:** strict output validation protects policy and write boundaries.

## Close (6:00–8:00)

Open **Inspect trace** to show event summaries and redaction disclosure, then
open an evidence citation to contrast source proof with trace context. If useful,
choose **Save regression** after reviewing a fixture state. Finish by reiterating:

1. Offline is the safe default.
2. DeepSeek is opt-in and Run-gated; bounded excerpts may leave the device only
   on that explicit action.
3. Approval and **Submit · local/mock** are separate actions.
4. The six scenarios cover clean agreement, a grounded discrepancy, semantic
   escalation, prompt-injection blocking, provider failure, and invalid output.
