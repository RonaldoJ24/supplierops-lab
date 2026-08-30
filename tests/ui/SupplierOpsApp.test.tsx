import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { createSupplierOpsService } from '../../src/shared/service'
import { describe, expect, it, vi } from 'vitest'
import SupplierOpsApp from '../../src/renderer/App'

function openDisclosure(selector: string) {
  const summary = document.querySelector<HTMLElement>(`${selector} > summary`)
  expect(summary).toBeTruthy()
  fireEvent.click(summary!)
}

describe('SupplierOps Lab renderer', () => {
  it('renders the principal evidence, reconciliation, and trace surfaces', () => {
    render(<SupplierOpsApp />)

    expect(screen.getByText('SupplierOps Lab')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Source packet' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Reconciliation review' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Agent run' })).toBeTruthy()
    openDisclosure('.action-bar__more')
    expect(screen.getByRole('button', { name: /request correction/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /inspect trace/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve explicitly/i })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Case actions' })).toBeTruthy()
    expect(screen.queryByRole('status', { name: /refreshing the local workspace/i })).toBeNull()
    const shell = document.querySelector('.app-shell')
    expect(shell?.children).toHaveLength(4)
    expect(shell?.children[1]).toHaveClass('loading-slot')
    expect(shell?.children[3]).toHaveClass('action-bar')

    const scenarioSelect = screen.getByRole('combobox', {
      name: 'Choose scenario',
    }) as HTMLSelectElement
    expect(scenarioSelect.options).toHaveLength(6)
    expect(Array.from(scenarioSelect.options).map((option) => option.value)).toEqual([
      'clean-match',
      'price-mismatch',
      'semantic-match',
      'prompt-injection',
      'api-outage',
      'invalid-model-output',
    ])
  })

  it('switches to the blocked prompt-injection state and keeps submission gated', async () => {
    render(<SupplierOpsApp />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose scenario' }), {
      target: { value: 'prompt-injection' },
    })

    expect(await screen.findByText('Workflow blocked')).toBeTruthy()
    expect(screen.getByText(/embedded document instruction was quarantined/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /create corrected draft/i })).toBeDisabled()
  })

  it('creates a correction draft, asks for explicit approval, and only then enables submit', async () => {
    render(<SupplierOpsApp />)
    const submit = screen.getByRole('button', { name: /submit/i })
    expect(submit).toBeDisabled()

    const createDraft = screen.getByRole('button', { name: /create corrected draft/i })
    await waitFor(() => expect(createDraft).not.toBeDisabled())
    fireEvent.click(createDraft)
    expect(await screen.findByRole('heading', { name: 'Corrected invoice draft' })).toBeTruthy()
    const approve = screen.getByRole('button', { name: /approve explicitly/i })
    expect(approve).not.toBeDisabled()
    fireEvent.click(approve)
    expect(await screen.findByRole('heading', { name: 'Confirm explicit approval' })).toBeTruthy()
    expect(screen.getByText(/nothing will be submitted until/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /confirm approval/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled())
    expect(screen.getAllByText(/approval recorded/i).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(screen.getByText(/local\/mock adapter succeeded/i)).toBeTruthy())
  })

  it('opens focused evidence and trace disclosures with escape support', async () => {
    render(<SupplierOpsApp />)
    openDisclosure('.source-files-details')
    fireEvent.click(screen.getAllByRole('button', { name: /open evidence/i })[0])
    expect(await screen.findByRole('heading', { name: 'Evidence' })).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Evidence' })).toBeNull())

    openDisclosure('.action-bar__more')
    fireEvent.click(screen.getByRole('button', { name: /inspect trace/i }))
    expect(await screen.findByRole('heading', { name: 'Run trace' })).toBeTruthy()
    expect(screen.getByText(/sensitive provider payloads/i)).toBeTruthy()
  })

  it('consumes a shared CaseWorkspace and preserves the approval boundary', async () => {
    const api = createSupplierOpsService()
    render(<SupplierOpsApp api={api} initialScenarioId="price-mismatch" />)

    expect(
      (await screen.findAllByText(/needs review|human review needed/i)).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Deterministic review completed')).toBeTruthy()
    expect(screen.getByText('case-price-mismatch')).toBeTruthy()
    expect(screen.getByText('1 invoice line needs review before approval.')).toBeTruthy()
    expect(
      screen.getByText(
        'Steel bolt is priced at MX$11.00 on the invoice versus MX$10.00 on the approved order (+10.0% variance).',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Invoice variance policy · Draft allowed')).toBeTruthy()
    expect(screen.getByText('Checked Revision 1')).toBeTruthy()
    expect(screen.getByText('Revision 1')).toBeTruthy()
    expect(screen.getByText('15 Jan 2025 · 10:00 UTC')).toBeTruthy()
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
    expect(screen.getByText(/Invoice ↔ approved order/i)).toBeTruthy()
  })

  it('runs the strict shared draft, approval, and submit operations', async () => {
    const api = createSupplierOpsService()
    const createCorrectionDraft = vi.spyOn(api, 'createCorrectionDraft')
    const approveDraft = vi.spyOn(api, 'approveDraft')
    const submitDraft = vi.spyOn(api, 'submitDraft')
    const saveRegression = vi.spyOn(api, 'saveRegression')
    render(<SupplierOpsApp api={api} initialScenarioId="price-mismatch" />)
    await screen.findAllByText(/needs review|human review needed/i)

    const createDraft = screen.getByRole('button', { name: /create corrected draft/i })
    await waitFor(() => expect(createDraft).not.toBeDisabled())
    fireEvent.click(createDraft)
    expect(await screen.findByRole('heading', { name: 'Corrected invoice draft' })).toBeTruthy()
    await waitFor(() =>
      expect(createCorrectionDraft).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case:price-mismatch' }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /approve explicitly/i }))
    fireEvent.click(await screen.findByRole('button', { name: /confirm approval/i }))
    await waitFor(() =>
      expect(approveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case:price-mismatch' }),
      ),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() =>
      expect(submitDraft).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case:price-mismatch' }),
      ),
    )
    await waitFor(() => expect(screen.getByText('Local/mock adapter succeeded')).toBeTruthy())

    openDisclosure('.topbar__more')
    fireEvent.click(screen.getByRole('button', { name: 'Save regression' }))
    await waitFor(() => expect(saveRegression).toHaveBeenCalledTimes(1))
    expect(saveRegression).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: 'price-mismatch',
        workspace: expect.objectContaining({
          caseMetadata: expect.objectContaining({ caseId: 'case:price-mismatch' }),
          correctionDraft: expect.objectContaining({ caseId: 'case:price-mismatch' }),
          approval: expect.objectContaining({ caseId: 'case:price-mismatch' }),
          execution: expect.objectContaining({ caseId: 'case:price-mismatch' }),
        }),
      }),
    )
  })

  it('uses the explicit provider mode for semantic mapping and shows the offline escalation boundary', async () => {
    const api = createSupplierOpsService()
    const runScenario = vi.spyOn(api, 'runScenario')
    render(<SupplierOpsApp api={api} initialScenarioId="semantic-match" />)

    await waitFor(() =>
      expect(runScenario).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioId: 'semantic-match', mode: 'offline' }),
      ),
    )
    expect(await screen.findByText('Semantic mapping requires escalation')).toBeTruthy()
    const initialRunCount = runScenario.mock.calls.length

    const mode = screen.getByRole('combobox', { name: 'Provider mode' }) as HTMLSelectElement
    await waitFor(() => expect(mode).not.toBeDisabled())
    fireEvent.change(mode, { target: { value: 'provider' } })
    expect(runScenario).toHaveBeenCalledTimes(initialRunCount)
    expect(await screen.findByText('DeepSeek provider selected · not run')).toBeTruthy()
    expect(screen.getByText(/bounded document excerpts may leave this device/i)).toBeTruthy()

    const runButton = screen.getByRole('button', { name: 'Run current scenario' })
    await waitFor(() => expect(runButton).not.toBeDisabled())
    fireEvent.click(runButton)
    await waitFor(() =>
      expect(runScenario).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioId: 'semantic-match', mode: 'provider' }),
      ),
    )
    expect(await screen.findByText('AI-proposed mapping')).toBeTruthy()
    expect(screen.getByText(/deterministic verification/i)).toBeTruthy()
    expect(runScenario.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ scenarioId: 'semantic-match', mode: 'provider' }),
    )
  })

  it('invokes the main-owned source chooser with only case metadata and time', async () => {
    const api = createSupplierOpsService()
    const importSourcePacket = vi.spyOn(api, 'importSourcePacket')
    render(<SupplierOpsApp api={api} initialScenarioId="price-mismatch" />)

    await screen.findByText('Deterministic review completed')
    fireEvent.click(screen.getByRole('button', { name: 'Import source packet' }))
    await waitFor(() => expect(importSourcePacket).toHaveBeenCalledTimes(1))
    expect(importSourcePacket).toHaveBeenCalledWith({
      caseMetadata: expect.objectContaining({
        caseId: expect.any(String),
        scenarioId: 'price-mismatch',
      }),
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
  })

  it('renders measured evaluation data and an honest no-measurement state', async () => {
    const api = createSupplierOpsService()
    render(<SupplierOpsApp api={api} initialScenarioId="clean-match" />)
    expect(await screen.findByText(/fixture model\/control schemas valid/i)).toBeTruthy()
    expect(screen.getByText(/observed sample/i)).toBeTruthy()
    expect(screen.queryByText('0' + '.98')).toBeNull()

    render(<SupplierOpsApp initialScenarioId="clean-match" />)
    expect(screen.getAllByText('Not measured for this run.').length).toBeGreaterThan(0)
  })

  it('keeps prompt-injection blocked and never selects a provider mode', async () => {
    const api = createSupplierOpsService()
    const runScenario = vi.spyOn(api, 'runScenario')
    render(<SupplierOpsApp api={api} initialScenarioId="prompt-injection" />)

    expect(await screen.findByText('Workflow blocked')).toBeTruthy()
    const mode = screen.getByRole('combobox', { name: 'Provider mode' }) as HTMLSelectElement
    expect(mode).toBeDisabled()
    expect(mode.value).toBe('offline')
    await waitFor(() => expect(runScenario).toHaveBeenCalled())
    const initialRunCount = runScenario.mock.calls.length
    const runButton = screen.getByRole('button', { name: 'Run current scenario' })
    await waitFor(() => expect(runButton).not.toBeDisabled())
    fireEvent.click(runButton)
    await waitFor(() => expect(runScenario.mock.calls.length).toBeGreaterThan(initialRunCount))
    expect(runScenario.mock.calls.every(([input]) => input.mode === 'offline')).toBe(true)
  })

  it('uses the canonical case ID when replaying a provider failure', async () => {
    const api = createSupplierOpsService()
    const runScenario = vi.spyOn(api, 'runScenario')
    const replayFailure = vi.spyOn(api, 'replayFailure')
    render(<SupplierOpsApp api={api} initialScenarioId="api-outage" />)

    const mode = screen.getByRole('combobox', { name: 'Provider mode' }) as HTMLSelectElement
    await waitFor(() => expect(mode).not.toBeDisabled())
    fireEvent.change(mode, { target: { value: 'provider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run current scenario' }))
    await waitFor(() =>
      expect(runScenario).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioId: 'api-outage', mode: 'provider' }),
      ),
    )
    expect((await screen.findAllByText(/rate limited/i)).length).toBeGreaterThan(0)

    openDisclosure('.topbar__more')
    fireEvent.click(screen.getByRole('button', { name: 'Replay scenario' }))
    await waitFor(() =>
      expect(replayFailure).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case:api-outage', mode: 'offline' }),
      ),
    )
  })

  it('surfaces a redacted IPC error envelope with its stable failure ID', async () => {
    const api = createSupplierOpsService()
    const runScenario = vi.spyOn(api, 'runScenario').mockResolvedValue({
      error: {
        name: 'ProviderUnavailable',
        message: 'Provider unavailable; api-key=private-value',
        failureId: 'provider-failure:envelope-1',
      },
    } as never)
    const loadScenario = vi.spyOn(api, 'loadScenario')
    render(<SupplierOpsApp api={api} initialScenarioId="semantic-match" />)

    expect(
      (await screen.findAllByText(/Provider unavailable; \[redacted\]/i)).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/Failure ID: provider-failure:envelope-1/i).length).toBeGreaterThan(
      0,
    )
    expect(screen.queryByText(/private-value/i)).toBeNull()
    expect(loadScenario).not.toHaveBeenCalled()
    expect(runScenario).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'semantic-match', mode: 'offline' }),
    )
  })
})
