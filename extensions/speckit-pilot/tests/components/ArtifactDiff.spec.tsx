import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { ArtifactDiff } from '../../src/components/ArtifactDiff.js'

describe('ArtifactDiff', () => {
  it('renders no-changes message when current matches approved', () => {
    const content = 'line one\nline two\n'
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent={content}
        approvedContent={content}
      />
    )
    expect(screen.getByText(/No changes/)).toBeTruthy()
  })

  it('renders added lines with + prefix', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="line one\nline two\nnew line\n"
        approvedContent="line one\nline two\n"
      />
    )
    expect(screen.getByText('+')).toBeTruthy()
  })

  it('renders removed lines with − prefix', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="line one\n"
        approvedContent="line one\nremoved line\n"
      />
    )
    expect(screen.getByText('−')).toBeTruthy()
  })

  it('shows stats with add/remove counts when there are changes', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="line one\nnew\n"
        approvedContent="line one\nold\n"
      />
    )
    // Should have +1 and -1 stats
    expect(screen.getByText(/\+1/)).toBeTruthy()
    expect(screen.getByText(/−1/)).toBeTruthy()
  })

  it('shows "Hide unchanged" toggle', () => {
    render(
      <ArtifactDiff filePath="/repo/specs/001/plan.md" currentContent="old" approvedContent="new" />
    )
    expect(screen.getByText('Hide unchanged')).toBeTruthy()
  })

  it('shows Open in editor button when callback provided', () => {
    const onOpenInEditor = vi.fn()
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="a\nb\n"
        approvedContent="a\nc\n"
        onOpenInEditor={onOpenInEditor}
      />
    )
    const btn = screen.getByText('Open in editor')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onOpenInEditor).toHaveBeenCalledOnce()
  })

  it('shows Save & mark ready for re-approval button when onSaveAndApprove provided and there are changes', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="new content"
        approvedContent="old content"
        onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.getByText(/Save & mark ready for re-approval/)).toBeTruthy()
  })

  it('calls onSaveAndApprove when save button is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="updated content"
        approvedContent="original content"
        onSaveAndApprove={onSave}
      />
    )
    fireEvent.click(screen.getAllByText(/Save & mark ready for re-approval/)[0])
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('updated content')
    })
  })

  it('shows "What happens when I save" info when changes exist and onSaveAndApprove provided', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="changed"
        approvedContent="original"
        onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.getByText('What happens when I save')).toBeTruthy()
  })

  it('shows all-new lines when approvedContent is null (new file)', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent="new file content\nline 2\n"
        approvedContent={null}
      />
    )
    // All lines should be additions
    const plusSigns = screen.getAllByText('+')
    expect(plusSigns.length).toBeGreaterThan(0)
  })

  it('shows all-removed lines when currentContent is null (deleted file)', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent={null}
        approvedContent="deleted content\n"
      />
    )
    expect(screen.getByText('−')).toBeTruthy()
  })

  it('shows short path in header', () => {
    render(
      <ArtifactDiff
        filePath="/repo/specs/001-my-feature/plan.md"
        currentContent="a"
        approvedContent="b"
      />
    )
    // Path should be truncated to last 3 segments
    expect(screen.getByText(/plan\.md/)).toBeTruthy()
  })

  it('filters unchanged lines when Hide unchanged is toggled', async () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const modified = content.replace('line 10', 'CHANGED')
    render(
      <ArtifactDiff
        filePath="/repo/specs/001/plan.md"
        currentContent={modified}
        approvedContent={content}
      />
    )
    const toggle = screen.getByRole('checkbox')
    fireEvent.click(toggle)
    await waitFor(() => {
      // After hiding unchanged, should still show the diff
      expect(screen.getByText('+')).toBeTruthy()
    })
  })
})
