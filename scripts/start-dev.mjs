import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = resolve(scriptDirectory, '..')
const MAX_EXECUTABLE_PATH_LENGTH = 512

const defaultFileSystem = {
  existsSync,
  readFileSync,
  statSync,
  accessSync,
}

function isRegularFile(filePath, fileSystem) {
  try {
    return fileSystem.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isDirectory(directoryPath, fileSystem) {
  try {
    return fileSystem.statSync(directoryPath).isDirectory()
  } catch {
    return false
  }
}

function electronPaths(projectRoot) {
  const packageDirectory = resolve(projectRoot, 'node_modules/electron')
  return {
    packageDirectory,
    packageJson: join(packageDirectory, 'package.json'),
    installScript: join(packageDirectory, 'install.js'),
    pathFile: join(packageDirectory, 'path.txt'),
    distributionDirectory: join(packageDirectory, 'dist'),
  }
}

function invalidExecutable(reason) {
  return {
    status: 'invalid-executable',
    reason,
  }
}

function validateExecutablePath(rawPath, distributionDirectory) {
  if (
    rawPath.length === 0 ||
    rawPath.length > MAX_EXECUTABLE_PATH_LENGTH ||
    rawPath.includes('\0') ||
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath)
  ) {
    return invalidExecutable('Electron path.txt does not contain a bounded relative path.')
  }

  // Electron writes POSIX separators on macOS/Linux and Windows separators on
  // Windows. Normalize both forms before applying the containment check so a
  // damaged path.txt can never make this bootstrap resolve outside dist/.
  const normalizedPath = rawPath.replaceAll('\\', '/')
  const executablePath = resolve(distributionDirectory, normalizedPath)
  const relativePath = relative(distributionDirectory, executablePath)
  if (relativePath.length === 0 || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    return invalidExecutable('Electron path.txt resolves outside the local Electron distribution.')
  }

  return { status: 'candidate', executablePath }
}

export function inspectElectronInstall(projectRoot, fileSystem = defaultFileSystem) {
  const paths = electronPaths(projectRoot)
  if (
    !isRegularFile(paths.packageJson, fileSystem) ||
    !isRegularFile(paths.installScript, fileSystem)
  ) {
    return {
      status: 'missing-package',
      paths,
      reason: 'The local Electron package or its official installer is missing.',
    }
  }

  if (!isRegularFile(paths.pathFile, fileSystem)) {
    return {
      status: 'needs-repair',
      paths,
      reason: 'Electron path.txt is missing.',
    }
  }

  let rawPath
  try {
    rawPath = fileSystem.readFileSync(paths.pathFile, 'utf8').trim()
  } catch {
    return invalidExecutable('Electron path.txt could not be read.')
  }

  const candidate = validateExecutablePath(rawPath, paths.distributionDirectory)
  if (candidate.status === 'invalid-executable') {
    return { ...candidate, paths }
  }
  if (!isDirectory(paths.distributionDirectory, fileSystem)) {
    return {
      status: 'needs-repair',
      paths,
      reason: 'The Electron distribution directory is missing.',
    }
  }
  if (!isRegularFile(candidate.executablePath, fileSystem)) {
    return {
      status: 'needs-repair',
      paths,
      reason: 'The Electron executable is missing from the distribution.',
      executablePath: candidate.executablePath,
    }
  }

  if (process.platform !== 'win32') {
    try {
      fileSystem.accessSync(candidate.executablePath, fsConstants.X_OK)
    } catch {
      return {
        ...invalidExecutable('The Electron executable exists but is not executable.'),
        paths,
        executablePath: candidate.executablePath,
      }
    }
  }

  return {
    status: 'ready',
    paths,
    executablePath: candidate.executablePath,
  }
}

function missingPackageError(projectRoot, reason) {
  return new Error(
    `[supplierops] Electron package is missing or incomplete: ${reason}\n` +
      `Run "npm ci" (or "npm install") in ${projectRoot}, then retry "npm run dev".`,
  )
}

function invalidExecutableError(projectRoot, reason) {
  return new Error(
    `[supplierops] Installed Electron executable is invalid: ${reason}\n` +
      `Run "npm ci" (or "npm install") in ${projectRoot} to restore the verified distribution, then retry "npm run dev".`,
  )
}

function repairFailureError(projectRoot, reason) {
  return new Error(
    `[supplierops] Electron repair/download failed: ${reason}\n` +
      `Retry "npm run dev" with network access. If it still fails, run "npm ci" in ${projectRoot} and retry.`,
  )
}

export function ensureElectronReady(projectRoot = defaultProjectRoot, overrides = {}) {
  const fileSystem = overrides.fileSystem ?? defaultFileSystem
  const runInstaller = overrides.runInstaller ?? spawnSync
  const initial = inspectElectronInstall(projectRoot, fileSystem)

  if (initial.status === 'ready') return initial
  if (initial.status === 'missing-package') {
    throw missingPackageError(projectRoot, initial.reason)
  }
  if (initial.status === 'invalid-executable') {
    throw invalidExecutableError(projectRoot, initial.reason)
  }

  const installerResult = (() => {
    try {
      return runInstaller(process.execPath, [initial.paths.installScript], {
        cwd: projectRoot,
        stdio: 'inherit',
      })
    } catch {
      return { status: null }
    }
  })()
  if (!installerResult || installerResult.error || installerResult.status !== 0) {
    throw repairFailureError(projectRoot, initial.reason)
  }

  const repaired = inspectElectronInstall(projectRoot, fileSystem)
  if (repaired.status === 'ready') return repaired
  if (repaired.status === 'invalid-executable') {
    throw invalidExecutableError(projectRoot, repaired.reason)
  }
  if (repaired.status === 'missing-package') {
    throw repairFailureError(
      projectRoot,
      'The official installer did not restore the Electron package.',
    )
  }
  throw repairFailureError(projectRoot, repaired.reason)
}

function startError(error) {
  return error instanceof Error ? error.message : 'Electron development startup failed.'
}

function localElectronViteCli(projectRoot) {
  const cliPath = resolve(projectRoot, 'node_modules/electron-vite/bin/electron-vite.js')
  if (!existsSync(cliPath)) {
    throw missingPackageError(projectRoot, 'The local electron-vite package is missing.')
  }
  return cliPath
}

export function runDev(args = process.argv.slice(2), projectRoot = defaultProjectRoot) {
  if (args.includes('--ensure-only')) {
    throw new Error('--ensure-only is only valid as a standalone Electron preflight command.')
  }
  ensureElectronReady(projectRoot)
  const cliPath = localElectronViteCli(projectRoot)
  const child = spawn(process.execPath, [cliPath, 'dev', ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  })

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal)
  }
  process.once('SIGINT', forwardSignal)
  process.once('SIGTERM', forwardSignal)

  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      process.removeListener('SIGINT', forwardSignal)
      process.removeListener('SIGTERM', forwardSignal)
    }
    child.once('error', (error) => {
      cleanup()
      rejectPromise(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolvePromise(signal ? 1 : (code ?? 1))
    })
  })
}

export function ensureOnlyRequested(args = process.argv.slice(2)) {
  return args.includes('--ensure-only')
}

function isDirectInvocation() {
  const entryPoint = process.argv[1]
  return Boolean(entryPoint && pathToFileURL(resolve(entryPoint)).href === import.meta.url)
}

if (isDirectInvocation()) {
  try {
    const args = process.argv.slice(2)
    if (ensureOnlyRequested(args)) {
      if (args.length !== 1) {
        throw new Error(
          '--ensure-only must be the only argument to the Electron preflight command.',
        )
      }
      ensureElectronReady()
      console.log('[supplierops] Electron preflight passed; local distribution is ready.')
    } else {
      process.exitCode = await runDev(args)
    }
  } catch (error) {
    console.error(startError(error))
    process.exitCode = 1
  }
}
