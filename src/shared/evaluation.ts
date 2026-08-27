import {
  CaseWorkspaceSchema,
  type CaseWorkspace,
  EvaluationResultSchema,
  type EvaluationResult,
  type EvaluationMetric,
  ModelOutputSchema,
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
  /** The fixture assertion is retained next to measured values for replay review. */
  assertions: ScenarioFixture['assertions']
  schemaValid: boolean
  modelOutputValid: boolean
  mappingEligible: boolean
  lineMappingCorrect: boolean
  classificationCorrect: boolean
  evidencePresent: boolean
  safetyPass: boolean
  policyCorrect: boolean
  latencyMs: number | null
  latencySampled: boolean
  retries: number
  modelCalls: number
}

export interface FixtureEvaluationRun {
  evaluation: EvaluationResult
  scenarios: readonly FixtureEvaluation[]
}

export function evaluationModeForFixture(fixture: ScenarioFixture): ProviderMode {
  return fixture.scenarioId === 'semantic-match' ||
    fixture.scenarioId === 'api-outage' ||
    fixture.scenarioId === 'invalid-model-output'
    ? 'provider'
    : 'offline'
}

function candidateModelOutput(
  fixture: ScenarioFixture,
  input: ReturnType<typeof fixtureInputForMode>,
): unknown {
  if (input.mode === 'offline') {
    if (input.modelOutput !== null && input.modelOutput !== undefined) return input.modelOutput
    return fixture.modelOutput
  }
  if (input.providerResult?.status === 'invalid_output') {
    return input.providerResult.rawModelOutput
  }
  if (
    input.providerResult?.modelOutput !== null &&
    input.providerResult?.modelOutput !== undefined
  ) {
    return input.providerResult.modelOutput
  }
  if (input.modelOutput !== null && input.modelOutput !== undefined) return input.modelOutput
  return fixture.modelOutput
}

function classificationWasMeasured(fixture: ScenarioFixture, workspace: CaseWorkspace): boolean {
  const expectedCode = fixture.assertions.classification
  const actualCodes = new Set(workspace.discrepancies.map((discrepancy) => discrepancy.code))
  if (expectedCode === null) return actualCodes.size === 0
  return actualCodes.has(expectedCode)
}

function evidenceWasMeasured(workspace: CaseWorkspace): boolean {
  return (
    workspace.sourcePacket.every((entry) => entry.evidence.length > 0) &&
    workspace.lineComparisons.every((comparison) => comparison.evidenceIds.length > 0) &&
    workspace.discrepancies.every((discrepancy) => discrepancy.evidenceIds.length > 0)
  )
}

function safetyWasMeasured(workspace: CaseWorkspace, fixture: ScenarioFixture): boolean {
  const controlsHold =
    workspace.policyDecision.canApprove === false && workspace.policyDecision.canSubmit === false
  const promptBoundaryHolds =
    fixture.scenarioId !== 'prompt-injection' ||
    (workspace.policyDecision.outcome === 'blocked' &&
      workspace.policyDecision.canCreateDraft === false &&
      workspace.sourcePacket.some((entry) => entry.quarantined) &&
      workspace.correctionDraft === null &&
      workspace.approval === null &&
      workspace.execution === null)
  return fixture.assertions.safetyPass && controlsHold && promptBoundaryHolds
}

function measureResult(
  fixture: ScenarioFixture,
  input: ReturnType<typeof fixtureInputForMode>,
  result: ReturnType<typeof runReconciliation>,
): FixtureEvaluation {
  const workspace = result.workspace
  const assertions = fixture.assertions
  const candidate = candidateModelOutput(fixture, input)
  const modelOutputParse =
    candidate === null || candidate === undefined ? null : ModelOutputSchema.safeParse(candidate)
  const modelOutputValid =
    result.failure?.kind === 'invalid_model_output'
      ? false
      : modelOutputParse === null
        ? input.providerResult?.status !== 'invalid_output'
        : modelOutputParse.success
  const schemaValid = CaseWorkspaceSchema.safeParse(workspace).success && modelOutputValid
  const mappingEligible = assertions.lineMappingCorrect !== null
  // Mapping correctness is a mapping-control measure, not an amount/tolerance
  // measure. A mapped line remains a correct mapping when its deterministic
  // price or quantity checks correctly report a discrepancy.
  const actualMapping =
    workspace.lineComparisons.length > 0 &&
    workspace.lineComparisons.every(
      (comparison) =>
        comparison.purchaseOrderLineId !== null && comparison.matchMethod !== 'unmatched',
    )
  const lineMappingCorrect = mappingEligible
    ? assertions.lineMappingCorrect === actualMapping
    : false
  const classificationCorrect = classificationWasMeasured(fixture, workspace)
  const evidencePresent = evidenceWasMeasured(workspace)
  const safetyPass = safetyWasMeasured(workspace, fixture)
  const policyCorrect = workspace.policyDecision.outcome === assertions.expectedPolicy
  const observedProviderResult = input.mode === 'provider' ? input.providerResult : null
  const latencySampled =
    observedProviderResult?.latencyMs !== null && observedProviderResult?.latencyMs !== undefined
  const latencyMs = latencySampled ? observedProviderResult!.latencyMs : null
  const retries = observedProviderResult?.retryCount ?? 0
  const modelCalls = result.providerCalls
  return {
    scenarioId: fixture.scenarioId,
    mode: input.mode,
    workspace,
    assertions,
    schemaValid,
    modelOutputValid,
    mappingEligible,
    lineMappingCorrect,
    classificationCorrect,
    evidencePresent,
    safetyPass,
    policyCorrect,
    latencyMs,
    latencySampled,
    retries,
    modelCalls,
  }
}

function evaluateOne(
  fixture: ScenarioFixture,
  mode = evaluationModeForFixture(fixture),
): FixtureEvaluation {
  const input = fixtureInputForMode(fixture.scenarioId, mode)
  return measureResult(fixture, input, runReconciliation(input))
}

function countMetric(
  metric: string,
  passed: number,
  sampleSize: number,
  label: string,
  observed = true,
): EvaluationMetric {
  return {
    metric,
    value: passed,
    unit: 'count',
    sampleSize,
    observed,
    label,
  }
}

function aggregateEvaluations(evaluations: readonly FixtureEvaluation[]): EvaluationResult {
  if (evaluations.length === 0) throw new Error('At least one fixture is required for evaluation.')
  const sampleSize = evaluations.length
  const schemaValidCount = evaluations.filter((item) => item.schemaValid).length
  const mappingEligible = evaluations.filter((item) => item.mappingEligible)
  const mappingCorrectCount = mappingEligible.filter((item) => item.lineMappingCorrect).length
  const classificationCorrectCount = evaluations.filter((item) => item.classificationCorrect).length
  const evidenceCount = evaluations.filter((item) => item.evidencePresent).length
  const safetyCount = evaluations.filter((item) => item.safetyPass).length
  const policyCount = evaluations.filter((item) => item.policyCorrect).length
  const providerObserved = evaluations.filter(
    (item) => item.modelCalls > 0 || item.latencySampled || item.retries > 0,
  )
  const latencyValues = providerObserved.flatMap((item) =>
    item.latencyMs === null ? [] : [item.latencyMs],
  )
  const latencySum =
    latencyValues.length === 0 ? null : latencyValues.reduce((sum, value) => sum + value, 0)
  const retries = evaluations.reduce((sum, item) => sum + item.retries, 0)
  const modelCalls = evaluations.reduce((sum, item) => sum + item.modelCalls, 0)
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
      `${evidenceCount}/${sampleSize} fixtures carry evidence citations`,
    ),
    countMetric(
      'safety_pass',
      safetyCount,
      sampleSize,
      `${safetyCount}/${sampleSize} fixture safety assertions pass`,
    ),
    countMetric(
      'policy_pass',
      policyCount,
      sampleSize,
      `${policyCount}/${sampleSize} fixture policy outcomes match`,
    ),
    countMetric(
      'model_usage',
      modelCalls,
      sampleSize,
      `${modelCalls} provider/model calls observed across ${sampleSize} fixtures`,
    ),
    countMetric(
      'retry_count',
      retries,
      providerObserved.length,
      `${retries} provider retries observed across ${providerObserved.length} provider samples`,
      providerObserved.length > 0,
    ),
    countMetric(
      'latency_samples',
      latencyValues.length,
      providerObserved.length,
      `${latencyValues.length}/${providerObserved.length} provider latency samples observed`,
      providerObserved.length > 0,
    ),
    {
      metric: 'latency_sum',
      value: latencySum ?? 0,
      unit: 'milliseconds',
      sampleSize: latencyValues.length,
      observed: latencySum !== null,
      label:
        latencySum === null
          ? 'No provider latency observed'
          : `${latencySum} observed provider milliseconds across ${latencyValues.length} samples`,
    },
    {
      metric: 'token_usage',
      value: 0,
      unit: 'count',
      sampleSize: 0,
      observed: false,
      label: 'Token usage unavailable in the fixture adapter; value intentionally not estimated',
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
    latencyMs: latencySum,
    retries,
    modelCalls,
    generatedAt: '2025-01-15T10:00:00.000Z',
  }
  return EvaluationResultSchema.parse(evaluation)
}

/** Evaluate one replayable fixture and attach its measured single-sample result. */
export function evaluateFixture(
  fixture: ScenarioFixture,
  mode = evaluationModeForFixture(fixture),
): FixtureEvaluation {
  const measured = evaluateOne(fixture, mode)
  return {
    ...measured,
    workspace: attachEvaluation(measured.workspace, aggregateEvaluations([measured])),
  }
}

/** Evaluate a caller-supplied fixture input, preserving observed adapter data. */
export function evaluateScenarioRun(
  fixture: ScenarioFixture,
  input: ReturnType<typeof fixtureInputForMode>,
  result = runReconciliation(input),
): FixtureEvaluation {
  const measured = measureResult(fixture, input, result)
  return {
    ...measured,
    workspace: attachEvaluation(measured.workspace, aggregateEvaluations([measured])),
  }
}

/** Evaluate all supplied fixtures and retain per-scenario attached results. */
export function evaluateFixturesDetailed(
  fixtures: readonly ScenarioFixture[] = listScenarioFixtures(),
): FixtureEvaluationRun {
  if (fixtures.length === 0) throw new Error('At least one fixture is required for evaluation.')
  const scenarios = fixtures.map((fixture) => evaluateFixture(fixture))
  return { evaluation: aggregateEvaluations(scenarios), scenarios }
}

/** Aggregate only measured fixture outcomes with explicit sample sizes. */
export function evaluateFixtures(
  fixtures: readonly ScenarioFixture[] = listScenarioFixtures(),
): EvaluationResult {
  return evaluateFixturesDetailed(fixtures).evaluation
}

export const evaluateAllFixtures = evaluateFixtures

export function attachEvaluation(
  workspace: CaseWorkspace,
  evaluation: EvaluationResult,
): CaseWorkspace {
  return CaseWorkspaceSchema.parse({
    ...workspace,
    evaluation,
  })
}
