import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test, type Page } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '../..')
const responsiveViewports = [
  { width: 1440, height: 900 },
  { width: 1080, height: 760 },
] as const

async function expectResponsiveLayout(page: Page, viewport: (typeof responsiveViewports)[number]) {
  await page.setViewportSize(viewport)
  await expect
    .poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
    .toEqual(viewport)

  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace')?.getBoundingClientRect()
    const actionBar = document.querySelector<HTMLElement>('.action-bar')?.getBoundingClientRect()
    if (!workspace || !actionBar) {
      throw new Error('Responsive layout landmarks are missing from the production shell.')
    }
    return {
      viewportHeight: window.innerHeight,
      workspaceBottom: workspace.bottom,
      actionBarTop: actionBar.top,
      actionBarBottom: actionBar.bottom,
      actionBarHeight: actionBar.height,
    }
  })

  // A one-pixel tolerance absorbs fractional layout rounding while catching
  // an action-bar overlay or the prior large narrow action-bar expansion.
  expect(geometry.workspaceBottom).toBeLessThanOrEqual(geometry.actionBarTop + 1)
  expect(geometry.actionBarTop).toBeGreaterThanOrEqual(-1)
  expect(geometry.actionBarBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  expect(geometry.actionBarHeight).toBeGreaterThan(0)
  expect(geometry.actionBarHeight).toBeLessThanOrEqual(120)
}

test('production Electron price-mismatch path keeps approval and submission separate', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'supplierops-e2e-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    app = await electron.launch({
      // Launch the repository package so Electron resolves its declared main
      // entry and app.getAppPath() has production package semantics.
      args: [projectRoot, `--user-data-dir=${userDataDirectory}`, '--headless', '--disable-gpu'],
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
    // The production shell opens on price-mismatch. Transition through a
    // different scenario first so this DOM action exercises the real scenario
    // hydration path instead of dispatching a no-op change event that would
    // only repaint the fallback shell.
    await scenario.selectOption('clean-match')
    await expect(scenario).toHaveValue('clean-match')
    await scenario.selectOption('price-mismatch')
    await expect(scenario).toHaveValue('price-mismatch')
    const createDraft = page.getByRole('button', { name: 'Create corrected draft' })
    const approve = page.getByRole('button', { name: 'Approve explicitly' })
    const submit = page.getByRole('button', { name: 'Submit · local/mock' })
    await expect(createDraft).toBeEnabled()

    const evaluation = page.locator('details.evaluation-details')
    await evaluation.locator('summary').click()
    await expect(evaluation).toContainText('1 observed sample')
    await expect(evaluation).not.toContainText('Not measured for this run')

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

test('production Electron layout keeps the action bar bounded', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'supplierops-layout-e2e-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDirectory}`, '--headless', '--disable-gpu'],
      env: {
        NODE_ENV: 'test',
        ELECTRON_RENDERER_URL: '',
        SUPPLIEROPS_E2E_USER_DATA: userDataDirectory,
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('combobox', { name: 'Choose scenario' })).toBeVisible()

    for (const viewport of responsiveViewports) {
      await expectResponsiveLayout(page, viewport)
    }
  } finally {
    await app?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
