import type { ExtensionAPI } from '@terminator/extension-sdk'
import type { ShellExec } from './line/integrate.js'

/** The time a record is stamped with, as every deps object's `now` gives it. */
export function isoNow(): string {
  return new Date().toISOString()
}

/** The host's `git` and `gh` runner, as every deps object's `exec` takes it. */
export function shellExecOf(api: ExtensionAPI): ShellExec {
  return (options) => api.shell.exec(options)
}
