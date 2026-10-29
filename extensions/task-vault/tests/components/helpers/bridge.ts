import { vi } from 'vitest'
import { installExtensionBridge } from '../../../../../tests/support/extension-bridge'
import type { IndexedProject, IndexedTask } from '../../../src/vault/types'

export { eventually } from '../../../../../tests/support/extension-bridge'

/** The extension bridge as task-vault's views see it: unanswered channels succeed. */
export function installVaultBridge(extra: Record<string, unknown> = {}) {
  const recordUsage = vi.fn()
  const bridge = installExtensionBridge(
    { success: true },
    { usage: { record: recordUsage }, ...extra }
  )
  return { ...bridge, recordUsage }
}

/** A task as the vault channels return it. */
export function task(id: string, text: string, overrides: Partial<IndexedTask> = {}): IndexedTask {
  return {
    id,
    filePath: 'daily/2026-01-05',
    line: 0,
    status: 'open',
    text,
    terminatorLinks: [],
    subtasks: [],
    ...overrides,
  }
}

/** A project as the vault channels return it. */
export function indexedProject(
  name: string,
  overrides: Partial<IndexedProject> = {}
): IndexedProject {
  return {
    id: `p-${name}`,
    filePath: name,
    name,
    status: 'active',
    isStale: false,
    nextActionCount: 1,
    lastModified: '2026-01-01T00:00:00Z',
    terminatorLinks: [],
    ...overrides,
  }
}

/** The local date `offset` days from today, as YYYY-MM-DD. */
export function dayFromToday(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
