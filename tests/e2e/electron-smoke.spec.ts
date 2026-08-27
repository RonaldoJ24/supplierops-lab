import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '../..')

test('production Electron price-mismatch path keeps approval and submission separate', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'supplierops-e2e-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    app = await electron.launch({
      // Launch the repository package so Electron resolves its declared main
      // entry and app.getAppPath() has production package semantics.
      args: [projectRoot, '--headless', '--disable-gpu'],
      env: {
        NODE_ENV: 'test',
        ELECTRON_RENDERER_URL: '',
        SUPPLIEROPS_E2E_USER_DATA: userDataDirectory,
      },
    })

    const appPath = await app.evaluate(({ app: electronApp }) => electronApp.getAppPath())
    expect(appPath).toBe(projectRoot)

    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const desktopBridge = await page.evaluate(() => {
      const bridge = (window as Window & { supplierOps?: unknown }).supplierOps
      return {
        available: typeof bridge === 'object' && bridge !== null,
      }
    })
    expect(desktopBridge).toEqual({ available: true })

    const scenario = page.getByRole('combobox', { name: 'Choose scenario' })
    await scenario.selectOption('price-mismatch')
    await expect(scenario).toHaveValue('price-mismatch')

    const createDraft = page.getByRole('button', { name: 'Create corrected draft' })
    const approve = page.getByRole('button', { name: 'Approve explicitly' })
    const submit = page.getByRole('button', { name: 'Submit · local/mock' })
    await expect(createDraft).toBeEnabled()
    await expect(approve).toBeDisabled()
    await expect(submit).toBeDisabled()

    await createDraft.click()
    await expect(page.getByRole('button', { name: 'Draft created', exact: true })).toBeVisible()
    await expect(approve).toBeEnabled()
    await expect(submit).toBeDisabled()

    await approve.click()
    await expect(page.getByRole('dialog', { name: 'Confirm explicit approval' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm approval' }).click()
    await expect(page.getByText(/Approval recorded · submission is separate/)).toBeVisible()
    await expect(submit).toBeEnabled()
  } finally {
    await app?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
