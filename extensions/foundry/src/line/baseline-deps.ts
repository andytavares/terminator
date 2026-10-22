import type { ExtensionAPI } from '@terminator/extension-sdk'

import { isoNow, shellExecOf } from '../host-calls.js'
import type { OrderStore } from '../order/store.js'
import { runtime } from '../runtime/runtime-state.js'
import type { BaselineDeps } from './baseline.js'
import { workspaceOf } from './run-context.js'

/** What a run on the base branch needs: the host's shell, its supervised terminals, the order's ledger. */
export function baselineDepsFor(
  api: ExtensionAPI,
  root: string,
  store: Pick<OrderStore, 'record'>
): BaselineDeps {
  return {
    root,
    now: isoNow,
    exec: shellExecOf(api),
    runCommand: (options) => runtime.supervisedRunner?.runCommand(options) ?? Promise.resolve(null),
    workspaceOf: (origin) => workspaceOf(api, { origin }),
    record: store.record,
  }
}
