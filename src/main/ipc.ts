import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { MAX_SOURCE_PACKET_BYTES, MAX_SOURCE_PACKET_PREVIEW_CHARS } from './constants'
import { IPC_CHANNELS } from '../shared/api'
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
  const textual = new Set(['.txt', '.csv', '.tsv', '.json', '.xml', '.html', '.md'])
  if (!textual.has(extension)) return undefined

  const previewBytes = Math.min(size, MAX_SOURCE_PACKET_PREVIEW_CHARS * 4)
  return readFileSync(filePath, { encoding: 'utf8', flag: 'r' })
    .slice(0, previewBytes)
    .slice(0, MAX_SOURCE_PACKET_PREVIEW_CHARS)
}

async function selectSourcePacket(mainWindow: BrowserWindow | null): Promise<SelectedSourcePacket> {
  const options: OpenDialogOptions = {
    title: 'Import source packet',
    properties: ['openFile'],
    filters: [
      { name: 'Source packets', extensions: ['json', 'csv', 'tsv', 'txt', 'xml', 'pdf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || selection.filePaths.length === 0) {
    throw new Error('Source packet import cancelled')
  }

  const filePath = selection.filePaths[0]
  if (!filePath) throw new Error('Source packet import cancelled')

  const stats = statSync(filePath)
  if (!stats.isFile()) throw new Error('Selected source packet is not a file')
  if (stats.size > MAX_SOURCE_PACKET_BYTES) {
    throw new Error(`Source packet exceeds the ${MAX_SOURCE_PACKET_BYTES} byte limit`)
  }

  const fileName = basename(filePath).slice(0, 180)
  const extension = extname(fileName).toLowerCase().slice(1) || 'unknown'
  const preview = readTextPreview(filePath, stats.size)
  return {
    fileName,
    extension,
    byteSize: stats.size,
    preview,
  }
}

function normalizeError(error: unknown): {
  error: { name: string; message: string; failureId: string }
} {
  return { error: redactError(error) }
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
        assertTrustedSender(event, devOrigin)
        return services.workspace.bootstrap(input ?? {})
      },
    ],
    [
      IPC_CHANNELS.loadScenario,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.loadScenario(input)
      },
    ],
    [
      IPC_CHANNELS.runScenario,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.runScenario(input)
      },
    ],
    [
      IPC_CHANNELS.createCorrectionDraft,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.createCorrectionDraft(input)
      },
    ],
    [
      IPC_CHANNELS.approveDraft,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.approveDraft(input)
      },
    ],
    [
      IPC_CHANNELS.submitDraft,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.submitDraft(input)
      },
    ],
    [
      IPC_CHANNELS.replayFailure,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.replayFailure(input)
      },
    ],
    [
      IPC_CHANNELS.saveRegression,
      (event, input) => {
        assertTrustedSender(event, devOrigin)
        return services.workspace.saveRegression(input)
      },
    ],
    [
      IPC_CHANNELS.importSourcePacket,
      async (event, input) => {
        assertTrustedSender(event, devOrigin)
        const selected = await selectSourcePacket(mainWindow)
        return services.workspace.importSourcePacket(input, selected)
      },
    ],
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        // Return a stable, redacted diagnostic shape; never echo payloads or secrets.
        return normalizeError(error)
      }
    })
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
