import { describe, expect, it } from 'vitest'
import {
  API_INPUT_SCHEMAS,
  IPC_CHANNELS,
  IPC_CHANNEL_ALLOWLIST,
  ModelOutputSchema,
  SourcePacketEntrySchema,
  parseApiInput,
  SCENARIO_IDS,
} from '../../src/shared'

describe('strict shared contracts', () => {
  it('exposes exactly the six replayable scenario IDs', () => {
    expect(SCENARIO_IDS).toEqual([
      'clean-match',
      'price-mismatch',
      'semantic-match',
      'prompt-injection',
      'api-outage',
      'invalid-model-output',
    ])
  })

  it('rejects unknown source and model fields at the runtime boundary', () => {
    const source = {
      sourceId: 'source:test',
      kind: 'invoice',
      name: 'invoice.txt',
      pageCount: 1,
      contentType: 'text',
      content: 'data',
      trustBoundary: 'untrusted',
      quarantined: false,
      quarantineReason: null,
      evidence: [],
      execute: 'approve',
    }
    expect(SourcePacketEntrySchema.safeParse(source).success).toBe(false)
    expect(
      ModelOutputSchema.safeParse({
        semanticMappings: [],
        contractInterpretations: [],
        classifications: [],
        explanations: [],
        totalMinor: 99,
      }).success,
    ).toBe(false)
  })

  it('keeps the exact IPC allowlist separate from the typed API', () => {
    expect(IPC_CHANNELS).toEqual({
      bootstrap: 'supplierops:bootstrap',
      loadScenario: 'supplierops:scenario:load',
      runScenario: 'supplierops:scenario:run',
      createCorrectionDraft: 'supplierops:correction:create-draft',
      approveDraft: 'supplierops:correction:approve-draft',
      submitDraft: 'supplierops:correction:submit',
      replayFailure: 'supplierops:failure:replay',
      saveRegression: 'supplierops:regression:save',
      importSourcePacket: 'supplierops:source:import',
    })
    expect(IPC_CHANNEL_ALLOWLIST).toHaveLength(9)
    expect(new Set(IPC_CHANNEL_ALLOWLIST).size).toBe(9)
  })

  it('strictly parses operation inputs while allowing controlled defaults', () => {
    const parsed = parseApiInput('runScenario', { scenarioId: 'clean-match' })
    expect(parsed.mode).toBe('offline')
    expect(parsed.providerResult).toBeNull()
    expect(parsed.modelOutput).toBeNull()
    expect(() =>
      parseApiInput('runScenario', { scenarioId: 'clean-match', arbitrary: true }),
    ).toThrow()
    expect(Object.keys(API_INPUT_SCHEMAS)).toHaveLength(9)
  })
})
