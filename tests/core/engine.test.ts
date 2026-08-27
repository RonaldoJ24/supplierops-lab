import { describe, expect, it } from 'vitest'
import {
  CaseWorkspaceSchema,
  fixtureInputForMode,
  loadScenarioFixture,
  reconcile,
  runReconciliation,
  createCorrectionDraft,
  approveDraft,
  submitDraft,
  computeInvoiceFingerprint,
  calculateDocumentTotals,
  multiplyMinorUnits,
  withinTolerance,
  DomainTransitionError,
} from '../../src/shared'

const AT = '2025-01-15T10:00:00.000Z'

describe('deterministic reconciliation engine', () => {
  it('clears a clean match without a model call', () => {
    const fixture = loadScenarioFixture('clean-match')
    const result = runReconciliation(fixture.input)

    expect(result.failure).toBeNull()
    expect(result.providerCalls).toBe(0)
    expect(result.workspace.policyDecision.outcome).toBe('clear')
    expect(result.workspace.discrepancies).toHaveLength(0)
    expect(result.workspace.lineComparisons[0]).toMatchObject({
      matchMethod: 'exact_sku',
      verification: 'verified',
      status: 'match',
    })
    expect(CaseWorkspaceSchema.safeParse(result.workspace).success).toBe(true)
  })

  it('detects integer unit-price mismatch and gates a correction draft through approval', () => {
    const fixture = loadScenarioFixture('price-mismatch')
    const workspace = reconcile(fixture.input)
    expect(workspace.policyDecision.outcome).toBe('draft_allowed')
    expect(workspace.discrepancies.map((item) => item.code)).toEqual(['unit_price_mismatch'])

    const draftResult = createCorrectionDraft(workspace, {
      caseId: workspace.caseMetadata.caseId,
      idempotencyKey: 'idempotency:price-draft',
      at: AT,
    })
    expect(draftResult.workspace.workflow.phase).toBe('drafted')
    expect(draftResult.draft.correctedSubtotalMinor).toBe(10_000)
    expect(draftResult.draft.correctedTaxMinor).toBe(1_600)
    expect(draftResult.draft.correctedTotalMinor).toBe(11_600)

    const approvalResult = approveDraft(draftResult.workspace, {
      caseId: workspace.caseMetadata.caseId,
      draftId: draftResult.draft.draftId,
      approvedBy: 'operator:test',
      note: null,
      at: AT,
      idempotencyKey: 'idempotency:price-approval',
    })
    expect(approvalResult.workspace.workflow.phase).toBe('approved')
    expect(approvalResult.workspace.policyDecision.canSubmit).toBe(true)

    const submission = submitDraft(approvalResult.workspace, {
      caseId: workspace.caseMetadata.caseId,
      draftId: draftResult.draft.draftId,
      idempotencyKey: 'idempotency:price-submit',
      at: AT,
    })
    expect(submission.execution.status).toBe('submitted')
    const repeated = submitDraft(submission.workspace, {
      caseId: workspace.caseMetadata.caseId,
      draftId: draftResult.draft.draftId,
      idempotencyKey: 'idempotency:price-submit',
      at: AT,
    })
    expect(repeated.execution.executionId).toBe(submission.execution.executionId)
  })

  it('escalates an offline semantic case and clears only after a validated provider suggestion', () => {
    const fixture = loadScenarioFixture('semantic-match')
    const offline = runReconciliation(fixture.input)
    expect(offline.workspace.policyDecision.outcome).toBe('escalate')
    expect(
      offline.workspace.discrepancies.some((item) => item.code === 'semantic_mapping_required'),
    ).toBe(true)
    expect(offline.workspace.lineComparisons[0]?.verification).toBe('not_run')

    const providerInput = fixtureInputForMode('semantic-match', 'provider')
    const provider = runReconciliation(providerInput)
    expect(provider.failure).toBeNull()
    expect(provider.providerCalls).toBe(1)
    expect(provider.workspace.policyDecision.outcome).toBe('clear')
    expect(provider.workspace.lineComparisons[0]).toMatchObject({
      matchMethod: 'semantic_suggestion',
      verification: 'verified',
      confidence: 96,
    })
  })

  it('blocks quarantined prompt-injection text before any write action', () => {
    const fixture = loadScenarioFixture('prompt-injection')
    const result = runReconciliation(fixture.input)
    expect(result.workspace.policyDecision.outcome).toBe('blocked')
    expect(result.workspace.sourcePacket.some((entry) => entry.quarantined)).toBe(true)
    expect(result.workspace.policyDecision.canCreateDraft).toBe(false)
    expect(result.workspace.policyDecision.canApprove).toBe(false)
    expect(result.workspace.policyDecision.canSubmit).toBe(false)
    expect(() =>
      createCorrectionDraft(result.workspace, {
        caseId: result.workspace.caseMetadata.caseId,
        idempotencyKey: 'idempotency:prompt-draft',
        at: AT,
      }),
    ).toThrow(DomainTransitionError)
  })

  it('keeps provider outage and invalid-output failure IDs stable across replay attempts', () => {
    const first = runReconciliation(fixtureInputForMode('api-outage', 'provider'))
    const second = runReconciliation(fixtureInputForMode('api-outage', 'provider'))
    expect(first.failure?.failureId).toBe(second.failure?.failureId)
    expect(first.workspace.correctionDraft).toBeNull()
    expect(first.workspace.policyDecision.outcome).toBe('escalate')

    const invalidFirst = runReconciliation(fixtureInputForMode('invalid-model-output', 'provider'))
    const invalidSecond = runReconciliation(fixtureInputForMode('invalid-model-output', 'provider'))
    expect(invalidFirst.failure?.kind).toBe('invalid_model_output')
    expect(invalidFirst.failure?.failureId).toBe(invalidSecond.failure?.failureId)
    expect(invalidFirst.workspace.correctionDraft).toBeNull()
  })

  it('uses integer arithmetic for totals, quantities, tolerance, and duplicate fingerprints', () => {
    expect(multiplyMinorUnits(3, 125)).toBe(375)
    expect(multiplyMinorUnits(1.5, 125)).toBeNull()
    expect(
      calculateDocumentTotals(loadScenarioFixture('clean-match').input.invoice!.lines),
    ).toEqual({
      subtotalMinor: 10_000,
      taxMinor: 1_600,
      totalMinor: 11_600,
    })
    expect(withinTolerance(1_005, 1_000, 5, 0)).toBe(true)
    expect(withinTolerance(1_006, 1_000, 5, 0)).toBe(false)
    expect(withinTolerance(1_005, 1_000, 0, 100)).toBe(true)
    expect(withinTolerance(1_011, 1_000, 0, 100)).toBe(false)

    const fixture = loadScenarioFixture('clean-match')
    const fingerprint = computeInvoiceFingerprint(fixture.input.invoice!)
    const duplicateInput = {
      ...fixture.input,
      knownInvoiceIds: [fixture.input.invoice!.invoiceNumber!],
      knownFingerprints: [fingerprint],
    }
    const duplicate = runReconciliation(duplicateInput)
    expect(duplicate.workspace.policyDecision.outcome).toBe('blocked')
    expect(duplicate.workspace.discrepancies.map((item) => item.code)).toEqual(
      expect.arrayContaining(['duplicate_invoice_id', 'duplicate_invoice_fingerprint']),
    )
  })

  it('blocks currency, quantity, tax, and total control violations', () => {
    const fixture = loadScenarioFixture('clean-match')
    const invoice = fixture.input.invoice!
    const currencyMismatch = runReconciliation({
      ...fixture.input,
      invoice: { ...invoice, currency: 'USD' },
    })
    expect(
      currencyMismatch.workspace.discrepancies.some((item) => item.code === 'currency_mismatch'),
    ).toBe(true)
    expect(currencyMismatch.workspace.policyDecision.outcome).toBe('escalate')

    const quantityMismatch = runReconciliation({
      ...fixture.input,
      invoice: {
        ...invoice,
        subtotalMinor: 11_000,
        totalMinor: 12_760,
        lines: [{ ...invoice.lines[0]!, quantity: 11, amountMinor: 11_000 }],
      },
    })
    expect(
      quantityMismatch.workspace.discrepancies.some((item) => item.code === 'quantity_mismatch'),
    ).toBe(true)

    const taxMismatch = runReconciliation({
      ...fixture.input,
      invoice: { ...invoice, taxMinor: 1_601, totalMinor: 11_601 },
    })
    expect(taxMismatch.workspace.discrepancies.some((item) => item.code === 'tax_mismatch')).toBe(
      true,
    )

    const totalMismatch = runReconciliation({
      ...fixture.input,
      invoice: { ...invoice, totalMinor: 11_601 },
    })
    expect(
      totalMismatch.workspace.discrepancies.some((item) => item.code === 'total_mismatch'),
    ).toBe(true)
  })
})
