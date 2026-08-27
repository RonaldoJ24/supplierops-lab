import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadScenarioFixture } from '../../src/shared/fixtures'
import { WorkspaceStore } from '../../src/main/persistence'
import {
  DEEPSEEK_ENDPOINT,
  DEEPSEEK_MODEL,
  SemanticInterpreter,
  ProviderBoundary,
  type ProviderClock,
  type ProviderFetch,
} from '../../src/main/provider'
import { WorkspaceService } from '../../src/main/workspace'

type FakeResponse = Pick<Response, 'status' | 'headers' | 'json'>

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const fake: FakeResponse = {
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
  return fake as Response
}

function modelOutputBody(content: string, usage?: Record<string, number>): Response {
  return response(200, {
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  })
}

function validModelOutput(): string {
  return JSON.stringify(loadScenarioFixture('semantic-match').modelOutput)
}

function fakeClock(): { clock: ProviderClock; waits: number[] } {
  let now = 1_000
  const waits: number[] = []
  return {
    waits,
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      },
    },
  }
}

function queuedFetch(queue: Array<Response | Error>): {
  fetcher: ProviderFetch
  calls: RequestInit[]
  urls: string[]
} {
  const calls: RequestInit[] = []
  const urls: string[] = []
  return {
    calls,
    urls,
    fetcher: async (url, init) => {
      urls.push(url)
      calls.push(init ?? {})
      const next = queue.shift()
      if (!next) throw new Error('fixture response queue exhausted')
      if (next instanceof Error) throw next
      return next
    },
  }
}

describe('DeepSeek semantic interpreter', () => {
  it('posts bounded descriptions and evidence IDs and validates a successful model output', async () => {
    const fake = queuedFetch([
      modelOutputBody(validModelOutput(), { prompt_tokens: 12, completion_tokens: 8 }),
    ])
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: fakeClock().clock,
    }).interpret({
      invoiceLines: [
        {
          lineId: 'invoice-line:1',
          description: 'Industrial fastening bolt',
          evidenceIds: ['source:invoice-facts'],
        },
      ],
      purchaseOrderLines: [
        { lineId: 'po-line:1', description: 'Steel bolt', evidenceIds: ['source:po-facts'] },
      ],
    })

    expect(result.result.status).toBe('ok')
    expect(result.result.modelOutput?.semanticMappings).toHaveLength(1)
    expect(result.result.retryCount).toBe(0)
    expect(result.traceMetadata).toMatchObject({
      provider: 'deepseek',
      model: DEEPSEEK_MODEL,
      operation: 'semantic-interpreter',
      attemptCount: 1,
      responseStatusClass: '2xx',
      inputTokenCount: 12,
      outputTokenCount: 8,
    })
    expect(result.traceMetadata.costEstimateUsd).toContain('USD ')

    expect(fake.urls).toEqual([DEEPSEEK_ENDPOINT])
    const body = JSON.parse(String(fake.calls[0]?.body)) as Record<string, unknown>
    expect(body.model).toBe(DEEPSEEK_MODEL)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.stream).toBe(false)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBeLessThanOrEqual(512)
    expect(fake.calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer fixture-key',
      'content-type': 'application/json',
    })
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]?.content).toContain('untrusted')
    expect(messages[0]?.content).toContain('semanticMappings')
    expect(messages[0]?.content).toContain('contractInterpretations')
    expect(messages[0]?.content).toContain('classifications')
    expect(messages[0]?.content).toContain('explanations')
    expect(messages[0]?.content).toContain('integer from 0 to 100')
    expect(messages[1]?.content).toContain('Industrial fastening bolt')
    expect(messages[1]?.content).toContain('invoice-line:1')
    expect(messages[1]?.content).toContain('po-line:1')
    expect(messages[1]?.content).toContain('source:invoice-facts')
    expect(messages[1]?.content).not.toContain('unitPriceMinor')
  })

  it('does not invent a zero cost when provider usage is absent', async () => {
    const fake = queuedFetch([modelOutputBody(validModelOutput())])
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: fakeClock().clock,
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(result.result.status).toBe('ok')
    expect(result.traceMetadata.inputTokenCount).toBeUndefined()
    expect(result.traceMetadata.outputTokenCount).toBeUndefined()
    expect(result.traceMetadata.costEstimateUsd).toContain('not observed')
    expect(result.traceMetadata.costEstimateUsd).not.toContain('$0.000000')
  })

  it('redacts the configured key if untrusted line text attempts to echo it', async () => {
    const configuredKey = 'fixture-deepseek-secret-value'
    const fake = queuedFetch([modelOutputBody(validModelOutput())])
    await new SemanticInterpreter({
      apiKey: configuredKey,
      fetch: fake.fetcher,
      clock: fakeClock().clock,
    }).interpret({
      invoiceLines: [
        { lineId: 'invoice-line:1', description: `untrusted ${configuredKey}`, evidenceIds: [] },
      ],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(String(fake.calls[0]?.body)).not.toContain(configuredKey)
  })

  it('does not call the network when no key is configured', async () => {
    let calls = 0
    const result = await new SemanticInterpreter({
      fetch: async () => {
        calls += 1
        return modelOutputBody(validModelOutput())
      },
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'Invoice', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'PO', evidenceIds: [] }],
    })

    expect(calls).toBe(0)
    expect(result.result).toMatchObject({
      status: 'unavailable',
      statusCode: null,
      retryable: false,
      retryCount: 0,
      modelOutput: null,
    })
    expect(result.traceMetadata.responseStatusClass).toBe('not-configured')
    expect(result.traceMetadata.costEstimateUsd).toContain('unavailable')
  })

  it('does not retry authentication failures', async () => {
    const fake = queuedFetch([response(401, { error: { message: 'unauthorized' } })])
    const clock = fakeClock()
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: clock.clock,
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(fake.calls).toHaveLength(1)
    expect(clock.waits).toEqual([])
    expect(result.result).toMatchObject({
      status: 'unavailable',
      statusCode: 401,
      retryable: false,
      retryCount: 0,
    })
  })

  it('honors a bounded Retry-After and retries one rate-limit response', async () => {
    const fake = queuedFetch([
      response(429, { error: { message: 'busy' } }, { 'retry-after': '3' }),
      modelOutputBody(validModelOutput()),
    ])
    const clock = fakeClock()
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: clock.clock,
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(fake.calls).toHaveLength(2)
    expect(clock.waits).toEqual([3_000])
    expect(result.result.status).toBe('ok')
    expect(result.result.retryCount).toBe(1)
    expect(result.traceMetadata.attemptCount).toBe(2)
  })

  it('retries 503/network failures at most once', async () => {
    const fake = queuedFetch([response(503, {}), new Error('network unavailable')])
    const clock = fakeClock()
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: clock.clock,
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(fake.calls).toHaveLength(2)
    expect(clock.waits).toEqual([250])
    expect(result.result).toMatchObject({
      status: 'unavailable',
      statusCode: null,
      retryable: true,
      retryCount: 1,
    })
    expect(result.traceMetadata.responseStatusClass).toBe('network')
  })

  it('classifies a timeout without exposing the provider payload', async () => {
    const clock = fakeClock()
    const fetcher: ProviderFetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted fixture')))
      })
    const result = await new SemanticInterpreter({
      apiKey: 'fixture-key',
      fetch: fetcher,
      clock: clock.clock,
      timeoutMs: 5,
      retry: { maxRetries: 0 },
    }).interpret({
      invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
      purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
    })

    expect(result.result).toMatchObject({
      status: 'unavailable',
      statusCode: null,
      retryable: true,
      retryCount: 0,
    })
    expect(result.traceMetadata.responseStatusClass).toBe('timeout')
    expect(JSON.stringify(result)).not.toContain('fixture-key')
    expect(JSON.stringify(result)).not.toContain('aborted fixture')
  })

  it.each([
    ['empty content', modelOutputBody(' ')],
    ['invalid JSON', modelOutputBody('{not-json')],
    ['invalid schema', modelOutputBody(JSON.stringify({ execute: 'approve' }))],
  ])(
    'retries %s and returns a stable invalid_output result when both attempts fail',
    async (_label, first) => {
      const fake = queuedFetch([first, first])
      const clock = fakeClock()
      const result = await new SemanticInterpreter({
        apiKey: 'fixture-key',
        fetch: fake.fetcher,
        clock: clock.clock,
      }).interpret({
        invoiceLines: [{ lineId: 'invoice-line:1', description: 'a', evidenceIds: [] }],
        purchaseOrderLines: [{ lineId: 'po-line:1', description: 'b', evidenceIds: [] }],
      })

      expect(fake.calls).toHaveLength(2)
      expect(clock.waits).toEqual([250])
      expect(result.result.status).toBe('invalid_output')
      expect(result.result.failureId).toMatch(/^[a-f0-9]{16}$/u)
      expect(result.result.retryCount).toBe(1)
      expect(result.result.modelOutput).toBeNull()
      expect(result.result.rawModelOutput).toBeUndefined()
    },
  )
})

describe('provider-mode workspace integration', () => {
  const temporaryDirectories: string[] = []
  const temporaryStores: WorkspaceStore[] = []

  afterEach(() => {
    for (const store of temporaryStores.splice(0)) store.close()
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  function serviceWithFakeProvider(): { service: WorkspaceService; calls: RequestInit[] } {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-provider-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
    store.open()
    temporaryStores.push(store)
    const fake = queuedFetch([modelOutputBody(validModelOutput())])
    const provider = new ProviderBoundary(store, directory, {
      apiKey: 'fixture-key',
      fetch: fake.fetcher,
      clock: fakeClock().clock,
    })
    return { service: new WorkspaceService(store, provider), calls: fake.calls }
  }

  function serviceWithoutProviderKey(): {
    service: WorkspaceService
    calls: RequestInit[]
  } {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-provider-no-key-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
    store.open()
    temporaryStores.push(store)
    const fake = queuedFetch([modelOutputBody(validModelOutput())])
    const provider = new ProviderBoundary(store, directory, {
      apiKey: '',
      loadFromEnvironment: false,
      fetch: fake.fetcher,
      clock: fakeClock().clock,
    })
    return { service: new WorkspaceService(store, provider), calls: fake.calls }
  }

  it('calls DeepSeek only for an ambiguous semantic provider run and keeps trace data sanitized', async () => {
    const { service, calls } = serviceWithFakeProvider()
    const result = await service.runScenario({
      scenarioId: 'semantic-match',
      mode: 'provider',
      providerResult: null,
      modelOutput: null,
      idempotencyKey: null,
    })

    expect(calls).toHaveLength(1)
    expect(result.workspace.policyDecision.outcome).toBe('clear')
    expect(result.providerCalls).toBe(1)
    const traceText = JSON.stringify(result.workspace.traceEvents)
    expect(traceText).toContain('semantic-interpreter')
    expect(traceText).toContain('costEstimateUsd')
    expect(traceText).not.toContain('fixture-key')
    expect(traceText).not.toContain('Fixture-backed PDF')
  })

  it('reports provider-unavailable in provider mode without a key and makes no fetch call', async () => {
    const { service, calls } = serviceWithoutProviderKey()
    const result = await service.runScenario({
      scenarioId: 'semantic-match',
      mode: 'provider',
      providerResult: null,
      modelOutput: null,
      idempotencyKey: null,
    })

    expect(calls).toHaveLength(0)
    expect(result.providerCalls).toBe(1)
    expect(result.failure?.kind).toBe('provider_unavailable')
    const traceText = JSON.stringify(result.workspace.traceEvents)
    expect(traceText).toContain('not-configured')
    expect(traceText).toContain('unavailable')
    expect(traceText).not.toContain('fixture-key')
  })

  it.each(['clean-match', 'price-mismatch', 'prompt-injection'] as const)(
    'does not call a provider for %s',
    async (scenarioId) => {
      const { service, calls } = serviceWithFakeProvider()
      const result = await service.runScenario({
        scenarioId,
        mode: 'provider',
        providerResult: null,
        modelOutput: null,
        idempotencyKey: null,
      })
      expect(calls).toHaveLength(0)
      if (scenarioId === 'prompt-injection')
        expect(result.workspace.workflow.status).toBe('blocked')
    },
  )
})
