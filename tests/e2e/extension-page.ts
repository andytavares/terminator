import {
  expect,
  type Frame,
  type Keyboard,
  type Locator,
  type Mouse,
  type Page,
} from '@playwright/test'
import { frameFocusEmulated, type AppHandle } from './helpers'

// An extension's view is an iframe inside the main window's page (ADR 114), so
// Playwright sees it as a Frame of `handle.page`, not a Page. A Frame has no
// keyboard/mouse/screenshot of its own — those go through the host page.

/** The subset of `Frame` the e2e specs drive, plus the host page's keyboard
 * and mouse. Structurally what a pop-out Page also satisfies. */
export interface ExtensionView {
  locator: Frame['locator']
  getByRole: Frame['getByRole']
  getByText: Frame['getByText']
  getByPlaceholder: Frame['getByPlaceholder']
  getByLabel: Frame['getByLabel']
  getByTestId: Frame['getByTestId']
  getByTitle: Frame['getByTitle']
  evaluate: Frame['evaluate']
  waitForFunction: Frame['waitForFunction']
  waitForSelector: Frame['waitForSelector']
  frameLocator: Frame['frameLocator']
  url(): string
  /** The host page's input, which lands in the frame once it holds focus. */
  readonly keyboard: Keyboard
  readonly mouse: Mouse
  /** A shot of the frame's own iframe element, not of the whole window. */
  screenshot(options?: Parameters<Locator['screenshot']>[0]): Promise<Buffer>
  /** Reloads the frame's document and waits for it to parse. */
  reload(): Promise<void>
  /** The frame keeps its panel; bringing it to front is a no-op for a frame. */
  bringToFront(): Promise<void>
}

/** The extension frame of `handle.page` whose URL contains `urlPart`, or null while it attaches. */
export function extensionFrame(handle: AppHandle, urlPart: string): Frame | null {
  return (
    handle.page
      .frames()
      .find((frame) => frame.url().startsWith('ext://') && frame.url().includes(urlPart)) ?? null
  )
}

/** The git-integration frame showing `viewParam`, or null while it attaches. */
export function gitIntegrationFrame(handle: AppHandle, viewParam: string): Frame | null {
  return (
    handle.page
      .frames()
      .find((f) => f.url().includes('git-integration') && f.url().includes(`view=${viewParam}`)) ??
    null
  )
}

/** The frame of `handle.page` whose ext:// URL contains `urlPart`, once it exists. */
export async function findExtensionFrame(handle: AppHandle, urlPart: string): Promise<Frame> {
  await expect
    .poll(() => Boolean(extensionFrame(handle, urlPart)), {
      timeout: 20_000,
      message: `no ext:// frame for ${urlPart}`,
    })
    .toBe(true)
  const frame = extensionFrame(handle, urlPart) as Frame
  await frameFocusEmulated(handle.page, frame)
  return frame
}

/** The frame methods a view forwards to the frame found at each call, so a
 * re-opened view (a new frame at the same URL) answers instead of the first. */
const FORWARDED = [
  'locator',
  'getByRole',
  'getByText',
  'getByPlaceholder',
  'getByLabel',
  'getByTestId',
  'getByTitle',
  'evaluate',
  'waitForFunction',
  'waitForSelector',
  'frameLocator',
] as const

function extensionView(handle: AppHandle, urlPart: string, frame: Frame): ExtensionView {
  const { page } = handle
  // The iframe element carrying this frame (ExtensionPanelPortal puts
  // `data-extension-panel` on the wrapping div, not on the iframe itself).
  const iframe = () => page.locator(`[data-extension-panel] iframe[src^="ext://"]`).first()
  // The frame at a call, not the one found first: a spec can dismiss the view
  // and re-open it, and the re-open is a new frame at the same URL.
  const frameNow = (): Frame => extensionFrame(handle, urlPart) ?? frame
  const callOnFrame = <K extends keyof Frame>(method: K): Frame[K] =>
    ((...args: unknown[]) =>
      (frameNow()[method] as (...a: unknown[]) => unknown)(...args)) as Frame[K]
  const forwarded = Object.fromEntries(FORWARDED.map((method) => [method, callOnFrame(method)]))
  return {
    ...forwarded,
    url: () => frameNow().url(),
    keyboard: page.keyboard,
    mouse: page.mouse,
    screenshot: (options) => iframe().screenshot(options),
    reload: async (): Promise<void> => {
      await frameNow().evaluate(() => location.reload())
      await frameNow().waitForLoadState('domcontentloaded')
    },
    bringToFront: () => Promise.resolve(),
  } as ExtensionView
}

/** The loaded extension view whose URL contains `urlPart`, once it exists. */
export async function extensionPage(handle: AppHandle, urlPart: string): Promise<ExtensionView> {
  const frame = await findExtensionFrame(handle, urlPart)
  await frame.waitForLoadState('domcontentloaded')
  return extensionView(handle, urlPart, frame)
}

/** Opens an extension from the app band and returns its view. */
export async function openFromAppBand(
  handle: AppHandle,
  bandLabel: string,
  urlPart: string
): Promise<ExtensionView> {
  await handle.page.locator(`.app-band__entry[aria-label="${bandLabel}"]`).click()
  return extensionPage(handle, urlPart)
}

/** The pop-out window whose ext:// URL contains `urlPart`, once it exists. A
 * pop-out (`api.window.openAuxiliary`) is a real BrowserWindow, so it stays a
 * Playwright Page with `close`, `waitForEvent` and the rest. */
export async function popoutPage(handle: AppHandle, urlPart: string): Promise<Page> {
  const matchingWindow = () =>
    handle.app
      .windows()
      .find((page) => page.url().startsWith('ext://') && page.url().includes(urlPart))
  await expect
    .poll(() => Boolean(matchingWindow()), {
      timeout: 20_000,
      message: `no ext:// window for ${urlPart}`,
    })
    .toBe(true)
  const page = matchingWindow() as Page
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Runs `script` inside the first extension frame whose URL contains `urlPart`:
 * the frame the main window composites, reached from main as a `webFrameMain`. */
export function inExtensionView<T>(handle: AppHandle, urlPart: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { part, source }) => {
      const win = webContents.getAllWebContents().find((contents) => !contents.isDestroyed())
      const frame = win?.mainFrame.frames.find(
        (f) => f.url.startsWith('ext://') && f.url.includes(part)
      )
      if (!frame) throw new Error(`no extension frame loaded for ${part}`)
      return frame.executeJavaScript(source) as Promise<unknown>
    },
    { part: urlPart, source: script }
  ) as Promise<T>
}

/** Calls an extension channel from `view`, exactly as the extension's own UI
 * does. Specs use it to read back what an action stored, never to perform the
 * action a user would. */
export function invokeChannel<T = unknown>(
  view: Pick<Frame, 'evaluate'>,
  channel: string,
  payload?: unknown
): Promise<T> {
  return view.evaluate(
    ([name, body]) => window.electronAPI.extensionBridge.invoke(name as string, body),
    [channel, payload] as const
  ) as Promise<T>
}

/** Answers the next native save dialog in main with `filePath`, as if the user chose it. */
export async function answerNextSaveDialog(handle: AppHandle, filePath: string): Promise<void> {
  await handle.app.evaluate(({ dialog }, chosen) => {
    const original = dialog.showSaveDialog
    dialog.showSaveDialog = (async () => {
      dialog.showSaveDialog = original
      return { canceled: false, filePath: chosen }
    }) as typeof dialog.showSaveDialog
  }, filePath)
}

/** Answers the next native open dialog in main with `folder`, as if the user picked it. */
export async function answerNextOpenDialog(handle: AppHandle, folder: string): Promise<void> {
  await handle.app.evaluate(({ dialog }, picked) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original
      return { canceled: false, filePaths: [picked] }
    }) as typeof dialog.showOpenDialog
  }, folder)
}
