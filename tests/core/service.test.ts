import { describe, expect, it } from 'vitest'
import { SupplierOpsService, fixtureInputForMode, loadScenarioFixture } from '../../src/shared'

const AT = '2025-01-15T10:00:00.000Z'

describe('in-memory SupplierOps API contract', () => {
  it('enforces draft, approval, submission, and idempotent retries', async () => {
    const service = new SupplierOpsService()
    const run = await service.runScenario({ scenarioId: 'price-mismatch' })
    expect(run.workspace.workflow.phase).toBe('reconciled')
    const firstDraft = await service.createCorrectionDraft({
      caseId: run.workspace.caseMetadata.caseId,
      idempotencyKey: 'idempotency:service-draft',
      at: AT,
    })
    const repeatedDraft = await service.createCorrectionDraft({
      caseId: run.workspace.caseMetadata.caseId,
      idempotencyKey: 'idempotency:service-draft',
      at: AT,
    })
    expect(repeatedDraft.draft.draftId).toBe(firstDraft.draft.draftId)

    const approved = await service.approveDraft({
      caseId: run.workspace.caseMetadata.caseId,
      draftId: firstDraft.draft.draftId,
      approvedBy: 'operator:test',
      note: null,
      at: AT,
      idempotencyKey: 'idempotency:service-approval',
    })
    const submitted = await service.submitDraft({
      caseId: run.workspace.caseMetadata.caseId,
      draftId: firstDraft.draft.draftId,
      idempotencyKey: 'idempotency:service-submit',
      at: AT,
    })
    const repeated = await service.submitDraft({
      caseId: run.workspace.caseMetadata.caseId,
      draftId: firstDraft.draft.draftId,
      idempotencyKey: 'idempotency:service-submit',
      at: AT,
    })
    expect(approved.approval.approvalId).toBeDefined()
    expect(submitted.execution.executionId).toBe(repeated.execution.executionId)
  })

  it('replays a rate-limit failure with a validated provider response', async () => {
    const service = new SupplierOpsService()
    const outageFixture = loadScenarioFixture('api-outage')
    const outage = await service.runScenario({
      scenarioId: 'api-outage',
      mode: 'provider',
      providerResult: outageFixture.providerResult,
      modelOutput: null,
      idempotencyKey: 'idempotency:service-outage',
    })
    expect(outage.failure?.kind).toBe('provider_rate_limited')
    const valid = fixtureInputForMode('semantic-match', 'provider').providerResult
    const replay = await service.replayFailure({
      caseId: outage.workspace.caseMetadata.caseId,
      failureId: outage.failure!.failureId,
      mode: 'provider',
      providerResult: valid,
      modelOutput: null,
      idempotencyKey: 'idempotency:service-replay',
      at: AT,
    })
    expect(replay.replayed).toBe(true)
    expect(replay.failure).toBeNull()
    expect(replay.workspace.policyDecision.outcome).toBe('clear')
  })
})
