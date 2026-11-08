import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { makeTempDir } from '../../../tests/support/temp-dir'
import { integrateDepsFor } from '../src/line/ship-deps.js'
import { ledgerActions } from './helpers/order-ledger'

const here = path.dirname(fileURLToPath(import.meta.url))
// The modules `activate` composes, read as one text: what these specs look for
// lives in whichever of them owns it.
const src = [
  'index.ts',
  'workspace-root.ts',
  'state/settings.ts',
  'state/settings-schema.ts',
  'runtime/agent-policy.ts',
  'runtime/held-calls.ts',
  'runtime/supervision-runtime.ts',
  'line/executor-deps.ts',
  'line/node-session.ts',
  'line/ship-deps.ts',
  'line/execute-run.ts',
  'forge/intake-turn.ts',
  'ipc/inbox-registration.ts',
  'ipc/ui-registration.ts',
]
  .map((file) => fs.readFileSync(path.join(here, '..', 'src', file), 'utf8'))
  .join('\n')

/** Every setting key the extension declares to the host. */
function declaredSettings(): string[] {
  return [...new Set([...src.matchAll(/'(terminator\.foundry\.[^']+)':\s*\{/g)].map((m) => m[1]))]
}

// A setting nothing reads is a control the operator can move while the factory
// ignores it. Thirty-three of them shipped: ten notification kinds carried over
// from the retired extension ("Could not start queued card"), three budgets,
// the critical-path list, a duplicate concurrency limit and a log retention
// nothing pruned. Every one had a label, a default and a place in the settings
// panel, and none of them did anything.
describe('the settings surface', () => {
  it('reads every setting it registers', () => {
    const unread = declaredSettings().filter((key) => {
      // The declaration itself is `'key': {`; a read is the same string
      // anywhere else — `settings.get('key')` or `settings.set('key', …)`.
      const occurrences = src.split(`'${key}'`).length - 1
      return occurrences < 2
    })
    expect(declaredSettings().length, 'found no declarations to check').toBeGreaterThan(5)
    expect(unread, `registered but read by nothing: ${unread.join(', ')}`).toEqual([])
  })
})

// `record` writes through the order store alone, and the draft setting is optional.
const noSettingsHost = {} as ExtensionAPI

// A shipping entry's subject is whatever the entry is about: the order for
// `ship.ready_asked`, and the pull request **URL** for `ship.draft_opened`.
// Filing the entry by its subject sent the most important record the feature
// writes to a ledger named after a URL, and built the directories to match —
// watched on a live run that opened a real draft:
//
//   .foundry/orders/https:/github.com/owner/repo/pull/8/ledger.jsonl
//
// The order's own ledger never mentioned the draft it had just opened.

describe('which ledger a shipping entry goes in', () => {
  it('files a shipping entry by the order it was built for, at every call site', async () => {
    const root = makeTempDir('foundry-ship-ledger-')
    const pullRequest = 'https://github.com/owner/repo/pull/8'
    await integrateDepsFor(noSettingsHost, root, 'WO-1').record(
      'ship.draft_opened',
      pullRequest,
      'opened a draft'
    )
    expect(await ledgerActions(root, 'WO-1')).toEqual(['ship.draft_opened'])
    expect(src).toContain('integrateDepsFor(api, root, order.id)')
    expect(src).toContain('integrateDepsFor(api, dataRoot(), gate.orderId)')
  })
})
