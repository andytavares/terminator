import React from 'react'
import { describe, it, beforeAll, beforeEach, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FileDiff } from '../../src/schemas/git.schema'

const CLEAN = { kind: 'clean', onRefreshStatus: (): void => undefined } as const

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
  return render(<FileDiffView diff={props.diff ?? makeDiff()} empty={CLEAN} {...props} />)
}

const mockRecordUsage = vi.fn()

beforeEach(() => {
  mockRecordUsage.mockClear()
  Object.assign(globalThis, { electronAPI: { usage: { record: mockRecordUsage } } })
})

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/FileDiffView')
})

describe('FileDiffView', () => {
  it('shows binary message for binary files', async () => {
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    render(<FileDiffView diff={makeDiff({ isBinary: true })} empty={CLEAN} />)
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

describe('FileDiffView — Unified and Split toggle', () => {
  it('switches to split view when Split is clicked', async () => {
    const user = userEvent.setup()
    const { container } = await renderDiff()
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    expect(container.querySelector('.diff-table--split')).toBeTruthy()
  })

  it('switches back to unified view from split', async () => {
    const user = userEvent.setup()
    const { container } = await renderDiff()
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    await user.click(screen.getByRole('radio', { name: 'Unified' }))
    expect(container.querySelector('.diff-table:not(.diff-table--split)')).toBeTruthy()
  })
})

describe('FileDiffView — stale banner and notices', () => {
  it('shows the stale banner when isStale is true, and its Refresh calls onRefresh', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    await renderDiff({ isStale: true, onRefresh })
    expect(screen.getByText(/File changed while viewing/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledOnce()
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
    const user = userEvent.setup()
    await renderDiff()
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy()
  })
})

describe('FileDiffView — split view of a remove-only hunk', () => {
  it('puts a removed line on the old side of the split view, beside an empty new side', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    const oldSide = screen.getByText('deleted line').closest('td')
    const newSide = oldSide?.parentElement?.querySelector('.diff-line__content--new-side')
    expect(oldSide?.className).toBe(
      'diff-line__content diff-line__content--remove diff-line__content--old-side'
    )
    expect(newSide?.className).toBe(
      'diff-line__content diff-line__content--empty diff-line__content--new-side'
    )
  })
})

describe('FileDiffView — split view of an add-only hunk', () => {
  it('puts an added line on the new side of the split view, beside an empty old side', async () => {
    const user = userEvent.setup()
    const diff = makeDiff({
      hunks: [
        {
          header: '@@ -0,0 +1 @@',
          lines: [{ type: 'add', content: 'added line', oldLineNumber: null, newLineNumber: 1 }],
        },
      ],
    })
    await renderDiff({ diff })
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    const newSide = screen.getByText('added line').closest('td')
    const oldSide = newSide?.parentElement?.querySelector('.diff-line__content--old-side')
    expect(newSide?.className).toBe(
      'diff-line__content diff-line__content--add diff-line__content--new-side'
    )
    expect(oldSide?.className).toBe(
      'diff-line__content diff-line__content--empty diff-line__content--old-side'
    )
  })
})

// The divider drag listens on window; user-event's moves bubble there from the divider.
describe('FileDiffView — split divider', () => {
  it('keeps the split position when the divider is pressed and released without moving', async () => {
    const user = userEvent.setup()
    const { container } = await renderDiff()
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    const scrollEl = container.querySelector('.file-diff-view__scroll') as HTMLElement
    const divider = container.querySelector('.diff-table__split-divider') as Element
    await user.pointer([
      { keys: '[MouseLeft>]', target: divider, coords: { clientX: 300 } },
      { keys: '[/MouseLeft]' },
      { coords: { clientX: 500 } },
    ])
    expect(scrollEl.style.getPropertyValue('--split-left')).toBe('50%')
  })
})

describe('FileDiffView — moves split position on mousemove while dragging', () => {
  it('moves split position on mousemove while dragging', async () => {
    const user = userEvent.setup()
    const { container } = await renderDiff()
    await user.click(screen.getByRole('radio', { name: 'Split' }))
    const scrollEl = container.querySelector('.file-diff-view__scroll') as HTMLElement
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
    const divider = container.querySelector('.diff-table__split-divider') as Element
    await user.pointer([
      { keys: '[MouseLeft>]', target: divider, coords: { clientX: 400 } },
      { coords: { clientX: 450 } },
      { keys: '[/MouseLeft]' },
    ])
    expect(scrollEl.style.getPropertyValue('--split-left')).toBe('56.25%')
  })
})

describe('FileDiffView usage', () => {
  it('counts a diff once when it is opened, and again for another file', async () => {
    const { rerender } = await renderDiff()
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    rerender(<FileDiffView diff={makeDiff()} isStale empty={CLEAN} />)
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('diff-open')
    rerender(<FileDiffView diff={makeDiff({ path: 'src/bar.ts' })} empty={CLEAN} />)
    expect(mockRecordUsage).toHaveBeenCalledTimes(2)
  })

  it('counts nothing while no file is selected', async () => {
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    render(<FileDiffView diff={null} empty={CLEAN} />)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })
})

describe('FileDiffView empty state', () => {
  it('offers to open the first change when no file is selected', async () => {
    const user = userEvent.setup()
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    function Harness() {
      const [opened, setOpened] = React.useState(false)
      return (
        <FileDiffView
          diff={opened ? makeDiff() : null}
          empty={{ kind: 'pick', onOpenFirstChange: () => setOpened(true) }}
        />
      )
    }
    render(<Harness />)
    expect(screen.getByText('No file selected')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Open the first change' }))
    expect(screen.getByText('src/foo.ts')).toBeTruthy()
    expect(screen.queryByText('No file selected')).toBeNull()
  })

  it('offers a refresh when nothing has changed', async () => {
    const user = userEvent.setup()
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    const onRefreshStatus = vi.fn()
    render(<FileDiffView diff={null} empty={{ kind: 'clean', onRefreshStatus }} />)
    expect(screen.getByText('No changes')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefreshStatus).toHaveBeenCalledTimes(1)
  })
})

describe('FileDiffView while no diff is shown for the selection', () => {
  it('shows a quiet reading line with no action while the diff loads', async () => {
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    render(<FileDiffView diff={null} empty={{ kind: 'reading' }} />)
    expect(screen.getByText('Reading changes…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the selected file cannot be shown and offers a refresh', async () => {
    const user = userEvent.setup()
    const { FileDiffView } = await import('../../src/components/FileDiffView')
    const onRefreshStatus = vi.fn()
    render(<FileDiffView diff={null} empty={{ kind: 'unreadable', onRefreshStatus }} />)
    expect(screen.getByText("This file's changes cannot be shown")).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefreshStatus).toHaveBeenCalledTimes(1)
  })
})
