import { contextBridge, ipcRenderer } from 'electron'
import type { ApiContract } from '../shared/api'
import { IPC_CHANNELS } from '../shared/api'
import { unwrapErrorEnvelope } from './errors'

type ApiFunction = (...args: never[]) => Promise<unknown>
type ApiMethod<K extends keyof ApiContract> = Extract<ApiContract[K], ApiFunction>

function invoke<K extends keyof ApiContract>(
  _method: K,
  channel: string,
  ...args: Parameters<ApiMethod<K>>
): ReturnType<ApiMethod<K>> {
  return ipcRenderer.invoke(channel, ...args).then(unwrapErrorEnvelope) as ReturnType<ApiMethod<K>>
}

/**
 * The only renderer capability. Keep this list explicit: no ipcRenderer,
 * filesystem path, environment value, or arbitrary channel reaches the page.
 */
const supplierOps: ApiContract = {
  bootstrap: (input) => invoke('bootstrap', IPC_CHANNELS.bootstrap, input),
  loadScenario: (input) => invoke('loadScenario', IPC_CHANNELS.loadScenario, input),
  runScenario: (input) => invoke('runScenario', IPC_CHANNELS.runScenario, input),
  createCorrectionDraft: (input) =>
    invoke('createCorrectionDraft', IPC_CHANNELS.createCorrectionDraft, input),
  approveDraft: (input) => invoke('approveDraft', IPC_CHANNELS.approveDraft, input),
  submitDraft: (input) => invoke('submitDraft', IPC_CHANNELS.submitDraft, input),
  replayFailure: (input) => invoke('replayFailure', IPC_CHANNELS.replayFailure, input),
  saveRegression: (input) => invoke('saveRegression', IPC_CHANNELS.saveRegression, input),
  importSourcePacket: (input) =>
    invoke('importSourcePacket', IPC_CHANNELS.importSourcePacket, input),
}

contextBridge.exposeInMainWorld('supplierOps', Object.freeze(supplierOps))
