import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragReorder } from '../../../../src/renderer/hooks/useDragReorder'

const items = ['a', 'b', 'c']

function dragEvent(): React.DragEvent {
  return { preventDefault: vi.fn() } as unknown as React.DragEvent
}

let onReorder: ReturnType<typeof vi.fn>

beforeEach(() => {
  onReorder = vi.fn()
})

describe('useDragReorder', () => {
  it('starts with no drag-over index', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    expect(result.current.dragOverIndex).toBeNull()
  })

  it('marks the hovered index on drag over and prevents the default', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    const e = dragEvent()
    act(() => result.current.getItemProps(1).onDragOver(e))
    expect(result.current.dragOverIndex).toBe(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('clears the hovered index on drag leave', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(1).onDragOver(dragEvent()))
    act(() => result.current.getItemProps(1).onDragLeave())
    expect(result.current.dragOverIndex).toBeNull()
  })

  it('reorders forward on drop and reports the new order', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(0).onDragStart())
    act(() => result.current.getItemProps(2).onDrop())
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('reorders backward on drop', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(2).onDragStart())
    act(() => result.current.getItemProps(0).onDrop())
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('does not reorder when dropped on its own index', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(1).onDragStart())
    act(() => result.current.getItemProps(1).onDrop())
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('does not reorder when dropped without a drag start', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(1).onDrop())
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('clears drag-over state after a drop', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(0).onDragStart())
    act(() => result.current.getItemProps(2).onDragOver(dragEvent()))
    act(() => result.current.getItemProps(2).onDrop())
    expect(result.current.dragOverIndex).toBeNull()
  })

  it('clears state on drag end so an abandoned drag cannot reorder later', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    act(() => result.current.getItemProps(0).onDragStart())
    act(() => result.current.getItemProps(0).onDragEnd())
    act(() => result.current.getItemProps(2).onDrop())
    expect(onReorder).not.toHaveBeenCalled()
    expect(result.current.dragOverIndex).toBeNull()
  })

  it('marks every item draggable', () => {
    const { result } = renderHook(() => useDragReorder(items, onReorder))
    expect(result.current.getItemProps(0).draggable).toBe(true)
  })

  it('reorders against the latest items when the list changes mid-drag', () => {
    const { result, rerender } = renderHook(({ list }) => useDragReorder(list, onReorder), {
      initialProps: { list: items },
    })
    act(() => result.current.getItemProps(0).onDragStart())
    rerender({ list: ['a', 'b', 'c', 'd'] })
    act(() => result.current.getItemProps(3).onDrop())
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'd', 'a'])
  })
})
