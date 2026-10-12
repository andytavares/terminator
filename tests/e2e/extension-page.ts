import { expect, type Page } from '@playwright/test'
import type { AppHandle } from './helpers'

// An extension's view is its own WebContentsView on an ext:// origin. Playwright
// attaches to it like any other page in the app's browser context, so a spec can
// click, type and read it with ordinary locators instead of injecting scripts.

/** The loaded page whose URL contains `urlPart`, once it exists. */
export async function extensionPage(handle: AppHandle, urlPart: string): Promise<Page> {
  const find = () =>
    handle.app
      .context()
      .pages()
      .find((page) => page.url().startsWith('ext://') && page.url().includes(urlPart))
  await expect
    .poll(() => Boolean(find()), { timeout: 20_000, message: `no ext:// page for ${urlPart}` })
    .toBe(true)
  const page = find() as Page
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Opens an extension from the app band and returns its view. */
export async function openExtension(
  handle: AppHandle,
  bandLabel: string,
  urlPart: string
): Promise<Page> {
  await handle.page.locator(`.app-band__entry[aria-label="${bandLabel}"]`).click()
  return extensionPage(handle, urlPart)
}

/**
 * Calls an extension channel from `page`, exactly as the extension's own UI
 * does. Specs use it to read back what an action stored, never to perform the
 * action a user would.
 */
export function invokeChannel<T = unknown>(
  page: Page,
  channel: string,
  payload?: unknown
): Promise<T> {
  return page.evaluate(
    ([name, body]) =>
      (
        window as unknown as {
          electronAPI: { extensionBridge: { invoke(c: string, p?: unknown): Promise<unknown> } }
        }
      ).electronAPI.extensionBridge.invoke(name as string, body),
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
