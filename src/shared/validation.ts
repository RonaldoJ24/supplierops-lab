import {
  CaseWorkspaceSchema,
  ModelOutputSchema,
  ReconciliationInputSchema,
  SourcePacketEntrySchema,
  type CaseWorkspace,
  type ModelOutput,
  type ReconciliationInput,
  type SourcePacketEntry,
} from './schemas'

export function parseModelOutput(value: unknown): ModelOutput {
  return ModelOutputSchema.parse(value)
}

export function safeParseModelOutput(
  value: unknown,
): ReturnType<typeof ModelOutputSchema.safeParse> {
  return ModelOutputSchema.safeParse(value)
}

export function parseReconciliationInput(value: unknown): ReconciliationInput {
  return ReconciliationInputSchema.parse(value)
}

export function parseCaseWorkspace(value: unknown): CaseWorkspace {
  return CaseWorkspaceSchema.parse(value)
}

export function parseSourcePacketEntry(value: unknown): SourcePacketEntry {
  return SourcePacketEntrySchema.parse(value)
}

export {
  CaseWorkspaceSchema,
  ModelOutputSchema,
  ReconciliationInputSchema,
  SourcePacketEntrySchema,
}
