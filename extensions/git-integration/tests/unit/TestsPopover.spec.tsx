import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockTestsForBlock = vi.fn()
vi.mock('../../src/api/github', () => ({
  githubAPI: { testsForBlock: (...a: unknown[]) => mockTestsForBlock(...a) },
}))

import { TestsPopover } from '../../src/components/pr-review/TestsPopover'

const mockOpenPath = vi.fn().mockResolvedValue('')

const block = {
  repoRoot: '/repo',
  headSHA: 'abc',
  path: 'src/utils.ts',
  code: 'export function sortByPriority() {}',
  hunkHeader: '@@ -1 +1 @@',
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { electronAPI: unknown }).electronAPI = {
    shell: { openPath: mockOpenPath },
  }
})

afterEach(() => {
  delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI
})

function renderPopover(prPaths: string[] = ['src/utils.spec.ts']) {
  const onOpenInReview = vi.fn()
  const onClose = vi.fn()
  render(
    <TestsPopover
      block={block}
      prPaths={new Set(prPaths)}
      onOpenInReview={onOpenInReview}
      onClose={onClose}
    />
  )
  return { onOpenInReview, onClose }
}

describe('TestsPopover', () => {
  it('asks for the tests of the block it was opened on', async () => {
    mockTestsForBlock.mockResolvedValue({ symbols: [], locations: [] })
    renderPopover()
    await waitFor(() => expect(mockTestsForBlock).toHaveBeenCalledWith(block))
  })

  it('lists each test line with its file, line number and text', async () => {
    mockTestsForBlock.mockResolvedValue({
      symbols: ['sortByPriority'],
      locations: [
        { path: 'src/utils.spec.ts', line: 12, symbol: 'sortByPriority', text: 'it("sorts")' },
        { path: 'tests/e2e/batch.spec.ts', line: 4, symbol: 'sortByPriority', text: 'import x' },
      ],
    })
    renderPopover()
    expect(await screen.findByText('src/utils.spec.ts:12')).toBeTruthy()
    expect(screen.getByText('it("sorts")')).toBeTruthy()
    expect(screen.getByText('tests/e2e/batch.spec.ts:4')).toBeTruthy()
  })

  it('opens a test that is part of the PR in the review, at its line', async () => {
    mockTestsForBlock.mockResolvedValue({
      symbols: ['sortByPriority'],
      locations: [{ path: 'src/utils.spec.ts', line: 12, symbol: 'sortByPriority', text: 't' }],
    })
    const { onOpenInReview, onClose } = renderPopover()
    fireEvent.click(await screen.findByRole('button', { name: /src\/utils\.spec\.ts:12/ }))
    expect(onOpenInReview).toHaveBeenCalledWith('src/utils.spec.ts', 12)
    expect(onClose).toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('opens a test outside the PR in the editor', async () => {
    mockTestsForBlock.mockResolvedValue({
      symbols: ['sortByPriority'],
      locations: [{ path: 'tests/old.spec.ts', line: 3, symbol: 'sortByPriority', text: 't' }],
    })
    const { onOpenInReview } = renderPopover()
    const row = await screen.findByRole('button', { name: /tests\/old\.spec\.ts:3/ })
    expect(row.textContent).toContain('Open file')
    fireEvent.click(row)
    expect(mockOpenPath).toHaveBeenCalledWith('/repo/tests/old.spec.ts')
    expect(onOpenInReview).not.toHaveBeenCalled()
  })

  it('says which names it looked for when no test mentions them', async () => {
    mockTestsForBlock.mockResolvedValue({
      symbols: ['sortByPriority', 'filterItems'],
      locations: [],
    })
    renderPopover()
    expect(await screen.findByText('No test mentions sortByPriority or filterItems.')).toBeTruthy()
  })

  it('says when the block defines nothing to search for', async () => {
    mockTestsForBlock.mockResolvedValue({ symbols: [], locations: [] })
    renderPopover()
    expect(
      await screen.findByText(
        'This block does not define or sit inside a named function, so there is nothing to search the tests for.'
      )
    ).toBeTruthy()
  })

  it('shows the error when the search fails', async () => {
    mockTestsForBlock.mockResolvedValue({ error: 'VALIDATION_ERROR' })
    renderPopover()
    expect(await screen.findByText(/Could not search the tests: VALIDATION_ERROR/)).toBeTruthy()
  })
})
