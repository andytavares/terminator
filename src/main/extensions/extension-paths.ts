import { join } from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'

/** The directories main knows. An extension sees the app's and only its own data folder. */
export interface AppPaths {
  app: string
  userData: string
}

/** One extension's `api.paths`: its data folder is `<userData>/extensions/<id>`, VS Code's
 * `ExtensionContext.globalStorageUri` (ADR 103). Nothing creates it here; the extension does
 * when it first writes, as in VS Code. */
export function extensionPaths(paths: AppPaths, extensionId: string): ExtensionAPI['paths'] {
  return { app: paths.app, globalStorage: join(paths.userData, 'extensions', extensionId) }
}
