import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED_ENV_KEY = 'DEEPSEEK_API_KEY'

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Load the provider secret at the main-process boundary. Only the explicit
 * allowlisted key is read; arbitrary .env values never cross into the app.
 */
export function loadDeepSeekApiKey(appPath: string): string | undefined {
  const processValue = process.env[ALLOWED_ENV_KEY]?.trim()
  if (processValue) return processValue

  const localEnvPath = join(appPath, '.env.local')
  if (!existsSync(localEnvPath)) return undefined

  let contents: string
  try {
    contents = readFileSync(localEnvPath, 'utf8')
  } catch {
    return undefined
  }

  for (const line of contents.split(/\r?\n/u)) {
    const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.*?)\s*(?:#.*)?$/u.exec(line)
    if (!match?.[1]) continue
    const value = unquote(match[1])
    if (value) return value
  }

  return undefined
}
