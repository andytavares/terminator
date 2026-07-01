import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockKnowledgeSearch = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({ knowledgeSearch: mockKnowledgeSearch }),
}))

import { KnowledgeSearch } from '../../src/components/KnowledgeSearch.js'

describe('KnowledgeSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a search and shows file:line results', async () => {
    mockKnowledgeSearch.mockResolvedValue({
      results: [{ file: 'docs/A.md', line: 5, snippet: 'auth token' }],
    })
    render(<KnowledgeSearch repoRoot="/repo" />)
    const input = screen.getByLabelText('Search workspace knowledge')
    fireEvent.change(input, { target: { value: 'auth' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('docs/A.md:5')).toBeTruthy())
    expect(screen.getByText('auth token')).toBeTruthy()
  })

  it('shows an explicit no-results state', async () => {
    mockKnowledgeSearch.mockResolvedValue({ results: [] })
    render(<KnowledgeSearch repoRoot="/repo" />)
    const input = screen.getByLabelText('Search workspace knowledge')
    fireEvent.change(input, { target: { value: 'zzz' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('No results')).toBeTruthy())
  })

  it('attaches a result to a card', async () => {
    const onAttach = vi.fn()
    mockKnowledgeSearch.mockResolvedValue({
      results: [{ file: 'docs/A.md', line: 5, snippet: 'auth token' }],
    })
    render(<KnowledgeSearch repoRoot="/repo" onAttach={onAttach} />)
    const input = screen.getByLabelText('Search workspace knowledge')
    fireEvent.change(input, { target: { value: 'auth' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => screen.getByText('Attach to card'))
    fireEvent.click(screen.getByText('Attach to card'))
    expect(onAttach).toHaveBeenCalledWith({ file: 'docs/A.md', line: 5, snippet: 'auth token' })
  })
})
