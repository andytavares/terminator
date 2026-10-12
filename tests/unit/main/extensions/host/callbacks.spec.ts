import { describe, it, expect, vi } from 'vitest'
import {
  CallbackRegistry,
  reviveCallbacks,
} from '../../../../../src/main/extensions/host/callbacks'

describe('callbacks across the port', () => {
  it('replaces functions at any depth with markers that structured clone accepts', () => {
    const registry = new CallbackRegistry()
    const onClick = vi.fn()
    const handler = vi.fn()
    const { params, ids } = registry.marshal([
      { title: 't', onClick, actions: [{ id: 'a', handler }] },
    ])

    expect(ids).toHaveLength(2)
    expect(() => structuredClone(params)).not.toThrow()
    expect(params).toEqual([
      {
        title: 't',
        onClick: { $callback: ids[0] },
        actions: [{ id: 'a', handler: { $callback: ids[1] } }],
      },
    ])
  })

  it('leaves values that are not plain objects as they are', () => {
    const registry = new CallbackRegistry()
    const bytes = new Uint8Array([1, 2])
    const { params } = registry.marshal([bytes, null, 'text'])
    expect(params[0]).toBe(bytes)
    expect(params.slice(1)).toEqual([null, 'text'])
  })

  it('calls the callback a revived function names, with its arguments', () => {
    const registry = new CallbackRegistry()
    const listener = vi.fn()
    const { params } = registry.marshal(['session-1', listener])
    const revived = reviveCallbacks(
      params,
      (id) =>
        (...args) =>
          registry.invoke(id, args)
    )
    const [, call] = revived as [string, (data: string) => void]

    call('output')
    expect(listener).toHaveBeenCalledWith('output')
  })

  it('stops calling a callback once it is released', () => {
    const registry = new CallbackRegistry()
    const listener = vi.fn()
    const { ids } = registry.marshal([listener])
    registry.release(ids)
    registry.invoke(ids[0], [])
    expect(listener).not.toHaveBeenCalled()
  })
})
