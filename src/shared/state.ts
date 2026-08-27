import {
  type Approval,
  ApproveDraftInputSchema,
  type CaseWorkspace,
  CaseWorkspaceSchema,
  type CorrectionDraft,
  CreateCorrectionDraftInputSchema,
  type DraftLineChange,
  CorrectionDraftSchema,
  type Execution,
  SubmitDraftInputSchema,
  type LineComparison,
  DraftStatusSchema,
  ApprovalSchema,
  ExecutionSchema,
} from './schemas'
import { DomainTransitionError, multiplyBasisPoints } from './engine'
import { stableId } from './stable'

export interface DraftTransitionResult {
  workspace: CaseWorkspace
  draft: CorrectionDraft
}

export interface ApprovalTransitionResult {
  workspace: CaseWorkspace
  approval: Approval
}

export interface SubmissionTransitionResult {
  workspace: CaseWorkspace
  execution: Execution
}

function assertDraftableWorkspace(workspace: CaseWorkspace): CaseWorkspace {
  const parsed = CaseWorkspaceSchema.parse(workspace)
  if (parsed.workflow.phase !== 'reconciled') {
    throw new DomainTransitionError(
      'invalid_phase',
      'A correction draft can only start from a reconciled workspace.',
    )
  }
  if (!parsed.policyDecision.canCreateDraft || parsed.policyDecision.outcome !== 'draft_allowed') {
    throw new DomainTransitionError(
      'policy_gate',
      'The engine policy does not allow a correction draft for this case.',
    )
  }
  if (parsed.correctionDraft !== null || parsed.approval !== null || parsed.execution !== null) {
    throw new DomainTransitionError(
      'draft_exists',
      'This case already has a correction draft or later state.',
    )
  }
  if (parsed.extracted.invoice === null || parsed.extracted.purchaseOrder === null) {
    throw new DomainTransitionError(
      'missing_fact',
      'Invoice and purchase-order facts are required to draft a correction.',
    )
  }
  return parsed
}

function comparisonFor(workspace: CaseWorkspace, code: string): LineComparison[] {
  return workspace.lineComparisons.filter((comparison) => {
    if (code === 'unit_price_mismatch') return comparison.unitPriceDeltaMinor !== 0
    return false
  })
}

function correctedTaxMinor(
  workspace: CaseWorkspace,
  correctedLines: readonly { amountMinor: number; taxRateBps: number | null }[],
): number {
  const invoice = workspace.extracted.invoice
  if (invoice === null) return 0
  let total = 0
  let allHaveRate = true
  for (const line of correctedLines) {
    if (line.taxRateBps === null) {
      allHaveRate = false
      continue
    }
    const tax = multiplyBasisPoints(line.amountMinor, line.taxRateBps)
    if (tax === null)
      throw new DomainTransitionError(
        'unsafe_arithmetic',
        'Corrected tax exceeds safe integer bounds.',
      )
    total += tax
    if (!Number.isSafeInteger(total))
      throw new DomainTransitionError(
        'unsafe_arithmetic',
        'Corrected tax exceeds safe integer bounds.',
      )
  }
  if (!allHaveRate) {
    const purchaseOrder = workspace.extracted.purchaseOrder
    if (purchaseOrder !== null) return purchaseOrder.taxMinor
    return invoice.taxMinor
  }
  return total
}

export function createCorrectionDraft(
  workspace: CaseWorkspace,
  input: unknown,
): DraftTransitionResult {
  const parsedInput = CreateCorrectionDraftInputSchema.parse(input)
  const parsedForIdempotency = CaseWorkspaceSchema.parse(workspace)
  if (parsedForIdempotency.correctionDraft !== null) {
    if (parsedForIdempotency.correctionDraft.idempotencyKey === parsedInput.idempotencyKey) {
      return { workspace: parsedForIdempotency, draft: parsedForIdempotency.correctionDraft }
    }
    throw new DomainTransitionError(
      'draft_exists',
      'A different draft idempotency key was already used for this case.',
    )
  }
  const parsedWorkspace = assertDraftableWorkspace(workspace)
  const invoice = parsedWorkspace.extracted.invoice
  const purchaseOrder = parsedWorkspace.extracted.purchaseOrder
  if (invoice === null || purchaseOrder === null || invoice.invoiceNumber === null) {
    throw new DomainTransitionError(
      'missing_invoice_number',
      'An invoice number is required to create a correction draft.',
    )
  }

  const mismatchComparisons = comparisonFor(parsedWorkspace, 'unit_price_mismatch')
  if (mismatchComparisons.length === 0) {
    throw new DomainTransitionError(
      'no_draft_changes',
      'No controlled unit-price change exists for this case.',
    )
  }
  const mappedByPurchaseOrderLineId = new Map(
    purchaseOrder.lines.map((line) => [line.lineId, line]),
  )
  const changes: DraftLineChange[] = []
  const correctedLines: { amountMinor: number; taxRateBps: number | null }[] = []
  const evidenceIds = new Set<string>()
  for (const invoiceLine of invoice.lines) {
    const comparison = mismatchComparisons.find((item) => item.invoiceLineId === invoiceLine.lineId)
    const poLine = comparison?.purchaseOrderLineId
      ? mappedByPurchaseOrderLineId.get(comparison.purchaseOrderLineId)
      : undefined
    const correctedAmount = poLine?.amountMinor ?? invoiceLine.amountMinor
    const correctedUnitPrice = poLine?.unitPriceMinor ?? invoiceLine.unitPriceMinor
    correctedLines.push({ amountMinor: correctedAmount, taxRateBps: invoiceLine.taxRateBps })
    for (const evidenceId of invoiceLine.evidenceIds) evidenceIds.add(evidenceId)
    if (poLine !== undefined && comparison !== undefined) {
      for (const evidenceId of comparison.evidenceIds) evidenceIds.add(evidenceId)
      changes.push({
        invoiceLineId: invoiceLine.lineId,
        fromUnitPriceMinor: invoiceLine.unitPriceMinor,
        toUnitPriceMinor: correctedUnitPrice,
        fromAmountMinor: invoiceLine.amountMinor,
        toAmountMinor: correctedAmount,
        evidenceIds: [
          ...new Set([
            ...invoiceLine.evidenceIds,
            ...poLine.evidenceIds,
            ...comparison.evidenceIds,
          ]),
        ],
      })
    }
  }
  if (changes.length === 0) {
    throw new DomainTransitionError(
      'no_draft_changes',
      'No deterministic purchase-order mapping exists for a correction draft.',
    )
  }
  const correctedSubtotalMinor = correctedLines.reduce((sum, line) => {
    const next = sum + line.amountMinor
    if (!Number.isSafeInteger(next))
      throw new DomainTransitionError(
        'unsafe_arithmetic',
        'Corrected subtotal exceeds safe integer bounds.',
      )
    return next
  }, 0)
  const correctedTax = correctedTaxMinor(parsedWorkspace, correctedLines)
  const correctedTotalMinor = correctedSubtotalMinor + correctedTax
  if (!Number.isSafeInteger(correctedTotalMinor)) {
    throw new DomainTransitionError(
      'unsafe_arithmetic',
      'Corrected total exceeds safe integer bounds.',
    )
  }
  const draftId = stableId(
    'draft',
    parsedWorkspace.caseMetadata.caseId,
    changes,
    correctedSubtotalMinor,
    correctedTax,
    correctedTotalMinor,
  )
  const draft: CorrectionDraft = {
    draftId,
    caseId: parsedWorkspace.caseMetadata.caseId,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    changes,
    correctedSubtotalMinor,
    correctedTaxMinor: correctedTax,
    correctedTotalMinor,
    rationale:
      'Unit-price correction copied from the reconciled purchase order; totals are recalculated with integer minor units.',
    evidenceIds: [...evidenceIds],
    idempotencyKey: parsedInput.idempotencyKey,
    status: 'pending_approval',
  }
  const nextWorkspace: CaseWorkspace = {
    ...parsedWorkspace,
    workflow: {
      phase: 'drafted',
      status: 'pending_approval',
      revision: parsedWorkspace.workflow.revision + 1,
    },
    policyDecision: {
      ...parsedWorkspace.policyDecision,
      canCreateDraft: true,
      canApprove: true,
      canSubmit: false,
    },
    correctionDraft: draft,
    traceEvents: [
      ...parsedWorkspace.traceEvents,
      {
        eventId: stableId('event', parsedWorkspace.caseMetadata.caseId, 'draft_created', draftId),
        type: 'draft_created',
        actor: 'engine',
        at: parsedInput.at,
        message: 'Correction draft created from deterministic purchase-order values.',
        evidenceIds: [...evidenceIds],
        metadata: { draftId, idempotencyKey: parsedInput.idempotencyKey },
      },
    ],
  }
  return {
    workspace: CaseWorkspaceSchema.parse(nextWorkspace),
    draft: CorrectionDraftSchema.parse(draft),
  }
}

export function approveDraft(workspace: CaseWorkspace, input: unknown): ApprovalTransitionResult {
  const parsedInput = ApproveDraftInputSchema.parse(input)
  const parsedWorkspace = CaseWorkspaceSchema.parse(workspace)
  const draft = parsedWorkspace.correctionDraft
  if (
    draft === null ||
    draft.draftId !== parsedInput.draftId ||
    draft.caseId !== parsedInput.caseId
  ) {
    throw new DomainTransitionError(
      'draft_not_found',
      'The requested correction draft is not present in this case.',
    )
  }
  if (parsedWorkspace.execution !== null) {
    throw new DomainTransitionError(
      'already_submitted',
      'A submitted draft cannot be approved again.',
    )
  }
  if (parsedWorkspace.policyDecision.outcome !== 'draft_allowed') {
    throw new DomainTransitionError(
      'policy_gate',
      'The engine policy does not allow approval for this draft.',
    )
  }
  if (parsedWorkspace.approval !== null) {
    return { workspace: parsedWorkspace, approval: parsedWorkspace.approval }
  }
  if (parsedWorkspace.workflow.phase !== 'drafted') {
    throw new DomainTransitionError('invalid_phase', 'Only a drafted correction can be approved.')
  }
  const approval: Approval = {
    approvalId: stableId('approval', parsedInput.caseId, parsedInput.draftId),
    caseId: parsedInput.caseId,
    draftId: parsedInput.draftId,
    approvedBy: parsedInput.approvedBy,
    approvedAt: parsedInput.at,
    note: parsedInput.note,
  }
  const nextDraft = DraftStatusSchema.parse('approved')
  const nextWorkspace: CaseWorkspace = {
    ...parsedWorkspace,
    workflow: {
      phase: 'approved',
      status: 'ready',
      revision: parsedWorkspace.workflow.revision + 1,
    },
    policyDecision: { ...parsedWorkspace.policyDecision, canApprove: false, canSubmit: true },
    correctionDraft: { ...draft, status: nextDraft },
    approval,
    traceEvents: [
      ...parsedWorkspace.traceEvents,
      {
        eventId: stableId('event', parsedInput.caseId, 'draft_approved', parsedInput.draftId),
        type: 'draft_approved',
        actor: 'human',
        at: parsedInput.at,
        message: 'Correction draft explicitly approved by a human operator.',
        evidenceIds: draft.evidenceIds,
        metadata: {
          approvalId: approval.approvalId,
          approvedBy: parsedInput.approvedBy,
          idempotencyKey: parsedInput.idempotencyKey,
        },
      },
    ],
  }
  return {
    workspace: CaseWorkspaceSchema.parse(nextWorkspace),
    approval: ApprovalSchema.parse(approval),
  }
}

export function submitDraft(workspace: CaseWorkspace, input: unknown): SubmissionTransitionResult {
  const parsedInput = SubmitDraftInputSchema.parse(input)
  const parsedWorkspace = CaseWorkspaceSchema.parse(workspace)
  const draft = parsedWorkspace.correctionDraft
  if (
    draft === null ||
    draft.draftId !== parsedInput.draftId ||
    draft.caseId !== parsedInput.caseId
  ) {
    throw new DomainTransitionError(
      'draft_not_found',
      'The requested correction draft is not present in this case.',
    )
  }
  if (
    parsedWorkspace.approval === null ||
    parsedWorkspace.approval.draftId !== parsedInput.draftId
  ) {
    throw new DomainTransitionError(
      'approval_required',
      'Explicit human approval is required before submission.',
    )
  }
  if (parsedWorkspace.execution !== null) {
    if (parsedWorkspace.execution.idempotencyKey === parsedInput.idempotencyKey) {
      return { workspace: parsedWorkspace, execution: parsedWorkspace.execution }
    }
    throw new DomainTransitionError(
      'submission_exists',
      'A different submission idempotency key was already used for this case.',
    )
  }
  if (!parsedWorkspace.policyDecision.canSubmit || parsedWorkspace.workflow.phase !== 'approved') {
    throw new DomainTransitionError('policy_gate', 'The engine policy does not allow submission.')
  }
  const execution: Execution = {
    executionId: stableId('execution', parsedInput.caseId, parsedInput.draftId),
    caseId: parsedInput.caseId,
    draftId: parsedInput.draftId,
    status: 'submitted',
    idempotencyKey: parsedInput.idempotencyKey,
    submittedAt: parsedInput.at,
    providerReference: null,
    message:
      'Submission recorded after explicit approval; external execution remains separately controlled.',
  }
  const nextWorkspace: CaseWorkspace = {
    ...parsedWorkspace,
    workflow: {
      phase: 'approved',
      status: 'submitted',
      revision: parsedWorkspace.workflow.revision + 1,
    },
    policyDecision: { ...parsedWorkspace.policyDecision, canSubmit: false },
    correctionDraft: { ...draft, status: 'submitted' },
    execution,
    traceEvents: [
      ...parsedWorkspace.traceEvents,
      {
        eventId: stableId('event', parsedInput.caseId, 'draft_submitted', parsedInput.draftId),
        type: 'draft_submitted',
        actor: 'human',
        at: parsedInput.at,
        message: 'Approved correction draft submitted with a stable idempotency key.',
        evidenceIds: draft.evidenceIds,
        metadata: {
          executionId: execution.executionId,
          idempotencyKey: parsedInput.idempotencyKey,
        },
      },
    ],
  }
  return {
    workspace: CaseWorkspaceSchema.parse(nextWorkspace),
    execution: ExecutionSchema.parse(execution),
  }
}

export function canTransition(
  current: CaseWorkspace['workflow']['phase'],
  target: CaseWorkspace['workflow']['phase'],
): boolean {
  const order = ['source_loaded', 'parsed', 'reconciled', 'drafted', 'approved']
  const currentIndex = order.indexOf(current)
  const targetIndex = order.indexOf(target)
  return currentIndex >= 0 && targetIndex === currentIndex + 1
}

/** Enforce the documented linear workflow for callers that advance projections. */
export function transitionPhase(
  workspace: CaseWorkspace,
  target: CaseWorkspace['workflow']['phase'],
): CaseWorkspace {
  const parsed = CaseWorkspaceSchema.parse(workspace)
  if (!canTransition(parsed.workflow.phase, target)) {
    throw new DomainTransitionError(
      'invalid_transition',
      `Cannot transition from ${parsed.workflow.phase} to ${target}.`,
    )
  }
  return CaseWorkspaceSchema.parse({
    ...parsed,
    workflow: { ...parsed.workflow, phase: target, revision: parsed.workflow.revision + 1 },
  })
}
