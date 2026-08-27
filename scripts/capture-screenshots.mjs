import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDirectory = join(projectRoot, 'docs', 'screenshots')

async function capture({ fileName, viewport, scenario, dark = false }) {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'supplierops-capture-'))
  const application = await electron.launch({
    args: [projectRoot, '--headless', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_RENDERER_URL: '',
      SUPPLIEROPS_E2E_USER_DATA: userDataDirectory,
    },
  })

  try {
    const page = await application.firstWindow()
    await page.setViewportSize(viewport)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => typeof globalThis.supplierOps?.runScenario === 'function')
    await page.getByRole('combobox', { name: 'Choose scenario' }).selectOption(scenario)
    await page.getByRole('button', { name: 'Run current scenario' }).click()
    await page.getByText('4 files', { exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Reconciliation review' }).waitFor()
    if (dark) await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await page.screenshot({ path: join(outputDirectory, fileName), fullPage: true })
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
}

mkdirSync(outputDirectory, { recursive: true })
await capture({
  fileName: 'supplierops-price-review.png',
  viewport: { width: 1440, height: 900 },
  scenario: 'price-mismatch',
})
await capture({
  fileName: 'supplierops-prompt-injection-dark.png',
  viewport: { width: 1080, height: 760 },
  scenario: 'prompt-injection',
  dark: true,
})

console.log(`Captured sanitized demo screenshots in ${outputDirectory}`)
