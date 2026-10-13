import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrDialog } from '../../src/components/PrDialog'

const mockReadFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, {
    electronAPI: {
      shell: { exec: vi.fn(), openExternal: vi.fn().mockResolvedValue({ ok: true }) },
      git: { listBranches: vi.fn().mockResolvedValue({ branches: [] }) },
      fs: { readFile: mockReadFile },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

async function previewOf(template: string): Promise<HTMLElement> {
  mockReadFile.mockResolvedValue({ content: template })
  render(
    <PrDialog
      repoRoot="/repo"
      branch="feature/x"
      existingPr={null}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  )
  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText(/Describe your changes/) as HTMLTextAreaElement).value
    ).toBe(template)
  )
  fireEvent.click(screen.getByText('Preview'))
  return document.querySelector('.pr-dialog__preview') as HTMLElement
}

describe('PrDialog template preview', () => {
  it('renders the template as Markdown', async () => {
    const preview = await previewOf('## Summary\n\n- first\n- second\n')

    expect(preview.querySelector('h2')?.textContent).toBe('Summary')
    expect(preview.querySelectorAll('li')).toHaveLength(2)
  })

  it('never puts script or event-handler markup from the template into the page', async () => {
    const preview = await previewOf(
      '## Notes\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3))'
    )

    await waitFor(() => expect(preview.querySelector('h2')?.textContent).toBe('Notes'))
    expect(preview.querySelector('script')).toBeNull()
    expect(preview.querySelector('[onerror]')).toBeNull()
    expect(preview.innerHTML).not.toContain('javascript:')
  })
})
