/**
 * Small deterministic, browser-safe identity helpers. These are not intended
 * as cryptographic hashes; they provide stable correlation IDs for replay and
 * idempotency while keeping the shared package free of Node dependencies.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN'
    if (value === Infinity) return 'number:Infinity'
    if (value === -Infinity) return 'number:-Infinity'
    return `number:${String(value)}`
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return `bigint:${String(value)}`
  if (typeof value === 'function') return 'function'
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`
  }
  return String(value)
}

export function hashString(value: string): string {
  // FNV-1a in a 32-bit lane. Math.imul works identically in browser and Node.
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function stableId(prefix: string, ...parts: readonly unknown[]): string {
  return `${prefix}:${hashString(parts.map((part) => canonicalize(part)).join('|'))}`
}

export function stableFingerprint(value: unknown): string {
  return stableId('fp', value)
}
