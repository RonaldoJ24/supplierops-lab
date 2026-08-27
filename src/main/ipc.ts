import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  MAX_SOURCE_PACKET_BYTES,
  MAX_SOURCE_PACKET_FILES,
  MAX_SOURCE_PACKET_PREVIEW_CHARS,
  MAX_SOURCE_PACKET_TOTAL_BYTES,
} from './constants'
import { IPC_CHANNELS, parseApiInput, parseApiOutput, type ApiOperationName } from '../shared/api'
import { redactError } from './redaction'
import type { SelectedSourcePacket, WorkspaceService } from './workspace'

export interface IpcServices {
  workspace: WorkspaceService
}

interface TrustedRendererOrigin {
  protocol: string
  host: string
  port: string
}

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.json',
  '.csv',
  '.tsv',
  '.txt',
  '.xml',
  '.md',
  '.pdf',
])

function trustedOriginFromUrl(url: string | undefined): TrustedRendererOrigin | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    ) {
      return undefined
    }
    return { protocol: parsed.protocol, host: parsed.hostname, port: parsed.port }
  } catch {
    return undefined
  }
}

function isTrustedSender(event: IpcMainInvokeEvent, devOrigin?: TrustedRendererOrigin): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false

  try {
    const parsed = new URL(frame.url)
    if (parsed.protocol === 'app:' && parsed.hostname === 'bundle') return true
    if (!devOrigin) return false
    return (
      parsed.protocol === devOrigin.protocol &&
      parsed.hostname === devOrigin.host &&
      parsed.port === devOrigin.port
    )
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, devOrigin?: TrustedRendererOrigin): void {
  if (!isTrustedSender(event, devOrigin)) throw new Error('Untrusted IPC sender')
}

function readTextPreview(filePath: string, size: number): string | undefined {
  const extension = extname(filePath).toLowerCase()
  const textual = new Set(['.txt', '.csv', '.tsv', '.json', '.xml', '.md'])
  if (!textual.has(extension)) return undefined

  const previewBytes = Math.min(size, MAX_SOURCE_PACKET_PREVIEW_CHARS * 4)
  try {
    return readFileSync(filePath, { encoding: 'utf8', flag: 'r' })
      .slice(0, previewBytes)
      .slice(0, MAX_SOURCE_PACKET_PREVIEW_CHARS)
  } catch {
    throw new Error('Selected source packet could not be read')
  }
}

async function selectSourcePacket(mainWindow: BrowserWindow | null): Promise<SelectedSourcePacket> {
  const options: OpenDialogOptions = {
    title: 'Import source packet',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Source packets', extensions: ['json', 'csv', 'tsv', 'txt', 'xml', 'md', 'pdf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || selection.filePaths.length === 0) {
    throw new Error('Source packet import cancelled')
  }

  if (selection.filePaths.length > MAX_SOURCE_PACKET_FILES) {
    throw new Error(`Source packet must contain at most ${MAX_SOURCE_PACKET_FILES} files`)
  }

  let totalBytes = 0
  return selection.filePaths.map((filePath) => {
    const extension = extname(filePath).toLowerCase()
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
      throw new Error('Unsupported source packet type')
    }
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(filePath)
    } catch {
      throw new Error('Selected source packet is unavailable')
    }
    if (!stats.isFile()) throw new Error('Selected source packet is not a file')
    if (stats.size > MAX_SOURCE_PACKET_BYTES) {
      throw new Error(`A source packet file exceeds the ${MAX_SOURCE_PACKET_BYTES} byte limit`)
    }
    totalBytes += stats.size
    if (totalBytes > MAX_SOURCE_PACKET_TOTAL_BYTES) {
      throw new Error('Source packet exceeds the aggregate byte limit')
    }

    const fileName = basename(filePath).slice(0, 180)
    const normalizedExtension = extension.slice(1)
    const preview = readTextPreview(filePath, stats.size)
    return {
      fileName,
      extension: normalizedExtension,
      byteSize: stats.size,
      ...(preview === undefined ? {} : { preview }),
    }
  })
}

function normalizeError(
  error: unknown,
  workspace?: WorkspaceService,
): {
  error: { name: string; message: string; failureId: string }
} {
  return { error: workspace?.failureProjection(error) ?? redactError(error) }
}

async function dispatchValidated(
  event: IpcMainInvokeEvent,
  rendererUrl: TrustedRendererOrigin | undefined,
  operation: ApiOperationName,
  input: unknown,
  action: (parsedInput: unknown) => unknown,
): Promise<unknown> {
  assertTrustedSender(event, rendererUrl)
  const parsedInput = parseApiInput(operation, input)
  const output = await action(parsedInput)
  return parseApiOutput(operation, output)
}

/** Register the allowlisted renderer-to-main operations. */
export function registerIpcHandlers(
  mainWindow: BrowserWindow | null,
  services: IpcServices,
  rendererUrl?: string,
): () => void {
  const devOrigin = trustedOriginFromUrl(rendererUrl)
  const handlers: Array<[string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown]> = [
    [
      IPC_CHANNELS.bootstrap,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'bootstrap', input ?? {}, (parsedInput) =>
          services.workspace.bootstrap(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.loadScenario,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'loadScenario', input, (parsedInput) =>
          services.workspace.loadScenario(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.runScenario,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'runScenario', input, (parsedInput) =>
          services.workspace.runScenario(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.createCorrectionDraft,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'createCorrectionDraft', input, (parsedInput) =>
          services.workspace.createCorrectionDraft(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.approveDraft,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'approveDraft', input, (parsedInput) =>
          services.workspace.approveDraft(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.submitDraft,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'submitDraft', input, (parsedInput) =>
          services.workspace.submitDraft(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.replayFailure,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'replayFailure', input, (parsedInput) =>
          services.workspace.replayFailure(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.saveRegression,
      (event, input) => {
        return dispatchValidated(event, devOrigin, 'saveRegression', input, (parsedInput) =>
          services.workspace.saveRegression(parsedInput),
        )
      },
    ],
    [
      IPC_CHANNELS.importSourcePacket,
      async (event, input) => {
        return dispatchValidated(
          event,
          devOrigin,
          'importSourcePacket',
          input,
          async (parsedInput) => {
            const selected = await selectSourcePacket(mainWindow)
            return services.workspace.importSourcePacket(parsedInput, selected)
          },
        )
      },
    ],
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        // Return a stable, redacted diagnostic shape; never echo payloads or secrets.
        return normalizeError(error, services.workspace)
      }
    })
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
