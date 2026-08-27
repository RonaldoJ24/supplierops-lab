import { loadDeepSeekApiKey } from './env'
import { redactError, stableFailureId } from './redaction'
import type { WorkspaceStore } from './persistence'
import type { ProviderMode } from '../shared/domain'

export interface ProviderBoundaryStatus {
  mode: ProviderMode
  configured: boolean
  implementation: 'scaffold'
  aiCallEnabled: false
  submissionAdapter: 'mock'
}

export interface SubmissionResult {
  status: 'submitted' | 'already-submitted' | 'failed'
  adapter: 'mock'
  idempotencyKey: string
  submissionId?: string
  failureId?: string
  replayable: boolean
}

type PayloadRecord = Record<string, unknown>

function asRecord(value: unknown): PayloadRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PayloadRecord)
    : {}
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback
}

/** Provider boundary used by the first checkpoint. It intentionally makes no network calls. */
export class ProviderBoundary {
  private readonly deepSeekApiKey: string | undefined

  public constructor(
    private readonly store: WorkspaceStore,
    appPath: string,
  ) {
    this.deepSeekApiKey = loadDeepSeekApiKey(appPath)
  }

  public status(mode: ProviderMode = 'offline'): ProviderBoundaryStatus {
    return {
      mode,
      configured: Boolean(this.deepSeekApiKey),
      implementation: 'scaffold',
      aiCallEnabled: false,
      submissionAdapter: 'mock',
    }
  }

  public runScenario(input: unknown, mode: ProviderMode): Record<string, unknown> {
    const request = asRecord(input)
    return {
      status: 'scaffold',
      mode,
      provider: this.status(mode),
      // Preserve only a bounded diagnostic shape; scenario contents remain untrusted.
      scenarioId: readString(request.scenarioId, 'unspecified'),
      message:
        mode === 'provider'
          ? 'Provider boundary is configured but the real AI call is not enabled in this checkpoint.'
          : 'Offline scenario execution is available through the local scaffold.',
    }
  }

  public submitMock(input: unknown): Promise<SubmissionResult> {
    const request = asRecord(input)
    const idempotencyKey = readString(request.idempotencyKey, '')
    if (!idempotencyKey) {
      return Promise.reject(new Error('An idempotency key is required'))
    }

    const existing = this.store.read('submission', idempotencyKey)
    if (existing) {
      const projection = asRecord(existing.projection)
      return Promise.resolve({
        status: 'already-submitted',
        adapter: 'mock',
        idempotencyKey,
        submissionId: readString(projection.submissionId, `mock-${idempotencyKey}`),
        replayable: false,
      })
    }

    const shouldFail = request.simulateFailure === true || request.forceFailure === true
    if (shouldFail) {
      const failureId = stableFailureId('mock-submit', idempotencyKey)
      const result: SubmissionResult = {
        status: 'failed',
        adapter: 'mock',
        idempotencyKey,
        failureId,
        replayable: true,
      }
      return this.store.write('submission-failure', failureId, result).then(() => result)
    }

    const submissionId = `mock-${stableFailureId('mock-submission', idempotencyKey)}`
    const result: SubmissionResult = {
      status: 'submitted',
      adapter: 'mock',
      idempotencyKey,
      submissionId,
      replayable: false,
    }
    return this.store.write('submission', idempotencyKey, result).then(() => result)
  }

  public replayFailure(
    input: unknown,
  ): Promise<SubmissionResult | { status: 'not-found'; failureId: string }> {
    const request = asRecord(input)
    const failureId = readString(request.failureId, '')
    if (!failureId) return Promise.reject(new Error('A failure id is required'))

    const failure = this.store.read('submission-failure', failureId)
    if (!failure) return Promise.resolve({ status: 'not-found', failureId })

    const projection = asRecord(failure.projection)
    const idempotencyKey = readString(projection.idempotencyKey, '')
    if (!idempotencyKey) return Promise.reject(new Error('Stored failure has no idempotency key'))

    return this.store
      .write('submission', idempotencyKey, {
        status: 'submitted',
        adapter: 'mock',
        idempotencyKey,
        submissionId: `mock-${stableFailureId('mock-submission', idempotencyKey)}`,
        replayable: false,
        replayedFromFailureId: failureId,
      })
      .then(() => ({
        status: 'submitted' as const,
        adapter: 'mock' as const,
        idempotencyKey,
        submissionId: `mock-${stableFailureId('mock-submission', idempotencyKey)}`,
        replayable: false,
      }))
  }

  public failureProjection(error: unknown): Record<string, string> {
    return redactError(error)
  }
}
