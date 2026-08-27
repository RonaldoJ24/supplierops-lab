export class SupplierOpsIpcError extends Error {
  public readonly failureId: string

  public constructor(name: string, message: string, failureId: string) {
    super(message)
    this.name = name
    this.failureId = failureId
  }
}

/** Convert the main-process error envelope into a renderer-detectable rejection. */
export function unwrapErrorEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const envelope = value as { error?: unknown }
  if (envelope.error === null || typeof envelope.error !== 'object') return value
  const error = envelope.error as Record<string, unknown>
  if (
    typeof error.name !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.failureId !== 'string'
  ) {
    throw new SupplierOpsIpcError(
      'IpcError',
      'The main process returned an invalid error.',
      'ipc-error',
    )
  }
  throw new SupplierOpsIpcError(
    error.name.slice(0, 80),
    error.message.slice(0, 500),
    error.failureId.slice(0, 80),
  )
}
