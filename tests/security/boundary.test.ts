import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNEL_ALLOWLIST, IPC_CHANNELS } from '../../src/shared/api'
import { WorkspaceStore } from '../../src/main/persistence'
import { ProviderBoundary } from '../../src/main/provider'
import { redactError, redactSensitiveText, sanitizeProjection } from '../../src/main/redaction'
import { WorkspaceService } from '../../src/main/workspace'

const projectRoot = resolve(import.meta.dirname, '../..')

describe('secret and persistence redaction', () => {
  it('removes configured keys, bearer values, assignment values, and PEM blocks', () => {
    const configuredKey = 'fixture-deepseek-secret-value'
    const privateKey = [
      '-----BEGIN ',
      'PRIVATE KEY-----',
      '\n',
      'fixture-private-material',
      '\n',
      '-----END',
      ' PRIVATE KEY-----',
    ].join('')
    const value = [
      `Authorization: Bearer ${configuredKey}`,
      `${['api', '_key'].join('')}=${configuredKey}`,
      privateKey,
    ].join(' ')
    const redacted = redactSensitiveText(value, [configuredKey])

    expect(redacted).not.toContain(configuredKey)
    expect(redacted).not.toContain('fixture-private-material')
    expect(redacted).toContain('[redacted]')
  })

  it('sanitizes nested projections and error messages before persistence or IPC', () => {
    const configuredKey = 'fixture-deepseek-secret-value'
    const projection = sanitizeProjection(
      {
        [['auth', 'orization'].join('')]: configuredKey,
        nested: { note: `Bearer ${configuredKey}` },
        ordinary: configuredKey,
      },
      0,
      new WeakSet<object>(),
      [configuredKey],
    ) as Record<string, unknown>
    expect(JSON.stringify(projection)).not.toContain(configuredKey)

    const error = redactError(new Error(`request failed: Bearer ${configuredKey}`), configuredKey)
    expect(JSON.stringify(error)).not.toContain(configuredKey)
    expect(error.failureId).toMatch(/^[a-f0-9]{16}$/u)
  })

  it('registers configured secrets with the main-owned local store projection boundary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-redaction-'))
    try {
      const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
      store.open()
      store.registerRedactionSecret('fixture-deepseek-secret-value')
      await store.write('diagnostic', 'fixture', {
        message: 'fixture-deepseek-secret-value',
        [['auth', 'orization'].join('')]: 'fixture-deepseek-secret-value',
      })
      const stored = store.read('diagnostic', 'fixture')
      expect(JSON.stringify(stored?.projection)).not.toContain('fixture-deepseek-secret-value')
      store.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses the configured main-process key when projecting IPC errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-error-redaction-'))
    try {
      const configuredKey = 'fixture-deepseek-secret-value'
      const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
      store.open()
      const provider = new ProviderBoundary(store, directory, {
        apiKey: configuredKey,
        loadFromEnvironment: false,
      })
      const service = new WorkspaceService(store, provider)
      const projected = service.failureProjection(
        new Error(`provider rejected Bearer ${configuredKey}`),
      )
      expect(JSON.stringify(projected)).not.toContain(configuredKey)
      store.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('IPC and Electron security boundaries', () => {
  it('keeps the IPC surface explicitly allowlisted', () => {
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(9)
    expect(IPC_CHANNEL_ALLOWLIST).toEqual(Object.values(IPC_CHANNELS))
    expect(new Set(IPC_CHANNEL_ALLOWLIST).size).toBe(IPC_CHANNEL_ALLOWLIST.length)
  })

  it('exposes only the typed supplierOps bridge and hardened BrowserWindow settings', () => {
    const preload = readFileSync(join(projectRoot, 'src/preload/index.ts'), 'utf8')
    const preloadErrors = readFileSync(join(projectRoot, 'src/preload/errors.ts'), 'utf8')
    const main = readFileSync(join(projectRoot, 'src/main/index.ts'), 'utf8')
    const ipc = readFileSync(join(projectRoot, 'src/main/ipc.ts'), 'utf8')

    expect(preload).toContain("contextBridge.exposeInMainWorld('supplierOps'")
    expect(preload).not.toContain("exposeInMainWorld('ipcRenderer'")
    expect(preload).not.toContain('process.env')
    expect(preload).not.toContain('node:fs')
    expect(preload).toContain('unwrapErrorEnvelope')
    expect(preloadErrors).toContain('SupplierOpsIpcError')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('sandbox: true')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('requestSingleInstanceLock')
    expect(main).toContain("on('second-instance'")
    expect(main).toContain('mainWindow.focus()')
    expect(main).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(main).toContain("on('will-frame-navigate'")
    expect(main).toContain('setPermissionRequestHandler')
    expect(ipc).toContain('parseApiInput(operation, input)')
    expect(ipc).toContain('parseApiOutput(operation, output)')
    expect(ipc).toContain('event.sender.mainFrame')
  })

  it('keeps source packet chooser output bounded and path-free', () => {
    const ipc = readFileSync(join(projectRoot, 'src/main/ipc.ts'), 'utf8')
    expect(ipc).toContain('MAX_SOURCE_PACKET_BYTES')
    expect(ipc).toContain('MAX_SOURCE_PACKET_PREVIEW_CHARS')
    expect(ipc).toContain('MAX_SOURCE_PACKET_FILES')
    expect(ipc).toContain('MAX_SOURCE_PACKET_TOTAL_BYTES')
    expect(ipc).toContain("'multiSelections'")
    expect(ipc).toContain('SUPPORTED_SOURCE_EXTENSIONS')
    expect(ipc).toContain('statSync(filePath)')
    expect(ipc).toContain('fileName,')
    expect(ipc).toContain('byteSize: stats.size')
    expect(ipc).not.toContain('path: filePath')
  })
})
