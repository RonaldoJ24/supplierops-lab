import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const issues = []

function gitFiles(args) {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

function isEnvFile(filePath) {
  const fileName = basename(filePath)
  return fileName === '.env' || fileName.startsWith('.env.')
}

function displayPath(filePath) {
  return relative(projectRoot, filePath) || filePath
}

function addIssue(filePath, label) {
  issues.push({ path: displayPath(filePath), label })
}

function checkLocalEnvIsIgnored() {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', '--', '.env.local'], {
      cwd: projectRoot,
      stdio: 'ignore',
    })
  } catch {
    addIssue(join(projectRoot, '.env.local'), 'the local env filename is not ignored')
  }
}

function readTextIfSafe(filePath) {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size > 4 * 1024 * 1024) return undefined
    const content = readFileSync(filePath)
    if (content.includes(0)) return undefined
    return content.toString('utf8')
  } catch {
    return undefined
  }
}

const credentialPatterns = [
  { label: 'private-key material', pattern: /-----BEGIN [^-\r\n]*PRIVATE KEY-----/iu },
  { label: 'bearer token literal', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/u },
  {
    label: 'credential-like assignment',
    pattern:
      /\b(?:api[_-]?key|secret|token|password|credential|authorization)\s*[:=]\s*(?:"[A-Za-z0-9_./+=:-]{12,}"|'[A-Za-z0-9_./+=:-]{12,}'|`[A-Za-z0-9_./+=:-]{12,}`)/iu,
  },
]

const rendererPatterns = [
  { label: 'DEEPSEEK_API_KEY in renderer boundary', pattern: /\bDEEPSEEK_API_KEY\b/u },
  {
    label: 'authorization or bearer pattern in renderer boundary',
    pattern: /\b(?:authorization|auth)\s*[:=]\s*|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  },
  {
    label: 'private-key material in renderer boundary',
    pattern: /-----BEGIN [^-\r\n]*PRIVATE KEY-----/iu,
  },
]

function scanFile(filePath, patterns) {
  const text = readTextIfSafe(filePath)
  if (text === undefined) return
  for (const { label, pattern } of patterns) {
    if (pattern.test(text)) addIssue(filePath, label)
  }
}

function scanTree(directory, patterns) {
  let stats
  try {
    stats = statSync(directory)
  } catch {
    return
  }
  if (stats.isFile()) {
    scanFile(directory, patterns)
    return
  }
  if (!stats.isDirectory()) return
  for (const entry of readdirSync(directory)) scanTree(join(directory, entry), patterns)
}

checkLocalEnvIsIgnored()

const trackedFiles = gitFiles(['ls-files', '-z'])
for (const filePath of trackedFiles) {
  if (isEnvFile(filePath) && filePath !== '.env.example') {
    addIssue(
      join(projectRoot, filePath),
      'environment file is tracked (only .env.example is allowed)',
    )
  }
}

const projectFiles = gitFiles(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
for (const filePath of projectFiles) {
  if (filePath === '.env.example' || isEnvFile(filePath)) continue
  scanFile(join(projectRoot, filePath), credentialPatterns)
}

for (const rendererRoot of ['src/renderer', 'out/renderer']) {
  const absoluteRoot = join(projectRoot, rendererRoot)
  if (!existsSync(absoluteRoot)) continue
  const rendererFiles = gitFiles([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    rendererRoot,
  ])
  for (const filePath of rendererFiles) scanFile(join(projectRoot, filePath), rendererPatterns)
  if (rendererRoot === 'out/renderer') {
    // Build output is ignored, so inspect its files without adding them to Git's file list.
    scanTree(absoluteRoot, rendererPatterns)
  }
}

if (issues.length > 0) {
  console.error('Secret verification failed:')
  for (const issue of issues) console.error(`- ${issue.path}: ${issue.label}`)
  process.exitCode = 1
} else {
  console.log(
    'Secret verification passed: local env is ignored and renderer/project boundaries are clean.',
  )
}
