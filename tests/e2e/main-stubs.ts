import type { ElectronApplication } from '@playwright/test'

// Stand-ins for the parts of Electron's main process that reach outside the
// app: the native folder picker, and handing a URL or a file to the OS. A spec
// replaces them on the running app's own `dialog` and `shell` modules, so the
// app's code runs unchanged up to the edge and the spec reads what crossed it.

/** Makes the native folder picker answer `folder`, as if the operator had chosen it. */
export async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as unknown as typeof dialog.showOpenDialog
  }, folder)
}

/**
 * Records what the app hands the OS to open, instead of opening it: a URL for
 * the browser, or a path for the default application.
 */
export async function recordShellOpens(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    Object.assign(globalThis, { __shellOpened: opened })
    shell.openExternal = async (url: string) => void opened.push(url)
    shell.openPath = async (path: string) => (opened.push(path), '')
  })
}

/** Everything handed to the OS since `recordShellOpens`. */
export function shellOpens(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...((globalThis as { __shellOpened?: string[] }).__shellOpened ?? [])])
}

/**
 * Lets the app keep credentials where the OS offers no keychain (a Linux
 * container has no Secret Service), through Electron's own plain-text backend:
 * https://www.electronjs.org/docs/latest/api/safe-storage#safestoragesetuseplaintextencryptionuseplaintext
 * macOS always has its keychain, so this changes nothing there.
 */
export async function allowCredentialsWithoutKeychain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ safeStorage }) => {
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  })
}
