import { describe, expect, it } from 'vitest'
import {
  evaluateFixture,
  evaluateScenarioRun,
  evaluateFixtures,
  evaluateFixturesDetailed,
  fixtureInputForMode,
  listScenarioFixtures,
  runReconciliation,
} from '../../src/shared'

function metric(name: string, result = evaluateFixtures()) {
  const found = result.metrics.find((item) => item.metric === name)
  if (!found) throw new Error(`Missing metric ${name}`)
  return found
}

describe('measured replay evaluation', () => {
  it('evaluates all six scenarios with inspectable assertions and exact samples', () => {
    const detailed = evaluateFixturesDetailed()
    expect(detailed.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      'clean-match',
      'price-mismatch',
      'semantic-match',
      'prompt-injection',
      'api-outage',
      'invalid-model-output',
    ])
    expect(detailed.scenarios.every((scenario) => scenario.assertions !== undefined)).toBe(true)
    expect(
      detailed.scenarios.every((scenario) => scenario.workspace.evaluation?.sampleSize === 1),
    ).toBe(true)
    expect(detailed.evaluation.sampleSize).toBe(6)
    expect(detailed.evaluation.scenarioIds).toHaveLength(6)
    expect(metric('schema_validity', detailed.evaluation)).toMatchObject({
      value: 5,
      sampleSize: 6,
    })
    expect(metric('line_mapping_correctness', detailed.evaluation)).toMatchObject({
      value: 4,
      sampleSize: 4,
    })
    expect(metric('classification', detailed.evaluation)).toMatchObject({ value: 6, sampleSize: 6 })
    expect(metric('evidence_presence', detailed.evaluation)).toMatchObject({
      value: 6,
      sampleSize: 6,
    })
    expect(metric('safety_pass', detailed.evaluation)).toMatchObject({ value: 6, sampleSize: 6 })
    expect(metric('policy_pass', detailed.evaluation)).toMatchObject({ value: 6, sampleSize: 6 })
  })

  it('counts only observed provider retries, calls, and latency samples', () => {
    const result = evaluateFixtures()
    expect(metric('model_usage', result)).toMatchObject({ value: 3, sampleSize: 6, observed: true })
    expect(metric('retry_count', result)).toMatchObject({ value: 1, sampleSize: 3, observed: true })
    expect(metric('latency_samples', result)).toMatchObject({
      value: 3,
      sampleSize: 3,
      observed: true,
    })
    expect(metric('latency_sum', result)).toMatchObject({
      value: 53,
      sampleSize: 3,
      observed: true,
    })
    expect(metric('token_usage', result)).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
    })

    const offlineOnly = evaluateFixtures([listScenarioFixtures()[0]])
    expect(metric('model_usage', offlineOnly)).toMatchObject({
      value: 0,
      sampleSize: 1,
      observed: true,
    })
    expect(metric('retry_count', offlineOnly)).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
    })
    expect(metric('latency_samples', offlineOnly)).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
    })
  })

  it('preserves semantic offline/provider boundaries and attaches actual samples', () => {
    const semantic = listScenarioFixtures().find(
      (fixture) => fixture.scenarioId === 'semantic-match',
    )!
    const offline = evaluateFixture(semantic, 'offline')
    expect(offline.workspace.policyDecision.outcome).toBe('escalate')
    expect(offline.workspace.correctionDraft).toBeNull()
    expect(offline.workspace.evaluation?.sampleSize).toBe(1)

    const provider = evaluateFixture(semantic, 'provider')
    expect(provider.workspace.policyDecision.outcome).toBe('clear')
    expect(provider.lineMappingCorrect).toBe(true)
    expect(provider.workspace.lineComparisons[0]).toMatchObject({
      matchMethod: 'semantic_suggestion',
      verification: 'verified',
    })

    const providerResponse = fixtureInputForMode('semantic-match', 'provider').providerResult
    const ignoredProviderResponse = evaluateScenarioRun(semantic, {
      ...fixtureInputForMode('semantic-match', 'offline'),
      providerResult: providerResponse,
    })
    expect(ignoredProviderResponse.modelCalls).toBe(0)
    expect(ignoredProviderResponse.retries).toBe(0)
    expect(ignoredProviderResponse.latencySampled).toBe(false)
  })

  it('keeps prompt-injection safety, outage replay, and invalid-output failure measurable', () => {
    const detailed = evaluateFixturesDetailed()
    const prompt = detailed.scenarios.find(
      (scenario) => scenario.scenarioId === 'prompt-injection',
    )!
    expect(prompt.safetyPass).toBe(true)
    expect(prompt.workspace.policyDecision.outcome).toBe('blocked')
    expect(prompt.workspace.sourcePacket.some((entry) => entry.quarantined)).toBe(true)

    const outage = detailed.scenarios.find((scenario) => scenario.scenarioId === 'api-outage')!
    expect(outage.retries).toBe(1)
    expect(outage.workspace.failure?.kind).toBe('provider_rate_limited')
    expect(outage.workspace.correctionDraft).toBeNull()

    const invalid = detailed.scenarios.find(
      (scenario) => scenario.scenarioId === 'invalid-model-output',
    )!
    expect(invalid.modelOutputValid).toBe(false)
    expect(invalid.workspace.failure?.kind).toBe('invalid_model_output')
    expect(invalid.workspace.policyDecision.canCreateDraft).toBe(false)
  })

  it('is deterministic across repeated runs and rejects empty evaluation samples', () => {
    const first = evaluateFixtures()
    const second = evaluateFixtures()
    expect(first).toEqual(second)
    expect(() => evaluateFixtures([])).toThrow()

    const outageInput = fixtureInputForMode('api-outage', 'provider')
    const firstRun = runReconciliation(outageInput)
    const secondRun = runReconciliation(outageInput)
    expect(firstRun.failure?.failureId).toBe(secondRun.failure?.failureId)
  })
})
