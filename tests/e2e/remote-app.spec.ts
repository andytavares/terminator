import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// End-to-end guard for the browser `/app/` remote surface — the feature that
// silently broke when the bridge default-deny enforcement shipped without an
// allowlist. This launches the real Electron app, enables the remote-control
// server, then loads `/app/` in a real browser and asserts that a workspace
// created in the desktop app appears remotely — which can only happen if the
// IPC bridge `invoke` (workspace:list) flows through end-to-end.
//
// Requires a built app (`npm run build`) — `/app/` serves `out/renderer/index.html`.

const TEST_PORT = 17682
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

test('/app/ browser remote renderer loads and the IPC bridge serves workspace:list', async ({
  playwright,
}) => {
  // 1. Create a workspace in the desktop app so we have something to observe remotely.
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.dialog__title')
  await page.getByPlaceholder('My Workspace').fill(WS_NAME)
  // folderPath is required by the schema; point it at the (non-repo) temp profile dir.
  await page.getByPlaceholder('/path/to/folder').fill(userDataDir)
  await page.click('.dialog__btn-primary')
  await expect(page.locator('.repo-header__name').filter({ hasText: WS_NAME })).toBeVisible()

  // 2. Enable the remote-control server on an isolated port and read its password.
  const remote = await page.evaluate(async (port) => {
    const bridge = (
      window as unknown as {
        electronAPI: { extensionBridge: { invoke: (c: string, p: unknown) => Promise<unknown> } }
      }
    ).electronAPI.extensionBridge
    await bridge.invoke('remote:port-change', { port })
    await bridge.invoke('remote:toggle', { enabled: true })
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      const s = (await bridge.invoke('remote:get-settings', {})) as {
        password: string
        lanUrl?: string
        port: number
      }
      if (s.lanUrl) return s
      await new Promise((r) => requestAnimationFrame(r))
    }
    throw new Error('remote server did not start (no lanUrl after 6s)')
  }, TEST_PORT)

  const baseURL = `http://127.0.0.1:${TEST_PORT}`

  // 3. Authenticate and obtain a single-use ticket to enter /app/.
  const api = await playwright.request.newContext({ baseURL })
  const ticketRes = await api.post('/api/app-ticket', {
    headers: { Authorization: `Bearer ${remote.password}` },
  })
  expect(ticketRes.status()).toBe(201)
  const { ticket } = (await ticketRes.json()) as { ticket: string }

  // 4. Load /app/ in a real browser. Seed remote_token so the renderer's IPC
  //    shim can authenticate the bridge WebSocket (the app-session cookie is
  //    scoped to /app and is not sent to /api/bridge-ticket).
  const browser = await playwright.chromium.launch()
  const context = await browser.newContext({ baseURL })
  await context.addInitScript((pw) => {
    window.localStorage.setItem('remote_token', pw as string)
  }, remote.password)
  const remotePage = await context.newPage()
  await remotePage.goto(`/app/?t=${ticket}`)

  // 5. The remote renderer must boot, connect the bridge, and render the
  //    desktop-created workspace — proving the bridge invoke path works.
  await expect(remotePage.locator('.repo-header__name').filter({ hasText: WS_NAME })).toBeVisible({
    timeout: 20000,
  })

  await browser.close()
  await api.dispose()

  // Disable the server again so it doesn't linger past the test.
  await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        electronAPI: { extensionBridge: { invoke: (c: string, p: unknown) => Promise<unknown> } }
      }
    ).electronAPI.extensionBridge
    await bridge.invoke('remote:toggle', { enabled: false })
  })
})
