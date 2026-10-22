import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  inExtensionView,
  launchApp,
  projectGroup,
  runQuickActionFromPanel,
  acceptingDialog,
} from './helpers'
import { foundryChannel, makeFixtureRepo } from './foundry-harness'
import { answerFolderPicker } from './main-stubs'
import { openExtensionSettings, settingRow } from './extension-settings-page'

// Every bundled extension's settings, written one control at a time on its ⚙ page, read
// back from the page and main after a restart, then checked for any effect that can be seen.

interface SettingDef {
  type: string
  label: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  confirmMessage?: string
}
interface Schema {
  extensionId: string
  label: string
  properties: Record<string, SettingDef>
}

const NOTIFY = /^(.+)\.notify\.([^.]+)\.(system|center|toast)$/

/** Values chosen so their effect can be checked below; the rest only differ from the default. */
const CHOSEN: Record<string, unknown> = {
  'terminator.git-integration.git.enabled': false,
  // Foundry sets this itself when it shows its notice, which it has not yet: the app started
  // with no workspace, so no records sit beside one. Written here, it stays.
  'terminator.foundry.untrackedNoticeSeen': true,
  'terminator.foundry.budgets.agents': 7,
  'terminator.foundry.budgets.wallClockMinutes': 50,
  'terminator.foundry.criticalPaths': ['src/auth/**'],
  'terminator.notepad.defaultTags': 'e2e-tag',
  'terminator.remote-control.maxSubscribers': 13,
  'terminator.task-vault.weeklyReviewDay': '3',
  'terminator.task-vault.dueDateAlertTime': '07:30',
  'terminator.task-vault.contexts': 'deep-work,errands',
}

function chosenValue(key: string, def: SettingDef, folder: string): unknown {
  if (key in CHOSEN) return CHOSEN[key]
  if (def.type === 'boolean') return !def.default
  if (def.type === 'enum') return def.options!.find((option) => option !== def.default)
  if (def.type === 'folder') return folder
  if (def.type === 'list') return [`e2e ${key.split('.').pop()}`]
  if (def.type === 'number') {
    const low = def.min ?? 0
    return [low + 1, low + 2].find((n) => n !== def.default && (def.max ?? n) >= n)
  }
  return `e2e ${key.split('.').pop()}`
}

function notifyBox(panel: Locator, key: string, def: SettingDef): Locator {
  const target = NOTIFY.exec(key)![3]
  return panel.getByRole('checkbox', {
    name: `${def.label.split(' → ')[0]} → ${target}`,
    exact: true,
  })
}

/** Opens one extension's settings page. */
function openPage(page: Page, schema: Schema): Promise<Locator> {
  return openExtensionSettings(page, schema.label)
}

/** One setting and the value a spec writes to, or expects of, it. */
interface Setting {
  key: string
  def: SettingDef
  value: unknown
}

async function writeControl(handle: AppHandle, panel: Locator, setting: Setting) {
  const { key, def, value } = setting
  if (NOTIFY.test(key)) return notifyBox(panel, key, def).click()
  const row = settingRow(panel, def.label)
  if (def.type === 'boolean') {
    // An extension may have written it already (Foundry's untracked notice).
    const toggle = row.getByRole('switch')
    if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
    return
  }
  if (def.type === 'enum') {
    const label = String(value).charAt(0).toUpperCase() + String(value).slice(1)
    return row.getByRole('button', { name: label, exact: true }).click()
  }
  if (def.type === 'folder') {
    await answerFolderPicker(handle.app, String(value))
    return row.getByRole('button', { name: 'Choose…' }).click()
  }
  await row.locator('input, textarea').fill(controlText(value))
}

/** What a text control shows for a value: a list one item per line. */
function controlText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : String(value)
}

/** Whether a stored value differs from the one written; a list is compared item by item. */
function differs(stored: unknown, written: unknown): boolean {
  return JSON.stringify(stored) !== JSON.stringify(written)
}

/** Runs an action setting's button, confirming when it asks. */
async function pressActionSetting(
  handle: AppHandle,
  panel: Locator,
  def: SettingDef
): Promise<void> {
  if (def.confirmMessage) {
    await acceptingDialog(handle.page, () =>
      panel.getByRole('button', { name: def.label, exact: true }).click()
    )
  } else {
    await panel.getByRole('button', { name: def.label, exact: true }).click()
  }
  await expect
    .poll(async () =>
      (await handle.page.evaluate(() => window.electronAPI.notifications.list())).some(
        (n) => n.title === def.label && n.message === 'Done'
      )
    )
    .toBe(true)
}

async function expectControl(panel: Locator, setting: Setting) {
  const { key, def, value } = setting
  if (NOTIFY.test(key))
    return expect(notifyBox(panel, key, def)).toBeChecked({ checked: value === true })
  const row = settingRow(panel, def.label)
  if (def.type === 'boolean')
    return expect(row.getByRole('switch')).toHaveAttribute('aria-checked', String(value))
  if (def.type === 'enum')
    return expect(row.locator('.ext-segmented__btn--active')).toHaveText(
      new RegExp(`^${value}$`, 'i')
    )
  if (def.type === 'folder')
    return expect(row.locator('.ext-folder-row__path')).toHaveText(String(value))
  await expect(row.locator('input, textarea')).toHaveValue(controlText(value))
}

function storedValues(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => (await window.electronAPI.extension.getSettingsValues()).values)
}

function readSchemas(page: Page): Promise<Schema[]> {
  return page.evaluate(
    async () => (await window.electronAPI.extension.getSettingsSchemas()).schemas as never
  )
}

let handle: AppHandle
let repo: string
let schemas: Schema[]
const expected = new Map<string, unknown>()

test.beforeAll(async () => {
  handle = await launchApp()
  repo = makeFixtureRepo('terminator-e2e-settings-')
  await createWorkspace(handle.page, 'Settings', repo)
  await expect.poll(async () => (await readSchemas(handle.page)).length).toBe(5)
  schemas = await readSchemas(handle.page)
})

test.afterAll(async () => closeApp(handle))

/** Writes every setting of one extension from its settings page, and checks main stored each. */
async function writesEverySetting(extension: string): Promise<void> {
  const schema = schemas.find((s) => s.label === extension)!
  const panel = await openPage(handle.page, schema)
  const folder = mkdtempSync(join(tmpdir(), 'terminator-e2e-setting-folder-'))
  for (const [key, def] of Object.entries(schema.properties)) {
    if (def.type === 'action') {
      await pressActionSetting(handle, panel, def)
      continue
    }
    const value = NOTIFY.test(key) ? false : chosenValue(key, def, folder)
    await writeControl(handle, panel, { key, def, value })
    expected.set(key, value)
  }
  await closeSettingsPanel(handle.page)
  const keys = Object.keys(schema.properties).filter((key) => expected.has(key))
  await expect
    .poll(async () => {
      const values = await storedValues(handle.page)
      return keys.filter((key) => differs(values[key], expected.get(key)))
    })
    .toEqual([])
}

async function valuesSurviveRestart(): Promise<void> {
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
  const values = await storedValues(handle.page)
  expect([...expected].filter(([key, value]) => differs(values[key], value))).toEqual([])
  for (const schema of schemas) {
    const panel = await openPage(handle.page, schema)
    for (const [key, def] of Object.entries(schema.properties)) {
      if (expected.has(key)) await expectControl(panel, { key, def, value: expected.get(key) })
    }
    await closeSettingsPanel(handle.page)
  }
}

const EXTENSIONS_WITH_SETTINGS = [
  'Foundry',
  'Git Integration',
  'Notepad',
  'Remote Control',
  'Task Vault',
]

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const WRITE_STEPS: Steps = [
  ...EXTENSIONS_WITH_SETTINGS.map((extension): Steps[number] => [
    `${extension}: every setting is written from its settings page`,
    () => writesEverySetting(extension),
  ]),
  ['every value survives a restart, in main and on each settings page', valuesSurviveRestart],
]

// The second flow reads what the first wrote, so the two run in order on one profile.
test.describe.configure({ mode: 'serial' })

test('every extension setting is written from its page and survives a restart', async () => {
  for (const [title, body] of WRITE_STEPS) await test.step(title, body)
})

async function gitIntegrationOffRegistersNoCommands(): Promise<void> {
  const { page } = handle
  // Its page is the first thing it registers, so once the page is here its
  // activation has run, and the commands it would register are not there.
  const schema = schemas.find((s) => s.extensionId === 'terminator.git-integration')!
  const panel = await openPage(page, schema)
  await expect(settingRow(panel, 'Enable Git Integration').getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'false'
  )
  await closeSettingsPanel(page)
  const { commands } = await page.evaluate(() => window.electronAPI.extension.getCommands())
  expect(commands.filter((c) => c.extensionId === 'terminator.git-integration')).toEqual([])
}

async function foundryOrderStartsWithSettings(): Promise<void> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'Tighten the login checks' },
    repoPaths: [repo],
  })) as { order?: { budgets: unknown; writeBack: unknown; risk: { criticalPaths: string[] } } }
  expect(created.order?.budgets).toMatchObject({ agents: 7, wallClockMinutes: 50 })
  expect(created.order?.writeBack).toEqual([])
  expect(created.order?.risk.criticalPaths).toEqual(['src/auth/**'])
}

async function notepadNoteStartsWithDefaultTags(): Promise<void> {
  await projectGroup(handle.page, 'main').click()
  await runQuickActionFromPanel(handle.page, 'New note')
  await expect
    .poll(() =>
      inExtensionView<string>(handle, 'terminator.notepad', 'document.body.innerText').catch(
        () => ''
      )
    )
    .toContain('e2e-tag')
}

// Every notification row is switched off above. Task Vault raises "Task
// completed" through the shared dispatcher exactly as here; switching one
// target back on is what brings it back.
async function notificationSwitchRoutesIt(): Promise<void> {
  const { page } = handle
  const raiseNotification = (title: string) =>
    page.evaluate(async (t) => {
      await window.electronAPI.notifications.create({
        type: 'success',
        title: t,
        source: 'terminator.task-vault',
        key: 'taskCompleted',
      })
      return (await window.electronAPI.notifications.list()).find((n) => n.title === t)?.targets
    }, title)
  // With every target off it is not recorded at all.
  expect(await raiseNotification('Completed: muted')).toBeUndefined()
  const schema = schemas.find((s) => s.extensionId === 'terminator.task-vault')!
  const panel = await openPage(page, schema)
  await panel.getByRole('checkbox', { name: 'Task completed → center', exact: true }).click()
  await closeSettingsPanel(page)
  await expect.poll(() => raiseNotification('Completed: heard')).toEqual(['center'])
  await page.locator('.app-band__entry[aria-label^="Notifications"]').click()
  await expect(page.locator('.notif-item', { hasText: 'Completed: heard' })).toBeVisible()
  await expect(page.locator('.notif-item', { hasText: 'Completed: muted' })).toHaveCount(0)
  await page.keyboard.press('Escape')
}

async function remoteControlViewerLimitMatchesPage(): Promise<void> {
  await handle.page.locator('button[aria-label="Remote Control"]').click()
  await expect
    .poll(() =>
      inExtensionView<string>(handle, 'terminator.remote-control', 'document.body.innerText').catch(
        () => ''
      )
    )
    .toContain('13')
}

const EFFECT_STEPS: Steps = [
  [
    'Git Integration switched off keeps its settings page, and registers no commands',
    gitIntegrationOffRegistersNoCommands,
  ],
  [
    "Foundry's budgets, critical paths and write-backs are what a new order starts with",
    foundryOrderStartsWithSettings,
  ],
  [
    "Notepad's default tags are on a new note before anything is typed",
    notepadNoteStartsWithDefaultTags,
  ],
  [
    'a notification switched off goes nowhere, and switched on reaches the centre',
    notificationSwitchRoutesIt,
  ],
  ["Remote Control's viewer limit is the one its page shows", remoteControlViewerLimitMatchesPage],
]

test('what the settings change shows where a person looks for it', async () => {
  for (const [title, body] of EFFECT_STEPS) await test.step(title, body)
})
