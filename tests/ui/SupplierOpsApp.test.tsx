import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { createSupplierOpsService } from '../../src/shared/service'
import { describe, expect, it, vi } from 'vitest'
import SupplierOpsApp from '../../src/renderer/App'

describe('SupplierOps Lab renderer', () => {
  it('renders the principal evidence, reconciliation, and trace surfaces', () => {
    render(<SupplierOpsApp />)

    expect(screen.getByText('SupplierOps Lab')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Source packet' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Reconciliation review' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Agent run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /request correction/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /inspect trace/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve explicitly/i })).toBeTruthy()

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
    fireEvent.click(screen.getAllByRole('button', { name: /open evidence/i })[0])
    expect(await screen.findByRole('heading', { name: 'Evidence' })).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Evidence' })).toBeNull())

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
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
    expect(screen.getByText(/Invoice ↔ approved order/i)).toBeTruthy()
  })

  it('runs the strict shared draft, approval, and submit operations', async () => {
    const api = createSupplierOpsService()
    render(<SupplierOpsApp api={api} initialScenarioId="price-mismatch" />)
    await screen.findAllByText(/needs review|human review needed/i)

    const createDraft = screen.getByRole('button', { name: /create corrected draft/i })
    await waitFor(() => expect(createDraft).not.toBeDisabled())
    fireEvent.click(createDraft)
    expect(await screen.findByRole('heading', { name: 'Corrected invoice draft' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /approve explicitly/i }))
    fireEvent.click(await screen.findByRole('button', { name: /confirm approval/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(screen.getByText('Local/mock adapter succeeded')).toBeTruthy())
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

    await screen.findByText(/AI not needed · deterministic path/i)
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
