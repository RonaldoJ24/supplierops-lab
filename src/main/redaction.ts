import { createHash } from 'node:crypto'

const MAX_STRING_LENGTH = 4_096
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 100
const MAX_DEPTH = 8
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|credential|authorization|cookie)/i
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu
const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu
const ASSIGNED_SECRET_PATTERN =
  /((?:api[_-]?key|secret|token|password|credential|authorization)\s*[:=]\s*)(["']?)[^\s"',;}\]]+/giu
const QUERY_SECRET_PATTERN = /([?&](?:api[_-]?key|secret|token|password)=)[^&\s]+/giu
const TOKEN_LIKE_PATTERN = /\b(?:sk|ds|key)[_-][A-Za-z0-9_-]{8,}\b/giu

const REDACTED = '[redacted]'

/** Redact common credential representations before a value can cross a boundary. */
export function redactSensitiveText(value: string, secrets: readonly string[] = []): string {
  let redacted = value
    .replace(PEM_PRIVATE_KEY_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(ASSIGNED_SECRET_PATTERN, `$1$2${REDACTED}`)
    .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`)
    .replace(TOKEN_LIKE_PATTERN, REDACTED)
  for (const secret of secrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join(REDACTED)
  }
  return redacted
}

function normalizedSecrets(secrets: readonly string[] | string | undefined): readonly string[] {
  if (secrets === undefined) return []
  return (Array.isArray(secrets) ? secrets : [secrets]).filter(
    (secret): secret is string => typeof secret === 'string' && secret.length >= 4,
  )
}

/**
 * Keep diagnostics useful without allowing untrusted documents or secrets to
 * become persistent logs. This is deliberately a projection, not a clone.
 */
export function sanitizeProjection(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  secrets: readonly string[] = [],
): unknown {
  if (depth > MAX_DEPTH) return '[depth limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return redactSensitiveText(value, secrets).slice(0, MAX_STRING_LENGTH)
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number.isSafeInteger(value) ? Number(value) : '[bigint]'
  if (typeof value !== 'object') return `[${typeof value}]`

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeProjection(item, depth + 1, seen, secrets))
  }

  const projection: Record<string, unknown> = {}
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
  for (const [key, item] of entries) {
    if (SECRET_KEY_PATTERN.test(key)) {
      projection[key] = '[redacted]'
      continue
    }
    projection[key.slice(0, 128)] = sanitizeProjection(item, depth + 1, seen, secrets)
  }
  return projection
}

export function serializeProjection(
  value: unknown,
  maxBytes: number,
  secrets: readonly string[] = [],
): string {
  const serialized = JSON.stringify(sanitizeProjection(value, 0, new WeakSet<object>(), secrets))
  if (serialized === undefined) return 'null'
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized

  return JSON.stringify({
    truncated: true,
    reason: 'projection-size-limit',
    preview: serialized.slice(0, Math.max(0, maxBytes - 128)),
  })
}

export function redactError(
  error: unknown,
  secrets: readonly string[] | string = [],
): { name: string; message: string; failureId: string } {
  const configuredSecrets = normalizedSecrets(secrets)
  const name = redactSensitiveText(
    error instanceof Error ? error.name : 'Error',
    configuredSecrets,
  ).slice(0, 128)
  const message = redactSensitiveText(
    error instanceof Error ? error.message : 'Unexpected error',
    configuredSecrets,
  ).slice(0, 512)
  const failureId = stableFailureId(name, message)
  return { name, message, failureId }
}

/** Stable enough to correlate a failure across a replay without storing payloads. */
export function stableFailureId(code: string, detail: string): string {
  return createHash('sha256').update(`${code}\u0000${detail}`).digest('hex').slice(0, 16)
}
