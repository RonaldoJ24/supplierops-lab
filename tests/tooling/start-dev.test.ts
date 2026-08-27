import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureElectronReady,
  ensureOnlyRequested,
  inspectElectronInstall,
} from '../../scripts/start-dev.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function createFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'supplierops-dev-bootstrap-'))
  temporaryDirectories.push(projectRoot)
  const electronDirectory = join(projectRoot, 'node_modules/electron')
  mkdirSync(electronDirectory, { recursive: true })
  writeFileSync(join(electronDirectory, 'package.json'), '{"name":"electron","version":"42.8.0"}\n')
  writeFileSync(join(electronDirectory, 'install.js'), '// fixture installer\n')
  return { projectRoot, electronDirectory }
}

function installFixtureExecutable(electronDirectory: string, executablePath = 'electron') {
  const distributionDirectory = join(electronDirectory, 'dist')
  const executable = join(distributionDirectory, executablePath)
  mkdirSync(distributionDirectory, { recursive: true })
  writeFileSync(join(electronDirectory, 'path.txt'), `${executablePath}\n`)
  mkdirSync(join(executable, '..'), { recursive: true })
  writeFileSync(executable, 'fixture executable\n')
  chmodSync(executable, 0o755)
}

describe('npm dev Electron preflight', () => {
  it('recognizes the ensure-only flag for standalone preflight dispatch', () => {
    expect(ensureOnlyRequested(['--ensure-only'])).toBe(true)
    expect(ensureOnlyRequested([])).toBe(false)
    expect(ensureOnlyRequested(['--ensure-only', '--mode', 'development'])).toBe(true)
  })

  it('takes the fast path for a complete local distribution', () => {
    const fixture = createFixture()
    installFixtureExecutable(fixture.electronDirectory)
    let installerCalls = 0

    const result = ensureElectronReady(fixture.projectRoot, {
      runInstaller: () => {
        installerCalls += 1
        return { status: 0 }
      },
    })

    expect(result.status).toBe('ready')
    expect(installerCalls).toBe(0)
    expect(inspectElectronInstall(fixture.projectRoot).status).toBe('ready')
  })

  it('invokes only the local official installer when the distribution is incomplete', () => {
    const fixture = createFixture()
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []

    const result = ensureElectronReady(fixture.projectRoot, {
      runInstaller: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd })
        installFixtureExecutable(fixture.electronDirectory)
        return { status: 0 }
      },
    })

    expect(result.status).toBe('ready')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe(process.execPath)
    expect(calls[0]?.args).toEqual([join(fixture.electronDirectory, 'install.js')])
    expect(calls[0]?.cwd).toBe(fixture.projectRoot)
  })

  it('reports a failed repair with exact local remediation', () => {
    const fixture = createFixture()

    expect(() =>
      ensureElectronReady(fixture.projectRoot, {
        runInstaller: () => ({ status: 1 }),
      }),
    ).toThrow(/Electron repair\/download failed[\s\S]*npm run dev[\s\S]*npm ci/iu)
  })

  it('reports an invalid executable path without invoking a repair', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.electronDirectory, 'path.txt'), '../outside\n')
    let installerCalls = 0

    expect(() =>
      ensureElectronReady(fixture.projectRoot, {
        runInstaller: () => {
          installerCalls += 1
          return { status: 0 }
        },
      }),
    ).toThrow(/installed Electron executable is invalid[\s\S]*npm ci/iu)
    expect(installerCalls).toBe(0)
  })

  it('distinguishes a missing Electron package from repair failures', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'supplierops-dev-bootstrap-empty-'))
    temporaryDirectories.push(projectRoot)

    expect(() => ensureElectronReady(projectRoot)).toThrow(
      /Electron package is missing or incomplete[\s\S]*npm ci/iu,
    )
  })
})
