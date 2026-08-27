import {
  CaseWorkspaceSchema,
  type CaseMetadata,
  type CaseWorkspace,
  type ContractFact,
  type Discrepancy,
  type DiscrepancyCode,
  type Failure,
  type InvoiceFact,
  type LineComparison,
  type LineFact,
  type ModelOutput,
  type PolicyDecision,
  type PurchaseOrderFact,
  type ReconciliationInput,
  ReconciliationInputSchema,
  type SemanticMappingSuggestion,
  type SourcePacketEntry,
  type TraceEvent,
  type ProviderAdapterResult,
  ModelOutputSchema,
} from './schemas'
import { canonicalize, stableFingerprint, stableId } from './stable'

export interface ReconciliationResult {
  workspace: CaseWorkspace
  failure: Failure | null
  providerCalls: number
}

export const MAX_SAFE_MINOR_UNITS = Number.MAX_SAFE_INTEGER

export class DomainTransitionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainTransitionError'
    this.code = code
  }
}

type NumericResult = number | null

function safeAdd(left: number, right: number): NumericResult {
  const result = left + right
  return Number.isSafeInteger(result) ? result : null
}

export function multiplyMinorUnits(quantity: number, unitPriceMinor: number): NumericResult {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) return null
  const result = quantity * unitPriceMinor
  return Number.isSafeInteger(result) ? result : null
}

/** Integer, round-half-up tax calculation in minor units. */
export function multiplyBasisPoints(amountMinor: number, basisPoints: number): NumericResult {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) return null
  const product = amountMinor * basisPoints
  if (!Number.isSafeInteger(product)) return null
  const rounded = Math.floor((product + 5_000) / 10_000)
  return Number.isSafeInteger(rounded) ? rounded : null
}

export function absoluteIntegerDifference(left: number, right: number): NumericResult {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null
  const difference = Math.abs(left - right)
  return Number.isSafeInteger(difference) ? difference : null
}

/** Compare integer prices without converting either side to floating point. */
export function withinTolerance(
  actualMinor: number,
  expectedMinor: number,
  toleranceMinor: number,
  toleranceBps: number,
): boolean {
  const difference = absoluteIntegerDifference(actualMinor, expectedMinor)
  if (difference === null) return false
  if (!Number.isSafeInteger(toleranceMinor) || toleranceMinor < 0) return false
  if (!Number.isSafeInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) return false
  if (difference <= toleranceMinor) return true
  const product = difference * 10_000
  const baseline = Math.max(Math.abs(expectedMinor), 1)
  const threshold = baseline * toleranceBps
  return Number.isSafeInteger(product) && Number.isSafeInteger(threshold) && product <= threshold
}

export interface CalculatedDocumentTotals {
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
}

export function calculateDocumentTotals(
  lines: readonly LineFact[],
): CalculatedDocumentTotals | null {
  let subtotalMinor = 0
  let taxMinor = 0
  for (const line of lines) {
    const expectedAmount = multiplyMinorUnits(line.quantity, line.unitPriceMinor)
    if (expectedAmount === null) return null
    const nextSubtotal = safeAdd(subtotalMinor, expectedAmount)
    if (nextSubtotal === null) return null
    subtotalMinor = nextSubtotal
    if (line.taxRateBps !== null) {
      const lineTax = multiplyBasisPoints(expectedAmount, line.taxRateBps)
      if (lineTax === null) return null
      const nextTax = safeAdd(taxMinor, lineTax)
      if (nextTax === null) return null
      taxMinor = nextTax
    }
  }
  const totalMinor = safeAdd(subtotalMinor, taxMinor)
  return totalMinor === null ? null : { subtotalMinor, taxMinor, totalMinor }
}

export function computeInvoiceFingerprint(invoice: InvoiceFact): string {
  return stableFingerprint({
    supplierId: invoice.supplierId,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    lines: invoice.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: line.amountMinor,
      taxRateBps: line.taxRateBps,
    })),
  })
}

function normalizeDescription(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function isInstructionLikeText(value: string): boolean {
  return /(?:ignore|disregard|override|bypass|reveal|system message|previous instructions).{0,120}(?:approve|pay|control|policy|instruction|secret)/iu.test(
    value,
  )
}

function issue(
  code: DiscrepancyCode,
  severity: Discrepancy['severity'],
  message: string,
  caseId: string,
  evidenceIds: readonly string[] = [],
  lineComparisonIds: readonly string[] = [],
  confidence: number = 100,
  controlBoundary: Discrepancy['controlBoundary'] = 'engine',
): Discrepancy {
  return {
    discrepancyId: stableId('disc', caseId, code, lineComparisonIds, evidenceIds, message),
    code,
    severity,
    confidence,
    controlBoundary,
    message,
    lineComparisonIds: [...lineComparisonIds],
    evidenceIds: [...evidenceIds],
  }
}

function allEvidenceIds(sourcePacket: readonly SourcePacketEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of sourcePacket) {
    for (const evidence of entry.evidence) ids.add(evidence.evidenceId)
  }
  return ids
}

function factEvidence(...facts: readonly { evidenceIds: readonly string[] }[]): string[] {
  return [...new Set(facts.flatMap((fact) => fact.evidenceIds))]
}

function sourceEntryFor(
  sourcePacket: readonly SourcePacketEntry[],
  kind: SourcePacketEntry['kind'],
): SourcePacketEntry | undefined {
  return sourcePacket.find((entry) => entry.kind === kind)
}

function quarantineSources(sourcePacket: readonly SourcePacketEntry[]): {
  sourcePacket: SourcePacketEntry[]
  quarantined: SourcePacketEntry[]
} {
  const quarantined: SourcePacketEntry[] = []
  const next = sourcePacket.map((entry) => {
    const shouldQuarantine = entry.quarantined || isInstructionLikeText(entry.content)
    if (!shouldQuarantine)
      return { ...entry, evidence: entry.evidence.map((evidence) => ({ ...evidence })) }
    const changed: SourcePacketEntry = {
      ...entry,
      trustBoundary: 'untrusted',
      quarantined: true,
      quarantineReason:
        entry.quarantineReason ?? 'Instruction-like document text retained as untrusted data.',
      evidence: entry.evidence.map((evidence) => ({ ...evidence })),
    }
    quarantined.push(changed)
    return changed
  })
  return { sourcePacket: next, quarantined }
}

function makeFailure(
  caseId: string,
  kind: Failure['kind'],
  message: string,
  source: Failure['source'],
  retryable: boolean,
  occurrenceKey: unknown,
  issues: Failure['issues'] = [],
): Failure {
  const occurrence = stableId('occurrence', caseId, kind, occurrenceKey)
  return {
    failureId: stableId('failure', occurrence),
    kind,
    message,
    retryable,
    source,
    issues: [...issues],
    occurrenceKey: occurrence,
  }
}

function providerFailure(
  caseId: string,
  result: ProviderAdapterResult,
): { failure: Failure; code: DiscrepancyCode } {
  const isRateLimited = result.status === 'rate_limited'
  const code: DiscrepancyCode = isRateLimited ? 'provider_rate_limited' : 'provider_unavailable'
  const kind: Failure['kind'] = isRateLimited ? 'provider_rate_limited' : 'provider_unavailable'
  return {
    code,
    failure: makeFailure(
      caseId,
      kind,
      isRateLimited
        ? 'Provider rate limit response retained for replay.'
        : 'Provider unavailable; no decision was inferred.',
      'provider',
      result.retryable,
      {
        status: result.status,
        statusCode: result.statusCode,
        failureId: result.failureId,
        rawModelOutput: result.rawModelOutput,
      },
    ),
  }
}

function invalidModelFailure(caseId: string, rawModelOutput: unknown, parseError: string): Failure {
  return makeFailure(
    caseId,
    'invalid_model_output',
    'Model output failed the strict schema and was quarantined from control decisions.',
    'schema',
    true,
    rawModelOutput,
    [{ path: 'modelOutput', code: 'invalid_model_output', message: parseError }],
  )
}

function parseProviderModel(
  caseId: string,
  input: ReconciliationInput,
): {
  modelOutput: ModelOutput | null
  failure: Failure | null
  providerCalls: number
  failureCode: DiscrepancyCode | null
} {
  const providerResult = input.providerResult
  if (input.mode === 'offline') {
    return { modelOutput: null, failure: null, providerCalls: 0, failureCode: null }
  }
  if (providerResult !== null) {
    if (providerResult.status === 'invalid_output') {
      const failure = invalidModelFailure(
        caseId,
        providerResult.rawModelOutput,
        'The provider marked the response as invalid_output; raw content remains quarantined.',
      )
      return { modelOutput: null, failure, providerCalls: 1, failureCode: 'invalid_model_output' }
    }
    if (providerResult.status !== 'ok') {
      const failed = providerFailure(caseId, providerResult)
      return {
        modelOutput: null,
        failure: failed.failure,
        providerCalls: 1,
        failureCode: failed.code,
      }
    }
    if (providerResult.modelOutput === null) {
      const failure = invalidModelFailure(
        caseId,
        providerResult.rawModelOutput,
        'A successful provider response did not contain modelOutput.',
      )
      return { modelOutput: null, failure, providerCalls: 1, failureCode: 'invalid_model_output' }
    }
    const parsed = ModelOutputSchema.safeParse(providerResult.modelOutput)
    if (!parsed.success) {
      const failure = invalidModelFailure(
        caseId,
        providerResult.modelOutput,
        parsed.error.issues[0]?.message ?? 'Invalid model output.',
      )
      return { modelOutput: null, failure, providerCalls: 1, failureCode: 'invalid_model_output' }
    }
    return { modelOutput: parsed.data, failure: null, providerCalls: 1, failureCode: null }
  }
  if (input.modelOutput === null) {
    // Provider mode is still offline for cases that do not require a semantic
    // suggestion; do not report a model call that never occurred.
    return { modelOutput: null, failure: null, providerCalls: 0, failureCode: null }
  }
  const parsed = ModelOutputSchema.safeParse(input.modelOutput)
  if (!parsed.success) {
    const failure = invalidModelFailure(
      caseId,
      input.modelOutput,
      parsed.error.issues[0]?.message ?? 'Invalid model output.',
    )
    return { modelOutput: null, failure, providerCalls: 1, failureCode: 'invalid_model_output' }
  }
  return { modelOutput: parsed.data, failure: null, providerCalls: 1, failureCode: null }
}

function lineEvidence(invoiceLine: LineFact, poLine: LineFact | null): string[] {
  return [...new Set([...invoiceLine.evidenceIds, ...(poLine?.evidenceIds ?? [])])]
}

function findSemanticMapping(
  invoiceLine: LineFact,
  purchaseOrder: PurchaseOrderFact,
  suggestions: readonly SemanticMappingSuggestion[],
  usedPurchaseOrderLineIds: ReadonlySet<string>,
): SemanticMappingSuggestion | undefined {
  const suggestion = suggestions.find(
    (candidate) =>
      candidate.invoiceLineId === invoiceLine.lineId &&
      !usedPurchaseOrderLineIds.has(candidate.purchaseOrderLineId),
  )
  if (!suggestion) return undefined
  return purchaseOrder.lines.some((line) => line.lineId === suggestion.purchaseOrderLineId)
    ? suggestion
    : undefined
}

function compareLines(
  invoice: InvoiceFact,
  purchaseOrder: PurchaseOrderFact,
  contract: ContractFact | null,
  modelOutput: ModelOutput | null,
  caseId: string,
  currencyMatches: boolean,
  availableEvidence: ReadonlySet<string>,
  discrepancies: Discrepancy[],
): LineComparison[] {
  const comparisons: LineComparison[] = []
  const usedPurchaseOrderLineIds = new Set<string>()
  const semanticSuggestions = modelOutput?.semanticMappings ?? []

  for (const invoiceLine of invoice.lines) {
    const invoiceSku = invoiceLine.sku?.trim().toLocaleLowerCase('en-US')
    const exactSku = invoiceSku
      ? purchaseOrder.lines.find(
          (line) =>
            line.sku?.trim().toLocaleLowerCase('en-US') === invoiceSku &&
            !usedPurchaseOrderLineIds.has(line.lineId),
        )
      : undefined
    const invoiceDescription = normalizeDescription(invoiceLine.description)
    const exactDescription = exactSku
      ? undefined
      : purchaseOrder.lines.find(
          (line) =>
            normalizeDescription(line.description) === invoiceDescription &&
            !usedPurchaseOrderLineIds.has(line.lineId),
        )
    const semantic =
      exactSku || exactDescription
        ? undefined
        : findSemanticMapping(
            invoiceLine,
            purchaseOrder,
            semanticSuggestions,
            usedPurchaseOrderLineIds,
          )
    const poLine =
      exactSku ??
      exactDescription ??
      (semantic
        ? purchaseOrder.lines.find((line) => line.lineId === semantic.purchaseOrderLineId)
        : undefined)
    const matchMethod: LineComparison['matchMethod'] = exactSku
      ? 'exact_sku'
      : exactDescription
        ? 'exact_description'
        : semantic
          ? 'semantic_suggestion'
          : 'unmatched'
    const confidence = semantic?.confidence ?? (poLine ? 100 : 0)
    const evidenceIds = [
      ...new Set([...lineEvidence(invoiceLine, poLine ?? null), ...(semantic?.evidenceIds ?? [])]),
    ]
    const semanticEvidenceValid =
      semantic === undefined ||
      (semantic.evidenceIds.length > 0 &&
        semantic.evidenceIds.every((evidenceId) => availableEvidence.has(evidenceId)))
    const comparisonId = stableId(
      'line',
      caseId,
      invoiceLine.lineId,
      poLine?.lineId ?? null,
      matchMethod,
    )

    if (!poLine) {
      const status: LineComparison['status'] = 'unmatched'
      comparisons.push({
        comparisonId,
        invoiceLineId: invoiceLine.lineId,
        purchaseOrderLineId: null,
        matchMethod,
        status,
        verification: 'not_run',
        invoiceQuantity: invoiceLine.quantity,
        purchaseOrderQuantity: null,
        quantityDelta: invoiceLine.quantity,
        invoiceUnitPriceMinor: invoiceLine.unitPriceMinor,
        purchaseOrderUnitPriceMinor: null,
        unitPriceDeltaMinor: invoiceLine.unitPriceMinor,
        invoiceAmountMinor: invoiceLine.amountMinor,
        purchaseOrderAmountMinor: null,
        amountDeltaMinor: invoiceLine.amountMinor,
        confidence,
        evidenceIds,
      })
      discrepancies.push(
        issue(
          semanticSuggestions.some((candidate) => candidate.invoiceLineId === invoiceLine.lineId)
            ? 'semantic_mapping_unverified'
            : 'unmatched_line',
          'high',
          semanticSuggestions.some((candidate) => candidate.invoiceLineId === invoiceLine.lineId)
            ? 'The suggested line mapping did not identify a purchase-order line.'
            : 'No deterministic line mapping exists for this invoice line.',
          caseId,
          evidenceIds,
          [comparisonId],
          semantic?.confidence ?? 0,
          semantic ? 'human' : 'engine',
        ),
      )
      continue
    }

    usedPurchaseOrderLineIds.add(poLine.lineId)
    const quantityDelta = invoiceLine.quantity - poLine.quantity
    const unitPriceDeltaMinor = invoiceLine.unitPriceMinor - poLine.unitPriceMinor
    const amountDeltaMinor = invoiceLine.amountMinor - poLine.amountMinor
    const priceWithinTolerance = withinTolerance(
      invoiceLine.unitPriceMinor,
      poLine.unitPriceMinor,
      contract?.priceToleranceMinor ?? 0,
      contract?.priceToleranceBps ?? 0,
    )
    const quantityMatches = quantityDelta === 0
    const amountMatches = amountDeltaMinor === 0
    const deterministicVerified =
      currencyMatches &&
      quantityMatches &&
      priceWithinTolerance &&
      amountMatches &&
      semanticEvidenceValid
    const verification: LineComparison['verification'] =
      matchMethod === 'semantic_suggestion'
        ? deterministicVerified
          ? 'verified'
          : 'failed'
        : deterministicVerified
          ? 'verified'
          : 'failed'
    const status: LineComparison['status'] = deterministicVerified ? 'match' : 'mismatch'
    const comparison: LineComparison = {
      comparisonId,
      invoiceLineId: invoiceLine.lineId,
      purchaseOrderLineId: poLine.lineId,
      matchMethod,
      status,
      verification,
      invoiceQuantity: invoiceLine.quantity,
      purchaseOrderQuantity: poLine.quantity,
      quantityDelta,
      invoiceUnitPriceMinor: invoiceLine.unitPriceMinor,
      purchaseOrderUnitPriceMinor: poLine.unitPriceMinor,
      unitPriceDeltaMinor,
      invoiceAmountMinor: invoiceLine.amountMinor,
      purchaseOrderAmountMinor: poLine.amountMinor,
      amountDeltaMinor,
      confidence,
      evidenceIds,
    }
    comparisons.push(comparison)

    if (matchMethod === 'semantic_suggestion' && !deterministicVerified) {
      discrepancies.push(
        issue(
          'semantic_mapping_unverified',
          'high',
          'A semantic suggestion was not verified by deterministic quantity, price, amount, and currency checks.',
          caseId,
          evidenceIds,
          [comparisonId],
          confidence,
          'human',
        ),
      )
    }
    if (matchMethod === 'semantic_suggestion' && !semanticEvidenceValid) {
      discrepancies.push(
        issue(
          'evidence_missing',
          'high',
          'A semantic mapping suggestion must include source evidence that exists in the imported packet.',
          caseId,
          lineEvidence(invoiceLine, poLine),
          [comparisonId],
          confidence,
          'human',
        ),
      )
    }
    if (!quantityMatches) {
      discrepancies.push(
        issue(
          'quantity_mismatch',
          'high',
          `Invoice quantity ${invoiceLine.quantity} differs from purchase-order quantity ${poLine.quantity}.`,
          caseId,
          evidenceIds,
          [comparisonId],
          confidence,
        ),
      )
    }
    if (!priceWithinTolerance) {
      discrepancies.push(
        issue(
          'unit_price_mismatch',
          'medium',
          `Invoice unit price ${invoiceLine.unitPriceMinor} differs from purchase-order unit price ${poLine.unitPriceMinor}.`,
          caseId,
          evidenceIds,
          [comparisonId],
          confidence,
        ),
      )
    }
    // A cross-document amount difference is explained by quantity/price
    // discrepancies. Internal amount arithmetic is checked separately below.
  }

  for (const poLine of purchaseOrder.lines) {
    if (usedPurchaseOrderLineIds.has(poLine.lineId)) continue
    discrepancies.push(
      issue(
        'unmatched_line',
        'high',
        'A purchase-order line has no invoice counterpart.',
        caseId,
        poLine.evidenceIds,
        [],
        100,
      ),
    )
  }
  return comparisons
}

function checkDocumentArithmetic(
  document: InvoiceFact | PurchaseOrderFact,
  caseId: string,
  label: string,
  discrepancies: Discrepancy[],
): void {
  const evidenceIds = document.evidenceIds
  let subtotal = 0
  let taxFromLines = 0
  for (const line of document.lines) {
    const expectedAmount = multiplyMinorUnits(line.quantity, line.unitPriceMinor)
    if (expectedAmount === null || expectedAmount !== line.amountMinor) {
      discrepancies.push(
        issue(
          'line_amount_mismatch',
          'critical',
          `${label} line ${line.lineId} amount does not equal integer quantity × unit price.`,
          caseId,
          line.evidenceIds,
          [],
          100,
        ),
      )
    }
    if (expectedAmount !== null) {
      const nextSubtotal = safeAdd(subtotal, expectedAmount)
      if (nextSubtotal === null) {
        discrepancies.push(
          issue(
            'line_amount_mismatch',
            'critical',
            `${label} subtotal exceeds safe integer bounds.`,
            caseId,
            line.evidenceIds,
          ),
        )
      } else {
        subtotal = nextSubtotal
      }
      if (line.taxRateBps !== null) {
        const lineTax = multiplyBasisPoints(expectedAmount, line.taxRateBps)
        if (lineTax === null) {
          discrepancies.push(
            issue(
              'tax_mismatch',
              'critical',
              `${label} tax calculation exceeds safe integer bounds.`,
              caseId,
              line.evidenceIds,
            ),
          )
        } else {
          const nextTax = safeAdd(taxFromLines, lineTax)
          if (nextTax === null) {
            discrepancies.push(
              issue(
                'tax_mismatch',
                'critical',
                `${label} tax total exceeds safe integer bounds.`,
                caseId,
                line.evidenceIds,
              ),
            )
          } else {
            taxFromLines = nextTax
          }
        }
      }
    }
  }
  if (subtotal !== document.subtotalMinor) {
    discrepancies.push(
      issue(
        'subtotal_mismatch',
        'critical',
        `${label} declared subtotal does not equal the sum of integer line amounts.`,
        caseId,
        evidenceIds,
      ),
    )
  }
  if (
    document.lines.some((line) => line.taxRateBps !== null) &&
    taxFromLines !== document.taxMinor
  ) {
    discrepancies.push(
      issue(
        'tax_mismatch',
        'critical',
        `${label} declared tax does not equal the controlled basis-point calculation.`,
        caseId,
        evidenceIds,
      ),
    )
  }
  const expectedTotal = safeAdd(document.subtotalMinor, document.taxMinor)
  if (expectedTotal === null || expectedTotal !== document.totalMinor) {
    discrepancies.push(
      issue(
        'total_mismatch',
        'critical',
        `${label} total does not equal subtotal + tax in integer minor units.`,
        caseId,
        evidenceIds,
      ),
    )
  }
}

function addFactBoundaryChecks(
  input: ReconciliationInput,
  sourcePacket: readonly SourcePacketEntry[],
  discrepancies: Discrepancy[],
): void {
  const { invoice, purchaseOrder, contract, catalog } = input
  const caseId = input.caseMetadata.caseId
  const availableEvidence = allEvidenceIds(sourcePacket)
  if (invoice === null || purchaseOrder === null) {
    discrepancies.push(
      issue(
        'missing_required_fact',
        'critical',
        'Invoice and purchase-order facts are required for reconciliation.',
        caseId,
      ),
    )
    return
  }
  if (invoice.invoiceNumber === null) {
    discrepancies.push(
      issue(
        'invoice_identifier_missing',
        'high',
        'Invoice number is required for duplicate detection and audit traceability.',
        caseId,
        invoice.evidenceIds,
      ),
    )
  }
  const invoiceFingerprint = computeInvoiceFingerprint(invoice)
  if (input.knownInvoiceIds.includes(invoice.invoiceNumber ?? '')) {
    discrepancies.push(
      issue(
        'duplicate_invoice_id',
        'critical',
        'Invoice identifier already exists in the known identifier set.',
        caseId,
        invoice.evidenceIds,
      ),
    )
  }
  if (
    input.knownFingerprints.includes(invoiceFingerprint) ||
    input.knownFingerprints.includes(input.caseMetadata.sourceFingerprint)
  ) {
    discrepancies.push(
      issue(
        'duplicate_invoice_fingerprint',
        'critical',
        'Invoice fingerprint already exists in the known fingerprint set.',
        caseId,
        invoice.evidenceIds,
      ),
    )
  }
  if (invoice.currency !== purchaseOrder.currency) {
    discrepancies.push(
      issue(
        'currency_mismatch',
        'critical',
        'Invoice and purchase order currencies differ; no conversion is inferred.',
        caseId,
        factEvidence(invoice, purchaseOrder),
      ),
    )
  }
  if (invoice.supplierId !== purchaseOrder.supplierId) {
    discrepancies.push(
      issue(
        'missing_required_fact',
        'critical',
        'Invoice and purchase order supplier identifiers differ.',
        caseId,
        factEvidence(invoice, purchaseOrder),
      ),
    )
  }
  if (
    contract !== null &&
    (contract.currency !== invoice.currency || contract.supplierId !== invoice.supplierId)
  ) {
    discrepancies.push(
      issue(
        'currency_mismatch',
        'critical',
        'Contract currency or supplier does not match the invoice control boundary.',
        caseId,
        contract.evidenceIds,
      ),
    )
  }
  if (catalog !== null && catalog.currency !== invoice.currency) {
    discrepancies.push(
      issue(
        'currency_mismatch',
        'critical',
        'Catalog currency does not match the invoice control boundary.',
        caseId,
        catalog.evidenceIds,
      ),
    )
  }
  checkDocumentArithmetic(invoice, caseId, 'Invoice', discrepancies)
  checkDocumentArithmetic(purchaseOrder, caseId, 'Purchase order', discrepancies)
  const referencedEvidence = [
    ...invoice.evidenceIds,
    ...purchaseOrder.evidenceIds,
    ...(contract?.evidenceIds ?? []),
    ...(catalog?.evidenceIds ?? []),
    ...invoice.lines.flatMap((line) => line.evidenceIds),
    ...purchaseOrder.lines.flatMap((line) => line.evidenceIds),
  ]
  if (referencedEvidence.some((evidenceId) => !availableEvidence.has(evidenceId))) {
    discrepancies.push(
      issue(
        'evidence_missing',
        'high',
        'A fact references evidence that is absent from the imported source packet.',
        caseId,
      ),
    )
  }
}

function choosePolicy(
  discrepancies: readonly Discrepancy[],
  hasProviderFailure: boolean,
): PolicyDecision {
  const codes = [...new Set(discrepancies.map((discrepancy) => discrepancy.code))]
  const blockingCodes = new Set<DiscrepancyCode>([
    'quantity_mismatch',
    'line_amount_mismatch',
    'subtotal_mismatch',
    'tax_mismatch',
    'total_mismatch',
    'currency_mismatch',
    'invoice_identifier_missing',
    'duplicate_invoice_id',
    'duplicate_invoice_fingerprint',
    'unmatched_line',
    'semantic_mapping_required',
    'semantic_mapping_unverified',
    'source_quarantined',
    'provider_unavailable',
    'provider_rate_limited',
    'invalid_model_output',
    'evidence_missing',
    'missing_required_fact',
  ])
  const hasBlock = codes.some((code) => blockingCodes.has(code))
  if (hasBlock) {
    const safetyBlock =
      codes.includes('source_quarantined') ||
      codes.includes('duplicate_invoice_id') ||
      codes.includes('duplicate_invoice_fingerprint')
    return {
      outcome: safetyBlock ? 'blocked' : hasProviderFailure ? 'escalate' : 'escalate',
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reasonCodes: codes,
      rationale: safetyBlock
        ? 'A safety or duplicate-control boundary blocks all write actions.'
        : 'Human review is required before any correction can be drafted.',
      decidedBy: 'engine',
    }
  }
  if (codes.length === 0) {
    return {
      outcome: 'clear',
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reasonCodes: [],
      rationale: 'All deterministic controls matched within the configured tolerance.',
      decidedBy: 'engine',
    }
  }
  const onlyDraftable = codes.every((code) => code === 'unit_price_mismatch')
  if (onlyDraftable) {
    return {
      outcome: 'draft_allowed',
      canCreateDraft: true,
      canApprove: false,
      canSubmit: false,
      reasonCodes: codes,
      rationale:
        'Only a controlled unit-price exception is present; a correction draft may be prepared for explicit approval.',
      decidedBy: 'engine',
    }
  }
  return {
    outcome: 'escalate',
    canCreateDraft: false,
    canApprove: false,
    canSubmit: false,
    reasonCodes: codes,
    rationale: 'The case requires human review before a correction can be prepared.',
    decidedBy: 'engine',
  }
}

function makeTrace(
  caseMetadata: CaseMetadata,
  type: TraceEvent['type'],
  index: number,
  message: string,
  actor: TraceEvent['actor'],
  evidenceIds: readonly string[] = [],
  metadata?: Record<string, string>,
): TraceEvent {
  return {
    eventId: stableId('event', caseMetadata.caseId, type, index, message),
    type,
    actor,
    at: caseMetadata.openedAt,
    message,
    evidenceIds: [...evidenceIds],
    ...(metadata ? { metadata } : {}),
  }
}

function buildWorkspace(input: ReconciliationInput): ReconciliationResult {
  const { sourcePacket, quarantined } = quarantineSources(input.sourcePacket)
  const parsedInput: ReconciliationInput = { ...input, sourcePacket }
  const discrepancies: Discrepancy[] = []
  const traces: TraceEvent[] = [
    makeTrace(
      input.caseMetadata,
      'source_loaded',
      0,
      'Source packet loaded as auditable data.',
      'system',
    ),
  ]
  if (quarantined.length > 0) {
    const evidenceIds = quarantined.flatMap((entry) =>
      entry.evidence.map((evidence) => evidence.evidenceId),
    )
    traces.push(
      makeTrace(
        input.caseMetadata,
        'source_quarantined',
        traces.length,
        'Instruction-like document text was quarantined and ignored as control input.',
        'engine',
        evidenceIds,
      ),
    )
    discrepancies.push(
      issue(
        'source_quarantined',
        'critical',
        'One or more source entries contain instruction-like text and remain quarantined as untrusted data.',
        input.caseMetadata.caseId,
        evidenceIds,
        [],
        100,
        'human',
      ),
    )
  }
  traces.push(
    makeTrace(
      input.caseMetadata,
      'parsed',
      traces.length,
      'Invoice, purchase-order, contract, and catalog facts parsed through strict schemas.',
      'engine',
    ),
  )
  addFactBoundaryChecks(parsedInput, sourcePacket, discrepancies)
  const provider = parseProviderModel(input.caseMetadata.caseId, parsedInput)
  if (provider.failure !== null && provider.failureCode !== null) {
    const providerEvidence =
      sourceEntryFor(sourcePacket, 'invoice')?.evidence.map((evidence) => evidence.evidenceId) ?? []
    discrepancies.push(
      issue(
        provider.failureCode,
        'high',
        provider.failure.message,
        input.caseMetadata.caseId,
        providerEvidence,
        [],
        100,
        'provider',
      ),
    )
    traces.push(
      makeTrace(
        input.caseMetadata,
        'model_output_rejected',
        traces.length,
        provider.failure.message,
        'provider',
        providerEvidence,
        { failureId: provider.failure.failureId },
      ),
    )
  }
  if (input.invoice !== null && input.purchaseOrder !== null) {
    const currencyMatches = input.invoice.currency === input.purchaseOrder.currency
    const comparisons = compareLines(
      input.invoice,
      input.purchaseOrder,
      input.contract,
      provider.modelOutput,
      input.caseMetadata.caseId,
      currencyMatches,
      allEvidenceIds(sourcePacket),
      discrepancies,
    )
    // An offline semantic case has no AI mapping. Emit a specific escalation
    // code so the UI can explain why no match was inferred.
    const hasUnmatched = comparisons.some((comparison) => comparison.status === 'unmatched')
    const requiresSemantic = input.invoice.lines.some((invoiceLine) => {
      const hasSkuMatch =
        invoiceLine.sku !== null &&
        input.purchaseOrder?.lines.some((poLine) => poLine.sku === invoiceLine.sku)
      const hasDescriptionMatch = input.purchaseOrder?.lines.some(
        (poLine) =>
          normalizeDescription(poLine.description) ===
          normalizeDescription(invoiceLine.description),
      )
      return !hasSkuMatch && !hasDescriptionMatch
    })
    if (
      hasUnmatched &&
      requiresSemantic &&
      input.mode === 'offline' &&
      !discrepancies.some((item) => item.code === 'semantic_mapping_required')
    ) {
      const invoiceEvidence = input.invoice.lines.flatMap((line) => line.evidenceIds)
      discrepancies.push(
        issue(
          'semantic_mapping_required',
          'high',
          'Offline mode does not infer semantic line mappings; provider-assisted mapping is required for this case.',
          input.caseMetadata.caseId,
          invoiceEvidence,
          comparisons
            .filter((comparison) => comparison.status === 'unmatched')
            .map((comparison) => comparison.comparisonId),
          0,
          'human',
        ),
      )
    }
    traces.push(
      makeTrace(
        input.caseMetadata,
        'reconciled',
        traces.length,
        'Deterministic line and total controls evaluated.',
        'engine',
        discrepancies.flatMap((item) => item.evidenceIds),
      ),
    )
    const policyDecision = choosePolicy(discrepancies, provider.failure !== null)
    const status =
      policyDecision.outcome === 'clear'
        ? 'ready'
        : policyDecision.outcome === 'blocked'
          ? 'blocked'
          : 'needs_review'
    for (const discrepancy of discrepancies) {
      traces.push(
        makeTrace(
          input.caseMetadata,
          'discrepancy_detected',
          traces.length,
          discrepancy.message,
          discrepancy.controlBoundary === 'provider' ? 'provider' : 'engine',
          discrepancy.evidenceIds,
          { discrepancyId: discrepancy.discrepancyId, code: discrepancy.code },
        ),
      )
    }
    const failure = provider.failure
    const workspace: CaseWorkspace = {
      caseMetadata: input.caseMetadata,
      workflow: { phase: 'reconciled', status, revision: 1 },
      sourcePacket,
      extracted: {
        invoice: input.invoice,
        purchaseOrder: input.purchaseOrder,
        contract: input.contract,
        catalog: input.catalog,
      },
      lineComparisons: comparisons,
      discrepancies,
      policyDecision,
      traceEvents: traces,
      correctionDraft: null,
      approval: null,
      execution: null,
      evaluation: null,
      failure,
    }
    return {
      workspace: CaseWorkspaceSchema.parse(workspace),
      failure,
      providerCalls: provider.providerCalls,
    }
  }

  discrepancies.push(
    issue(
      'missing_required_fact',
      'critical',
      'Invoice and purchase-order facts are required for reconciliation.',
      input.caseMetadata.caseId,
    ),
  )
  const policyDecision = choosePolicy(discrepancies, provider.failure !== null)
  const workspace: CaseWorkspace = {
    caseMetadata: input.caseMetadata,
    workflow: { phase: 'reconciled', status: 'blocked', revision: 1 },
    sourcePacket,
    extracted: {
      invoice: input.invoice,
      purchaseOrder: input.purchaseOrder,
      contract: input.contract,
      catalog: input.catalog,
    },
    lineComparisons: [],
    discrepancies,
    policyDecision,
    traceEvents: traces,
    correctionDraft: null,
    approval: null,
    execution: null,
    evaluation: null,
    failure: provider.failure,
  }
  return {
    workspace: CaseWorkspaceSchema.parse(workspace),
    failure: provider.failure,
    providerCalls: provider.providerCalls,
  }
}

/** Reconcile a validated input. Runtime parsing remains enforced for JS callers. */
export function reconcile(input: ReconciliationInput): CaseWorkspace {
  const parsed = ReconciliationInputSchema.parse(input)
  return buildWorkspace(parsed).workspace
}

export const reconcileCase = reconcile
export const runReconciliation = (input: ReconciliationInput): ReconciliationResult => {
  const parsed = ReconciliationInputSchema.parse(input)
  return buildWorkspace(parsed)
}

export function safeReconcile(input: unknown): ReconciliationResult | null {
  const parsed = ReconciliationInputSchema.safeParse(input)
  return parsed.success ? buildWorkspace(parsed.data) : null
}

export function assertWorkspace(value: unknown): CaseWorkspace {
  return CaseWorkspaceSchema.parse(value)
}

export function sourcePacketHasOnlyData(sourcePacket: readonly SourcePacketEntry[]): boolean {
  return sourcePacket.every(
    (entry) => entry.trustBoundary === 'untrusted' || entry.trustBoundary === 'trusted',
  )
}

export function modelOutputFingerprint(value: unknown): string {
  return stableFingerprint(canonicalize(value))
}
