import type { vi } from 'vitest'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

/** A typed order with one repository, `/repos/app`, and `over` on top. */
export function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

/** Each call a fake checkout `exec` received. */
export function calls(exec: ReturnType<typeof vi.fn>) {
  return exec.mock.calls.map((c) => c[0] as { command: string; args: string[]; cwd: string })
}
