import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadScenarioFixture } from '../../src/shared/fixtures'
import { RunScenarioOutputSchema, type EvaluationResult } from '../../src/shared/schemas'
import { WorkspaceStore } from '../../src/main/persistence'
import { ProviderBoundary } from '../../src/main/provider'
import { WorkspaceService } from '../../src/main/workspace'

describe('production workspace evaluation', () => {
  const temporaryDirectories: string[] = []
  const temporaryStores: WorkspaceStore[] = []

  afterEach(() => {
    for (const store of temporaryStores.splice(0)) store.close()
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  function createService(): WorkspaceService {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-workspace-evaluation-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
    store.open()
    temporaryStores.push(store)
    const provider = new ProviderBoundary(store, directory, {
      apiKey: '',
      loadFromEnvironment: false,
    })
    return new WorkspaceService(store, provider)
  }

  function metric(evaluation: EvaluationResult, name: string) {
    const found = evaluation.metrics.find((item) => item.metric === name)
    if (!found) throw new Error(`Missing evaluation metric ${name}`)
    return found
  }

  it('attaches a single honest offline sample to production scenario runs', async () => {
    const service = createService()
    const result = RunScenarioOutputSchema.parse(
      await service.runScenario({
        scenarioId: 'price-mismatch',
        mode: 'offline',
        idempotencyKey: 'evaluation:price-mismatch',
      }),
    )
    const evaluation = result.workspace.evaluation

    expect(evaluation).not.toBeNull()
    expect(evaluation?.sampleSize).toBe(1)
    expect(metric(evaluation!, 'schema_validity')).toMatchObject({
      value: 1,
      sampleSize: 1,
      observed: true,
    })
    expect(metric(evaluation!, 'model_usage')).toMatchObject({
      value: 0,
      sampleSize: 1,
      observed: true,
      label: '0 provider/model calls observed across 1 fixtures',
    })
    expect(metric(evaluation!, 'retry_count')).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
      label: '0 provider retries observed across 0 provider samples',
    })
    expect(metric(evaluation!, 'latency_samples')).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
      label: '0/0 provider latency samples observed',
    })
    expect(metric(evaluation!, 'latency_sum')).toMatchObject({
      value: 0,
      sampleSize: 0,
      observed: false,
      label: 'No provider latency observed',
    })
  })

  it('retains observed provider retry and latency samples from a replay fixture', async () => {
    const service = createService()
    const fixture = loadScenarioFixture('api-outage')
    const result = RunScenarioOutputSchema.parse(
      await service.runScenario({
        scenarioId: fixture.scenarioId,
        mode: 'provider',
        providerResult: fixture.providerResult,
        modelOutput: null,
        idempotencyKey: 'evaluation:api-outage',
      }),
    )
    const evaluation = result.workspace.evaluation

    expect(evaluation).not.toBeNull()
    expect(evaluation?.sampleSize).toBe(1)
    expect(result.failure?.kind).toBe('provider_rate_limited')
    expect(metric(evaluation!, 'model_usage')).toMatchObject({
      value: 1,
      sampleSize: 1,
      observed: true,
      label: '1 provider/model calls observed across 1 fixtures',
    })
    expect(metric(evaluation!, 'retry_count')).toMatchObject({
      value: 1,
      sampleSize: 1,
      observed: true,
      label: '1 provider retries observed across 1 provider samples',
    })
    expect(metric(evaluation!, 'latency_samples')).toMatchObject({
      value: 1,
      sampleSize: 1,
      observed: true,
      label: '1/1 provider latency samples observed',
    })
    expect(metric(evaluation!, 'latency_sum')).toMatchObject({
      value: 25,
      sampleSize: 1,
      observed: true,
      label: '25 observed provider milliseconds across 1 samples',
    })
  })

  it('keeps intended invalid output measurable without violating the output schema', async () => {
    const service = createService()
    const fixture = loadScenarioFixture('invalid-model-output')
    const result = RunScenarioOutputSchema.parse(
      await service.runScenario({
        scenarioId: fixture.scenarioId,
        mode: 'provider',
        providerResult: fixture.providerResult,
        modelOutput: null,
        idempotencyKey: 'evaluation:invalid-model-output',
      }),
    )
    const evaluation = result.workspace.evaluation

    expect(evaluation).not.toBeNull()
    expect(evaluation?.sampleSize).toBe(1)
    expect(result.failure?.kind).toBe('invalid_model_output')
    expect(result.workspace.policyDecision.outcome).toBe('escalate')
    expect(metric(evaluation!, 'schema_validity')).toMatchObject({
      value: 0,
      sampleSize: 1,
      observed: true,
      label: '0/1 fixture model/control schemas valid',
    })
    expect(metric(evaluation!, 'model_usage')).toMatchObject({
      value: 1,
      sampleSize: 1,
      observed: true,
    })
    expect(metric(evaluation!, 'latency_sum')).toMatchObject({
      value: 18,
      sampleSize: 1,
      observed: true,
    })
  })
})
