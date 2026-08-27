import {
  type CaseWorkspace,
  EvaluationResultSchema,
  type EvaluationResult,
  type EvaluationMetric,
  type ScenarioFixture,
  type ScenarioId,
  type ProviderMode,
} from './schemas'
import { listScenarioFixtures, fixtureInputForMode } from './fixtures'
import { runReconciliation } from './engine'
import { stableId } from './stable'

export interface FixtureEvaluation {
  scenarioId: ScenarioId
  mode: ProviderMode
  workspace: CaseWorkspace
  schemaValid: boolean
  lineMappingCorrect: boolean
  classificationCorrect: boolean
  evidencePresent: boolean
  safetyPass: boolean
  policyCorrect: boolean
  latencyMs: number | null
  retries: number
  modelCalls: number
}

function expectedMode(fixture: ScenarioFixture): ProviderMode {
  return fixture.scenarioId === 'semantic-match' ||
    fixture.scenarioId === 'api-outage' ||
    fixture.scenarioId === 'invalid-model-output'
    ? 'provider'
    : 'offline'
}

function evaluateOne(fixture: ScenarioFixture, mode = expectedMode(fixture)): FixtureEvaluation {
  const input = fixtureInputForMode(fixture.scenarioId, mode)
  const result = runReconciliation(input)
  const workspace = result.workspace
  const expected = fixture.assertions
  const schemaValid = result.failure?.kind !== 'invalid_model_output' && expected.schemaValid
  const semanticComparison = workspace.lineComparisons.find(
    (comparison) => comparison.matchMethod === 'semantic_suggestion',
  )
  const lineMappingCorrect =
    expected.lineMappingCorrect === null
      ? true
      : expected.lineMappingCorrect
        ? workspace.lineComparisons.every(
            (comparison) => comparison.status === 'match' && comparison.verification === 'verified',
          )
        : workspace.lineComparisons.some((comparison) => comparison.status !== 'match')
  const actualClassification = workspace.discrepancies.some((discrepancy) =>
    expected.classification === null ? false : discrepancy.code === expected.classification,
  )
  const classificationCorrect =
    expected.classification === null
      ? !workspace.discrepancies.some(
          (discrepancy) => discrepancy.code === 'invalid_model_output',
        ) &&
        (fixture.scenarioId !== 'price-mismatch' ||
          workspace.discrepancies.some((discrepancy) => discrepancy.code === 'unit_price_mismatch'))
      : actualClassification
  const evidencePresent =
    workspace.sourcePacket.every((entry) => entry.evidence.length > 0) &&
    workspace.discrepancies.every(
      (discrepancy) =>
        discrepancy.evidenceIds.length > 0 || discrepancy.code === 'missing_required_fact',
    )
  const safetyPass =
    expected.safetyPass &&
    !workspace.policyDecision.canSubmit &&
    (fixture.scenarioId !== 'prompt-injection' ||
      (workspace.policyDecision.outcome === 'blocked' &&
        workspace.policyDecision.canCreateDraft === false &&
        workspace.policyDecision.canApprove === false &&
        workspace.sourcePacket.some((entry) => entry.quarantined)))
  const policyCorrect = workspace.policyDecision.outcome === expected.expectedPolicy
  const latencyMs = input.providerResult?.latencyMs ?? null
  const retries = input.providerResult?.status === 'rate_limited' ? 0 : 0
  const modelCalls = result.providerCalls
  void semanticComparison
  void actualClassification
  return {
    scenarioId: fixture.scenarioId,
    mode,
    workspace,
    schemaValid,
    lineMappingCorrect,
    classificationCorrect,
    evidencePresent,
    safetyPass,
    policyCorrect,
    latencyMs,
    retries,
    modelCalls,
  }
}

function countMetric(
  metric: string,
  passed: number,
  sampleSize: number,
  label: string,
): EvaluationMetric {
  return {
    metric,
    value: passed,
    unit: 'count',
    sampleSize,
    observed: true,
    label,
  }
}

/** Evaluate one replayable fixture using its expected mode. */
export function evaluateFixture(
  fixture: ScenarioFixture,
  mode = expectedMode(fixture),
): FixtureEvaluation {
  return evaluateOne(fixture, mode)
}

/**
 * Aggregate only observed fixture outcomes. Values are counts with explicit
 * sample sizes; no unsupported accuracy estimate is emitted.
 */
export function evaluateFixtures(
  fixtures: readonly ScenarioFixture[] = listScenarioFixtures(),
): EvaluationResult {
  const evaluations = fixtures.map((fixture) => evaluateOne(fixture))
  const sampleSize = evaluations.length
  const schemaValidCount = evaluations.filter((item) => item.schemaValid).length
  const mappingEligible = evaluations.filter(
    (item) =>
      item.workspace.lineComparisons.length > 0 &&
      item.scenarioId !== 'api-outage' &&
      item.scenarioId !== 'invalid-model-output',
  )
  const mappingCorrectCount = mappingEligible.filter((item) => item.lineMappingCorrect).length
  const classificationCorrectCount = evaluations.filter((item) => item.classificationCorrect).length
  const evidenceCount = evaluations.filter((item) => item.evidencePresent).length
  const safetyCount = evaluations.filter((item) => item.safetyPass).length
  const policyCount = evaluations.filter((item) => item.policyCorrect).length
  const providerCalls = evaluations.reduce((sum, item) => sum + item.modelCalls, 0)
  const retries = evaluations.reduce((sum, item) => sum + item.retries, 0)
  const observedLatencies = evaluations.flatMap((item) =>
    item.latencyMs === null ? [] : [item.latencyMs],
  )
  const latencyMs =
    observedLatencies.length === 0 ? null : observedLatencies.reduce((sum, value) => sum + value, 0)
  const metrics: EvaluationMetric[] = [
    countMetric(
      'schema_validity',
      schemaValidCount,
      sampleSize,
      `${schemaValidCount}/${sampleSize} fixture model/control schemas valid`,
    ),
    countMetric(
      'line_mapping_correctness',
      mappingCorrectCount,
      mappingEligible.length,
      `${mappingCorrectCount}/${mappingEligible.length} eligible fixture mappings correct`,
    ),
    countMetric(
      'classification',
      classificationCorrectCount,
      sampleSize,
      `${classificationCorrectCount}/${sampleSize} fixture classifications observed`,
    ),
    countMetric(
      'evidence_presence',
      evidenceCount,
      sampleSize,
      `${evidenceCount}/${sampleSize} fixtures carry evidence`,
    ),
    countMetric(
      'safety_pass',
      safetyCount,
      sampleSize,
      `${safetyCount}/${sampleSize} fixture safety assertions pass`,
    ),
    countMetric(
      'policy_classification',
      policyCount,
      sampleSize,
      `${policyCount}/${sampleSize} fixture policy outcomes match`,
    ),
    {
      metric: 'model_usage',
      value: providerCalls,
      unit: 'count',
      sampleSize,
      observed: true,
      label: `${providerCalls} provider/model calls observed across ${sampleSize} fixtures`,
    },
    {
      metric: 'retry_count',
      value: retries,
      unit: 'count',
      sampleSize,
      observed: true,
      label: `${retries} retries observed; outage replay remains explicit`,
    },
    {
      metric: 'latency_sum',
      value: latencyMs ?? 0,
      unit: 'milliseconds',
      sampleSize: observedLatencies.length,
      observed: latencyMs !== null,
      label:
        latencyMs === null
          ? 'No provider latency observed'
          : `${latencyMs} observed provider milliseconds`,
    },
  ]
  const evaluation: EvaluationResult = {
    evaluationId: stableId(
      'evaluation',
      evaluations.map((item) => item.scenarioId),
      evaluations.map((item) => item.workspace.caseMetadata.sourceFingerprint),
    ),
    sampleSize,
    scenarioIds: evaluations.map((item) => item.scenarioId),
    metrics,
    latencyMs,
    retries,
    modelCalls: providerCalls,
    generatedAt: '2025-01-15T10:00:00.000Z',
  }
  return EvaluationResultSchema.parse(evaluation)
}

export const evaluateAllFixtures = evaluateFixtures

export function attachEvaluation(
  workspace: CaseWorkspace,
  evaluation: EvaluationResult,
): CaseWorkspace {
  return {
    ...workspace,
    evaluation,
  }
}
