import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  type AppHandle,
  e2eTempDir,
  readTerminalRows,
} from '../helpers'

// SC-005: typing stays responsive while other terminals print continuously.
// Twelve terminals, six of them printing, then keystroke-to-echo time in an
// idle one. Run deliberately: E2E_TOOLS=1 npx playwright test tests/e2e/tools/measure-echo-latency.spec.ts

let handle: AppHandle | undefined
test.afterAll(async () => closeApp(handle))

/** Twelve terminals on one workspace, the first six printing without pause. */
async function startBusyTerminals(page: Page): Promise<void> {
  await createWorkspace(page, 'load', e2eTempDir('echo-'))
  for (let i = 1; i <= 12; i++) {
    await addAndSelectProject(page, 'load', `t${i}`)
    if (i <= 6) {
      await page.locator('.terminal-pane').click()
      await page.keyboard.type(
        'while true; do echo "busy $RANDOM $RANDOM $RANDOM"; sleep 0.05; done'
      )
      await page.keyboard.press('Enter')
    }
  }
  await page.locator('.terminal-pane').click()
  await expect.poll(async () => (await readTerminalRows(page)).join('\n')).toContain('busy')
}

/** Milliseconds from each of ten keystrokes to its echo in the idle terminal. */
async function echoTimes(page: Page): Promise<number[]> {
  // A prefix nothing else prints, so the probe matches this line only.
  await page.keyboard.type('zqx')
  let typed = 'zqx'
  const samples: number[] = []
  for (const key of 'abcdefghij') {
    typed += key
    const started = Date.now()
    await page.keyboard.type(key)
    await page.waitForFunction(
      (expected) => window.terminatorE2E!.terminalRows().some((row) => row.includes(expected)),
      typed,
      { polling: 'raf' }
    )
    samples.push(Date.now() - started)
  }
  return samples
}

test('measure keystroke echo with six busy terminals', async () => {
  handle = await launchApp()
  const { page } = handle
  await startBusyTerminals(page)
  const samples = await echoTimes(page)
  const sorted = [...samples].sort((a, b) => a - b)
  writeFileSync(
    join(tmpdir(), 'terminator-054-echo.json'),
    JSON.stringify({ samples, median: sorted[5], max: sorted[9] }, null, 2)
  )
})
