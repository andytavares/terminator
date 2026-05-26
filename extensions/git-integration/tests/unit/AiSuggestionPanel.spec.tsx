import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

const mockRequestAiSuggestion = vi.fn()

vi.mock('../../src/api/merge-flow', () => ({
  mergeFlowAPI: {
    requestAiSuggestion: (...a: unknown[]) => mockRequestAiSuggestion(...a),
  },
}))

import { AiSuggestionPanel } from '../../src/components/merge-flow/AiSuggestionPanel'

const baseBlock = {
  blockId: 'src/foo.ts#0',
  index: 0,
  oursText: 'const x = 1',
  theirsText: 'const x = 2',
  baseText: '',
  contextBefore: ['// before'],
  contextAfter: ['// after'],
  originalConflictText: '<<<<<<< HEAD\nconst x = 1\n=======\nconst x = 2\n>>>>>>> branch',
  isResolved: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AiSuggestionPanel — NOT_IMPLEMENTED', () => {
  it('shows loading state while request in-flight', () => {
    mockRequestAiSuggestion.mockReturnValue(new Promise(() => {}))
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText(/Generating/i)).toBeTruthy()
  })

  it('shows error message when NOT_IMPLEMENTED returned', async () => {
    mockRequestAiSuggestion.mockResolvedValue({ error: 'NOT_IMPLEMENTED' })
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    expect(screen.getByText(/not available/i)).toBeTruthy()
  })

  it('close button calls onClose', async () => {
    mockRequestAiSuggestion.mockResolvedValue({ error: 'NOT_IMPLEMENTED' })
    const onClose = vi.fn()
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={onClose} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    await userEvent.click(screen.getByLabelText(/Close AI panel/i))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('close does not call onApply', async () => {
    mockRequestAiSuggestion.mockResolvedValue({ error: 'NOT_IMPLEMENTED' })
    const onApply = vi.fn()
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={onApply} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    await userEvent.click(screen.getByLabelText(/Close AI panel/i))
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('AiSuggestionPanel — suggestion present', () => {
  const fakeSuggestion = {
    blockId: 'src/foo.ts#0',
    suggestedText: 'const x = merged',
    explanation: 'Combined both approaches safely',
    confidence: 0.85,
  }

  beforeEach(() => {
    mockRequestAiSuggestion.mockResolvedValue(fakeSuggestion)
  })

  it('renders explanation text', async () => {
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    expect(screen.getByText('Combined both approaches safely')).toBeTruthy()
  })

  it('renders suggested code', async () => {
    const { container } = render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    // Text may be split across highlight.js spans — check textContent
    expect(container.textContent).toContain('const x = merged')
  })

  it('renders confidence score', async () => {
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    expect(screen.getByText(/85%/)).toBeTruthy()
  })

  it('Apply suggestion button calls onApply with suggestedText', async () => {
    const onApply = vi.fn()
    render(
      <AiSuggestionPanel repoRoot="/repo" block={baseBlock} onApply={onApply} onClose={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/Generating/i)).toBeNull())
    await userEvent.click(screen.getByText(/Apply suggestion/i))
    expect(onApply).toHaveBeenCalledWith('const x = merged')
  })
})
