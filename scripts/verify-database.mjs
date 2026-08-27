import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const outputDirectory = mkdtempSync(join(projectRoot, 'node_modules/.supplierops-db-verify-'))
const typescript = resolve(projectRoot, 'node_modules/.bin/tsc')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sharedFiles = readdirSync(resolve(projectRoot, 'src/shared'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => `src/shared/${name}`)
const mainFiles = [
  'src/main/constants.ts',
  'src/main/env.ts',
  'src/main/persistence.ts',
  'src/main/provider.ts',
  'src/main/redaction.ts',
  'src/main/workspace.ts',
]

try {
  assert(existsSync(typescript), 'TypeScript compiler is not installed.')
  writeFileSync(join(outputDirectory, 'package.json'), '{"type":"commonjs"}\n')

  const compilation = spawnSync(
    typescript,
    [
      '--ignoreConfig',
      ...sharedFiles,
      ...mainFiles,
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--target',
      'es2023',
      '--types',
      'node',
      '--outDir',
      outputDirectory,
      '--skipLibCheck',
      '--esModuleInterop',
      '--ignoreDeprecations',
      '6.0',
      '--noEmit',
      'false',
    ],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  if (compilation.status !== 0) {
    throw new Error(
      compilation.stderr || compilation.stdout || 'Database verification compilation failed.',
    )
  }

  const require = createRequire(import.meta.url)
  const { WorkspaceStore } = require(join(outputDirectory, 'main/persistence.js'))
  const { ProviderBoundary } = require(join(outputDirectory, 'main/provider.js'))
  const { WorkspaceService } = require(join(outputDirectory, 'main/workspace.js'))
  const store = new WorkspaceStore(':memory:')
  store.open()

  try {
    const service = new WorkspaceService(store, new ProviderBoundary(store, outputDirectory))
    const bootstrap = service.bootstrap({})
    assert(bootstrap.schemaVersion === '1', 'Versioned workspace schema was not initialized.')
    const loaded = await service.loadScenario({ scenarioId: 'price-mismatch' })
    assert(loaded.workflow.phase === 'reconciled', 'Scenario workspace did not persist.')
    const draft = await service.createCorrectionDraft({
      caseId: loaded.caseMetadata.caseId,
      idempotencyKey: 'idempotency:verify-draft',
      at: '2025-01-15T10:00:00.000Z',
    })
    const approved = await service.approveDraft({
      caseId: loaded.caseMetadata.caseId,
      draftId: draft.draft.draftId,
      approvedBy: 'operator:verify',
      note: null,
      at: '2025-01-15T10:00:00.000Z',
      idempotencyKey: 'idempotency:verify-approval',
    })
    const submitted = await service.submitDraft({
      caseId: loaded.caseMetadata.caseId,
      draftId: approved.approval.draftId,
      idempotencyKey: 'idempotency:verify-submit',
      at: '2025-01-15T10:00:00.000Z',
    })
    const repeated = await service.submitDraft({
      caseId: loaded.caseMetadata.caseId,
      draftId: approved.approval.draftId,
      idempotencyKey: 'idempotency:verify-submit',
      at: '2025-01-15T10:00:00.000Z',
    })
    assert(
      submitted.execution.providerReference?.startsWith('mock-'),
      'Mock adapter did not return a reference.',
    )
    assert(
      repeated.execution.executionId === submitted.execution.executionId,
      'Submission idempotency was not preserved.',
    )
    console.log(
      'Database verification passed: schema, persisted workspace, approval gate, and idempotent mock submission.',
    )
  } finally {
    store.close()
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true })
}
