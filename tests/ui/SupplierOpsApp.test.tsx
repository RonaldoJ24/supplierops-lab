import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { createSupplierOpsService } from '../../src/shared/service'
import { describe, expect, it } from 'vitest'
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
})
