import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiContract } from '../../shared/api'
import {
  SCENARIO_IDS,
  type CaseWorkspace,
  type ProviderMode,
  type ScenarioId,
} from '../../shared/domain'

export const SCENARIO_META: Record<ScenarioId, { label: string; shortLabel: string }> = {
  'clean-match': { label: 'Clean match', shortLabel: 'Clean match' },
  'price-mismatch': { label: 'Price mismatch', shortLabel: 'Price mismatch' },
  'semantic-match': { label: 'Semantic match', shortLabel: 'Semantic match' },
  'prompt-injection': { label: 'Prompt injection', shortLabel: 'Prompt injection' },
  'api-outage': { label: 'API outage', shortLabel: 'API outage' },
  'invalid-model-output': { label: 'Invalid model output', shortLabel: 'Invalid output' },
}

export type WorkflowPhase = 'ingest' | 'parse' | 'reconcile' | 'draft' | 'approve'
export type WorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'warning'
  | 'blocked'
  | 'error'
  | 'offline'
  | 'rate-limited'
  | 'invalid-output'
  | 'approved'
  | 'executed'
  | 'empty'

export interface EvidenceRef {
  id: string
  label: string
  fileName: string
  page: number
  quote: string
  kind: 'source' | 'extracted' | 'policy' | 'trace'
}

export interface SourceFile {
  id: string
  name: string
  type: string
  pages: number
  received: string
  evidence: EvidenceRef[]
}

export interface SourcePacketView {
  files: SourceFile[]
  supplier: string
  invoiceNumber: string
  purchaseOrder: string
  receivedAt: string
  pageCount: number
  packetHash: string
}

export interface ExtractedFactView {
  id: string
  label: string
  value: string
  confidence?: string
  evidence?: EvidenceRef
}

export interface LineComparisonView {
  id: string
  description: string
  sku: string
  quantity: string
  invoiceValue: string
  expectedValue: string
  variance: string
  status: 'match' | 'review' | 'blocked' | 'unknown'
  matchMethod?: string
  verification?: string
  confidence?: string
  evidence?: EvidenceRef
}

export interface PolicyView {
  approvalRequired: boolean
  canCreateDraft: boolean
  canApprove: boolean
  canSubmit: boolean
  reason: string
  policyName: string
  lastChecked: string
}

export interface TraceEventView {
  id: string
  time: string
  kind: 'system' | 'adapter' | 'model' | 'policy' | 'human'
  title: string
  summary: string
  detail: string
  safeDetail?: string
  status: 'complete' | 'attention' | 'blocked' | 'pending'
}

export interface DraftView {
  id: string
  status: 'ready' | 'pending' | 'rejected'
  title: string
  summary: string
  changes: string[]
  createdAt: string
}

export interface ApprovalView {
  status: 'not-requested' | 'pending' | 'approved' | 'rejected'
  approvedBy?: string
  approvedAt?: string
}

export interface ExecutionView {
  status: 'not-run' | 'queued' | 'succeeded' | 'failed'
  adapter: 'local/mock'
  message?: string
  requestId?: string
}

export interface EvaluationView {
  evaluationId: string
  sampleSize: number
  metrics: EvaluationMetricView[]
  latencyMs: number | null
  retries: number
  modelCalls: number
  generatedAt: string
}

export interface EvaluationMetricView {
  metric: string
  label: string
  value: string
  unit: string
  sampleSize: number
  observed: boolean
}

export interface WorkspaceView {
  id: string
  scenarioId: ScenarioId
  caseTitle: string
  caseNumber: string
  supplier: string
  status: WorkspaceStatus
  phase: WorkflowPhase
  headline: string
  happened: string
  why: string
  safeNextAction: string
  sourcePacket: SourcePacketView
  extractedFacts: ExtractedFactView[]
  comparisons: LineComparisonView[]
  policy: PolicyView
  trace: TraceEventView[]
  draft?: DraftView
  approval: ApprovalView
  execution: ExecutionView
  evaluation?: EvaluationView
  providerMode: ProviderMode
  providerCallObserved: boolean
  providerCalls: number
  provider: 'offline' | 'local' | 'redacted-provider'
  providerLabel: string
  isPromptInjection: boolean
  correctionRequested: boolean
  regressionSaved: boolean
  updatedAt: string
  errorMessage?: string
  failureId?: string
  /** Raw, schema-validated workspace retained solely for save-regression input. */
  rawWorkspace?: CaseWorkspace
}

export interface SupplierOpsApi extends ApiContract {
  [key: string]: unknown
}

export interface UseSupplierOpsOptions {
  api?: ApiContract
  initialScenarioId?: ScenarioId
}

export interface SupplierOpsState {
  apiAvailable: boolean
  scenarioId: ScenarioId
  providerMode: ProviderMode
  workspace: WorkspaceView
  isLoading: boolean
  isMutating: boolean
  error?: string
  setScenario: (scenarioId: ScenarioId) => void
  setProviderMode: (mode: ProviderMode) => void
  runScenario: () => Promise<void>
  importSourcePacket: () => Promise<void>
  requestCorrection: () => Promise<void>
  createCorrectedDraft: () => Promise<void>
  approve: () => Promise<void>
  submit: () => Promise<void>
  retry: () => Promise<void>
  replay: () => Promise<void>
  saveRegression: () => Promise<void>
}

type RecordLike = Record<string, unknown>

const asRecord = (value: unknown): RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : {}

const first = (record: RecordLike, keys: string[], fallback: unknown = ''): unknown => {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return fallback
}

const stringValue = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

const numberValue = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const defaultProviderMode = (): ProviderMode => 'offline'

const providerModeFor = (scenarioId: ScenarioId, requested: ProviderMode): ProviderMode =>
  scenarioId === 'prompt-injection' ? 'offline' : requested

const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const scenarioFrom = (value: unknown, fallback: ScenarioId): ScenarioId => {
  const candidate = stringValue(value, fallback)
  return (SCENARIO_IDS as readonly string[]).includes(candidate)
    ? (candidate as ScenarioId)
    : fallback
}

const statusFrom = (value: unknown, scenarioId: ScenarioId): WorkspaceStatus => {
  const candidate = stringValue(value).toLowerCase().replaceAll('_', '-')
  const aliases: Record<string, WorkspaceStatus> = {
    'needs-review': 'warning',
    'pending-approval': 'warning',
    failed: 'error',
    submitted: 'executed',
  }
  if (aliases[candidate]) return aliases[candidate]
  if (
    [
      'loading',
      'ready',
      'warning',
      'blocked',
      'error',
      'offline',
      'rate-limited',
      'invalid-output',
      'approved',
      'executed',
      'empty',
    ].includes(candidate)
  ) {
    return candidate as WorkspaceStatus
  }
  if (scenarioId === 'prompt-injection') return 'blocked'
  if (scenarioId === 'api-outage') return 'offline'
  if (scenarioId === 'invalid-model-output') return 'invalid-output'
  return 'ready'
}

const phaseFrom = (value: unknown, status: WorkspaceStatus): WorkflowPhase => {
  const candidate = stringValue(value).toLowerCase().replaceAll('-', '_')
  const phases: Record<string, WorkflowPhase> = {
    ingest: 'ingest',
    source_loaded: 'ingest',
    parse: 'parse',
    parsed: 'parse',
    reconcile: 'reconcile',
    reconciled: 'reconcile',
    draft: 'draft',
    drafted: 'draft',
    approve: 'approve',
    approved: 'approve',
  }
  if (phases[candidate]) return phases[candidate]
  if (status === 'approved' || status === 'executed') return 'approve'
  if (status === 'blocked' || status === 'invalid-output' || status === 'error') return 'reconcile'
  return 'reconcile'
}

const safeKind = (value: unknown): TraceEventView['kind'] => {
  const candidate = stringValue(value).toLowerCase()
  if (candidate === 'engine') return 'policy'
  if (candidate === 'provider') return 'model'
  if (['system', 'adapter', 'model', 'policy', 'human'].includes(candidate)) {
    return candidate as TraceEventView['kind']
  }
  return 'system'
}

const evidenceFrom = (value: unknown, index: number, defaultFile: string): EvidenceRef => {
  const source = asRecord(value)
  const page = Math.max(
    1,
    Math.round(numberValue(first(source, ['page', 'pageNumber', 'page_index']), 1)),
  )
  const fileName = stringValue(
    first(source, ['fileName', 'file', 'source', 'document']),
    defaultFile,
  )
  return {
    id: stringValue(first(source, ['id', 'evidenceId', 'citationId']), `evidence-${index + 1}`),
    label: stringValue(first(source, ['label', 'title', 'citation']), `p. ${page}`),
    fileName,
    page,
    quote: stringValue(
      first(source, ['quote', 'excerpt', 'text', 'content', 'locator']),
      'Source excerpt is available in the evidence drawer.',
    ),
    kind: ['extracted', 'policy', 'trace'].includes(stringValue(source.kind))
      ? (stringValue(source.kind) as EvidenceRef['kind'])
      : 'source',
  }
}

const evidenceFromId = (
  value: unknown,
  index: number,
  defaultFile: string,
  evidenceById: Map<string, EvidenceRef>,
): EvidenceRef | undefined => {
  if (typeof value === 'string') return evidenceById.get(value)
  if (Array.isArray(value)) {
    const firstId = value.find((candidate): candidate is string => typeof candidate === 'string')
    if (firstId && evidenceById.has(firstId)) return evidenceById.get(firstId)
    if (value[0] !== undefined && typeof value[0] === 'object')
      return evidenceFrom(value[0], index, defaultFile)
  }
  if (value && typeof value === 'object') return evidenceFrom(value, index, defaultFile)
  return undefined
}

/** Format an explicitly minor-unit amount. Never infer units from magnitude. */
const formatMoney = (value: unknown, currency = 'USD'): string => {
  if (value === null || value === undefined || value === '') return '—'
  const numeric =
    typeof value === 'number'
      ? Number.isSafeInteger(value)
        ? value
        : Number.NaN
      : typeof value === 'string' && /^-?\d+$/u.test(value.trim())
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(numeric)) return stringValue(value, '—')
  const major = numeric / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${currency} ${major.toFixed(2)}`
  }
}

const formatPercent = (delta: unknown, base: unknown): string => {
  const deltaNumber = numberValue(delta, Number.NaN)
  const baseNumber = numberValue(base, Number.NaN)
  if (!Number.isFinite(deltaNumber) || !Number.isFinite(baseNumber) || baseNumber === 0) return '—'
  const percent = (deltaNumber / Math.abs(baseNumber)) * 100
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`
}

const fallbackEvidence = (
  id: string,
  label: string,
  fileName: string,
  page: number,
  quote: string,
  kind: EvidenceRef['kind'] = 'source',
): EvidenceRef => ({ id, label, fileName, page, quote, kind })

const makeFallback = (scenarioId: ScenarioId): WorkspaceView => {
  const invoiceFile = 'invoice_INV-24018.pdf'
  const orderFile = 'purchase_order_PO-8831.pdf'
  const policyFile = 'supplier_policy_v3.pdf'
  const invoiceEvidence = fallbackEvidence(
    'invoice-total',
    'Invoice · p. 1',
    invoiceFile,
    1,
    'Invoice total: $2,940.00 USD · terms Net 30',
  )
  const orderEvidence = fallbackEvidence(
    'po-total',
    'PO · p. 2',
    orderFile,
    2,
    'Approved purchase order total: $2,760.00 USD · unit price $120.00',
  )
  const policyEvidence = fallbackEvidence(
    'policy-threshold',
    'Policy · p. 4',
    policyFile,
    4,
    'Price variance above 5% requires correction and a separate human approval.',
    'policy',
  )

  const sharedFiles: SourceFile[] = [
    {
      id: 'invoice',
      name: invoiceFile,
      type: 'PDF invoice',
      pages: 2,
      received: 'Today · 09:41',
      evidence: [invoiceEvidence],
    },
    {
      id: 'purchase-order',
      name: orderFile,
      type: 'PDF purchase order',
      pages: 2,
      received: 'Today · 09:41',
      evidence: [orderEvidence],
    },
    {
      id: 'policy',
      name: policyFile,
      type: 'Policy snapshot',
      pages: 6,
      received: 'Pinned · v3.2',
      evidence: [policyEvidence],
    },
  ]

  const base: WorkspaceView = {
    id: `case-${scenarioId}`,
    scenarioId,
    caseTitle: 'Invoice exception review',
    caseNumber: 'INV-24018',
    supplier: 'Northwind Industrial Supply',
    status: 'ready',
    phase: 'reconcile',
    headline: 'Two invoice lines need a grounded review before approval.',
    happened:
      'The invoice was parsed successfully and compared with the purchase order. One unit-price variance is outside the configured tolerance.',
    why: 'The supplier invoice lists $135.00 for the gasket kit while the approved order lists $120.00. The 12.5% variance exceeds the 5% policy threshold.',
    safeNextAction:
      'Request a corrected invoice, then create a corrected draft for separate approval.',
    sourcePacket: {
      files: sharedFiles,
      supplier: 'Northwind Industrial Supply',
      invoiceNumber: 'INV-24018',
      purchaseOrder: 'PO-8831',
      receivedAt: '27 Aug 2026 · 09:41',
      pageCount: 10,
      packetHash: 'sha256: 8e1a…4c90',
    },
    extractedFacts: [
      {
        id: 'supplier',
        label: 'Supplier',
        value: 'Northwind Industrial Supply',
      },
      {
        id: 'invoice',
        label: 'Invoice number',
        value: 'INV-24018',
        evidence: invoiceEvidence,
      },
      { id: 'currency', label: 'Currency', value: 'USD' },
      {
        id: 'terms',
        label: 'Payment terms',
        value: 'Net 30',
        evidence: invoiceEvidence,
      },
    ],
    comparisons: [
      {
        id: 'line-001',
        description: 'Gasket kit · 40 mm',
        sku: 'NW-GK-40',
        quantity: '12',
        invoiceValue: '$135.00',
        expectedValue: '$120.00',
        variance: '+12.5%',
        status: 'review',
        evidence: invoiceEvidence,
      },
      {
        id: 'line-002',
        description: 'Stainless fastener set',
        sku: 'NW-FS-08',
        quantity: '24',
        invoiceValue: '$45.00',
        expectedValue: '$45.00',
        variance: '0.0%',
        status: 'match',
        evidence: orderEvidence,
      },
      {
        id: 'line-003',
        description: 'Freight · standard',
        sku: 'FRT-STND',
        quantity: '1',
        invoiceValue: '$120.00',
        expectedValue: '$120.00',
        variance: '0.0%',
        status: 'match',
        evidence: invoiceEvidence,
      },
    ],
    policy: {
      approvalRequired: true,
      canCreateDraft: true,
      canApprove: false,
      canSubmit: false,
      reason: 'Correction draft and separate human approval are required.',
      policyName: 'Invoice variance policy · v3.2',
      lastChecked: '09:42:18 local',
    },
    trace: [
      {
        id: 'trace-ingest',
        time: '09:41:02',
        kind: 'system',
        title: 'Packet ingested',
        summary: '3 source files · 10 pages',
        detail: 'The local sandbox recorded the source packet and its content hash.',
        status: 'complete',
      },
      {
        id: 'trace-parse',
        time: '09:41:21',
        kind: 'model',
        title: 'Fields extracted',
        summary: '18 fields · local extraction path',
        detail:
          'Document excerpts were handled by the configured offline path; no provider request was made.',
        safeDetail: 'Provider payloads and credentials are redacted from the trace.',
        status: 'complete',
      },
      {
        id: 'trace-reconcile',
        time: '09:42:18',
        kind: 'policy',
        title: 'Variance identified',
        summary: '1 line above 5% tolerance',
        detail: 'Unit price on NW-GK-40 is $15.00 above the approved purchase order value.',
        status: 'attention',
      },
    ],
    approval: { status: 'not-requested' },
    execution: { status: 'not-run', adapter: 'local/mock' },
    evaluation: undefined,
    providerMode: defaultProviderMode(),
    providerCallObserved: false,
    providerCalls: 0,
    provider: 'offline',
    providerLabel: 'Offline AI path',
    isPromptInjection: false,
    correctionRequested: false,
    regressionSaved: false,
    updatedAt: '09:42:18',
  }

  if (scenarioId === 'clean-match') {
    base.headline = 'All invoice lines reconcile to the approved order.'
    base.happened =
      'The packet was parsed locally and every line matched the purchase order within the configured tolerance.'
    base.why =
      'No material variance was found. Supplier, currency, quantities, and totals are grounded in the source packet.'
    base.safeNextAction =
      'Create a corrected draft for review, then approve it explicitly before the local mock adapter is run.'
    base.comparisons = base.comparisons.map((line) => ({
      ...line,
      invoiceValue: line.expectedValue,
      variance: '0.0%',
      status: 'match',
    }))
    base.policy = {
      ...base.policy,
      canCreateDraft: false,
      canApprove: false,
      reason: 'A draft must be created before the approval step.',
    }
    base.trace = base.trace.map((event) =>
      event.id === 'trace-reconcile'
        ? {
            ...event,
            title: 'Reconciliation complete',
            summary: 'All lines within tolerance',
            status: 'complete',
          }
        : event,
    )
  }

  if (scenarioId === 'semantic-match') {
    base.headline = 'Description variants resolve to the same approved items.'
    base.happened =
      'The parser found wording differences between the invoice and order, then grounded the match on SKU, quantity, and unit price.'
    base.why =
      '‘Gasket kit 40mm’ and ‘40 mm gasket assembly’ refer to the same SKU. No price or quantity variance remains.'
    base.safeNextAction =
      'Review the semantic-match evidence, create a draft, and approve separately.'
    base.comparisons = base.comparisons.map((line, index) =>
      index === 0
        ? {
            ...line,
            description: '40 mm gasket assembly ↔ Gasket kit · 40 mm',
            invoiceValue: '$120.00',
            expectedValue: '$120.00',
            variance: '0.0%',
            status: 'match',
          }
        : line,
    )
    base.trace = base.trace.map((event) =>
      event.id === 'trace-reconcile'
        ? {
            ...event,
            title: 'Semantic match grounded',
            summary: 'SKU + quantity + price agree',
            status: 'complete',
          }
        : event,
    )
  }

  if (scenarioId === 'prompt-injection') {
    base.status = 'blocked'
    base.headline = 'Processing stopped: an embedded instruction was detected in the source packet.'
    base.happened =
      'A note inside the supplier document attempted to redirect the workflow. It was treated as untrusted document content and was not followed.'
    base.why =
      'The source packet cannot authorize actions, change policy, or request secrets. Human review is required before any correction can proceed.'
    base.safeNextAction =
      'Keep the case blocked. Inspect the trace and obtain a clean supplier document before continuing.'
    base.policy = {
      ...base.policy,
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reason: 'Prompt-injection signal keeps approval and submission blocked.',
    }
    base.isPromptInjection = true
    base.comparisons = base.comparisons.map((line) => ({ ...line, status: 'blocked' }))
    base.trace = [
      ...base.trace.slice(0, 2),
      {
        id: 'trace-injection',
        time: '09:42:03',
        kind: 'policy',
        title: 'Untrusted instruction blocked',
        summary: 'No tool or provider action was taken',
        detail:
          'A document excerpt was classified as an instruction rather than business evidence. It remains quarantined from the workflow.',
        safeDetail: 'Sensitive request and provider payload details are intentionally omitted.',
        status: 'blocked',
      },
    ]
  }

  if (scenarioId === 'api-outage') {
    base.status = 'offline'
    base.headline = 'Provider unavailable; the local evidence path is still available.'
    base.happened =
      'The optional provider check timed out. Source files and previously captured local evidence remain available for review.'
    base.why =
      'No external response is required to inspect the packet, but the case cannot claim a fresh model result while the provider is unavailable.'
    base.safeNextAction =
      'Review local evidence or retry the provider check. Do not submit until a draft is grounded and approved.'
    base.policy = {
      ...base.policy,
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reason: 'Provider outage: fresh model result and approval are unavailable.',
    }
    base.provider = 'offline'
    base.providerLabel = 'Offline fallback · provider unavailable'
    base.trace = base.trace.map((event) =>
      event.id === 'trace-parse'
        ? {
            ...event,
            title: 'Provider check timed out',
            summary: 'Local parse retained',
            detail:
              'The provider did not respond within the sandbox timeout. The UI is using the captured local path and no automatic retry was sent.',
            status: 'attention',
          }
        : event,
    )
    base.errorMessage = 'Provider check timed out after 10s. The local sandbox remains available.'
  }

  if (scenarioId === 'invalid-model-output') {
    base.status = 'invalid-output'
    base.headline = 'The model output was quarantined before it could affect the case.'
    base.happened =
      'A structured extraction response failed validation. The invalid fields were discarded and no reconciliation decision was made from them.'
    base.why =
      'Only schema-valid, source-grounded values can enter the review. The last valid packet snapshot is retained for inspection.'
    base.safeNextAction =
      'Request a fresh parse or use the source packet manually; approval and submission remain unavailable.'
    base.policy = {
      ...base.policy,
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reason: 'Invalid model output must be corrected before approval.',
    }
    base.trace = base.trace.map((event) =>
      event.id === 'trace-parse'
        ? {
            ...event,
            title: 'Output validation failed',
            summary: 'Payload quarantined · no fields applied',
            detail:
              'The structured response did not satisfy the expected schema. No raw provider payload is shown in this trace.',
            safeDetail:
              'The rejected payload is not displayed because it may contain untrusted or sensitive content.',
            status: 'blocked',
          }
        : event,
    )
  }

  return base
}

const FALLBACK_WORKSPACES = SCENARIO_IDS.reduce<Record<ScenarioId, WorkspaceView>>(
  (accumulator, scenarioId) => {
    accumulator[scenarioId] = makeFallback(scenarioId)
    return accumulator
  },
  {} as Record<ScenarioId, WorkspaceView>,
)

const normalizeStatus = (value: unknown, scenarioId: ScenarioId): WorkspaceStatus =>
  statusFrom(value, scenarioId)

const normalizeWorkspace = (input: unknown, fallbackScenario: ScenarioId): WorkspaceView => {
  const root = asRecord(input)
  if (root.caseMetadata && root.workflow && Array.isArray(root.sourcePacket)) {
    return normalizeCaseWorkspace(input, fallbackScenario)
  }
  const caseRecord = asRecord(first(root, ['case', 'caseMetadata', 'metadata'], {}))
  const scenarioId = scenarioFrom(
    first(
      root,
      ['scenarioId', 'scenario', 'scenario_id'],
      first(caseRecord, ['scenarioId', 'scenario']),
    ),
    fallbackScenario,
  )
  const fallback = FALLBACK_WORKSPACES[scenarioId]
  const status = normalizeStatus(
    first(root, ['status', 'workflowStatus'], first(caseRecord, ['status'])),
    scenarioId,
  )
  const workflowRecord = asRecord(first(root, ['workflow', 'workflowState'], {}))
  const sourceRecord = asRecord(first(root, ['sourcePacket', 'source', 'packet'], {}))
  const policyRecord = asRecord(first(root, ['policy', 'policyDecision'], {}))
  const approvalRecord = asRecord(first(root, ['approval', 'approvalState'], {}))
  const executionRecord = asRecord(first(root, ['execution', 'executionState'], {}))
  const rawFiles = arrayValue(
    first(sourceRecord, ['files', 'documents', 'sources'], first(root, ['sourceFiles'], [])),
  )

  const files = rawFiles.length
    ? rawFiles.map((rawFile, index) => {
        const file = asRecord(rawFile)
        const name = stringValue(
          first(file, ['name', 'fileName', 'filename']),
          `source-${index + 1}.pdf`,
        )
        const rawEvidence = arrayValue(first(file, ['evidence', 'citations', 'excerpts'], []))
        return {
          id: stringValue(first(file, ['id', 'fileId']), `source-${index + 1}`),
          name,
          type: stringValue(first(file, ['type', 'mimeType']), 'Source document'),
          pages: Math.max(1, Math.round(numberValue(first(file, ['pages', 'pageCount']), 1))),
          received: stringValue(
            first(file, ['received', 'receivedAt', 'timestamp']),
            'Source packet',
          ),
          evidence: rawEvidence.map((evidence, evidenceIndex) =>
            evidenceFrom(evidence, evidenceIndex, name),
          ),
        } satisfies SourceFile
      })
    : fallback.sourcePacket.files

  const rawEvidence = arrayValue(
    first(sourceRecord, ['evidence', 'citations', 'excerpts'], first(root, ['evidence'], [])),
  )
  const allEvidence = rawEvidence.length
    ? rawEvidence.map((evidence, index) =>
        evidenceFrom(evidence, index, files[0]?.name ?? 'source.pdf'),
      )
    : files.flatMap((file) => file.evidence)
  const evidenceById = new Map(allEvidence.map((evidence) => [evidence.id, evidence]))
  const resolveEvidence = (value: unknown, index: number): EvidenceRef | undefined => {
    if (typeof value === 'string' && evidenceById.has(value)) return evidenceById.get(value)
    if (value && typeof value === 'object')
      return evidenceFrom(value, index, files[0]?.name ?? 'source.pdf')
    return allEvidence[index % Math.max(allEvidence.length, 1)]
  }

  const rawFacts = arrayValue(first(root, ['extractedFacts', 'facts', 'extracted'], []))
  const extractedFacts = rawFacts.length
    ? rawFacts.map((rawFact, index) => {
        const fact = asRecord(rawFact)
        return {
          id: stringValue(first(fact, ['id', 'key']), `fact-${index + 1}`),
          label: stringValue(first(fact, ['label', 'name', 'field']), `Field ${index + 1}`),
          value: stringValue(first(fact, ['value', 'displayValue', 'text']), '—'),
          confidence: stringValue(first(fact, ['confidence', 'score']), ''),
          evidence: resolveEvidence(first(fact, ['evidence', 'citation', 'source']), index),
        } satisfies ExtractedFactView
      })
    : fallback.extractedFacts

  const rawComparisons = arrayValue(
    first(root, ['comparisons', 'lineComparisons', 'discrepancies', 'reconciliation'], []),
  )
  const comparisons = rawComparisons.length
    ? rawComparisons.map((rawComparison, index) => {
        const comparison = asRecord(rawComparison)
        const rawStatus = stringValue(
          first(comparison, ['status', 'decision', 'result']),
          'unknown',
        ).toLowerCase()
        const comparisonStatus = rawStatus.includes('match')
          ? 'match'
          : rawStatus.includes('block')
            ? 'blocked'
            : rawStatus.includes('review') || rawStatus.includes('mismatch')
              ? 'review'
              : 'unknown'
        return {
          id: stringValue(
            first(comparison, ['id', 'lineId']),
            `line-${String(index + 1).padStart(3, '0')}`,
          ),
          description: stringValue(
            first(comparison, ['description', 'item', 'name']),
            `Line ${index + 1}`,
          ),
          sku: stringValue(first(comparison, ['sku', 'itemCode', 'code']), '—'),
          quantity: stringValue(first(comparison, ['quantity', 'qty']), '—'),
          invoiceValue: stringValue(
            first(comparison, ['invoiceValue', 'invoice', 'actual', 'observed']),
            '—',
          ),
          expectedValue: stringValue(
            first(comparison, ['expectedValue', 'purchaseOrder', 'po', 'expected']),
            '—',
          ),
          variance: stringValue(first(comparison, ['variance', 'delta', 'difference']), '—'),
          status: comparisonStatus as LineComparisonView['status'],
          evidence: resolveEvidence(first(comparison, ['evidence', 'citation', 'source']), index),
        } satisfies LineComparisonView
      })
    : fallback.comparisons

  const rawTrace = arrayValue(first(root, ['trace', 'traceEvents', 'events', 'auditTrail'], []))
  const trace = rawTrace.length
    ? rawTrace.map((rawEvent, index) => {
        const event = asRecord(rawEvent)
        const rawEventStatus = stringValue(first(event, ['status', 'state']), 'complete')
          .toLowerCase()
          .replaceAll('_', '-')
        const eventStatus = ['complete', 'attention', 'blocked', 'pending'].includes(rawEventStatus)
          ? rawEventStatus
          : 'complete'
        return {
          id: stringValue(first(event, ['id', 'eventId']), `trace-${index + 1}`),
          time: stringValue(first(event, ['time', 'timestamp', 'at']), '—'),
          kind: safeKind(first(event, ['kind', 'type', 'actor'])),
          title: stringValue(first(event, ['title', 'name', 'event']), `Event ${index + 1}`),
          summary: stringValue(
            first(event, ['summary', 'message', 'description']),
            'Recorded event',
          ),
          detail: stringValue(
            first(event, ['detail', 'details', 'output']),
            'Details are available in the trace drawer.',
          ),
          safeDetail: stringValue(first(event, ['safeDetail', 'redactionNote']), ''),
          status: eventStatus as TraceEventView['status'],
        } satisfies TraceEventView
      })
    : fallback.trace

  const rawDraft = asRecord(first(root, ['draft', 'correctionDraft'], {}))
  const hasDraft = Object.keys(rawDraft).length > 0 || Boolean(fallback.draft)
  const draft = hasDraft
    ? {
        id: stringValue(
          first(rawDraft, ['id', 'draftId']),
          fallback.draft?.id ?? 'draft-local-001',
        ),
        status: (['ready', 'pending', 'rejected'].includes(
          stringValue(first(rawDraft, ['status', 'state']), 'ready'),
        )
          ? stringValue(first(rawDraft, ['status', 'state']), 'ready')
          : 'ready') as DraftView['status'],
        title: stringValue(first(rawDraft, ['title', 'name']), 'Corrected invoice draft'),
        summary: stringValue(
          first(rawDraft, ['summary', 'description']),
          'Draft reflects the reviewed source evidence and policy decision.',
        ),
        changes: arrayValue(first(rawDraft, ['changes', 'edits']))
          .map((change) => stringValue(change))
          .filter(Boolean),
        createdAt: stringValue(first(rawDraft, ['createdAt', 'timestamp']), 'Just now'),
      }
    : undefined

  const normalizedPolicy: PolicyView = {
    approvalRequired: Boolean(
      first(
        policyRecord,
        ['approvalRequired', 'requiresApproval'],
        fallback.policy.approvalRequired,
      ),
    ),
    canCreateDraft: Boolean(
      first(policyRecord, ['canCreateDraft', 'draftAllowed'], fallback.policy.canCreateDraft),
    ),
    canApprove: Boolean(
      first(
        policyRecord,
        ['canApprove', 'approvalAllowed', 'isApprovable'],
        fallback.policy.canApprove,
      ),
    ),
    canSubmit: Boolean(
      first(
        policyRecord,
        ['canSubmit', 'submissionAllowed', 'isSubmittable'],
        fallback.policy.canSubmit,
      ),
    ),
    reason: stringValue(
      first(policyRecord, ['reason', 'explanation', 'message']),
      fallback.policy.reason,
    ),
    policyName: stringValue(
      first(policyRecord, ['name', 'policyName', 'version']),
      fallback.policy.policyName,
    ),
    lastChecked: stringValue(
      first(policyRecord, ['lastChecked', 'checkedAt']),
      fallback.policy.lastChecked,
    ),
  }

  const normalizedApproval: ApprovalView = {
    status: (['not-requested', 'pending', 'approved', 'rejected'].includes(
      stringValue(first(approvalRecord, ['status', 'state']), fallback.approval.status),
    )
      ? stringValue(first(approvalRecord, ['status', 'state']), fallback.approval.status)
      : fallback.approval.status) as ApprovalView['status'],
    approvedBy:
      stringValue(first(approvalRecord, ['approvedBy', 'actor', 'name']), '') || undefined,
    approvedAt: stringValue(first(approvalRecord, ['approvedAt', 'timestamp']), '') || undefined,
  }

  const rawExecutionStatus = stringValue(first(executionRecord, ['status', 'state']), 'not-run')
  const normalizedExecution: ExecutionView = {
    status: (['not-run', 'queued', 'succeeded', 'failed'].includes(rawExecutionStatus)
      ? rawExecutionStatus
      : 'not-run') as ExecutionView['status'],
    adapter: 'local/mock',
    message: stringValue(first(executionRecord, ['message', 'result']), '') || undefined,
    requestId: stringValue(first(executionRecord, ['requestId', 'id']), '') || undefined,
  }

  const provider = stringValue(
    first(root, ['provider', 'providerMode', 'aiMode']),
    fallback.provider,
  ).toLowerCase()
  const normalizedProvider: WorkspaceView['provider'] = provider.includes('redact')
    ? 'redacted-provider'
    : provider.includes('local')
      ? 'local'
      : 'offline'
  const normalizedCorrection = Boolean(
    first(root, ['correctionRequested', 'correction_requested'], fallback.correctionRequested),
  )
  const normalizedRegression = Boolean(
    first(root, ['regressionSaved', 'savedRegression'], fallback.regressionSaved),
  )

  return {
    ...fallback,
    ...root,
    id: stringValue(
      first(root, ['id', 'caseId'], first(caseRecord, ['id', 'caseId'])),
      fallback.id,
    ),
    scenarioId,
    caseTitle: stringValue(
      first(root, ['caseTitle', 'title', 'name'], first(caseRecord, ['title', 'name'])),
      fallback.caseTitle,
    ),
    caseNumber: stringValue(
      first(
        root,
        ['caseNumber', 'number', 'invoiceNumber'],
        first(caseRecord, ['number', 'invoiceNumber']),
      ),
      fallback.caseNumber,
    ),
    supplier: stringValue(
      first(root, ['supplier', 'supplierName'], first(caseRecord, ['supplier', 'supplierName'])),
      fallback.supplier,
    ),
    status,
    phase: phaseFrom(
      first(workflowRecord, ['phase', 'currentPhase'], first(root, ['phase'])),
      status,
    ),
    headline: stringValue(
      first(
        root,
        ['headline', 'summary', 'whatHappened'],
        first(caseRecord, ['headline', 'summary']),
      ),
      fallback.headline,
    ),
    happened: stringValue(
      first(root, ['happened', 'whatHappened', 'observation']),
      fallback.happened,
    ),
    why: stringValue(first(root, ['why', 'reason', 'explanation']), fallback.why),
    safeNextAction: stringValue(
      first(root, ['safeNextAction', 'nextAction', 'recommendation']),
      fallback.safeNextAction,
    ),
    sourcePacket: {
      ...fallback.sourcePacket,
      ...sourceRecord,
      files,
      supplier: stringValue(
        first(sourceRecord, ['supplier', 'supplierName']),
        fallback.sourcePacket.supplier,
      ),
      invoiceNumber: stringValue(
        first(sourceRecord, ['invoiceNumber', 'invoice']),
        fallback.sourcePacket.invoiceNumber,
      ),
      purchaseOrder: stringValue(
        first(sourceRecord, ['purchaseOrder', 'poNumber', 'po']),
        fallback.sourcePacket.purchaseOrder,
      ),
      receivedAt: stringValue(
        first(sourceRecord, ['receivedAt', 'timestamp']),
        fallback.sourcePacket.receivedAt,
      ),
      pageCount: Math.max(
        1,
        Math.round(
          numberValue(
            first(sourceRecord, ['pageCount', 'pages']),
            files.reduce((total, file) => total + file.pages, 0),
          ),
        ),
      ),
      packetHash: stringValue(
        first(sourceRecord, ['packetHash', 'hash', 'contentHash']),
        fallback.sourcePacket.packetHash,
      ),
    },
    extractedFacts,
    comparisons,
    policy: normalizedPolicy,
    trace,
    draft,
    approval: normalizedApproval,
    execution: normalizedExecution,
    provider: normalizedProvider,
    providerLabel: stringValue(
      first(root, ['providerLabel', 'aiModeLabel']),
      fallback.providerLabel,
    ),
    isPromptInjection:
      Boolean(
        first(
          root,
          ['isPromptInjection', 'promptInjection', 'blockedByPromptInjection'],
          fallback.isPromptInjection,
        ),
      ) || scenarioId === 'prompt-injection',
    correctionRequested: normalizedCorrection,
    regressionSaved: normalizedRegression,
    updatedAt: stringValue(
      first(root, ['updatedAt', 'lastUpdated', 'timestamp']),
      fallback.updatedAt,
    ),
    errorMessage:
      stringValue(first(root, ['errorMessage', 'error', 'message']), fallback.errorMessage ?? '') ||
      undefined,
  }
}

/**
 * Project the shared CaseWorkspace into display data without changing the
 * shared domain shape. The fallback above is intentionally kept for browser
 * previews and renderer tests; this adapter is the production contract path.
 */
const normalizeCaseWorkspace = (input: unknown, fallbackScenario: ScenarioId): WorkspaceView => {
  const root = asRecord(input)
  const hasTypedWorkspace =
    Boolean(root.caseMetadata) && Boolean(root.workflow) && Array.isArray(root.sourcePacket)
  const metadata = asRecord(root.caseMetadata)
  const workflow = asRecord(root.workflow)
  const sourceEntries = arrayValue(root.sourcePacket)
  const extracted = asRecord(root.extracted)
  const invoice = asRecord(extracted.invoice)
  const purchaseOrder = asRecord(extracted.purchaseOrder)
  const contract = asRecord(extracted.contract)
  const policyDecision = asRecord(root.policyDecision)
  const failure = asRecord(root.failure)
  const scenarioId = scenarioFrom(first(metadata, ['scenarioId']), fallbackScenario)
  const fallback = FALLBACK_WORKSPACES[scenarioId]
  const currencyValue = first(
    invoice,
    ['currency'],
    first(purchaseOrder, ['currency'], hasTypedWorkspace ? null : 'USD'),
  )
  const currency = stringValue(currencyValue, hasTypedWorkspace ? '—' : 'USD')
  const supplier = stringValue(
    first(metadata, ['supplierName'], first(invoice, ['supplierName'], fallback.supplier)),
    fallback.supplier,
  )
  const caseNumberValue = first(
    metadata,
    ['invoiceNumber'],
    first(invoice, ['invoiceNumber'], hasTypedWorkspace ? null : fallback.caseNumber),
  )
  const caseNumber = stringValue(caseNumberValue, hasTypedWorkspace ? '—' : fallback.caseNumber)
  const statusCandidate = stringValue(first(workflow, ['status']), 'ready')
  const providerFailureKind = stringValue(first(failure, ['kind'])).toLowerCase()
  const status = providerFailureKind.includes('invalid')
    ? 'invalid-output'
    : providerFailureKind.includes('rate')
      ? 'rate-limited'
      : providerFailureKind.includes('provider')
        ? 'offline'
        : statusFrom(statusCandidate, scenarioId)
  const phase = phaseFrom(first(workflow, ['phase']), status)

  const files: SourceFile[] = sourceEntries.length
    ? sourceEntries.map((rawSource, index) => {
        const source = asRecord(rawSource)
        const name = stringValue(first(source, ['name', 'fileName']), `source-${index + 1}.txt`)
        const evidence = arrayValue(source.evidence).map((item, evidenceIndex) =>
          evidenceFrom(item, evidenceIndex, name),
        )
        return {
          id: stringValue(first(source, ['sourceId', 'id']), `source-${index + 1}`),
          name,
          type: stringValue(first(source, ['kind', 'contentType']), 'Source document'),
          pages: Math.max(1, Math.round(numberValue(first(source, ['pageCount', 'pages']), 1))),
          received: stringValue(first(source, ['receivedAt', 'importedAt']), 'Source packet'),
          evidence,
        }
      })
    : hasTypedWorkspace
      ? []
      : fallback.sourcePacket.files
  const allEvidence = files.flatMap((file) => file.evidence)
  const evidenceById = new Map(allEvidence.map((evidence) => [evidence.id, evidence]))
  const resolveEvidence = (value: unknown, index: number): EvidenceRef | undefined => {
    const resolved = evidenceFromId(value, index, files[0]?.name ?? 'source.pdf', evidenceById)
    return resolved ?? allEvidence[index % Math.max(allEvidence.length, 1)]
  }

  const invoiceLines = arrayValue(invoice.lines)
  const poLines = arrayValue(purchaseOrder.lines)
  const invoiceById = new Map(
    invoiceLines.map((rawLine) => [
      stringValue(first(asRecord(rawLine), ['lineId', 'id'])),
      asRecord(rawLine),
    ]),
  )
  const poById = new Map(
    poLines.map((rawLine) => [
      stringValue(first(asRecord(rawLine), ['lineId', 'id'])),
      asRecord(rawLine),
    ]),
  )
  const rawComparisons = arrayValue(root.lineComparisons)
  const comparisons: LineComparisonView[] = rawComparisons.length
    ? rawComparisons.map((rawComparison, index) => {
        const comparison = asRecord(rawComparison)
        const invoiceLine = invoiceById.get(stringValue(first(comparison, ['invoiceLineId']))) ?? {}
        const poLine = poById.get(stringValue(first(comparison, ['purchaseOrderLineId']))) ?? {}
        const rawComparisonStatus = stringValue(first(comparison, ['status']), 'unmatched')
        const comparisonStatus: LineComparisonView['status'] =
          rawComparisonStatus === 'match'
            ? 'match'
            : rawComparisonStatus === 'unmatched'
              ? 'review'
              : 'review'
        const expectedUnitPrice = first(
          comparison,
          ['purchaseOrderUnitPriceMinor'],
          first(poLine, ['unitPriceMinor']),
        )
        const invoiceUnitPrice = first(
          comparison,
          ['invoiceUnitPriceMinor'],
          first(invoiceLine, ['unitPriceMinor']),
        )
        const priceDelta = first(
          comparison,
          ['unitPriceDeltaMinor'],
          numberValue(invoiceUnitPrice, 0) - numberValue(expectedUnitPrice, 0),
        )
        return {
          id: stringValue(
            first(comparison, ['comparisonId', 'id']),
            `line-${String(index + 1).padStart(3, '0')}`,
          ),
          description: stringValue(
            first(invoiceLine, ['description']),
            stringValue(first(poLine, ['description']), `Line ${index + 1}`),
          ),
          sku:
            stringValue(first(invoiceLine, ['sku']), stringValue(first(poLine, ['sku']), '—')) ||
            '—',
          quantity: stringValue(
            first(comparison, ['invoiceQuantity'], first(invoiceLine, ['quantity'])),
            '—',
          ),
          invoiceValue: formatMoney(
            first(comparison, ['invoiceUnitPriceMinor'], first(invoiceLine, ['unitPriceMinor'])),
            currency,
          ),
          expectedValue: formatMoney(
            first(comparison, ['purchaseOrderUnitPriceMinor'], first(poLine, ['unitPriceMinor'])),
            currency,
          ),
          variance: formatPercent(priceDelta, expectedUnitPrice),
          status: comparisonStatus,
          matchMethod: stringValue(first(comparison, ['matchMethod']), 'unmatched'),
          verification: stringValue(first(comparison, ['verification']), 'not_run'),
          confidence:
            first(comparison, ['confidence']) === ''
              ? undefined
              : `${stringValue(first(comparison, ['confidence']))}%`,
          evidence: resolveEvidence(first(comparison, ['evidenceIds']), index),
        }
      })
    : []

  const discrepancies = arrayValue(root.discrepancies).map(asRecord)
  const sourceQuarantined = sourceEntries.some((entry) => Boolean(asRecord(entry).quarantined))
  const isPromptInjection =
    scenarioId === 'prompt-injection' ||
    sourceQuarantined ||
    discrepancies.some((item) => stringValue(item.code) === 'source_quarantined')

  const facts: ExtractedFactView[] = []
  const pushFact = (
    id: string,
    label: string,
    value: unknown,
    confidence = '',
    evidence?: EvidenceRef,
  ) => {
    if (value === null || value === undefined || value === '') return
    facts.push({ id, label, value: stringValue(value), confidence, evidence })
  }
  pushFact(
    'supplier',
    'Supplier',
    supplier,
    '',
    resolveEvidence(first(invoice, ['evidenceIds']), 0),
  )
  pushFact(
    'invoice-number',
    'Invoice number',
    caseNumberValue,
    '',
    resolveEvidence(first(invoice, ['evidenceIds']), 0),
  )
  pushFact(
    'currency',
    'Currency',
    currencyValue,
    '',
    resolveEvidence(first(invoice, ['evidenceIds']), 0),
  )
  pushFact(
    'issue-date',
    'Issue date',
    first(invoice, ['issueDate']),
    '',
    resolveEvidence(first(invoice, ['evidenceIds']), 0),
  )
  pushFact(
    'purchase-order',
    'Purchase order',
    first(purchaseOrder, ['purchaseOrderNumber']),
    '',
    resolveEvidence(first(purchaseOrder, ['evidenceIds']), 1),
  )
  const toleranceBps = first(contract, ['priceToleranceBps'], null)
  pushFact(
    'contract-tolerance',
    'Price tolerance',
    toleranceBps === null ? null : `${numberValue(toleranceBps) / 100}%`,
    '',
    resolveEvidence(first(contract, ['evidenceIds']), 2),
  )

  const traceTitles: Record<string, string> = {
    source_loaded: 'Packet ingested',
    source_quarantined: 'Untrusted source quarantined',
    parsed: 'Fields extracted',
    reconciled: 'Reconciliation evaluated',
    discrepancy_detected: 'Discrepancy identified',
    draft_created: 'Correction draft created',
    draft_approved: 'Approval recorded',
    draft_submitted: 'Local/mock execution recorded',
    provider_failure: 'Provider check failed',
    provider_replayed: 'Failure replayed',
    model_output_rejected: 'Output validation failed',
    regression_saved: 'Regression saved',
  }
  const trace: TraceEventView[] = arrayValue(root.traceEvents).map((rawEvent, index) => {
    const event = asRecord(rawEvent)
    const type = stringValue(first(event, ['type']))
    const blocked = type === 'source_quarantined' || type === 'model_output_rejected'
    const attention = type === 'discrepancy_detected' || type === 'provider_failure'
    return {
      id: stringValue(first(event, ['eventId', 'id']), `trace-${index + 1}`),
      time: stringValue(first(event, ['at', 'time']), '—')
        .replace('T', ' ')
        .slice(0, 19),
      kind: safeKind(first(event, ['actor', 'kind'])),
      title: traceTitles[type] ?? type.replaceAll('_', ' '),
      summary: stringValue(first(event, ['message', 'summary']), 'Recorded event'),
      detail: stringValue(
        first(event, ['message', 'detail']),
        'Details are available in the trace drawer.',
      ),
      safeDetail:
        blocked || type === 'provider_failure'
          ? 'Raw untrusted/provider payloads are intentionally omitted.'
          : undefined,
      status: blocked ? 'blocked' : attention ? 'attention' : 'complete',
    }
  })
  const providerCallObserved = arrayValue(root.traceEvents).some((rawEvent) => {
    const event = asRecord(rawEvent)
    const type = stringValue(first(event, ['type']))
    return (
      stringValue(first(event, ['actor'])) === 'provider' ||
      type === 'provider_failure' ||
      type === 'provider_replayed' ||
      type === 'model_output_rejected'
    )
  })

  const policyOutcome = stringValue(first(policyDecision, ['outcome']), 'escalate')
  const normalizedPolicy: PolicyView = {
    approvalRequired: true,
    canCreateDraft: Boolean(first(policyDecision, ['canCreateDraft'], false)),
    canApprove: Boolean(first(policyDecision, ['canApprove'], false)),
    canSubmit: Boolean(first(policyDecision, ['canSubmit'], false)),
    reason: stringValue(first(policyDecision, ['rationale']), fallback.policy.reason),
    policyName: `Invoice variance policy · ${policyOutcome}`,
    lastChecked: stringValue(first(workflow, ['revision']), 'local'),
  }

  const rawDraft = root.correctionDraft
  const draftRecord = asRecord(rawDraft)
  const hasDraft =
    rawDraft !== null && rawDraft !== undefined && Object.keys(draftRecord).length > 0
  const draft = hasDraft
    ? {
        id: stringValue(first(draftRecord, ['draftId', 'id']), 'draft-local'),
        status: 'ready' as DraftView['status'],
        title: 'Corrected invoice draft',
        summary: stringValue(
          first(draftRecord, ['rationale', 'summary']),
          'Draft reflects deterministic purchase-order values.',
        ),
        changes: arrayValue(first(draftRecord, ['changes'])).map((rawChange) => {
          const change = asRecord(rawChange)
          return `${stringValue(first(change, ['invoiceLineId']), 'Line')} · ${formatMoney(first(change, ['fromUnitPriceMinor']), currency)} → ${formatMoney(first(change, ['toUnitPriceMinor']), currency)}`
        }),
        createdAt: 'Recorded locally',
      }
    : undefined
  const approvalRecord = asRecord(root.approval)
  const approval: ApprovalView = root.approval
    ? {
        status: 'approved',
        approvedBy: stringValue(first(approvalRecord, ['approvedBy']), 'local operator'),
        approvedAt: stringValue(first(approvalRecord, ['approvedAt']), 'Just now'),
      }
    : { status: 'not-requested' }
  const executionRecord = asRecord(root.execution)
  const execution: ExecutionView = root.execution
    ? {
        status: ['succeeded', 'submitted'].includes(stringValue(first(executionRecord, ['status'])))
          ? 'succeeded'
          : 'failed',
        adapter: 'local/mock',
        message: stringValue(
          first(executionRecord, ['message']),
          'No live supplier system was contacted.',
        ),
        requestId: stringValue(first(executionRecord, ['executionId']), '') || undefined,
      }
    : { status: 'not-run', adapter: 'local/mock' }
  const evaluationRecord = asRecord(root.evaluation)
  const evaluationMetrics = arrayValue(evaluationRecord.metrics).map(asRecord)
  const evaluation: EvaluationView | undefined =
    Object.keys(evaluationRecord).length > 0
      ? {
          evaluationId: stringValue(first(evaluationRecord, ['evaluationId']), 'evaluation'),
          sampleSize: numberValue(first(evaluationRecord, ['sampleSize']), 0),
          metrics: evaluationMetrics.map((metric, index) => ({
            metric: stringValue(first(metric, ['metric']), `metric-${index + 1}`),
            label: stringValue(first(metric, ['label']), 'Measured metric'),
            value: stringValue(first(metric, ['value']), '—'),
            unit: stringValue(first(metric, ['unit']), 'count'),
            sampleSize: numberValue(first(metric, ['sampleSize']), 0),
            observed: Boolean(first(metric, ['observed'], false)),
          })),
          latencyMs:
            first(evaluationRecord, ['latencyMs']) === null
              ? null
              : numberValue(first(evaluationRecord, ['latencyMs']), 0),
          retries: numberValue(first(evaluationRecord, ['retries']), 0),
          modelCalls: numberValue(first(evaluationRecord, ['modelCalls']), 0),
          generatedAt: stringValue(first(evaluationRecord, ['generatedAt']), '—'),
        }
      : undefined
  const providerLabel =
    status === 'offline'
      ? 'Offline fallback · provider unavailable'
      : status === 'rate-limited'
        ? 'Provider rate limited · replayable'
        : status === 'invalid-output'
          ? 'Provider output quarantined'
          : scenarioId === 'semantic-match'
            ? 'Offline semantic escalation'
            : scenarioId === 'clean-match' || scenarioId === 'price-mismatch'
              ? 'AI not needed · deterministic path'
              : 'Offline AI path'
  const happened = isPromptInjection
    ? 'An instruction-like source entry was quarantined as untrusted document data. It did not execute.'
    : stringValue(first(policyDecision, ['rationale']), fallback.happened)
  const why =
    discrepancies.length > 0
      ? discrepancies
          .map((item) => stringValue(first(item, ['message'])))
          .filter(Boolean)
          .join(' ')
      : hasTypedWorkspace
        ? 'No discrepancy is recorded yet; parsing is required before reconciliation.'
        : fallback.why
  const safeNextAction = isPromptInjection
    ? 'Keep the case blocked. Inspect the trace and obtain a clean supplier document before continuing.'
    : hasTypedWorkspace && invoiceLines.length === 0 && poLines.length === 0
      ? 'Parse the imported source packet before reconciliation or approval.'
      : status === 'offline' || status === 'rate-limited' || status === 'invalid-output'
        ? 'Review the retained local evidence or retry the provider check. Approval and submission remain unavailable.'
        : draft
          ? approval.status === 'approved'
            ? 'Submission is now enabled as a separate local/mock action.'
            : 'Review the corrected draft, then approve explicitly before the local mock adapter is run.'
          : normalizedPolicy.canCreateDraft
            ? 'Request a corrected invoice, then create a corrected draft for separate approval.'
            : 'Review the grounded evidence and decide the next safe action.'

  return {
    ...fallback,
    id: stringValue(first(metadata, ['caseId']), fallback.id),
    scenarioId,
    caseTitle:
      scenarioId === 'prompt-injection'
        ? 'Invoice exception review'
        : `${SCENARIO_META[scenarioId].label} · invoice review`,
    caseNumber,
    supplier,
    status,
    phase,
    headline: isPromptInjection
      ? 'Processing stopped: an embedded instruction was detected in the source packet.'
      : hasTypedWorkspace && invoiceLines.length === 0 && poLines.length === 0
        ? 'Source packet loaded; extraction and reconciliation are pending.'
        : fallback.headline,
    happened,
    why,
    safeNextAction,
    sourcePacket: {
      files,
      supplier,
      invoiceNumber: caseNumber,
      purchaseOrder: stringValue(
        first(purchaseOrder, ['purchaseOrderNumber'], hasTypedWorkspace ? null : undefined),
        hasTypedWorkspace ? '—' : fallback.sourcePacket.purchaseOrder,
      ),
      receivedAt: stringValue(first(metadata, ['openedAt']), fallback.sourcePacket.receivedAt),
      pageCount: files.reduce((total, file) => total + file.pages, 0),
      packetHash: stringValue(
        first(metadata, ['sourceFingerprint']),
        fallback.sourcePacket.packetHash,
      ),
    },
    extractedFacts: facts.length > 0 ? facts : hasTypedWorkspace ? [] : fallback.extractedFacts,
    comparisons:
      comparisons.length > 0 ? comparisons : hasTypedWorkspace ? [] : fallback.comparisons,
    policy: normalizedPolicy,
    trace: trace.length > 0 ? trace : hasTypedWorkspace ? [] : fallback.trace,
    draft,
    approval,
    execution,
    evaluation,
    providerMode: defaultProviderMode(),
    providerCallObserved,
    providerCalls: providerCallObserved ? 1 : 0,
    provider:
      status === 'offline' || status === 'rate-limited' || status === 'invalid-output'
        ? 'redacted-provider'
        : 'offline',
    providerLabel,
    isPromptInjection,
    correctionRequested: Boolean(draft),
    regressionSaved: false,
    updatedAt: stringValue(first(workflow, ['revision']), fallback.updatedAt),
    errorMessage: stringValue(first(failure, ['message']), '') || undefined,
    failureId: stringValue(first(failure, ['failureId']), '') || undefined,
    rawWorkspace: root.caseMetadata ? (input as CaseWorkspace) : undefined,
  }
}

const getDefaultApi = (): ApiContract | undefined => {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { supplierOps?: ApiContract }).supplierOps
}

const findFunction = (
  api: ApiContract | undefined,
  names: string[],
): ((...args: unknown[]) => unknown) | undefined => {
  if (!api) return undefined
  const record = api as unknown as Record<string, unknown>
  for (const name of names) {
    const candidate = record[name]
    if (typeof candidate === 'function')
      return candidate.bind(api) as (...args: unknown[]) => unknown
  }
  return undefined
}

const invoke = async (
  api: ApiContract | undefined,
  names: string[],
  payload?: unknown,
): Promise<unknown> => {
  const method = findFunction(api, names)
  if (!method) return undefined
  try {
    const result = await method(payload)
    const envelope = readIpcErrorEnvelope(result)
    if (envelope) throw new SupplierOpsIpcError(envelope)
    return result
  } catch (caughtError) {
    const envelope = readIpcErrorEnvelope(caughtError)
    if (envelope) throw new SupplierOpsIpcError(envelope)
    throw caughtError
  }
}

interface IpcErrorEnvelope {
  name: string
  message: string
  failureId?: string
}

class SupplierOpsIpcError extends Error {
  readonly failureId?: string

  constructor(envelope: IpcErrorEnvelope) {
    super(envelope.message)
    this.name = envelope.name
    this.failureId = envelope.failureId
  }
}

const readIpcErrorEnvelope = (value: unknown): IpcErrorEnvelope | undefined => {
  const root = asRecord(value)
  const error = asRecord(root.error)
  const name = stringValue(first(error, ['name']), '')
  const message = stringValue(first(error, ['message']), '')
  if (!name || !message) return undefined
  const failureId = stringValue(first(error, ['failureId']), '') || undefined
  return { name, message, failureId }
}

const redactedMessage = (value: unknown): string => {
  const message = value instanceof Error ? value.message : stringValue(value)
  if (!message) return 'The local operation could not be completed.'
  return message
    .replace(/(?:authorization|api[\s_-]*key|token|secret)\s*[:=]\s*[^\s,;]+/giu, '[redacted]')
    .replace(/\b[A-Za-z]{2,4}-[A-Za-z0-9_-]{16,}\b/gu, '[redacted]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240)
}

const errorDetails = (value: unknown): { message: string; failureId?: string } => {
  const envelope = value instanceof SupplierOpsIpcError ? undefined : readIpcErrorEnvelope(value)
  const message = redactedMessage(envelope?.message ?? value)
  const failureId = value instanceof SupplierOpsIpcError ? value.failureId : envelope?.failureId
  return { message, failureId }
}

const errorMessageWithFailureId = (details: { message: string; failureId?: string }): string =>
  details.failureId ? `${details.message} · Failure ID: ${details.failureId}` : details.message

const providerSelectionLabelFor = (scenarioId: ScenarioId, mode: ProviderMode): string => {
  if (scenarioId === 'prompt-injection') return 'Blocked · provider call not permitted'
  if (scenarioId === 'clean-match' || scenarioId === 'price-mismatch') {
    return 'AI not needed · deterministic path'
  }
  return mode === 'provider'
    ? 'DeepSeek provider selected · not run'
    : 'Offline mode selected · not run'
}

const providerErrorLabelFor = (scenarioId: ScenarioId, mode: ProviderMode): string =>
  mode === 'provider' && scenarioId !== 'prompt-injection'
    ? 'DeepSeek provider error · result unavailable'
    : providerSelectionLabelFor(scenarioId, mode)

const providerLabelFor = (
  scenarioId: ScenarioId,
  mode: ProviderMode,
  workspace: WorkspaceView,
  providerCallObserved: boolean,
): string => {
  if (scenarioId === 'prompt-injection') return 'Blocked · provider call not permitted'
  if (scenarioId === 'clean-match' || scenarioId === 'price-mismatch') {
    return 'AI not needed · deterministic path'
  }
  if (mode === 'offline') {
    return scenarioId === 'semantic-match'
      ? 'Offline semantic escalation'
      : 'Offline path · no provider call'
  }
  if (!providerCallObserved) return 'DeepSeek provider selected · no result observed'
  if (workspace.status === 'rate-limited') return 'DeepSeek provider rate limited · replayable'
  if (workspace.status === 'invalid-output') return 'DeepSeek output quarantined'
  if (workspace.status === 'offline')
    return 'DeepSeek provider unavailable · local evidence retained'
  return 'DeepSeek provider result · redacted'
}

const workspaceFromResult = (
  result: unknown,
  scenarioId: ScenarioId,
  requestedMode?: ProviderMode,
): WorkspaceView | undefined => {
  if (!result || typeof result !== 'object') return undefined
  const envelope = readIpcErrorEnvelope(result)
  if (envelope) throw new SupplierOpsIpcError(envelope)
  const record = asRecord(result)
  const candidate = first(record, ['workspace', 'caseWorkspace', 'data'], result)
  if (!candidate || typeof candidate !== 'object') return undefined
  const workspace = normalizeCaseWorkspace(candidate, scenarioId)
  const mode = providerModeFor(workspace.scenarioId, requestedMode ?? workspace.providerMode)
  const providerCalls = numberValue(first(record, ['providerCalls']), workspace.providerCalls)
  const providerCallObserved = workspace.providerCallObserved || providerCalls > 0
  return {
    ...workspace,
    providerMode: mode,
    providerCalls,
    providerCallObserved,
    providerLabel: providerLabelFor(workspace.scenarioId, mode, workspace, providerCallObserved),
  }
}

const callWorkspace = async (
  api: ApiContract | undefined,
  scenarioId: ScenarioId,
  requestedMode: ProviderMode,
): Promise<WorkspaceView | undefined> => {
  if (!api) return undefined
  const mode = providerModeFor(scenarioId, requestedMode)
  try {
    // Reconcile through the same contract used by the desktop app. The mode is
    // explicit so the UI never claims a provider call that the operator did
    // not select (or that the prompt-injection guard should prohibit).
    const runResult = await invoke(api, ['runScenario'], {
      scenarioId,
      mode,
    })
    const runWorkspace = workspaceFromResult(runResult, scenarioId, mode)
    if (runWorkspace) {
      return runWorkspace
    }
  } catch (caughtError) {
    if (caughtError instanceof SupplierOpsIpcError) throw caughtError
    // Loading a source snapshot remains a safe fallback when an adapter does
    // not implement scenario execution (for example, a focused test double).
  }
  const loaded = await invoke(api, ['loadScenario'], { scenarioId })
  return workspaceFromResult(loaded, scenarioId, mode)
}

const withLocalDraft = (workspace: WorkspaceView, result?: unknown): WorkspaceView => {
  const resultRecord = asRecord(result)
  const resultDraft = asRecord(first(resultRecord, ['draft', 'correctionDraft'], {}))
  const draftId = stringValue(first(resultDraft, ['draftId', 'id']), `${workspace.id}-draft-001`)
  return {
    ...workspace,
    phase: 'draft',
    status: workspace.status === 'blocked' ? 'blocked' : 'warning',
    correctionRequested: true,
    draft: {
      id: draftId,
      status: 'ready',
      title: 'Corrected invoice draft',
      summary: 'A review-ready draft records the grounded correction without sending it.',
      changes: workspace.isPromptInjection
        ? ['Embedded instruction remains quarantined', 'No approval or submission permission added']
        : workspace.scenarioId === 'price-mismatch'
          ? ['Gasket kit unit price aligned to PO-8831', 'Variance note retained for reviewer']
          : ['Source-grounded line comparison attached', 'Policy note retained for reviewer'],
      createdAt: 'Just now',
    },
    policy: workspace.isPromptInjection
      ? workspace.policy
      : {
          ...workspace.policy,
          canApprove: true,
          canSubmit: false,
          reason: 'Explicit approval is required before the local mock adapter can run.',
        },
    safeNextAction: workspace.isPromptInjection
      ? workspace.safeNextAction
      : 'Review the corrected draft, then approve explicitly before the local mock adapter is run.',
    trace: [
      ...workspace.trace,
      {
        id: `${workspace.id}-draft-trace`,
        time: 'Just now',
        kind: 'system',
        title: 'Correction draft created',
        summary: 'No external side effect',
        detail:
          'The draft is local and reviewable. It has not been submitted to any supplier or purchasing system.',
        status: 'complete',
      },
    ],
  }
}

const withApproval = (workspace: WorkspaceView): WorkspaceView => ({
  ...workspace,
  phase: 'approve',
  status: 'approved',
  approval: { status: 'approved', approvedBy: 'You · local operator', approvedAt: 'Just now' },
  policy: {
    ...workspace.policy,
    canApprove: true,
    canSubmit: true,
    reason: 'Approved explicitly by the local operator.',
  },
  safeNextAction:
    'Submission is now enabled. Run the local/mock adapter only if the reviewed values are still correct.',
  trace: [
    ...workspace.trace,
    {
      id: `${workspace.id}-approval-trace`,
      time: 'Just now',
      kind: 'human',
      title: 'Approval recorded',
      summary: 'Separate approval completed',
      detail: 'Approval was recorded locally after the review-ready draft was inspected.',
      status: 'complete',
    },
  ],
})

const withExecution = (workspace: WorkspaceView): WorkspaceView => ({
  ...workspace,
  phase: 'approve',
  status: 'executed',
  execution: {
    status: 'succeeded',
    adapter: 'local/mock',
    message: 'Mock execution succeeded; no live supplier system was contacted.',
    requestId: 'mock-run-24018',
  },
  safeNextAction: 'Execution is complete. Keep the trace and evidence with the case record.',
  trace: [
    ...workspace.trace,
    {
      id: `${workspace.id}-execution-trace`,
      time: 'Just now',
      kind: 'adapter',
      title: 'Local/mock execution succeeded',
      summary: 'No live supplier system contacted',
      detail:
        'The approved draft was passed to the local mock adapter. This is a sandbox result, not a Coupa or ERP submission.',
      status: 'complete',
    },
  ],
})

const operationAt = (): string => new Date().toISOString()
const operationId = (prefix: string, workspace: WorkspaceView): string =>
  `${prefix}:${workspace.id}:${workspace.updatedAt}`.slice(0, 160)

export const useSupplierOps = (options: UseSupplierOpsOptions = {}): SupplierOpsState => {
  const api = options.api ?? getDefaultApi()
  const initialScenarioId = options.initialScenarioId ?? 'price-mismatch'
  const [scenarioId, setScenarioIdState] = useState<ScenarioId>(initialScenarioId)
  const [providerMode, setProviderModeState] = useState<ProviderMode>(defaultProviderMode())
  const [workspace, setWorkspace] = useState<WorkspaceView>(
    () => FALLBACK_WORKSPACES[initialScenarioId],
  )
  // Keep mutating actions unavailable during the first contract hydration. The
  // fallback workspace is useful for a paint-stable shell, but should never be
  // mistaken for the loaded API case by an early click.
  const [isLoading, setIsLoading] = useState(Boolean(api))
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const requestSequence = useRef(0)

  const hydrate = useCallback(
    async (nextScenarioId: ScenarioId, requestedMode: ProviderMode = defaultProviderMode()) => {
      const requestId = ++requestSequence.current
      const mode = providerModeFor(nextScenarioId, requestedMode)
      if (!api) {
        // Browser previews and unit tests intentionally run without preload.
        // Keep that local fallback synchronous so there is no phantom loading
        // transition after the first paint.
        setError(undefined)
        setWorkspace({
          ...FALLBACK_WORKSPACES[nextScenarioId],
          providerMode: mode,
          providerCallObserved: false,
          providerCalls: 0,
          providerLabel: providerSelectionLabelFor(nextScenarioId, mode),
        })
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(undefined)
      try {
        const remoteWorkspace = await callWorkspace(api, nextScenarioId, mode)
        if (requestId !== requestSequence.current) return
        if (remoteWorkspace) {
          setWorkspace(remoteWorkspace)
        } else {
          setWorkspace({
            ...FALLBACK_WORKSPACES[nextScenarioId],
            providerMode: mode,
            providerCallObserved: false,
            providerCalls: 0,
            providerLabel: providerSelectionLabelFor(nextScenarioId, mode),
          })
        }
      } catch (caughtError) {
        if (requestId !== requestSequence.current) return
        const details = errorDetails(caughtError)
        const message = errorMessageWithFailureId(details)
        setError(message)
        setWorkspace({
          ...FALLBACK_WORKSPACES[nextScenarioId],
          status: 'error',
          errorMessage: message,
          failureId: details.failureId,
          providerMode: mode,
          providerCallObserved: false,
          providerCalls: 0,
          providerLabel: providerErrorLabelFor(nextScenarioId, mode),
        })
      } finally {
        if (requestId === requestSequence.current) setIsLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void hydrate(scenarioId)
  }, [hydrate, scenarioId])

  const setScenario = useCallback((nextScenarioId: ScenarioId) => {
    const nextMode = defaultProviderMode()
    setScenarioIdState(nextScenarioId)
    setProviderModeState(nextMode)
    setWorkspace({ ...FALLBACK_WORKSPACES[nextScenarioId], providerMode: nextMode })
  }, [])

  const setProviderMode = useCallback(
    (nextMode: ProviderMode) => {
      const effectiveMode = providerModeFor(scenarioId, nextMode)
      setProviderModeState(effectiveMode)
      setWorkspace((current) => ({
        ...current,
        providerMode: effectiveMode,
        providerCallObserved: false,
        providerCalls: 0,
        providerLabel: providerSelectionLabelFor(scenarioId, effectiveMode),
      }))
    },
    [scenarioId],
  )

  const runScenario = useCallback(
    () => hydrate(scenarioId, providerMode),
    [hydrate, providerMode, scenarioId],
  )

  const mutate = useCallback(
    async (
      names: string[],
      localUpdate: (current: WorkspaceView, result?: unknown) => WorkspaceView,
      payload: Record<string, unknown> = {},
      requestedMode: ProviderMode = providerMode,
      preserveProviderEvidence = true,
    ) => {
      setIsMutating(true)
      setError(undefined)
      try {
        // Every operation schema is strict. Callers provide the exact payload
        // for the selected contract method; adding cross-operation fields here
        // would make valid draft/approval/submission requests fail validation.
        const result = await invoke(api, names, payload)
        const remoteWorkspace = workspaceFromResult(result, scenarioId, requestedMode)
        if (remoteWorkspace) {
          setWorkspace((current) => {
            const providerCallObserved = preserveProviderEvidence
              ? remoteWorkspace.providerCallObserved || current.providerCallObserved
              : remoteWorkspace.providerCallObserved
            const providerCalls = preserveProviderEvidence
              ? Math.max(remoteWorkspace.providerCalls, current.providerCalls)
              : remoteWorkspace.providerCalls
            const mode = providerModeFor(scenarioId, requestedMode)
            return {
              ...remoteWorkspace,
              providerMode: mode,
              providerCalls,
              providerCallObserved,
              providerLabel: providerLabelFor(
                remoteWorkspace.scenarioId,
                mode,
                remoteWorkspace,
                providerCallObserved,
              ),
            }
          })
        } else setWorkspace((current) => localUpdate(current, result))
      } catch (caughtError) {
        const details = errorDetails(caughtError)
        const message = errorMessageWithFailureId(details)
        setError(message)
        setWorkspace((current) => ({
          ...current,
          status: 'error',
          errorMessage: message,
          failureId: details.failureId,
        }))
      } finally {
        setIsMutating(false)
      }
    },
    [api, providerMode, scenarioId, workspace.id],
  )

  const importSourcePacket = useCallback(async () => {
    if (!api) return
    const caseMetadata = workspace.rawWorkspace?.caseMetadata
    if (!caseMetadata) {
      setError('Import is waiting for a desktop case metadata snapshot.')
      return
    }
    await mutate(
      ['importSourcePacket'],
      (current) => ({
        ...current,
        status: 'empty',
        phase: 'ingest',
        extractedFacts: [],
        comparisons: [],
        trace: [],
        draft: undefined,
        approval: { status: 'not-requested' },
        execution: { status: 'not-run', adapter: 'local/mock' },
      }),
      { caseMetadata, at: operationAt() },
      'offline',
      false,
    )
  }, [api, mutate, workspace.rawWorkspace])

  const requestCorrection = useCallback(
    () =>
      mutate([], (current) => ({
        ...current,
        correctionRequested: true,
        status: current.status === 'blocked' ? 'blocked' : 'warning',
      })),
    [mutate],
  )

  const createCorrectedDraft = useCallback(
    () =>
      mutate(['createCorrectionDraft'], withLocalDraft, {
        caseId: workspace.id,
        idempotencyKey: operationId('draft', workspace),
        at: operationAt(),
      }),
    [mutate, workspace],
  )

  const approve = useCallback(
    () =>
      mutate(['approveDraft'], withApproval, {
        caseId: workspace.id,
        draftId: workspace.draft?.id ?? 'draft-missing',
        approvedBy: 'local operator',
        note: null,
        at: operationAt(),
        idempotencyKey: operationId('approval', workspace),
      }),
    [mutate, workspace],
  )

  const submit = useCallback(
    () =>
      mutate(['submitDraft'], withExecution, {
        caseId: workspace.id,
        draftId: workspace.draft?.id ?? 'draft-missing',
        idempotencyKey: operationId('submit', workspace),
        at: operationAt(),
      }),
    [mutate, workspace],
  )

  const retry = useCallback(() => hydrate(scenarioId, 'offline'), [hydrate, scenarioId])

  const replay = useCallback(() => {
    if (!workspace.failureId) return hydrate(scenarioId, 'offline')
    return mutate(
      ['replayFailure'],
      (current) => ({ ...current, updatedAt: 'Just now' }),
      {
        caseId: workspace.id,
        failureId: workspace.failureId,
        mode: 'offline',
        providerResult: null,
        modelOutput: null,
        idempotencyKey: operationId('replay', workspace),
        at: operationAt(),
      },
      'offline',
    )
  }, [hydrate, mutate, scenarioId, workspace])

  const saveRegression = useCallback(
    () =>
      mutate(['saveRegression'], (current) => ({ ...current, regressionSaved: true }), {
        scenarioId,
        workspace: workspace.rawWorkspace ?? (workspace as unknown as CaseWorkspace),
        note: 'Saved from SupplierOps Lab local scenario review.',
        idempotencyKey: operationId('regression', workspace),
      }),
    [mutate, scenarioId, workspace],
  )

  return useMemo(
    () => ({
      apiAvailable: Boolean(api),
      scenarioId,
      providerMode,
      workspace,
      isLoading,
      isMutating,
      error,
      setScenario,
      setProviderMode,
      runScenario,
      importSourcePacket,
      requestCorrection,
      createCorrectedDraft,
      approve,
      submit,
      retry,
      replay,
      saveRegression,
    }),
    [
      api,
      scenarioId,
      providerMode,
      workspace,
      isLoading,
      isMutating,
      error,
      setScenario,
      setProviderMode,
      runScenario,
      importSourcePacket,
      requestCorrection,
      createCorrectedDraft,
      approve,
      submit,
      retry,
      replay,
      saveRegression,
    ],
  )
}

export { FALLBACK_WORKSPACES, normalizeWorkspace }
export { SCENARIO_IDS } from '../../shared/domain'
export type { ProviderMode, ScenarioId }
