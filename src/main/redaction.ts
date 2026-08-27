import { createHash } from 'node:crypto'

const MAX_STRING_LENGTH = 4_096
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 100
const MAX_DEPTH = 8
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|credential|authorization|cookie)/i

/**
 * Keep diagnostics useful without allowing untrusted documents or secrets to
 * become persistent logs. This is deliberately a projection, not a clone.
 */
export function sanitizeProjection(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > MAX_DEPTH) return '[depth limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number.isSafeInteger(value) ? Number(value) : '[bigint]'
  if (typeof value !== 'object') return `[${typeof value}]`

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeProjection(item, depth + 1, seen))
  }

  const projection: Record<string, unknown> = {}
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
  for (const [key, item] of entries) {
    if (SECRET_KEY_PATTERN.test(key)) {
      projection[key] = '[redacted]'
      continue
    }
    projection[key.slice(0, 128)] = sanitizeProjection(item, depth + 1, seen)
  }
  return projection
}

export function serializeProjection(value: unknown, maxBytes: number): string {
  const serialized = JSON.stringify(sanitizeProjection(value))
  if (serialized === undefined) return 'null'
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized

  return JSON.stringify({
    truncated: true,
    reason: 'projection-size-limit',
    preview: serialized.slice(0, Math.max(0, maxBytes - 128)),
  })
}

export function redactError(error: unknown): { name: string; message: string; failureId: string } {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message.slice(0, 512) : 'Unexpected error'
  const failureId = stableFailureId(name, message)
  return { name, message, failureId }
}

/** Stable enough to correlate a failure across a replay without storing payloads. */
export function stableFailureId(code: string, detail: string): string {
  return createHash('sha256').update(`${code}\u0000${detail}`).digest('hex').slice(0, 16)
}
