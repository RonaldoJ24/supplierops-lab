import {
  ApproveDraftInputSchema,
  ApproveDraftOutputSchema,
  BootstrapInputSchema,
  BootstrapOutputSchema,
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
  CaseWorkspaceSchema,
  type ApproveDraftInput,
  type ApproveDraftOutput,
  type BootstrapInput,
  type BootstrapOutput,
  type CreateCorrectionDraftInput,
  type CreateCorrectionDraftOutput,
  type ImportSourcePacketInput,
  type ImportSourcePacketOutput,
  type LoadScenarioInput,
  type ReplayFailureInput,
  type ReplayFailureOutput,
  type RunScenarioInput,
  type RunScenarioOutput,
  type SaveRegressionInput,
  type SaveRegressionOutput,
  type SubmitDraftInput,
  type SubmitDraftOutput,
  type CaseWorkspace,
} from './schemas'
import type { infer as ZodInfer } from 'zod'

/** Exact renderer-to-main channel names. Keep the allowlist separate from the API shape. */
export const IPC_CHANNELS = {
  bootstrap: 'supplierops:bootstrap',
  loadScenario: 'supplierops:scenario:load',
  runScenario: 'supplierops:scenario:run',
  createCorrectionDraft: 'supplierops:correction:create-draft',
  approveDraft: 'supplierops:correction:approve-draft',
  submitDraft: 'supplierops:correction:submit',
  replayFailure: 'supplierops:failure:replay',
  saveRegression: 'supplierops:regression:save',
  importSourcePacket: 'supplierops:source:import',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
export const IPC_CHANNEL_ALLOWLIST: readonly IpcChannel[] = Object.freeze(
  Object.values(IPC_CHANNELS),
)
export const SUPPLIER_OPS_IPC_CHANNELS = IPC_CHANNELS
export const SUPPLIER_OPS_IPC_ALLOWLIST = IPC_CHANNEL_ALLOWLIST

/**
 * Renderer-facing boundary. Implementations may live in preload/main, but all
 * inputs and outputs have a strict schema available below.
 */
export interface ApiContract {
  bootstrap(input: BootstrapInput): Promise<BootstrapOutput>
  loadScenario(input: LoadScenarioInput): Promise<CaseWorkspace>
  runScenario(input: RunScenarioInput): Promise<RunScenarioOutput>
  createCorrectionDraft(input: CreateCorrectionDraftInput): Promise<CreateCorrectionDraftOutput>
  approveDraft(input: ApproveDraftInput): Promise<ApproveDraftOutput>
  submitDraft(input: SubmitDraftInput): Promise<SubmitDraftOutput>
  replayFailure(input: ReplayFailureInput): Promise<ReplayFailureOutput>
  saveRegression(input: SaveRegressionInput): Promise<SaveRegressionOutput>
  importSourcePacket(input: ImportSourcePacketInput): Promise<ImportSourcePacketOutput>
}

export type ApiOperationName = keyof ApiContract

export const API_INPUT_SCHEMAS = {
  bootstrap: BootstrapInputSchema,
  loadScenario: LoadScenarioInputSchema,
  runScenario: RunScenarioInputSchema,
  createCorrectionDraft: CreateCorrectionDraftInputSchema,
  approveDraft: ApproveDraftInputSchema,
  submitDraft: SubmitDraftInputSchema,
  replayFailure: ReplayFailureInputSchema,
  saveRegression: SaveRegressionInputSchema,
  importSourcePacket: ImportSourcePacketInputSchema,
} as const

export const API_OUTPUT_SCHEMAS = {
  bootstrap: BootstrapOutputSchema,
  loadScenario: CaseWorkspaceSchema,
  runScenario: RunScenarioOutputSchema,
  createCorrectionDraft: CreateCorrectionDraftOutputSchema,
  approveDraft: ApproveDraftOutputSchema,
  submitDraft: SubmitDraftOutputSchema,
  replayFailure: ReplayFailureOutputSchema,
  saveRegression: SaveRegressionOutputSchema,
  importSourcePacket: ImportSourcePacketOutputSchema,
} as const

/** Runtime boundary helper for callers that receive unknown IPC payloads. */
export function parseApiInput<K extends ApiOperationName>(
  operation: K,
  value: unknown,
): ZodInfer<(typeof API_INPUT_SCHEMAS)[K]> {
  return API_INPUT_SCHEMAS[operation].parse(value) as ZodInfer<(typeof API_INPUT_SCHEMAS)[K]>
}

export function parseApiOutput<K extends ApiOperationName>(
  operation: K,
  value: unknown,
): ZodInfer<(typeof API_OUTPUT_SCHEMAS)[K]> {
  return API_OUTPUT_SCHEMAS[operation].parse(value) as ZodInfer<(typeof API_OUTPUT_SCHEMAS)[K]>
}
