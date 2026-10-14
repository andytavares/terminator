import { test, expect, type Browser, type Page } from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  e2ePath,
  launchApp,
} from './helpers'
import { openFromAppBand } from './extension-page'

// Remote Control's channels, driven from its view, with each effect read where it lands: a
// browser running the real remote renderer, the server, or the clipboard. The public address
// comes from a stand-in ngrok (fixtures/ngrok-bin/ngrok) that accepts only this spec's token.

const NGROK_STUB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ngrok-bin')
const NGROK_TOKEN = 'e2e-ngrok-token'
const PUBLIC_URL = 'https://e2e-stub.ngrok-free.app'
const PORT = 17683
const PASSWORD = 'e2e-remote-control'
const BASE_URL = `http://127.0.0.1:${PORT}`
const PUBLIC_HEADING = 'On — reachable from any browser'

/** Every channel Remote Control registers (extensions/remote-control/src/index.ts). */
const REMOTE_CONTROL_CHANNELS = [
  'remote:toggle',
  'remote:port-change',
  'remote:update-password',
  'remote:update-max-subscribers',
  'remote:update-ngrok-token',
  'remote:caddyfile',
  'remote:get-settings',
  'remote:disconnect-device',
  'remote:tunnel-reconnect',
]

let handle: AppHandle
/** The Remote Control view in the desktop app. */
let view: Page
/** Chromium, where every phone in this spec runs the remote renderer. */
let browser: Browser
/** A phone watching the desktop app's terminal. */
let phone: Page

test.beforeAll(async ({ playwright }) => {
  handle = await launchApp(undefined, { PATH: e2ePath(NGROK_STUB_DIR) })
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

async function tokenOpensThePublicAddress(): Promise<void> {
  await openRemoteSettings()
  await saveRemoteField('Account token', NGROK_TOKEN)
  await view.getByPlaceholder('New password').fill(PASSWORD)
  await view.getByRole('button', { name: 'Set password' }).click()
  await expect(view.getByText('A password is set.')).toBeVisible()
  await saveRemoteField('Port', String(PORT))
  await view.getByRole('button', { name: 'Turn on' }).click()
  // The stand-in opens a tunnel only when ngrok is started with the saved token.
  await expect(heading(PUBLIC_HEADING)).toBeVisible({ timeout: 20_000 })
  await expect(view.locator('.rc-address__url')).toHaveText(PUBLIC_URL)
}

async function reconnectKeepsThePhone(): Promise<void> {
  phone = await openPhone()
  await expect(view.locator('.rc-device')).toHaveCount(1)
  await fetch('http://127.0.0.1:4040/e2e/crash')
  await expect(heading('The public address stopped working.')).toBeVisible()
  await view.getByRole('button', { name: 'Reconnect' }).click()
  await expect(heading(PUBLIC_HEADING)).toBeVisible({ timeout: 20_000 })
  await expect(view.locator('.rc-address__url')).toHaveText(PUBLIC_URL)
  // Only the tunnel restarted: the phone on this network never lost its terminal.
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

/** What the app put on the system clipboard. */
function clipboardText(): Promise<string> {
  return handle.app.evaluate(({ clipboard }) => clipboard.readText())
}

async function caddyfileProxiesTheRemoteRenderer(): Promise<void> {
  await handle.app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'))
  await openRemoteSettings()
  await view.getByRole('button', { name: 'Copy Caddyfile' }).click()
  await expect.poll(clipboardText).toContain(`reverse_proxy localhost:${PORT}`)
  expect(await clipboardText()).toContain('tls internal')
  // The upstream it names serves the remote renderer's sign-in page.
  const upstream = /reverse_proxy (\S+)/.exec(await clipboardText())![1]
  const page = await browser.newPage()
  await page.goto(`http://${upstream}/`)
  await expect(page.getByRole('heading', { name: 'Terminator Remote' })).toBeVisible()
  await page.close()
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

async function remoteRendererCannotDriveRemoteControl(): Promise<void> {
  const desk = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1600, height: 900 } })
  await desk.goto('/')
  await desk.getByPlaceholder('Password').fill(PASSWORD)
  await desk.getByRole('button', { name: 'Connect' }).click()
  await desk.waitForURL(/\/app\//)
  await expect(desk.locator('.repo-header__name', { hasText: 'Remote-WS' })).toBeVisible()
  expect(await invokeEach(desk, REMOTE_CONTROL_CHANNELS)).toEqual(
    REMOTE_CONTROL_CHANNELS.map(() => 'channel not remote-accessible')
  )
  // Nothing it asked for happened: the server is still on, with its address.
  await expect(heading(PUBLIC_HEADING)).toBeVisible()
  await desk.close()
}

test.describe.serial('Remote Control, driven from its view', () => {
  test(
    'the account token saved in Settings is what opens the public address',
    tokenOpensThePublicAddress
  )
  test(
    'Reconnect brings a dropped public address back and keeps the phone connected',
    reconnectKeepsThePhone
  )
  test(
    'a viewer over the limit saved in Settings is turned away, and told so',
    viewerLimitTurnsTheNextAway
  )
  test('Disconnect ends that phone’s connection, and it says so', disconnectEndsThatPhone)
  test(
    'Copy Caddyfile names the address the remote renderer is served from',
    caddyfileProxiesTheRemoteRenderer
  )
  test(
    'the remote renderer can drive none of these channels itself',
    remoteRendererCannotDriveRemoteControl
  )
})
