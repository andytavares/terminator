/**
 * A function cannot cross a MessagePort. The extension host keeps each callback
 * an extension passes and sends a marker with its id in its place; main puts a
 * function back that raises a `callback` event with that id (ADR 094).
 */
interface CallbackMarker {
  $callback: number
}

type Callback = (...args: unknown[]) => unknown

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isMarker(value: unknown): value is CallbackMarker {
  return isPlainObject(value) && typeof value.$callback === 'number'
}

/** `value` with every function, at any depth of arrays and plain objects, replaced. */
function mapFunctions(value: unknown, replace: (fn: Callback) => unknown): unknown {
  if (typeof value === 'function') return replace(value as Callback)
  if (Array.isArray(value)) return value.map((item) => mapFunctions(item, replace))
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapFunctions(item, replace)])
  )
}

/** The extension host's side: the callbacks it holds, by id. */
export class CallbackRegistry {
  private readonly callbacks = new Map<number, Callback>()
  private nextId = 1

  /** The params with each function swapped for a marker, and the ids that were minted. */
  marshal(params: unknown[]): { params: unknown[]; ids: number[] } {
    const ids: number[] = []
    const marshalled = mapFunctions(params, (callback) => {
      const id = this.nextId++
      this.callbacks.set(id, callback)
      ids.push(id)
      return { $callback: id } satisfies CallbackMarker
    }) as unknown[]
    return { params: marshalled, ids }
  }

  /** Calls the callback `id`; one already released is not called. */
  invokeById(id: number, args: unknown[]): unknown {
    return this.callbacks.get(id)?.(...args)
  }

  release(ids: readonly number[]): void {
    for (const id of ids) this.callbacks.delete(id)
  }
}

/** Main's side: `value` with each marker replaced by the function `revive` makes for its id. */
export function reviveCallbacks(value: unknown, revive: (id: number) => Callback): unknown {
  if (isMarker(value)) return revive(value.$callback)
  if (Array.isArray(value)) return value.map((item) => reviveCallbacks(item, revive))
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, reviveCallbacks(item, revive)])
  )
}
