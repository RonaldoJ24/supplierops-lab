import type { ApiContract } from './api'
import { parseApiInput } from './api'
import {
  type BootstrapOutput,
  BootstrapOutputSchema,
  type CaseWorkspace,
  CaseWorkspaceSchema,
  type CreateCorrectionDraftOutput,
  CreateCorrectionDraftOutputSchema,
  type ImportSourcePacketOutput,
  ImportSourcePacketOutputSchema,
  type ReplayFailureOutput,
  ReplayFailureOutputSchema,
  type RunScenarioOutput,
  RunScenarioOutputSchema,
  type SaveRegressionOutput,
  SaveRegressionOutputSchema,
  type SubmitDraftOutput,
  SubmitDraftOutputSchema,
  type ApproveDraftOutput,
  ApproveDraftOutputSchema,
  type ReconciliationInput,
  ReconciliationInputSchema,
  type TraceEvent,
} from './schemas'
import {
  fixtureInputForMode,
  fixtureIdempotencyKey,
  listScenarioIds,
  loadScenarioFixture,
} from './fixtures'
import { reconcile, runReconciliation } from './engine'
import { approveDraft, createCorrectionDraft, submitDraft } from './state'
import { stableId } from './stable'

function loadedWorkspace(input: ReconciliationInput): CaseWorkspace {
  const reconciled = reconcile(input)
  return CaseWorkspaceSchema.parse({
    ...reconciled,
    workflow: { phase: 'source_loaded', status: 'ready', revision: 0 },
    lineComparisons: [],
    discrepancies: [],
    policyDecision: {
      outcome: 'clear',
      canCreateDraft: false,
      canApprove: false,
      canSubmit: false,
      reasonCodes: [],
      rationale: 'Source packet loaded; reconciliation has not yet been requested.',
      decidedBy: 'engine',
    },
    traceEvents: [
      {
        eventId: stableId('event', input.caseMetadata.caseId, 'source_loaded'),
        type: 'source_loaded',
        actor: 'system',
        at: input.at,
        message: 'Source packet loaded as untrusted auditable data.',
        evidenceIds: input.sourcePacket.flatMap((entry) =>
          entry.evidence.map((item) => item.evidenceId),
        ),
      },
    ],
    correctionDraft: null,
    approval: null,
    execution: null,
    failure: null,
  })
}

function traceReplay(workspace: CaseWorkspace, at: string, failureId: string): CaseWorkspace {
  const replayEvent: TraceEvent = {
    eventId: stableId('event', workspace.caseMetadata.caseId, 'provider_replayed', failureId),
    type: 'provider_replayed',
    actor: 'system',
    at,
    message: 'Stored failure replayed with the same controlled case identity.',
    evidenceIds: workspace.extracted.invoice?.evidenceIds ?? [],
    metadata: { failureId },
  }
  return CaseWorkspaceSchema.parse({
    ...workspace,
    traceEvents: [...workspace.traceEvents, replayEvent],
  })
}

/**
 * In-memory, deterministic implementation useful for renderer tests and
 * offline demos. It intentionally has no filesystem, Electron, or network
 * dependency; production main code can adapt the same contract to persistence.
 */
export class SupplierOpsService implements ApiContract {
  private readonly workspaces = new Map<string, CaseWorkspace>()
  private readonly regressions = new Set<string>()

  public async bootstrap(input: Parameters<ApiContract['bootstrap']>[0]): Promise<BootstrapOutput> {
    parseApiInput('bootstrap', input)
    const output = {
      schemaVersion: 'supplierops.shared.v1',
      scenarioIds: listScenarioIds(),
      capabilities: [
        'offline-reconciliation',
        'strict-model-output-validation',
        'evidence-trace',
        'approval-gated-submission',
        'stable-idempotency',
      ],
      maxSourceEntries: 50,
      maxLineCount: 500,
    }
    return BootstrapOutputSchema.parse(output)
  }

  public async loadScenario(
    input: Parameters<ApiContract['loadScenario']>[0],
  ): Promise<CaseWorkspace> {
    const parsed = parseApiInput('loadScenario', input)
    const fixture = loadScenarioFixture(parsed.scenarioId)
    const workspace = loadedWorkspace(fixture.input)
    this.workspaces.set(workspace.caseMetadata.caseId, workspace)
    return CaseWorkspaceSchema.parse(workspace)
  }

  public async runScenario(
    input: Parameters<ApiContract['runScenario']>[0],
  ): Promise<RunScenarioOutput> {
    const parsed = parseApiInput('runScenario', input)
    const fixtureInput = fixtureInputForMode(parsed.scenarioId, parsed.mode)
    const reconciliationInput: ReconciliationInput = ReconciliationInputSchema.parse({
      ...fixtureInput,
      mode: parsed.mode,
      modelOutput: parsed.modelOutput ?? fixtureInput.modelOutput,
      providerResult: parsed.providerResult ?? fixtureInput.providerResult,
    })
    const result = runReconciliation(reconciliationInput)
    const idempotencyKey =
      parsed.idempotencyKey ?? fixtureIdempotencyKey(parsed.scenarioId, `run:${parsed.mode}`)
    const workspace = result.workspace
    this.workspaces.set(workspace.caseMetadata.caseId, workspace)
    const output = {
      workspace,
      failure: result.failure,
      replayable: result.failure?.retryable ?? false,
      idempotencyKey,
      providerCalls: result.providerCalls,
    }
    return RunScenarioOutputSchema.parse(output)
  }

  public async createCorrectionDraft(
    input: Parameters<ApiContract['createCorrectionDraft']>[0],
  ): Promise<CreateCorrectionDraftOutput> {
    const parsed = parseApiInput('createCorrectionDraft', input)
    const workspace = this.workspaces.get(parsed.caseId)
    if (!workspace) throw new Error(`Case ${parsed.caseId} is not loaded.`)
    if (workspace.correctionDraft !== null) {
      if (workspace.correctionDraft.idempotencyKey !== parsed.idempotencyKey) {
        throw new Error('A different draft idempotency key was already used for this case.')
      }
      return CreateCorrectionDraftOutputSchema.parse({
        workspace,
        draft: workspace.correctionDraft,
      })
    }
    const result = createCorrectionDraft(workspace, parsed)
    this.workspaces.set(parsed.caseId, result.workspace)
    return CreateCorrectionDraftOutputSchema.parse(result)
  }

  public async approveDraft(
    input: Parameters<ApiContract['approveDraft']>[0],
  ): Promise<ApproveDraftOutput> {
    const parsed = parseApiInput('approveDraft', input)
    const workspace = this.workspaces.get(parsed.caseId)
    if (!workspace) throw new Error(`Case ${parsed.caseId} is not loaded.`)
    const result = approveDraft(workspace, parsed)
    this.workspaces.set(parsed.caseId, result.workspace)
    return ApproveDraftOutputSchema.parse(result)
  }

  public async submitDraft(
    input: Parameters<ApiContract['submitDraft']>[0],
  ): Promise<SubmitDraftOutput> {
    const parsed = parseApiInput('submitDraft', input)
    const workspace = this.workspaces.get(parsed.caseId)
    if (!workspace) throw new Error(`Case ${parsed.caseId} is not loaded.`)
    const result = submitDraft(workspace, parsed)
    this.workspaces.set(parsed.caseId, result.workspace)
    return SubmitDraftOutputSchema.parse(result)
  }

  public async replayFailure(
    input: Parameters<ApiContract['replayFailure']>[0],
  ): Promise<ReplayFailureOutput> {
    const parsed = parseApiInput('replayFailure', input)
    const existing = this.workspaces.get(parsed.caseId)
    if (!existing) throw new Error(`Case ${parsed.caseId} is not loaded.`)
    if (existing.failure === null || existing.failure.failureId !== parsed.failureId) {
      throw new Error('The requested failure is not the current replayable failure for this case.')
    }
    const invoice = existing.extracted.invoice
    const purchaseOrder = existing.extracted.purchaseOrder
    const reconciliationInput = ReconciliationInputSchema.parse({
      caseMetadata: existing.caseMetadata,
      sourcePacket: existing.sourcePacket,
      invoice,
      purchaseOrder,
      contract: existing.extracted.contract,
      catalog: existing.extracted.catalog,
      mode: parsed.mode,
      providerResult: parsed.providerResult,
      modelOutput: parsed.modelOutput,
      knownInvoiceIds: [],
      knownFingerprints: [],
      at: parsed.at,
    })
    const result = runReconciliation(reconciliationInput)
    const replayedWorkspace = traceReplay(result.workspace, parsed.at, parsed.failureId)
    this.workspaces.set(parsed.caseId, replayedWorkspace)
    return ReplayFailureOutputSchema.parse({
      workspace: replayedWorkspace,
      failure: result.failure,
      replayed: true,
    })
  }

  public async saveRegression(
    input: Parameters<ApiContract['saveRegression']>[0],
  ): Promise<SaveRegressionOutput> {
    const parsed = parseApiInput('saveRegression', input)
    const workspace = CaseWorkspaceSchema.parse(parsed.workspace)
    const regressionId = stableId('regression', parsed.scenarioId, workspace, parsed.note)
    const already = this.regressions.has(regressionId)
    this.regressions.add(regressionId)
    return SaveRegressionOutputSchema.parse({
      regressionId,
      outcome: already ? 'already_exists' : 'saved',
      scenarioId: parsed.scenarioId,
    })
  }

  public async importSourcePacket(
    input: Parameters<ApiContract['importSourcePacket']>[0],
  ): Promise<ImportSourcePacketOutput> {
    const parsed = parseApiInput('importSourcePacket', input)
    const workspace = CaseWorkspaceSchema.parse({
      caseMetadata: parsed.caseMetadata,
      workflow: { phase: 'source_loaded', status: 'ready', revision: 0 },
      sourcePacket: parsed.sourcePacket,
      extracted: { invoice: null, purchaseOrder: null, contract: null, catalog: null },
      lineComparisons: [],
      discrepancies: [],
      policyDecision: {
        outcome: 'escalate',
        canCreateDraft: false,
        canApprove: false,
        canSubmit: false,
        reasonCodes: ['missing_required_fact'],
        rationale:
          'Imported source data must be parsed into invoice and purchase-order facts before reconciliation.',
        decidedBy: 'engine',
      },
      traceEvents: [
        {
          eventId: stableId('event', parsed.caseMetadata.caseId, 'source_loaded', parsed.at),
          type: 'source_loaded',
          actor: 'system',
          at: parsed.at,
          message: 'Source packet imported as untrusted auditable data.',
          evidenceIds: parsed.sourcePacket.flatMap((entry) =>
            entry.evidence.map((item) => item.evidenceId),
          ),
        },
      ],
      correctionDraft: null,
      approval: null,
      execution: null,
      evaluation: null,
      failure: null,
    })
    this.workspaces.set(workspace.caseMetadata.caseId, workspace)
    return ImportSourcePacketOutputSchema.parse({ workspace })
  }
}

export function createSupplierOpsService(): SupplierOpsService {
  return new SupplierOpsService()
}

export const createApi = createSupplierOpsService
