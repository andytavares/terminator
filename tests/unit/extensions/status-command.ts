import type { ExtensionAPI } from '@terminator/extension-sdk'

/** `git status` through an extension's shell API, in `cwd`. */
export const gitStatusIn = (api: ExtensionAPI, cwd: string) =>
  api.shell.exec({ command: 'git', args: ['status'], cwd })
