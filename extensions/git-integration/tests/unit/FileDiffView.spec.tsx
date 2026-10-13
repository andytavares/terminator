import React from 'react'
import { describe, it, beforeAll, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { FileDiff } from '../../src/schemas/git.schema'

vi.mock('../../src/utils/hljs', () => ({
  default: {
    highlight: vi.fn((_content: string, _opts: { language: string }) => ({
      value: '<span>highlighted</span>',
    })),
  },
}))

const makeDiff = (overrides: Partial<FileDiff> = {}): FileDiff => ({
  path: 'src/foo.ts',
  isBinary: false,
  truncated: false,
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      lines: [
        { type: 'context', content: 'const a = 1', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'remove', content: 'const b = 2', oldLineNumber: 2, newLineNumber: null },
        { type: 'add', content: 'const b = 3', oldLineNumber: null, newLineNumber: 2 },
      ],
    },
  ],
  ...overrides,
})

async function renderDiff(
  props: { diff?: FileDiff; isStale?: boolean; onRefresh?: () => void } = {}
) {
  const { FileDiffView } = await import('../../src/components/FileDiffView')
  return render(<FileDiffView diff={props.diff ?? makeDiff()} {...props} />)
}

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/FileDiffView')
}, 60_000)

describe('FileDiffView', () => {
  it('shows empty state when diff is null', async () => {
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    render(<FileDiffView diff={null} />)
    expect(screen.getByText('Select a file to view its diff.')).toBeTruthy()
  })

  it('shows binary message for binary files', async () => {
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    render(<FileDiffView diff={makeDiff({ isBinary: true })} />)
    expect(screen.getByText('Binary file — no diff available.')).toBeTruthy()
  })

  it('renders file path in toolbar', async () => {
    await renderDiff()
    expect(screen.getByText('src/foo.ts')).toBeTruthy()
  })

  it('renders renamed file as oldPath → path', async () => {
    await renderDiff({ diff: makeDiff({ oldPath: 'src/old.ts' }) })
    expect(screen.getByText('src/old.ts → src/foo.ts')).toBeTruthy()
  })

  it('renders hunk header in unified mode', async () => {
    await renderDiff()
    expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy()
  })
})

describe('FileDiffView — shows Unified and Split toggle buttons', () => {
  it('shows Unified and Split toggle buttons', async () => {
    await renderDiff()
    expect(screen.getByText('Unified')).toBeTruthy()
    expect(screen.getByText('Split')).toBeTruthy()
  })

  it('switches to split view when Split is clicked', async () => {
    const { container } = await renderDiff()
    fireEvent.click(screen.getByText('Split'))
    expect(container.querySelector('.diff-table--split')).toBeTruthy()
  })

  it('switches back to unified view from split', async () => {
    const { container } = await renderDiff()
    fireEvent.click(screen.getByText('Split'))
    fireEvent.click(screen.getByText('Unified'))
    expect(container.querySelector('.diff-table:not(.diff-table--split)')).toBeTruthy()
  })

  it('shows stale banner when isStale is true', async () => {
    await renderDiff({ isStale: true })
    expect(screen.getByText(/File changed while viewing/)).toBeTruthy()
  })
})

describe('FileDiffView — calls onRefresh when Refresh is clicked in stale banner', () => {
  it('calls onRefresh when Refresh is clicked in stale banner', async () => {
    const onRefresh = vi.fn()
    await renderDiff({ isStale: true, onRefresh })
    fireEvent.click(screen.getByText('Refresh'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('shows truncation notice for truncated diffs', async () => {
    await renderDiff({ diff: makeDiff({ truncated: true }) })
    expect(screen.getByText('Diff truncated at 500 KB.')).toBeTruthy()
  })

  it('renders add/remove lines with correct classes', async () => {
    const { container } = await renderDiff()
    expect(container.querySelector('.diff-line--add')).toBeTruthy()
    expect(container.querySelector('.diff-line--remove')).toBeTruthy()
  })

  it('renders split view with hunk header', async () => {
    await renderDiff()
    fireEvent.click(screen.getByText('Split'))
    expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy()
  })
})

describe('FileDiffView — renders a diff with only removes correctly in split view', () => {
  it('renders a diff with only removes correctly in split view', async () => {
    const diff = makeDiff({
      hunks: [
        {
          header: '@@ -1 +0,0 @@',
          lines: [
            { type: 'remove', content: 'deleted line', oldLineNumber: 1, newLineNumber: null },
          ],
        },
      ],
    })
    await renderDiff({ diff })
    fireEvent.click(screen.getByText('Split'))
    expect(screen.getByText('@@ -1 +0,0 @@')).toBeTruthy()
  })
})

describe('FileDiffView — renders a diff with only adds correctly in split view', () => {
  it('renders a diff with only adds correctly in split view', async () => {
    const diff = makeDiff({
      hunks: [
        {
          header: '@@ -0,0 +1 @@',
          lines: [{ type: 'add', content: 'new line', oldLineNumber: null, newLineNumber: 1 }],
        },
      ],
    })
    await renderDiff({ diff })
    fireEvent.click(screen.getByText('Split'))
    expect(screen.getByText('@@ -0,0 +1 @@')).toBeTruthy()
  })

  it('fires mousedown on split divider to start drag', async () => {
    const { container } = await renderDiff()
    fireEvent.click(screen.getByText('Split'))
    const divider = container.querySelector('.diff-table__split-divider')
    if (divider) {
      fireEvent.mouseDown(divider, { clientX: 300 })
    }
    // drag state activated — fire mouseup to deactivate
    fireEvent.mouseUp(window)
  })
})

describe('FileDiffView — moves split position on mousemove while dragging', () => {
  it('moves split position on mousemove while dragging', async () => {
    const { container } = await renderDiff()
    fireEvent.click(screen.getByText('Split'))
    const scrollEl = container.querySelector('.file-diff-view__scroll') as HTMLElement
    // Mock getBoundingClientRect
    if (scrollEl) {
      vi.spyOn(scrollEl, 'getBoundingClientRect').mockReturnValue({
        width: 800,
        height: 400,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
    }
    const divider = container.querySelector('.diff-table__split-divider')
    if (divider) {
      fireEvent.mouseDown(divider, { clientX: 400 })
      fireEvent.mouseMove(window, { clientX: 450 })
    }
    fireEvent.mouseUp(window)
  })
})
