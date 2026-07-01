import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockArtifactList = vi.fn()
const mockArtifactRead = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    artifactList: mockArtifactList,
    artifactRead: mockArtifactRead,
  }),
}))

import { ArtifactsPanel } from '../../src/components/ArtifactsPanel.js'
import type { ArtifactRef } from '../../src/types/speckit.types.js'

const specRef: ArtifactRef = {
  kind: 'spec',
  path: 'spec.md',
  label: 'Specification',
  exists: true,
  revisions: [{ commit: 'abc', ts: '2026-06-30T00:00:00Z', subject: 'Add spec' }],
}
const prRef: ArtifactRef = {
  kind: 'pr',
  path: null,
  label: 'Pull request',
  exists: true,
  revisions: [],
  prUrl: 'https://github.com/a/b/pull/1',
}
const missingRef: ArtifactRef = {
  kind: 'plan',
  path: 'plan.md',
  label: 'Plan',
  exists: false,
  revisions: [],
}

describe('ArtifactsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockArtifactList.mockResolvedValue({ artifacts: [specRef, missingRef, prRef] })
    mockArtifactRead.mockResolvedValue({ current: '# Spec content', approved: null })
  })

  it('lists artifacts with revision counts and disables missing ones', async () => {
    render(<ArtifactsPanel featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByText('Specification'))
    expect(screen.getByText('1 rev')).toBeTruthy()
    const planBtn = screen.getByText('Plan').closest('button') as HTMLButtonElement
    expect(planBtn.disabled).toBe(true)
  })

  it('renders markdown content (not raw text) on click', async () => {
    mockArtifactRead.mockResolvedValue({ current: '# Heading\n\nBody text', approved: null })
    render(<ArtifactsPanel featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByText('Specification'))
    fireEvent.click(screen.getByText('Specification'))
    const md = await screen.findByTestId('artifact-markdown')
    // '#' is consumed by the markdown renderer → rendered as a heading element
    expect(md.querySelector('h1')?.textContent).toContain('Heading')
    expect(md.textContent).not.toContain('# Heading')
    expect(mockArtifactRead).toHaveBeenCalledWith({
      filePath: '/repo/specs/x/spec.md',
      featureDir: '/repo/specs/x',
      commit: undefined,
    })
  })

  it('loads the selected revision content when the dropdown changes', async () => {
    mockArtifactRead.mockResolvedValue({ current: 'current content', approved: null })
    render(<ArtifactsPanel featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByText('Specification'))
    fireEvent.click(screen.getByText('Specification'))
    await screen.findByTestId('artifact-markdown')
    mockArtifactRead.mockResolvedValue({ current: '# Old revision', approved: null })
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'abc' } })
    await waitFor(() =>
      expect(mockArtifactRead).toHaveBeenLastCalledWith({
        filePath: '/repo/specs/x/spec.md',
        featureDir: '/repo/specs/x',
        commit: 'abc',
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId('artifact-markdown').textContent).toContain('Old revision')
    )
  })

  it('renders a PR link for the pr artifact', async () => {
    render(<ArtifactsPanel featureDir="/repo/specs/x" />)
    await waitFor(() => screen.getByText('Pull request'))
    fireEvent.click(screen.getByText('Pull request'))
    await waitFor(() => {
      const link = screen.getByText(/open pull request/i).closest('a') as HTMLAnchorElement
      expect(link.href).toContain('pull/1')
    })
  })
})
