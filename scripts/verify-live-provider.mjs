import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const userDataDirectory = mkdtempSync(join(tmpdir(), 'supplierops-provider-smoke-'))
let application

try {
  application = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDirectory}`, '--headless', '--disable-gpu'],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
    },
  })

  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('combobox', { name: 'Choose scenario' }).selectOption('semantic-match')
  await page.getByRole('combobox', { name: 'Provider mode' }).selectOption('provider')
  await page.getByRole('button', { name: 'Run current scenario' }).click()

  try {
    await page.getByText('AI-proposed mapping').waitFor({ timeout: 45_000 })
  } catch (error) {
    const stored = await page.evaluate(async () => {
      const workspace = await globalThis.supplierOps?.loadScenario({
        scenarioId: 'semantic-match',
      })
      if (!workspace) return null
      return {
        failure: workspace.failure,
        lastTraceMetadata: workspace.traceEvents.at(-1)?.metadata ?? null,
      }
    })
    const safeLines = (await page.locator('body').innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /provider|failure|invalid|rate limit|unavailable|timed out/iu.test(line))
      .map((line) => line.replaceAll(/sk-[A-Za-z0-9_-]{12,}/gu, '[redacted]'))
      .slice(0, 12)
    throw new Error(
      `Live provider smoke did not produce a mapping. ${safeLines.join(' | ')} | ${JSON.stringify(stored)}`,
      { cause: error },
    )
  }
  await page
    .getByText(/Provider result observed · 1 call/)
    .first()
    .waitFor({ timeout: 5_000 })
  console.log('Live provider smoke passed: one bounded semantic result was observed.')
} finally {
  await application?.close()
  rmSync(userDataDirectory, { recursive: true, force: true })
}
