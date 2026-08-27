import {
  BootstrapInputSchema,
  BootstrapOutputSchema,
  CaseWorkspaceSchema,
  CreateCorrectionDraftInputSchema,
  CreateCorrectionDraftOutputSchema,
  ImportSourcePacketInputSchema,
  ImportSourcePacketOutputSchema,
  LoadScenarioInputSchema,
  ReplayFailureInputSchema,
  ReplayFailureOutputSchema,
  RunScenarioInputSchema,
  RunScenarioOutputSchema,
  SaveRegressionInputSchema,
  SaveRegressionOutputSchema,
  SubmitDraftInputSchema,
  SubmitDraftOutputSchema,
  ApproveDraftInputSchema,
  ApproveDraftOutputSchema,
  type BootstrapOutput,
  type CaseWorkspace,
  type ImportSourcePacketInput,
  type ReconciliationInput,
  type ScenarioId,
  type TraceEvent,
} from '../shared/schemas'
import {
  fixtureIdempotencyKey,
  fixtureInputForMode,
  listScenarioIds,
  loadScenarioFixture,
} from '../shared/fixtures'
import { runReconciliation } from '../shared/engine'
import { evaluateScenarioRun } from '../shared/evaluation'
import { approveDraft, createCorrectionDraft, submitDraft } from '../shared/state'
import { stableId } from '../shared/stable'
import {
  MAX_SOURCE_PACKET_BYTES,
  MAX_SOURCE_PACKET_FILES,
  MAX_SOURCE_PACKET_PREVIEW_CHARS,
  MAX_SOURCE_PACKET_TOTAL_BYTES,
  PERSISTENCE_SCHEMA_VERSION,
} from './constants'
import type { ProviderBoundary, ProviderTraceMetadata, SubmissionResult } from './provider'
import type { WorkspaceStore } from './persistence'
import { sanitizeProjection } from './redaction'

const MAX_SOURCE_ENTRIES = 50
const MAX_LINE_COUNT = 500

export interface SelectedSourceFile {
  fileName: string
  byteSize: number
  extension: string
  preview?: string
}

export type SelectedSourcePacket = readonly SelectedSourceFile[]

const SUPPORTED_SOURCE_EXTENSIONS = new Set(['json', 'csv', 'tsv', 'txt', 'xml', 'md', 'pdf'])

function safeSourceFileName(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1)
  return lastSegment.trim().slice(0, 160)
}

/** Classify only from bounded, non-authoritative file metadata. */
export function classifySourceKind(
  fileName: string,
  extension: string,
): 'invoice' | 'purchase_order' | 'contract' | 'catalog' | 'other' {
  const name = fileName.toLocaleLowerCase('en-US')
  if (/(?:^|[^a-z])(invoice|factura)(?:[^a-z]|$)/u.test(name)) return 'invoice'
  if (
    /(?:^|[^a-z])(po|p[._ -]?o[._ -]?|purchase[._ -]?order|orden[._ -]?de?[._ -]?compra)(?:[^a-z]|$)/u.test(
      name,
    )
  )
    return 'purchase_order'
  if (/(?:^|[^a-z])(contract|agreement|acuerdo|terms?)(?:[^a-z]|$)/u.test(name)) return 'contract'
  if (
    /(?:^|[^a-z])(catalog|catalogue|price[._ -]?list|lista[._ -]?precios?|sku)(?:[^a-z]|$)/u.test(
      name,
    )
  )
    return 'catalog'

  // An extension alone is never authoritative. Keep common structured files
  // explicitly unclassified until a parser can establish their document kind.
  if (extension === 'pdf' || extension === 'xml' || extension === 'json') return 'other'
  return 'other'
}

function contentTypeForExtension(
  extension: string,
): 'text' | 'structured' | 'pdf' | 'json' | 'csv' {
  if (extension === 'pdf') return 'pdf'
  if (extension === 'json') return 'json'
  if (extension === 'csv' || extension === 'tsv') return 'csv'
  if (extension === 'xml') return 'structured'
  return 'text'
}

function workspaceId(workspace: CaseWorkspace): string {
  return workspace.caseMetadata.caseId
}

function caseIdForScenario(scenarioId: string): string {
  return `case:${scenarioId}`
}

function parseStoredWorkspace(value: unknown): CaseWorkspace | undefined {
  const parsed = CaseWorkspaceSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function providerInputForScenario(
  scenarioId: ScenarioId,
  mode: ReconciliationInput['mode'],
  providerResult: ReconciliationInput['providerResult'],
  modelOutput: ReconciliationInput['modelOutput'],
): ReconciliationInput {
  const fixtureInput = fixtureInputForMode(scenarioId, mode)
  const liveSemanticInput =
    mode === 'provider' &&
    scenarioId === 'semantic-match' &&
    providerResult === null &&
    modelOutput === null
  return {
    ...fixtureInput,
    providerResult: liveSemanticInput ? null : (providerResult ?? fixtureInput.providerResult),
    modelOutput: liveSemanticInput ? null : (modelOutput ?? fixtureInput.modelOutput),
  }
}

function providerTraceMetadata(trace: ProviderTraceMetadata): Record<string, string> {
  return {
    provider: trace.provider,
    model: trace.model,
    operation: trace.operation,
    attemptCount: String(trace.attemptCount),
    responseStatusClass: trace.responseStatusClass,
    latencyMs: String(trace.latencyMs),
    ...(trace.inputTokenCount === undefined
      ? {}
      : { inputTokenCount: String(trace.inputTokenCount) }),
    ...(trace.outputTokenCount === undefined
      ? {}
      : { outputTokenCount: String(trace.outputTokenCount) }),
    costEstimateUsd: trace.costEstimateUsd,
  }
}

function attachProviderTrace(
  workspace: CaseWorkspace,
  trace: ProviderTraceMetadata,
): CaseWorkspace {
  const lastIndex = workspace.traceEvents.length - 1
  if (lastIndex < 0) return workspace
  const traceEvents: TraceEvent[] = workspace.traceEvents.map((event, index) =>
    index === lastIndex
      ? {
          ...event,
          metadata: { ...(event.metadata ?? {}), ...providerTraceMetadata(trace) },
        }
      : event,
  )
  return CaseWorkspaceSchema.parse({ ...workspace, traceEvents })
}

/** Main-owned application workflow facade around the shared domain functions. */
export class WorkspaceService {
  public constructor(
    private readonly store: WorkspaceStore,
    private readonly provider: ProviderBoundary,
  ) {}

  public bootstrap(input: unknown): BootstrapOutput {
    BootstrapInputSchema.parse(input ?? {})
    return BootstrapOutputSchema.parse({
      schemaVersion: String(PERSISTENCE_SCHEMA_VERSION),
      scenarioIds: [...listScenarioIds()],
      capabilities: [
        'offline-reconciliation',
        'provider-boundary-status',
        'local-workspace-persistence',
        'mock-submission-idempotency',
        'main-owned-source-import',
      ],
      maxSourceEntries: MAX_SOURCE_ENTRIES,
      maxLineCount: MAX_LINE_COUNT,
    })
  }

  public async loadScenario(input: unknown): Promise<CaseWorkspace> {
    const parsedInput = LoadScenarioInputSchema.parse(input)
    const existing = this.store.read('workspace', caseIdForScenario(parsedInput.scenarioId))
    const storedWorkspace = existing ? parseStoredWorkspace(existing.projection) : undefined
    if (storedWorkspace) return storedWorkspace

    const reconciliationInput = fixtureInputForMode(parsedInput.scenarioId, 'offline')
    const workspace = runReconciliation(reconciliationInput).workspace
    await this.persistWorkspace(workspace)
    return workspace
  }

  public async runScenario(input: unknown): Promise<unknown> {
    const parsedInput = RunScenarioInputSchema.parse(input)
    let reconciliationInput = providerInputForScenario(
      parsedInput.scenarioId,
      parsedInput.mode,
      parsedInput.providerResult,
      parsedInput.modelOutput,
    )
    let providerTrace: ProviderTraceMetadata | undefined
    const shouldInterpretSemanticMatch =
      parsedInput.mode === 'provider' &&
      parsedInput.scenarioId === 'semantic-match' &&
      parsedInput.providerResult === null &&
      parsedInput.modelOutput === null
    if (shouldInterpretSemanticMatch) {
      const interpretation = await this.provider.runSemanticInterpretation(
        this.provider.semanticInput(reconciliationInput.invoice, reconciliationInput.purchaseOrder),
      )
      reconciliationInput = {
        ...reconciliationInput,
        modelOutput: null,
        providerResult: interpretation.result,
      }
      providerTrace = interpretation.traceMetadata
    }
    const result = runReconciliation(reconciliationInput)
    const evaluated = evaluateScenarioRun(
      loadScenarioFixture(parsedInput.scenarioId),
      reconciliationInput,
      result,
    )
    const workspace = providerTrace
      ? attachProviderTrace(evaluated.workspace, providerTrace)
      : evaluated.workspace
    await this.persistWorkspace(workspace)
    const idempotencyKey =
      parsedInput.idempotencyKey ??
      fixtureIdempotencyKey(parsedInput.scenarioId, `run:${parsedInput.mode}`)
    return RunScenarioOutputSchema.parse({
      workspace,
      failure: result.failure,
      replayable: result.failure?.retryable ?? false,
      idempotencyKey,
      providerCalls: result.providerCalls,
    })
  }

  public async createCorrectionDraft(input: unknown): Promise<unknown> {
    const parsedInput = CreateCorrectionDraftInputSchema.parse(input)
    const workspace = await this.requireWorkspace(parsedInput.caseId)
    const result = createCorrectionDraft(workspace, parsedInput)
    await this.persistWorkspace(result.workspace)
    return CreateCorrectionDraftOutputSchema.parse(result)
  }

  public async approveDraft(input: unknown): Promise<unknown> {
    const parsedInput = ApproveDraftInputSchema.parse(input)
    const workspace = await this.requireWorkspace(parsedInput.caseId)
    const result = approveDraft(workspace, parsedInput)
    await this.persistWorkspace(result.workspace)
    return ApproveDraftOutputSchema.parse(result)
  }

  public async submitDraft(input: unknown): Promise<unknown> {
    const parsedInput = SubmitDraftInputSchema.parse(input)
    const workspace = await this.requireWorkspace(parsedInput.caseId)
    const transitioned = submitDraft(workspace, parsedInput)
    const adapterResult: SubmissionResult = await this.provider.submitMock({
      idempotencyKey: parsedInput.idempotencyKey,
      draftId: parsedInput.draftId,
    })
    const execution = {
      ...transitioned.execution,
      providerReference: adapterResult.submissionId ?? null,
      message:
        adapterResult.status === 'already-submitted'
          ? 'The local mock adapter returned the existing idempotent submission.'
          : transitioned.execution.message,
    }
    const nextWorkspace = CaseWorkspaceSchema.parse({
      ...transitioned.workspace,
      execution,
    })
    await this.persistWorkspace(nextWorkspace)
    return SubmitDraftOutputSchema.parse({ workspace: nextWorkspace, execution })
  }

  public async replayFailure(input: unknown): Promise<unknown> {
    const parsedInput = ReplayFailureInputSchema.parse(input)
    const prior = await this.requireWorkspace(parsedInput.caseId)
    const failureMatches = prior.failure?.failureId === parsedInput.failureId
    const reconciliationInput = providerInputForScenario(
      prior.caseMetadata.scenarioId,
      parsedInput.mode,
      parsedInput.providerResult,
      parsedInput.modelOutput,
    )
    const result = runReconciliation(reconciliationInput)
    await this.persistWorkspace(result.workspace)
    return ReplayFailureOutputSchema.parse({
      workspace: result.workspace,
      failure: result.failure,
      replayed: failureMatches,
    })
  }

  public async saveRegression(input: unknown): Promise<unknown> {
    const parsedInput = SaveRegressionInputSchema.parse(input)
    const regressionId = stableId('regression', parsedInput.scenarioId, parsedInput.idempotencyKey)
    const existing = this.store.read('regression', regressionId)
    if (existing) {
      return SaveRegressionOutputSchema.parse({
        regressionId,
        outcome: 'already_exists',
        scenarioId: parsedInput.scenarioId,
      })
    }

    await this.store.write('regression', regressionId, {
      regressionId,
      scenarioId: parsedInput.scenarioId,
      note: parsedInput.note,
      workspace: parsedInput.workspace,
    })
    return SaveRegressionOutputSchema.parse({
      regressionId,
      outcome: 'saved',
      scenarioId: parsedInput.scenarioId,
    })
  }

  public async importSourcePacket(
    input: unknown,
    selected: SelectedSourcePacket,
  ): Promise<unknown> {
    const parsedInput: ImportSourcePacketInput = ImportSourcePacketInputSchema.parse(input)
    if (
      !Array.isArray(selected) ||
      selected.length < 1 ||
      selected.length > MAX_SOURCE_PACKET_FILES
    )
      throw new Error(`Source packet must contain 1-${MAX_SOURCE_PACKET_FILES} files`)

    let totalBytes = 0
    const sourcePacket = selected.map((file, index) => {
      const fileName = safeSourceFileName(file.fileName)
      const extension = file.extension.trim().toLowerCase().replace(/^\./u, '')
      const byteSize = Number.isSafeInteger(file.byteSize) ? file.byteSize : -1
      if (!fileName || !SUPPORTED_SOURCE_EXTENSIONS.has(extension))
        throw new Error('Source packet contains an unsupported file')
      if (byteSize < 0 || byteSize > MAX_SOURCE_PACKET_BYTES)
        throw new Error('A source packet file exceeds the configured size limit')
      totalBytes += byteSize
      if (totalBytes > MAX_SOURCE_PACKET_TOTAL_BYTES)
        throw new Error('Source packet exceeds the aggregate size limit')

      const preview =
        typeof file.preview === 'string'
          ? file.preview.slice(0, MAX_SOURCE_PACKET_PREVIEW_CHARS)
          : undefined
      const content = (
        preview ?? '[Binary source packet retained by the main process as bounded metadata.]'
      ).slice(0, 200_000)
      const sourceId = stableId(
        'source',
        parsedInput.caseMetadata.caseId,
        index,
        fileName,
        byteSize,
        extension,
      )
      const evidenceId = stableId('evidence', sourceId, 'bounded-preview')
      return {
        sourceId,
        kind: classifySourceKind(fileName, extension),
        name: fileName,
        pageCount: 1,
        contentType: contentTypeForExtension(extension),
        content,
        trustBoundary: 'untrusted' as const,
        quarantined: false,
        quarantineReason: null,
        evidence: [
          {
            evidenceId,
            sourceId,
            page: 1,
            locator: 'main-owned bounded preview (non-authoritative)',
            excerpt: content.slice(0, 1_000),
          },
        ],
      }
    })
    const reconciliationInput: ReconciliationInput = {
      caseMetadata: parsedInput.caseMetadata,
      sourcePacket,
      invoice: null,
      purchaseOrder: null,
      contract: null,
      catalog: null,
      mode: 'offline',
      modelOutput: null,
      providerResult: null,
      knownInvoiceIds: [],
      knownFingerprints: [],
      at: parsedInput.at,
    }
    const workspace = runReconciliation(reconciliationInput).workspace
    await this.persistWorkspace(workspace)
    return ImportSourcePacketOutputSchema.parse({ workspace })
  }

  public providerStatus(mode: ReconciliationInput['mode'] = 'offline') {
    return this.provider.status(mode)
  }

  /** Give the main IPC boundary a provider-aware redacted error projection. */
  public failureProjection(error: unknown): { name: string; message: string; failureId: string } {
    return this.provider.failureProjection(error)
  }

  private async requireWorkspace(caseId: string): Promise<CaseWorkspace> {
    const stored = this.store.read('workspace', caseId)
    const parsed = stored ? parseStoredWorkspace(stored.projection) : undefined
    if (!parsed) throw new Error('Workspace is not loaded')
    return parsed
  }

  private persistWorkspace(workspace: CaseWorkspace): Promise<unknown> {
    return this.store.write('workspace', workspaceId(workspace), sanitizeProjection(workspace))
  }
}
