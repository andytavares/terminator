import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, openSettingsSection } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { allTasks, openVault, todayTasks } from './task-vault-harness'
import { expectCentredInWindow } from './modal-centre'

// Task Vault's data tools and its database actions in Settings: the SQL
// console, export to JSON, reset, re-initialise, and import of the export.
// The steps run in order: the import restores the file the export wrote.

let handle: AppHandle
let vault: ExtensionView
let exportFile: string

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  for (const text of ['Water the plants', 'Back up the laptop']) {
    const input = vault.locator('.daily-log__add-row input')
    if (!(await input.isVisible())) await vault.locator('.daily-log__add-btn').click()
    await input.fill(text)
    await input.press('Enter')
    await expect(vault.locator('.daily-log__add-row')).toHaveCount(0)
  }
})

test.afterAll(async () => {
  await closeApp(handle)
})

function dataTools() {
  return vault.getByRole('dialog', { name: 'Data tools' })
}

async function openVaultDataTools(tab: 'Export & import' | 'Database'): Promise<void> {
  if ((await dataTools().count()) === 0) {
    await vault.getByRole('button', { name: 'Data tools (export / import)' }).click()
  }
  await dataTools().getByRole('tab', { name: tab }).click()
  await expectCentredInWindow(dataTools(), `Task Vault: Data tools, ${tab}`)
}

/** Saves the vault's next download to `filePath`. The frame downloads through
 * the main window's session, so the path is set on that session. */
function saveNextDownload(filePath: string): Promise<void> {
  return handle.app.evaluate(
    ({ webContents }, target) =>
      new Promise<void>((resolve, reject) => {
        const win = webContents.getAllWebContents().find((contents) => !contents.isDestroyed())
        win?.session.once('will-download', (_event, item) => {
          item.setSavePath(target)
          item.once('done', (_done, state) =>
            state === 'completed' ? resolve() : reject(new Error(state))
          )
        })
      }),
    filePath
  )
}

async function runSql(sql: string): Promise<void> {
  await dataTools().getByPlaceholder('SELECT * FROM tasks LIMIT 50').fill(sql)
  await dataTools().getByRole('button', { name: 'Run', exact: true }).click()
}

/** The Database tab counts each table and answers a query. */
async function countAndQuery(): Promise<void> {
  await openVaultDataTools('Database')
  const tasksChip = dataTools().locator('.db-admin__stat-chip', { hasText: /^tasks/ })
  await expect(tasksChip.locator('.db-admin__stat-count')).toHaveText('2')

  await runSql("SELECT text FROM tasks WHERE text LIKE 'Water%'")
  await expect(dataTools().locator('.db-admin__table')).toContainText('Water the plants')
}

/** A write in the SQL console shows on the log at once. */
async function sqlWriteShowsOnLog(): Promise<void> {
  await runSql("UPDATE tasks SET text = 'Water the ferns' WHERE text = 'Water the plants'")
  await expect(dataTools().locator('.db-admin__results')).toContainText('1 row affected')
  expect((await todayTasks(vault)).map((task) => task.text)).toContain('Water the ferns')

  await dataTools().press('Escape')
  await expect(vault.getByText('Water the ferns', { exact: true })).toBeVisible()
}

/** The SQL console refuses to change the schema. */
async function refuseSchemaChange(): Promise<void> {
  await openVaultDataTools('Database')
  await runSql('DROP TABLE tasks')
  await expect(dataTools().locator('.db-admin__error')).toHaveText(
    'DDL statements (DROP, CREATE, ALTER) are not permitted'
  )
  expect(await allTasks(vault)).toHaveLength(2)
}

/** Export JSON downloads every task, project and area. */
async function exportJson(): Promise<void> {
  await openVaultDataTools('Export & import')
  exportFile = join(mkdtempSync(join(tmpdir(), 'vault-export-')), 'vault.json')
  const saved = saveNextDownload(exportFile)
  await dataTools().getByRole('button', { name: 'Export JSON' }).click()
  await saved

  await expect(dataTools()).toContainText('Exported successfully.')
  const exported = JSON.parse(readFileSync(exportFile, 'utf8')) as { tasks: { text: string }[] }
  expect(exported.tasks.map((task) => task.text).sort()).toEqual([
    'Back up the laptop',
    'Water the ferns',
  ])
  await dataTools().press('Escape')
}

async function taskVaultSettingsAction(label: string): Promise<void> {
  const { page } = handle
  await page.bringToFront()
  await openSettingsSection(page, 'Extensions')
  const row = page.locator('.extension-item-wrapper').filter({
    has: page.locator('.extension-item__name', { hasText: 'Task Vault' }),
  })
  if ((await row.locator('.extension-settings-panel').count()) === 0) {
    await row.getByTitle('Configure').click()
  }
  await row.getByRole('button', { name: label, exact: true }).click()
}

/** Reset in Settings deletes every task, after asking. */
async function resetInSettings(): Promise<void> {
  handle.page.once('dialog', (dialog) => void dialog.accept())
  await taskVaultSettingsAction('Reset (delete all data)')
  await expect.poll(() => allTasks(vault)).toEqual([])
}

/** Re-initialize in Settings reapplies the schema and reports success. */
async function reinitialiseInSettings(): Promise<void> {
  await taskVaultSettingsAction('Re-initialize')
  await expect
    .poll(async () =>
      (await handle.page.evaluate(() => window.electronAPI.notifications.list())).map(
        (notification) => `${notification.title}: ${notification.message}`
      )
    )
    .toContain('Re-initialize: Done')
  // The vault still works on the re-initialised database.
  const { taskId } = await invokeChannel<{ taskId: string }>(vault, 'task-vault:vault:capture', {
    text: 'After reinit',
  })
  expect(taskId).toBeTruthy()
  await handle.page.keyboard.press('Escape')
}

/** Import JSON brings back what was exported. */
async function importJson(): Promise<void> {
  await vault.bringToFront()
  await openVaultDataTools('Export & import')
  await dataTools().locator('input[type="file"]').setInputFiles(exportFile)

  await expect(dataTools()).toContainText(/Imported \d+ records successfully\./)
  expect((await allTasks(vault)).map((task) => task.text).sort()).toEqual([
    'After reinit',
    'Back up the laptop',
    'Water the ferns',
  ])
}

const INSPECT_EXPORT_RESTORE: [string, () => Promise<void>][] = [
  ['the Database tab counts each table and answers a query', countAndQuery],
  ['a write in the SQL console shows on the log at once', sqlWriteShowsOnLog],
  ['the SQL console refuses to change the schema', refuseSchemaChange],
  ['Export JSON downloads every task, project and area', exportJson],
  ['Reset in Settings deletes every task, after asking', resetInSettings],
  ['Re-initialize in Settings reapplies the schema and reports success', reinitialiseInSettings],
  ['Import JSON brings back what was exported', importJson],
]

test("the vault's data is inspected, exported, wiped and restored from the export", async () => {
  for (const [title, step] of INSPECT_EXPORT_RESTORE) await test.step(title, step)
})
