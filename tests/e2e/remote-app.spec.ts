import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { expectCentredInWindow } from './modal-centre'

// End-to-end guard for the browser `/app/` remote surface — the feature that
// silently broke when the bridge default-deny enforcement shipped without an
// allowlist. This launches the real Electron app, enables the remote-control
// server, then loads `/app/` in a real browser and asserts that a workspace
// created in the desktop app appears remotely — which can only happen if the
// IPC bridge `invoke` (workspace:list) flows through end-to-end.
//
// Requires a built app (`npm run build`) — `/app/` serves `out/renderer/index.html`.

const TEST_PORT = 17682
const TEST_PASSWORD = 'e2e-remote-password'
const WS_NAME = 'E2E-Remote-WS'

let handle: AppHandle
let page: AppHandle['page']
let userDataDir: string

test.beforeAll(async () => {
  // launchApp gives a hermetic, isolated profile under this run's shared
  // root, and prepends the `claude` stub to PATH, same as every other spec.
  handle = await launchApp()
  page = handle.page
  userDataDir = handle.userDataDir
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** 1. A workspace created in the desktop app, so there is something to observe remotely. */
async function createDesktopWorkspace(): Promise<void> {
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.tmui-dialog__title')
  await page.getByPlaceholder('My Workspace').fill(WS_NAME)
  // folderPath is required by the schema; point it at the (non-repo) temp profile dir.
  await page.getByPlaceholder('/path/to/folder').fill(userDataDir)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(page.locator('.repo-header__name').filter({ hasText: WS_NAME })).toBeVisible()
}

/** 2. Sets a password, then enables the remote-control server on an isolated
 * port. The password is stored only as a hash, so the test keeps the one it chose. */
async function startRemoteServer(): Promise<void> {
  await page.evaluate(
    async ({ port, password }) => {
      const bridge = window.electronAPI.extensionBridge
      await bridge.invoke('remote:update-password', { password })
      await bridge.invoke('remote:port-change', { port })
      await bridge.invoke('remote:toggle', { enabled: true })
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        const s = (await bridge.invoke('remote:get-settings', {})) as {
          lanUrl?: string
          port: number
        }
        if (s.lanUrl) return s
        await new Promise((r) => requestAnimationFrame(r))
      }
      throw new Error('remote server did not start (no lanUrl after 6s)')
    },
    { port: TEST_PORT, password: TEST_PASSWORD }
  )
}

type Playwright = PlaywrightWorkerArgs['playwright']

/** 3. Logs in with the password; the session cookie authorises the ticket request. */
async function appTicket(
  playwright: Playwright,
  baseURL: string
): Promise<{ api: APIRequestContext; ticket: string }> {
  const api = await playwright.request.newContext({ baseURL })
  const loginRes = await api.post('/api/login', { data: { password: TEST_PASSWORD } })
  expect(loginRes.status()).toBe(200)
  const ticketRes = await api.post('/api/app-ticket')
  expect(ticketRes.status()).toBe(201)
  const { ticket } = (await ticketRes.json()) as { ticket: string }
  return { api, ticket }
}

/** 4. /app/ in a browser logged in the same way gets a bridge ticket with the session cookie
 * (no password in the page or a header). 5. The remote renderer boots, connects the bridge,
 * and renders the desktop-created workspace. */
async function expectRemoteWorkspace(
  playwright: Playwright,
  baseURL: string,
  ticket: string
): Promise<void> {
  const browser = await playwright.chromium.launch()
  const context = await browser.newContext({ baseURL })
  expect(
    (await context.request.post('/api/login', { data: { password: TEST_PASSWORD } })).status()
  ).toBe(200)
  const remotePage = await context.newPage()
  await remotePage.goto(`/app/?t=${ticket}`)
  await expect(remotePage.locator('.repo-header__name').filter({ hasText: WS_NAME })).toBeVisible({
    timeout: 20000,
  })
  await expectRemoteModalCentred(remotePage)
  await browser.close()
}

/** A modal in the remote client sits in the middle of the browser's window, as in the app. */
async function expectRemoteModalCentred(remotePage: Page): Promise<void> {
  await remotePage.click('.sidebar-header__add')
  const dialog = remotePage.getByRole('dialog', { name: 'Create Workspace' })
  await expectCentredInWindow(dialog, 'Remote client: Create Workspace')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
}

test('/app/ browser remote renderer loads and the IPC bridge serves workspace:list', async ({
  playwright,
}) => {
  await createDesktopWorkspace()
  await startRemoteServer()
  const baseURL = `http://127.0.0.1:${TEST_PORT}`
  const { api, ticket } = await appTicket(playwright, baseURL)
  await expectRemoteWorkspace(playwright, baseURL, ticket)
  await api.dispose()

  // Disable the server again so it doesn't linger past the test.
  await page.evaluate(async () => {
    const bridge = window.electronAPI.extensionBridge
    await bridge.invoke('remote:toggle', { enabled: false })
  })
})
