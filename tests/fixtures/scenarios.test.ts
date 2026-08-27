import { describe, expect, it } from 'vitest'
import {
  evaluateFixtures,
  fixtureInputForMode,
  listScenarioFixtures,
  listScenarioIds,
  runReconciliation,
} from '../../src/shared'

describe('replayable scenario fixtures and evaluation', () => {
  it('loads six schema-valid fixtures with bounded evidence', () => {
    const fixtures = listScenarioFixtures()
    expect(listScenarioIds()).toHaveLength(6)
    expect(fixtures).toHaveLength(6)
    for (const fixture of fixtures) {
      expect(fixture.input.sourcePacket.length).toBeGreaterThan(0)
      expect(fixture.input.sourcePacket.every((entry) => entry.evidence.length > 0)).toBe(true)
    }
  })

  it('uses deterministic packet names and bounded fixture-backed content types', () => {
    const standard = listScenarioFixtures()[0].input.sourcePacket
    expect(standard.map((entry) => [entry.name, entry.contentType])).toEqual([
      ['invoice-1001.pdf', 'pdf'],
      ['po-2001.json', 'json'],
      ['contract-2025.pdf', 'pdf'],
      ['catalog-2025.csv', 'csv'],
    ])
  })

  it('reports observed counts and sample sizes without inventing accuracy', () => {
    const evaluation = evaluateFixtures()
    expect(evaluation.sampleSize).toBe(6)
    expect(evaluation.scenarioIds).toHaveLength(6)
    expect(evaluation.metrics.map((metric) => metric.metric)).toEqual(
      expect.arrayContaining([
        'schema_validity',
        'line_mapping_correctness',
        'classification',
        'evidence_presence',
        'safety_pass',
        'latency_sum',
        'retry_count',
        'model_usage',
      ]),
    )
    expect(evaluation.metrics.every((metric) => metric.sampleSize >= 0)).toBe(true)
    expect(evaluation.metrics.find((metric) => metric.metric === 'token_usage')).toMatchObject({
      observed: false,
      sampleSize: 0,
    })
  })

  it('keeps outage replay and invalid output safely escalated', () => {
    const outage = runReconciliation(fixtureInputForMode('api-outage', 'provider'))
    const invalid = runReconciliation(fixtureInputForMode('invalid-model-output', 'provider'))
    expect(outage.workspace.policyDecision.outcome).toBe('escalate')
    expect(outage.workspace.correctionDraft).toBeNull()
    expect(invalid.workspace.policyDecision.outcome).toBe('escalate')
    expect(invalid.workspace.failure?.kind).toBe('invalid_model_output')
  })
})
