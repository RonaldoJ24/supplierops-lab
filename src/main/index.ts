import {
  app,
  BrowserWindow,
  net,
  protocol,
  session,
  type OnHeadersReceivedListenerDetails,
} from 'electron'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { APP_ENTRYPOINT, APP_HOST, APP_PROTOCOL } from './constants'
import { registerIpcHandlers } from './ipc'
import { WorkspaceStore } from './persistence'
import { ProviderBoundary } from './provider'
import { redactError } from './redaction'
import { WorkspaceService } from './workspace'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (hasSingleInstanceLock) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

let mainWindow: BrowserWindow | null = null
let workspaceStore: WorkspaceStore | undefined
let unregisterIpc: (() => void) | undefined

function isLoopbackRendererUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

/** E2E may provide an isolated temporary profile; production ignores this hook. */
function configureTestUserDataDirectory(): void {
  const candidate = process.env.SUPPLIEROPS_E2E_USER_DATA
  if (process.env.NODE_ENV !== 'test' || !candidate || !isAbsolute(candidate)) return
  app.setPath('userData', candidate)
}

function providerOptionsForRuntime(): { loadFromEnvironment: boolean } {
  return { loadFromEnvironment: process.env.NODE_ENV !== 'test' }
}

function rendererOutputDirectory(): string {
  const candidates = [
    resolve(app.getAppPath(), 'out/renderer'),
    resolve(currentDirectory, '../renderer'),
  ]
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    resolve(currentDirectory, '../renderer')
  )
}

function resolveRendererAsset(pathname: string): string | undefined {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return undefined
  }

  const requestedPath =
    decodedPath === '/' || decodedPath === '' ? 'index.html' : decodedPath.slice(1)
  const root = rendererOutputDirectory()
  const candidate = resolve(root, requestedPath)
  const relativePath = relative(root, candidate)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    return undefined
  }
  return candidate
}

async function handleAppProtocol(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.hostname !== APP_HOST || request.method !== 'GET') {
    return new Response('Not found', { status: 404 })
  }

  const assetPath = resolveRendererAsset(url.pathname)
  if (!assetPath) return new Response('Forbidden', { status: 403 })

  try {
    return await net.fetch(pathToFileURL(assetPath).toString())
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function installNavigationGuards(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )
  defaultSession.setPermissionCheckHandler(() => false)
}

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived(
    (details: OnHeadersReceivedListenerDetails, callback) => {
      if (!details.url.startsWith(`${APP_PROTOCOL}://${APP_HOST}/`)) {
        callback({})
        return
      }

      const responseHeaders = { ...details.responseHeaders }
      responseHeaders['Content-Security-Policy'] = [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ]
      callback({ responseHeaders })
    },
  )
}

function preloadPath(): string {
  const modulePreload = join(currentDirectory, '../preload/index.mjs')
  if (existsSync(modulePreload)) return modulePreload
  return join(currentDirectory, '../preload/index.js')
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  installNavigationGuards(window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isLoopbackRendererUrl(rendererUrl)) {
    await window.loadURL(rendererUrl)
    return
  }
  await window.loadURL(APP_ENTRYPOINT)
}

async function startApplication(): Promise<void> {
  protocol.handle(APP_PROTOCOL, handleAppProtocol)
  installContentSecurityPolicy()

  workspaceStore = new WorkspaceStore(join(app.getPath('userData'), 'supplierops.sqlite'))
  workspaceStore.open()
  const provider = new ProviderBoundary(
    workspaceStore,
    app.getAppPath(),
    providerOptionsForRuntime(),
  )
  const workspace = new WorkspaceService(workspaceStore, provider)

  mainWindow = createMainWindow()
  const rendererUrl = isLoopbackRendererUrl(process.env.ELECTRON_RENDERER_URL)
    ? process.env.ELECTRON_RENDERER_URL
    : undefined
  unregisterIpc = registerIpcHandlers(mainWindow, { workspace }, rendererUrl)
  await loadRenderer(mainWindow)
}

if (hasSingleInstanceLock) {
  configureTestUserDataDirectory()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(() => startApplication())
    .catch((error: unknown) => {
      console.error('SupplierOps Lab failed to start', redactError(error).failureId)
      app.quit()
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && workspaceStore) {
      mainWindow = createMainWindow()
      const rendererUrl = isLoopbackRendererUrl(process.env.ELECTRON_RENDERER_URL)
        ? process.env.ELECTRON_RENDERER_URL
        : undefined
      unregisterIpc?.()
      const provider = new ProviderBoundary(
        workspaceStore,
        app.getAppPath(),
        providerOptionsForRuntime(),
      )
      const workspace = new WorkspaceService(workspaceStore, provider)
      unregisterIpc = registerIpcHandlers(mainWindow, { workspace }, rendererUrl)
      void loadRenderer(mainWindow)
    }
  })

  app.on('before-quit', () => {
    unregisterIpc?.()
    unregisterIpc = undefined
    workspaceStore?.close()
    workspaceStore = undefined
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
} else {
  app.quit()
}
