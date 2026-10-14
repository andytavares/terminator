import type { ElectronApplication } from '@playwright/test'

// Stand-ins for main's `dialog` and `shell`, replaced on the running app, so its code runs
// unchanged up to the OS and the spec reads what crossed it.

/** Makes the native folder picker answer `folder`, as if the operator had chosen it. */
export async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
  }, folder)
}

/** Records what the app hands the OS to open, instead of opening it: a URL for
 * the browser, or a path for the default application. */
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

/** Lets the app keep credentials without a keychain (a Linux container has no Secret Service),
 * through Electron's plain-text backend; macOS is unchanged:
 * https://www.electronjs.org/docs/latest/api/safe-storage#safestoragesetuseplaintextencryptionuseplaintext */
export async function allowCredentialsWithoutKeychain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ safeStorage }) => {
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  })
}
