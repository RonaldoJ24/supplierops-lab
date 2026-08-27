import { describe, expect, it } from 'vitest'
import { unwrapErrorEnvelope } from '../../src/preload/errors'

describe('preload IPC error handling', () => {
  it('turns the narrow main-process error envelope into a bounded detectable error', () => {
    let thrown: unknown
    try {
      unwrapErrorEnvelope({
        error: {
          name: 'ProviderError',
          message: 'A bounded diagnostic message',
          failureId: 'failure:1234',
          payload: 'must not cross the boundary',
          stack: 'must not cross the boundary',
        },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      name: 'ProviderError',
      message: 'A bounded diagnostic message',
      failureId: 'failure:1234',
    })
    expect(JSON.stringify(thrown)).not.toContain('must not cross the boundary')
  })

  it('rejects malformed envelopes with a stable generic failure', () => {
    expect(() => unwrapErrorEnvelope({ error: { message: 'raw payload' } })).toThrow(
      'The main process returned an invalid error.',
    )
  })
})
