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
} from '../shared/schemas'
import { fixtureIdempotencyKey, fixtureInputForMode, listScenarioIds } from '../shared/fixtures'
import { runReconciliation } from '../shared/engine'
import { approveDraft, createCorrectionDraft, submitDraft } from '../shared/state'
import { stableId } from '../shared/stable'
import { MAX_SOURCE_PACKET_BYTES, PERSISTENCE_SCHEMA_VERSION } from './constants'
import type { ProviderBoundary, SubmissionResult } from './provider'
import type { WorkspaceStore } from './persistence'
import { sanitizeProjection } from './redaction'

const MAX_SOURCE_ENTRIES = 50
const MAX_LINE_COUNT = 500

export interface SelectedSourcePacket {
  fileName: string
  byteSize: number
  extension: string
  preview?: string
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
  return {
    ...fixtureInput,
    providerResult: providerResult ?? fixtureInput.providerResult,
    modelOutput: modelOutput ?? fixtureInput.modelOutput,
  }
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
    const reconciliationInput = providerInputForScenario(
      parsedInput.scenarioId,
      parsedInput.mode,
      parsedInput.providerResult,
      parsedInput.modelOutput,
    )
    const result = runReconciliation(reconciliationInput)
    await this.persistWorkspace(result.workspace)
    const idempotencyKey =
      parsedInput.idempotencyKey ??
      fixtureIdempotencyKey(parsedInput.scenarioId, `run:${parsedInput.mode}`)
    return RunScenarioOutputSchema.parse({
      workspace: result.workspace,
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
    if (selected.byteSize > MAX_SOURCE_PACKET_BYTES) {
      throw new Error('Source packet exceeds the configured size limit')
    }

    const sourceId = stableId('source', selected.fileName, selected.byteSize, selected.extension)
    const sourceEntry = {
      sourceId,
      kind: 'other' as const,
      name: selected.fileName.slice(0, 160),
      pageCount: 1,
      contentType: selected.preview === undefined ? ('structured' as const) : ('text' as const),
      content: (selected.preview ?? '[Binary source packet retained by the main process.]').slice(
        0,
        200_000,
      ),
      trustBoundary: 'untrusted' as const,
      quarantined: false,
      quarantineReason: null,
      evidence: [],
    }
    const reconciliationInput: ReconciliationInput = {
      caseMetadata: parsedInput.caseMetadata,
      sourcePacket: [sourceEntry],
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
