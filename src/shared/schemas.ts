import { z } from 'zod'

/**
 * Shared SupplierOps vocabulary.
 *
 * This module deliberately contains only browser-safe TypeScript and Zod. A
 * document is data at this boundary: its text is never represented as an
 * instruction or executable value.
 */

export const SCENARIO_IDS = [
  'clean-match',
  'price-mismatch',
  'semantic-match',
  'prompt-injection',
  'api-outage',
  'invalid-model-output',
] as const

export type ScenarioId = (typeof SCENARIO_IDS)[number]
export const ScenarioIdSchema = z.enum(SCENARIO_IDS)

export const PROVIDER_MODES = ['offline', 'provider'] as const
export type ProviderMode = (typeof PROVIDER_MODES)[number]
export const ProviderModeSchema = z.enum(PROVIDER_MODES)

export const CURRENCY_CODES = ['MXN', 'USD', 'CAD', 'EUR', 'GBP'] as const
/** Common display currencies; the schema accepts any ISO-4217-style code. */
export type CurrencyCode = string
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/u)

export const SOURCE_KINDS = [
  'invoice',
  'purchase_order',
  'contract',
  'catalog',
  'email',
  'other',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export const SourceKindSchema = z.enum(SOURCE_KINDS)

export const DOCUMENT_TRUST_BOUNDARIES = ['untrusted', 'trusted'] as const
export type DocumentTrustBoundary = (typeof DOCUMENT_TRUST_BOUNDARIES)[number]
export const DocumentTrustBoundarySchema = z.enum(DOCUMENT_TRUST_BOUNDARIES)

export const WORKFLOW_PHASES = [
  'source_loaded',
  'parsed',
  'reconciled',
  'drafted',
  'approved',
] as const
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number]
export const WorkflowPhaseSchema = z.enum(WORKFLOW_PHASES)

export const WORKFLOW_STATUSES = [
  'ready',
  'needs_review',
  'pending_approval',
  'blocked',
  'failed',
  'submitted',
  'executed',
] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]
export const WorkflowStatusSchema = z.enum(WORKFLOW_STATUSES)

export const POLICY_OUTCOMES = ['clear', 'draft_allowed', 'escalate', 'blocked'] as const
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number]
export const PolicyOutcomeSchema = z.enum(POLICY_OUTCOMES)

export const DISCREPANCY_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const
export type DiscrepancySeverity = (typeof DISCREPANCY_SEVERITIES)[number]
export const DiscrepancySeveritySchema = z.enum(DISCREPANCY_SEVERITIES)

export const CONTROL_BOUNDARIES = ['engine', 'human', 'provider'] as const
export type ControlBoundary = (typeof CONTROL_BOUNDARIES)[number]
export const ControlBoundarySchema = z.enum(CONTROL_BOUNDARIES)

export const DISCREPANCY_CODES = [
  'quantity_mismatch',
  'unit_price_mismatch',
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
] as const
export type DiscrepancyCode = (typeof DISCREPANCY_CODES)[number]
export const DiscrepancyCodeSchema = z.enum(DISCREPANCY_CODES)

export const LINE_MATCH_METHODS = [
  'exact_sku',
  'exact_description',
  'semantic_suggestion',
  'unmatched',
] as const
export type LineMatchMethod = (typeof LINE_MATCH_METHODS)[number]
export const LineMatchMethodSchema = z.enum(LINE_MATCH_METHODS)

export const LINE_COMPARISON_STATUSES = ['match', 'mismatch', 'unmatched'] as const
export type LineComparisonStatus = (typeof LINE_COMPARISON_STATUSES)[number]
export const LineComparisonStatusSchema = z.enum(LINE_COMPARISON_STATUSES)

export const VERIFICATION_STATUSES = ['verified', 'failed', 'not_run'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES)

export const PROVIDER_STATUSES = ['ok', 'unavailable', 'rate_limited', 'invalid_output'] as const
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number]
export const ProviderStatusSchema = z.enum(PROVIDER_STATUSES)

export const FAILURE_KINDS = [
  'provider_unavailable',
  'provider_rate_limited',
  'invalid_model_output',
  'schema_validation',
  'engine_reconciliation',
] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]
export const FailureKindSchema = z.enum(FAILURE_KINDS)

export const DRAFT_STATUSES = ['pending_approval', 'approved', 'submitted', 'rejected'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]
export const DraftStatusSchema = z.enum(DRAFT_STATUSES)

export const EXECUTION_STATUSES = ['not_started', 'submitted', 'succeeded', 'failed'] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES)

export const ACTOR_KINDS = ['engine', 'human', 'provider', 'system'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]
export const ActorKindSchema = z.enum(ACTOR_KINDS)

export const TRACE_EVENT_TYPES = [
  'source_loaded',
  'source_quarantined',
  'parsed',
  'reconciled',
  'discrepancy_detected',
  'draft_created',
  'draft_approved',
  'draft_submitted',
  'provider_failure',
  'provider_replayed',
  'model_output_rejected',
  'regression_saved',
] as const
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number]
export const TraceEventTypeSchema = z.enum(TRACE_EVENT_TYPES)

export const REGRESSION_OUTCOMES = ['saved', 'already_exists'] as const
export type RegressionOutcome = (typeof REGRESSION_OUTCOMES)[number]
export const RegressionOutcomeSchema = z.enum(REGRESSION_OUTCOMES)

export const METRIC_UNITS = ['count', 'basis_points', 'milliseconds', 'boolean'] as const
export type MetricUnit = (typeof METRIC_UNITS)[number]
export const MetricUnitSchema = z.enum(METRIC_UNITS)

const safeInteger = z
  .number()
  .int()
  .refine(Number.isSafeInteger, { message: 'Must be a safe integer.' })

/** Integer minor units. Currency arithmetic never accepts a decimal. */
export const MinorUnitsSchema = safeInteger.nonnegative()
export type MinorUnits = z.infer<typeof MinorUnitsSchema>

/** Controlled integer quantity. Fractional quantities need an explicit scale. */
export const QuantitySchema = safeInteger.positive()
export type Quantity = z.infer<typeof QuantitySchema>

/** Percent in basis points (10000 = 100%). */
export const BasisPointsSchema = safeInteger.nonnegative().max(10_000)
export type BasisPoints = z.infer<typeof BasisPointsSchema>

export const ConfidenceSchema = safeInteger.min(0).max(100)
export type Confidence = z.infer<typeof ConfidenceSchema>

export const NonNegativeIntegerSchema = safeInteger.nonnegative()
export const PositiveIntegerSchema = safeInteger.positive()

const IdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
export { IdSchema as EntityIdSchema }
export type EntityId = z.infer<typeof IdSchema>

const DateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
export const IsoDateTimeSchema = DateTimeSchema
export type IsoDateTime = z.infer<typeof DateTimeSchema>

const CalendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
export { CalendarDateSchema }
export type CalendarDate = z.infer<typeof CalendarDateSchema>

const BoundedText = (max: number) => z.string().trim().min(1).max(max)
const NullableText = (max: number) => z.string().trim().max(max).nullable()

export const SourceEvidenceSchema = z
  .object({
    evidenceId: IdSchema,
    sourceId: IdSchema,
    page: PositiveIntegerSchema.max(10_000),
    locator: BoundedText(200),
    excerpt: z.string().max(1_000),
  })
  .strict()
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>

export const SourcePacketEntrySchema = z
  .object({
    sourceId: IdSchema,
    kind: SourceKindSchema,
    name: BoundedText(160),
    pageCount: PositiveIntegerSchema.max(10_000),
    contentType: z.enum(['text', 'structured']),
    /** Content is untrusted data; it is never an instruction. */
    content: z.string().max(200_000),
    trustBoundary: DocumentTrustBoundarySchema,
    quarantined: z.boolean(),
    quarantineReason: NullableText(300),
    evidence: z.array(SourceEvidenceSchema).max(100),
  })
  .strict()
export type SourcePacketEntry = z.infer<typeof SourcePacketEntrySchema>

export const LineFactSchema = z
  .object({
    lineId: IdSchema,
    sku: NullableText(100),
    description: BoundedText(300),
    quantity: QuantitySchema,
    unitPriceMinor: MinorUnitsSchema,
    amountMinor: MinorUnitsSchema,
    taxRateBps: BasisPointsSchema.nullable(),
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type LineFact = z.infer<typeof LineFactSchema>

const DocumentTotals = {
  subtotalMinor: MinorUnitsSchema,
  taxMinor: MinorUnitsSchema,
  totalMinor: MinorUnitsSchema,
}

export const InvoiceFactSchema = z
  .object({
    documentId: IdSchema,
    invoiceNumber: NullableText(100),
    supplierId: IdSchema,
    supplierName: BoundedText(200),
    currency: CurrencyCodeSchema,
    issueDate: CalendarDateSchema,
    dueDate: CalendarDateSchema.nullable(),
    ...DocumentTotals,
    lines: z.array(LineFactSchema).min(1).max(500),
    evidenceIds: z.array(IdSchema).max(100),
  })
  .strict()
export type InvoiceFact = z.infer<typeof InvoiceFactSchema>

export const PurchaseOrderFactSchema = z
  .object({
    documentId: IdSchema,
    purchaseOrderNumber: NullableText(100),
    supplierId: IdSchema,
    supplierName: BoundedText(200),
    currency: CurrencyCodeSchema,
    issueDate: CalendarDateSchema,
    ...DocumentTotals,
    lines: z.array(LineFactSchema).min(1).max(500),
    evidenceIds: z.array(IdSchema).max(100),
  })
  .strict()
export type PurchaseOrderFact = z.infer<typeof PurchaseOrderFactSchema>

export const ContractFactSchema = z
  .object({
    contractId: IdSchema,
    supplierId: IdSchema,
    currency: CurrencyCodeSchema,
    active: z.boolean(),
    priceToleranceMinor: MinorUnitsSchema,
    priceToleranceBps: BasisPointsSchema,
    evidenceIds: z.array(IdSchema).max(100),
  })
  .strict()
export type ContractFact = z.infer<typeof ContractFactSchema>

export const CatalogItemSchema = z
  .object({
    catalogItemId: IdSchema,
    sku: NullableText(100),
    description: BoundedText(300),
    currency: CurrencyCodeSchema,
    unitPriceMinor: MinorUnitsSchema,
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type CatalogItem = z.infer<typeof CatalogItemSchema>

export const CatalogFactSchema = z
  .object({
    catalogId: IdSchema,
    currency: CurrencyCodeSchema,
    items: z.array(CatalogItemSchema).max(5_000),
    evidenceIds: z.array(IdSchema).max(100),
  })
  .strict()
export type CatalogFact = z.infer<typeof CatalogFactSchema>

export const CaseMetadataSchema = z
  .object({
    caseId: IdSchema,
    scenarioId: ScenarioIdSchema,
    supplierId: IdSchema,
    supplierName: BoundedText(200),
    openedAt: DateTimeSchema,
    sourceFingerprint: IdSchema,
    invoiceNumber: NullableText(100),
  })
  .strict()
export type CaseMetadata = z.infer<typeof CaseMetadataSchema>

export const WorkflowStateSchema = z
  .object({
    phase: WorkflowPhaseSchema,
    status: WorkflowStatusSchema,
    revision: NonNegativeIntegerSchema,
  })
  .strict()
export type WorkflowState = z.infer<typeof WorkflowStateSchema>

export const SemanticMappingSuggestionSchema = z
  .object({
    invoiceLineId: IdSchema,
    purchaseOrderLineId: IdSchema,
    confidence: ConfidenceSchema,
    rationale: BoundedText(500),
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type SemanticMappingSuggestion = z.infer<typeof SemanticMappingSuggestionSchema>

export const ContractInterpretationSuggestionSchema = z
  .object({
    rule: BoundedText(160),
    interpretation: BoundedText(500),
    confidence: ConfidenceSchema,
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type ContractInterpretationSuggestion = z.infer<
  typeof ContractInterpretationSuggestionSchema
>

export const ClassificationSuggestionSchema = z
  .object({
    discrepancyCode: DiscrepancyCodeSchema,
    classification: BoundedText(160),
    confidence: ConfidenceSchema,
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type ClassificationSuggestion = z.infer<typeof ClassificationSuggestionSchema>

export const ExplanationSuggestionSchema = z
  .object({
    discrepancyCode: DiscrepancyCodeSchema,
    explanation: BoundedText(1_000),
    confidence: ConfidenceSchema,
    evidenceIds: z.array(IdSchema).max(20),
  })
  .strict()
export type ExplanationSuggestion = z.infer<typeof ExplanationSuggestionSchema>

/**
 * The model can suggest semantic links and explanations only. It cannot send
 * amounts, totals, policy decisions, or approval/execution instructions.
 */
export const ModelOutputSchema = z
  .object({
    semanticMappings: z.array(SemanticMappingSuggestionSchema).max(500).default([]),
    contractInterpretations: z.array(ContractInterpretationSuggestionSchema).max(100).default([]),
    classifications: z.array(ClassificationSuggestionSchema).max(100).default([]),
    explanations: z.array(ExplanationSuggestionSchema).max(100).default([]),
  })
  .strict()
export type ModelOutput = z.infer<typeof ModelOutputSchema>

export const ProviderAdapterResultSchema = z
  .object({
    status: ProviderStatusSchema,
    statusCode: safeInteger.min(100).max(999).nullable(),
    retryable: z.boolean(),
    failureId: IdSchema.nullable(),
    latencyMs: NonNegativeIntegerSchema.nullable(),
    retryAfterMs: NonNegativeIntegerSchema.nullable(),
    modelOutput: ModelOutputSchema.nullable(),
    /** Raw provider data may be retained for a controlled replay, never executed. */
    rawModelOutput: z.unknown().optional(),
  })
  .strict()
export type ProviderAdapterResult = z.infer<typeof ProviderAdapterResultSchema>

export const LineComparisonSchema = z
  .object({
    comparisonId: IdSchema,
    invoiceLineId: IdSchema,
    purchaseOrderLineId: IdSchema.nullable(),
    matchMethod: LineMatchMethodSchema,
    status: LineComparisonStatusSchema,
    verification: VerificationStatusSchema,
    invoiceQuantity: QuantitySchema.nullable(),
    purchaseOrderQuantity: QuantitySchema.nullable(),
    quantityDelta: safeInteger,
    invoiceUnitPriceMinor: MinorUnitsSchema.nullable(),
    purchaseOrderUnitPriceMinor: MinorUnitsSchema.nullable(),
    unitPriceDeltaMinor: safeInteger,
    invoiceAmountMinor: MinorUnitsSchema.nullable(),
    purchaseOrderAmountMinor: MinorUnitsSchema.nullable(),
    amountDeltaMinor: safeInteger,
    confidence: ConfidenceSchema,
    evidenceIds: z.array(IdSchema).max(50),
  })
  .strict()
export type LineComparison = z.infer<typeof LineComparisonSchema>

export const DiscrepancySchema = z
  .object({
    discrepancyId: IdSchema,
    code: DiscrepancyCodeSchema,
    severity: DiscrepancySeveritySchema,
    confidence: ConfidenceSchema,
    controlBoundary: ControlBoundarySchema,
    message: BoundedText(1_000),
    lineComparisonIds: z.array(IdSchema).max(100),
    evidenceIds: z.array(IdSchema).max(100),
  })
  .strict()
export type Discrepancy = z.infer<typeof DiscrepancySchema>

export const PolicyDecisionSchema = z
  .object({
    outcome: PolicyOutcomeSchema,
    canCreateDraft: z.boolean(),
    canApprove: z.boolean(),
    canSubmit: z.boolean(),
    reasonCodes: z.array(DiscrepancyCodeSchema).max(100),
    rationale: BoundedText(1_000),
    decidedBy: z.literal('engine'),
  })
  .strict()
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

export const TraceEventSchema = z
  .object({
    eventId: IdSchema,
    type: TraceEventTypeSchema,
    actor: ActorKindSchema,
    at: DateTimeSchema,
    message: BoundedText(1_000),
    evidenceIds: z.array(IdSchema).max(100),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export type TraceEvent = z.infer<typeof TraceEventSchema>

export const FailureIssueSchema = z
  .object({
    path: z.string().max(300),
    code: z.string().trim().min(1).max(100),
    message: BoundedText(500),
  })
  .strict()
export type FailureIssue = z.infer<typeof FailureIssueSchema>

export const FailureSchema = z
  .object({
    failureId: IdSchema,
    kind: FailureKindSchema,
    message: BoundedText(1_000),
    retryable: z.boolean(),
    source: z.enum(['provider', 'schema', 'engine']),
    issues: z.array(FailureIssueSchema).max(100),
    occurrenceKey: IdSchema,
  })
  .strict()
export type Failure = z.infer<typeof FailureSchema>

export const DraftLineChangeSchema = z
  .object({
    invoiceLineId: IdSchema,
    fromUnitPriceMinor: MinorUnitsSchema,
    toUnitPriceMinor: MinorUnitsSchema,
    fromAmountMinor: MinorUnitsSchema,
    toAmountMinor: MinorUnitsSchema,
    evidenceIds: z.array(IdSchema).max(50),
  })
  .strict()
export type DraftLineChange = z.infer<typeof DraftLineChangeSchema>

export const CorrectionDraftSchema = z
  .object({
    draftId: IdSchema,
    caseId: IdSchema,
    invoiceNumber: IdSchema,
    currency: CurrencyCodeSchema,
    changes: z.array(DraftLineChangeSchema).min(1).max(500),
    correctedSubtotalMinor: MinorUnitsSchema,
    correctedTaxMinor: MinorUnitsSchema,
    correctedTotalMinor: MinorUnitsSchema,
    rationale: BoundedText(1_000),
    evidenceIds: z.array(IdSchema).max(100),
    idempotencyKey: IdSchema,
    status: DraftStatusSchema,
  })
  .strict()
export type CorrectionDraft = z.infer<typeof CorrectionDraftSchema>

export const ApprovalSchema = z
  .object({
    approvalId: IdSchema,
    caseId: IdSchema,
    draftId: IdSchema,
    approvedBy: BoundedText(160),
    approvedAt: DateTimeSchema,
    note: NullableText(1_000),
  })
  .strict()
export type Approval = z.infer<typeof ApprovalSchema>

export const ExecutionSchema = z
  .object({
    executionId: IdSchema,
    caseId: IdSchema,
    draftId: IdSchema,
    status: ExecutionStatusSchema,
    idempotencyKey: IdSchema,
    submittedAt: DateTimeSchema.nullable(),
    providerReference: NullableText(200),
    message: NullableText(500),
  })
  .strict()
export type Execution = z.infer<typeof ExecutionSchema>

export const FixtureAssertionSchema = z
  .object({
    schemaValid: z.boolean(),
    expectedPolicy: PolicyOutcomeSchema,
    lineMappingCorrect: z.boolean().nullable(),
    classification: DiscrepancyCodeSchema.nullable(),
    evidencePresent: z.boolean(),
    safetyPass: z.boolean(),
    draftAllowed: z.boolean(),
    approvalAllowed: z.boolean(),
    submissionAllowed: z.boolean(),
    providerCallsExpected: NonNegativeIntegerSchema,
    retryExpected: NonNegativeIntegerSchema,
    notes: z.array(BoundedText(500)).max(20),
  })
  .strict()
export type FixtureAssertion = z.infer<typeof FixtureAssertionSchema>

export const EvaluationMetricSchema = z
  .object({
    metric: z.string().trim().min(1).max(120),
    value: safeInteger.nonnegative(),
    unit: MetricUnitSchema,
    sampleSize: NonNegativeIntegerSchema,
    observed: z.boolean(),
    label: BoundedText(300),
  })
  .strict()
export type EvaluationMetric = z.infer<typeof EvaluationMetricSchema>

export const EvaluationResultSchema = z
  .object({
    evaluationId: IdSchema,
    sampleSize: PositiveIntegerSchema,
    scenarioIds: z.array(ScenarioIdSchema).min(1).max(SCENARIO_IDS.length),
    metrics: z.array(EvaluationMetricSchema).min(1).max(100),
    latencyMs: NonNegativeIntegerSchema.nullable(),
    retries: NonNegativeIntegerSchema,
    modelCalls: NonNegativeIntegerSchema,
    generatedAt: DateTimeSchema,
  })
  .strict()
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

export const ExtractedFactsSchema = z
  .object({
    invoice: InvoiceFactSchema.nullable(),
    purchaseOrder: PurchaseOrderFactSchema.nullable(),
    contract: ContractFactSchema.nullable(),
    catalog: CatalogFactSchema.nullable(),
  })
  .strict()
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>

/** Auditable projection used by renderer and persistence boundaries. */
export const CaseWorkspaceSchema = z
  .object({
    caseMetadata: CaseMetadataSchema,
    workflow: WorkflowStateSchema,
    sourcePacket: z.array(SourcePacketEntrySchema).min(1).max(50),
    extracted: ExtractedFactsSchema,
    lineComparisons: z.array(LineComparisonSchema).max(500),
    discrepancies: z.array(DiscrepancySchema).max(100),
    policyDecision: PolicyDecisionSchema,
    traceEvents: z.array(TraceEventSchema).max(500),
    correctionDraft: CorrectionDraftSchema.nullable(),
    approval: ApprovalSchema.nullable(),
    execution: ExecutionSchema.nullable(),
    evaluation: EvaluationResultSchema.nullable(),
    failure: FailureSchema.nullable(),
  })
  .strict()
export type CaseWorkspace = z.infer<typeof CaseWorkspaceSchema>

export const ReconciliationInputSchema = z
  .object({
    caseMetadata: CaseMetadataSchema,
    sourcePacket: z.array(SourcePacketEntrySchema).min(1).max(50),
    invoice: InvoiceFactSchema.nullable(),
    purchaseOrder: PurchaseOrderFactSchema.nullable(),
    contract: ContractFactSchema.nullable(),
    catalog: CatalogFactSchema.nullable(),
    mode: ProviderModeSchema,
    modelOutput: ModelOutputSchema.nullable(),
    providerResult: ProviderAdapterResultSchema.nullable(),
    knownInvoiceIds: z.array(IdSchema).max(10_000),
    knownFingerprints: z.array(IdSchema).max(10_000),
    at: DateTimeSchema,
  })
  .strict()
export type ReconciliationInput = z.infer<typeof ReconciliationInputSchema>

export const ScenarioFixtureSchema = z
  .object({
    scenarioId: ScenarioIdSchema,
    title: BoundedText(200),
    description: BoundedText(1_000),
    input: ReconciliationInputSchema,
    modelOutput: ModelOutputSchema.nullable(),
    rawModelOutput: z.unknown().optional(),
    providerResult: ProviderAdapterResultSchema.nullable(),
    assertions: FixtureAssertionSchema,
  })
  .strict()
export type ScenarioFixture = z.infer<typeof ScenarioFixtureSchema>

export const BootstrapInputSchema = z.object({}).strict()
export type BootstrapInput = z.infer<typeof BootstrapInputSchema>

export const BootstrapOutputSchema = z
  .object({
    schemaVersion: BoundedText(40),
    scenarioIds: z.array(ScenarioIdSchema).length(SCENARIO_IDS.length),
    capabilities: z.array(BoundedText(100)).max(50),
    maxSourceEntries: PositiveIntegerSchema,
    maxLineCount: PositiveIntegerSchema,
  })
  .strict()
export type BootstrapOutput = z.infer<typeof BootstrapOutputSchema>

export const LoadScenarioInputSchema = z.object({ scenarioId: ScenarioIdSchema }).strict()
export type LoadScenarioInput = z.infer<typeof LoadScenarioInputSchema>

export const RunScenarioInputSchema = z
  .object({
    scenarioId: ScenarioIdSchema,
    mode: ProviderModeSchema.default('offline'),
    providerResult: ProviderAdapterResultSchema.nullable().default(null),
    modelOutput: ModelOutputSchema.nullable().default(null),
    idempotencyKey: IdSchema.nullable().default(null),
  })
  .strict()
export type RunScenarioInput = z.infer<typeof RunScenarioInputSchema>

export const RunScenarioOutputSchema = z
  .object({
    workspace: CaseWorkspaceSchema,
    failure: FailureSchema.nullable(),
    replayable: z.boolean(),
    idempotencyKey: IdSchema,
    providerCalls: NonNegativeIntegerSchema,
  })
  .strict()
export type RunScenarioOutput = z.infer<typeof RunScenarioOutputSchema>

export const CreateCorrectionDraftInputSchema = z
  .object({
    caseId: IdSchema,
    idempotencyKey: IdSchema.default('idempotency:draft'),
    at: DateTimeSchema.default('1970-01-01T00:00:00.000Z'),
  })
  .strict()
export type CreateCorrectionDraftInput = z.infer<typeof CreateCorrectionDraftInputSchema>

export const CreateCorrectionDraftOutputSchema = z
  .object({ workspace: CaseWorkspaceSchema, draft: CorrectionDraftSchema })
  .strict()
export type CreateCorrectionDraftOutput = z.infer<typeof CreateCorrectionDraftOutputSchema>

export const ApproveDraftInputSchema = z
  .object({
    caseId: IdSchema,
    draftId: IdSchema,
    approvedBy: BoundedText(160).default('local-operator'),
    note: NullableText(1_000).default(null),
    at: DateTimeSchema.default('1970-01-01T00:00:00.000Z'),
    idempotencyKey: IdSchema.default('idempotency:approval'),
  })
  .strict()
export type ApproveDraftInput = z.infer<typeof ApproveDraftInputSchema>

export const ApproveDraftOutputSchema = z
  .object({ workspace: CaseWorkspaceSchema, approval: ApprovalSchema })
  .strict()
export type ApproveDraftOutput = z.infer<typeof ApproveDraftOutputSchema>

export const SubmitDraftInputSchema = z
  .object({
    caseId: IdSchema,
    draftId: IdSchema,
    idempotencyKey: IdSchema.default('idempotency:submit'),
    at: DateTimeSchema.default('1970-01-01T00:00:00.000Z'),
  })
  .strict()
export type SubmitDraftInput = z.infer<typeof SubmitDraftInputSchema>

export const SubmitDraftOutputSchema = z
  .object({ workspace: CaseWorkspaceSchema, execution: ExecutionSchema })
  .strict()
export type SubmitDraftOutput = z.infer<typeof SubmitDraftOutputSchema>

export const ReplayFailureInputSchema = z
  .object({
    caseId: IdSchema,
    failureId: IdSchema,
    mode: ProviderModeSchema.default('offline'),
    providerResult: ProviderAdapterResultSchema.nullable().default(null),
    modelOutput: ModelOutputSchema.nullable().default(null),
    idempotencyKey: IdSchema.default('idempotency:replay'),
    at: DateTimeSchema.default('1970-01-01T00:00:00.000Z'),
  })
  .strict()
export type ReplayFailureInput = z.infer<typeof ReplayFailureInputSchema>

export const ReplayFailureOutputSchema = z
  .object({
    workspace: CaseWorkspaceSchema,
    failure: FailureSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict()
export type ReplayFailureOutput = z.infer<typeof ReplayFailureOutputSchema>

export const SaveRegressionInputSchema = z
  .object({
    scenarioId: ScenarioIdSchema,
    workspace: CaseWorkspaceSchema,
    note: BoundedText(500).default('Regression fixture'),
    idempotencyKey: IdSchema.default('idempotency:regression'),
  })
  .strict()
export type SaveRegressionInput = z.infer<typeof SaveRegressionInputSchema>

export const SaveRegressionOutputSchema = z
  .object({
    regressionId: IdSchema,
    outcome: RegressionOutcomeSchema,
    scenarioId: ScenarioIdSchema,
  })
  .strict()
export type SaveRegressionOutput = z.infer<typeof SaveRegressionOutputSchema>

export const ImportSourcePacketInputSchema = z
  .object({
    caseMetadata: CaseMetadataSchema,
    sourcePacket: z.array(SourcePacketEntrySchema).min(1).max(50),
    at: DateTimeSchema.default('1970-01-01T00:00:00.000Z'),
  })
  .strict()
export type ImportSourcePacketInput = z.infer<typeof ImportSourcePacketInputSchema>

export const ImportSourcePacketOutputSchema = z.object({ workspace: CaseWorkspaceSchema }).strict()
export type ImportSourcePacketOutput = z.infer<typeof ImportSourcePacketOutputSchema>

/** Useful aliases for callers that use “PO” rather than “purchase order”. */
export const POSchema = PurchaseOrderFactSchema
export type POFact = PurchaseOrderFact
export const SourcePacketSchema = z.array(SourcePacketEntrySchema).min(1).max(50)
export const ApiModeSchema = ProviderModeSchema
