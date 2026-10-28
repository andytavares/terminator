import { test, expect, type Browser, type Page } from '@playwright/test'
import { AppHandle, addAndSelectProject, closeApp, createWorkspace, launchApp } from './helpers'
import { openFromAppBand, type ExtensionView } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

// Remote Control's channels, driven from its view, with each effect read where it lands: a
// browser running the real remote renderer (phone and desktop layouts), the server, or the
// clipboard. The ngrok tunnel is not driven here: ngrok-manager.spec.ts and
// extension-index.spec.ts check the token reaches ngrok and the address comes back.

const PORT = 17683
const PASSWORD = 'e2e-remote-control'
const BASE_URL = `http://127.0.0.1:${PORT}`
const LOCAL_HEADING = 'On — reachable on this network'

/** Every channel Remote Control registers (extensions/remote-control/src/index.ts). */
const REMOTE_CONTROL_CHANNELS = [
  'remote:toggle',
  'remote:port-change',
  'remote:update-password',
  'remote:update-max-subscribers',
  'remote:update-ngrok-token',
  'remote:get-settings',
  'remote:disconnect-device',
  'remote:tunnel-reconnect',
]

let handle: AppHandle
/** The Remote Control view in the desktop app. */
let view: ExtensionView
/** Chromium, where every phone in this spec runs the remote renderer. */
let browser: Browser
/** A phone watching the desktop app's terminal. */
let phone: Page
/** A desktop browser running the remote renderer at /app/. */
let desk: Page
test.beforeAll(async ({ playwright }) => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Remote-WS', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Remote-WS', 'phone-branch')
  view = await openFromAppBand(handle, 'Remote Control', 'remote-control')
  browser = await playwright.chromium.launch()
})

test.afterAll(async () => {
  await browser?.close()
  await closeApp(handle)
})

/** The view's Settings section, opened. */
async function openRemoteSettings(): Promise<void> {
  const toggle = view.getByRole('button', { name: /^Settings/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Types `value` into the settings field labelled `label` and leaves it, which saves it. */
async function saveRemoteField(label: string, value: string): Promise<void> {
  const field = view.getByLabel(label, { exact: true })
  await field.fill(value)
  await field.blur()
}

/** A phone's browser signing in on the remote renderer's own page and opening
 * the desktop app's terminal from its list, as a person does. */
async function openPhone(): Promise<Page> {
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 390, height: 844 } })
  await page.goto('/')
  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.waitForURL(/\/mobile\//)
  await page.locator('.mobile-list__terminal').first().click()
  await expect(page.locator('.mobile-terminal-container')).toBeVisible()
  return page
}

function heading(name: string) {
  return view.getByRole('heading', { name, exact: true })
}

async function turnedOnWithAPassword(): Promise<void> {
  await openRemoteSettings()
  await view.getByPlaceholder('New password').fill(PASSWORD)
  await view.getByRole('button', { name: 'Set password' }).click()
  await expect(view.getByText('A password is set.')).toBeVisible()
  await saveRemoteField('Port', String(PORT))
  await view.getByRole('button', { name: 'Turn on' }).click()
  await expect(heading(LOCAL_HEADING)).toBeVisible()
}

async function phoneSignsInAndWatches(): Promise<void> {
  phone = await openPhone()
  await expect(view.locator('.rc-device')).toHaveCount(1)
  await expect(phone.getByRole('alert')).toHaveCount(0)
}

async function viewerLimitTurnsTheNextAway(): Promise<void> {
  await openRemoteSettings()
  await saveRemoteField('Viewers per terminal', '1')
  await expect(view.getByText('up to 1 viewers')).toBeVisible()
  await expect(view.locator('.rc-count')).toHaveText('1 of 1')
  const second = await openPhone()
  await expect(second.getByRole('alert')).toContainText('already has as many viewers as allowed')
  await expect(view.locator('.rc-device')).toHaveCount(1)
  await second.close()
}

async function disconnectEndsThatPhone(): Promise<void> {
  await expect(view.locator('.rc-device__label')).toHaveText(/Chrome on/)
  await view.locator('.rc-device').getByRole('button', { name: 'Disconnect' }).click()
  await expect(phone.getByRole('alert')).toContainText('The desktop app disconnected this device.')
  await expect(view.locator('.rc-device')).toHaveCount(0)
  await expect(view.getByText(/Nothing connected/)).toBeVisible()
}

/** Each channel invoked from the remote renderer's bridge: what came back. */
function invokeEach(page: Page, channels: string[]): Promise<string[]> {
  return page.evaluate(
    (names) =>
      Promise.all(
        names.map((name) =>
          window.electronAPI.extensionBridge.invoke(name, {}).then(
            () => 'answered',
            (error: Error) => error.message
          )
        )
      ),
    channels
  )
}

/** /app/ in a browser signed in with the password: the session cookie gets the bridge ticket
 * (no password in the page or a header), and the bridge serves workspace:list, so the
 * workspace made in the desktop app is drawn. */
async function browserRendererShowsTheDesktopWorkspace(): Promise<void> {
  desk = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1600, height: 900 } })
  await desk.goto('/')
  await desk.getByPlaceholder('Password').fill(PASSWORD)
  await desk.getByRole('button', { name: 'Connect' }).click()
  await desk.waitForURL(/\/app\//)
  expect((await desk.request.post('/api/app-ticket')).status()).toBe(201)
  await expect(desk.locator('.repo-header__name', { hasText: 'Remote-WS' })).toBeVisible()
  await desk.click('.sidebar-header__add')
  const dialog = desk.getByRole('dialog', { name: 'Create Workspace' })
  await expectCentredInWindow(dialog, 'Remote client: Create Workspace')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
}

async function remoteRendererCannotDriveRemoteControl(): Promise<void> {
  expect(await invokeEach(desk, REMOTE_CONTROL_CHANNELS)).toEqual(
    REMOTE_CONTROL_CHANNELS.map(() => 'channel not remote-accessible')
  )
  // Nothing it asked for happened: the server is still on.
  await expect(heading(LOCAL_HEADING)).toBeVisible()
  await desk.close()
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const REMOTE_STEPS: Steps = [
  [
    'Remote Control is turned on with a password, on the port saved in Settings',
    turnedOnWithAPassword,
  ],
  ['a phone signs in with the password and watches the terminal', phoneSignsInAndWatches],
  [
    'a viewer over the limit saved in Settings is turned away, and told so',
    viewerLimitTurnsTheNextAway,
  ],
  ['Disconnect ends that phone’s connection, and it says so', disconnectEndsThatPhone],
  [
    "the browser remote renderer shows the desktop's workspace through its bridge, and centres its dialogs",
    browserRendererShowsTheDesktopWorkspace,
  ],
  [
    'the remote renderer can drive none of these channels itself',
    remoteRendererCannotDriveRemoteControl,
  ],
]

test('Remote Control is turned on from its view and used from a phone and a browser', async () => {
  for (const [title, body] of REMOTE_STEPS) await test.step(title, body)
})
