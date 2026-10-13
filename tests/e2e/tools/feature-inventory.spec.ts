import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledExtensionIds } from '../../../scripts/smoke-start.mjs'
import { closeApp, launchApp, type AppHandle } from '../helpers'

// What the running app offers, once every bundled extension is active: every
// IPC channel main handles, every command, every extension setting. The other
// half of docs/research/feature-coverage.md, joined with the e2e IPC trace by
// scripts/feature-coverage.mjs. Run deliberately:
//
//   FEATURE_INVENTORY=/tmp/inventory.json E2E_TOOLS=1 npx playwright test tests/e2e/tools/feature-inventory.spec.ts

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

let handle: AppHandle | undefined
test.afterAll(async () => closeApp(handle))

/** Every backend registers its channels and commands before it logs that it activated. */
async function awaitActivated(app: AppHandle['app'], ids: string[]): Promise<void> {
  const logPath = join(
    await app.evaluate(({ app: electronApp }) => electronApp.getPath('logs')),
    'terminator.log'
  )
  await expect
    .poll(() =>
      ids.filter((id) => readFileSync(logPath, 'utf8').includes(`Extension ${id} activated`))
    )
    .toEqual(ids)
}

/** Every command, and every extension setting with the channel an action setting runs. */
async function commandsAndSettings(page: AppHandle['page']) {
  const { commands, schemas } = await page.evaluate(async () => {
    const api = window.electronAPI.extension
    return {
      commands: (await api.getCommands()).commands,
      schemas: (await api.getSettingsSchemas()).schemas,
    }
  })
  const settings = schemas.flatMap((schema) =>
    Object.entries(schema.properties).map(([key, property]) => ({
      extensionId: schema.extensionId,
      key,
      label: property.label,
      type: property.type,
      channel: property.channel,
    }))
  )
  return { commands, settings }
}

test('record the features the running app offers', async () => {
  const output = process.env.FEATURE_INVENTORY
  test.skip(!output, 'FEATURE_INVENTORY names the file to write')
  handle = await launchApp()
  const { app, page } = handle
  const ids: string[] = bundledExtensionIds(join(REPO_ROOT, 'extensions'))

  await awaitActivated(app, ids)
  const channels = await app.evaluate(({ ipcMain }) => ({
    invoke: [...(Reflect.get(ipcMain, '_invokeHandlers') as Map<string, unknown>).keys()],
    send: ipcMain.eventNames().filter((name): name is string => typeof name === 'string'),
  }))
  const { commands, settings } = await commandsAndSettings(page)
  writeFileSync(
    output as string,
    JSON.stringify({ extensions: ids, channels, commands, settings }, null, 2)
  )
})
