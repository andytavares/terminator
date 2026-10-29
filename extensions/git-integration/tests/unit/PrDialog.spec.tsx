import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrDialog } from '../../src/components/PrDialog'
import { githubAPI } from '../../src/api/github'

const mockReadFile = vi.fn()
const mockExec = vi.fn()
const mockRecordUsage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, {
    electronAPI: {
      shell: { exec: mockExec, openExternal: vi.fn().mockResolvedValue({ ok: true }) },
      git: { listBranches: vi.fn().mockResolvedValue({ branches: [] }) },
      fs: { readFile: mockReadFile },
      usage: { record: mockRecordUsage },
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

describe('PrDialog usage', () => {
  async function createWith(prCreate: () => ReturnType<typeof githubAPI.prCreate>) {
    mockReadFile.mockResolvedValue({ content: '' })
    mockExec.mockResolvedValue({ exitCode: 0, stdout: '2\n', stderr: '' })
    vi.spyOn(githubAPI, 'prCreate').mockImplementation(prCreate)
    render(
      <PrDialog
        repoRoot="/repo"
        branch="feature/x"
        existingPr={null}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Pull request title'), {
      target: { value: 'Add x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Create (Draft )?PR$/ }))
  }

  it('counts a pull request that was opened', async () => {
    await createWith(async () => ({ number: 7, url: 'https://github.com/o/r/pull/7' }))
    await waitFor(() => expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('pr-create', {}))
  })

  it('counts a refused pull request as failed', async () => {
    await createWith(async () => ({ error: 'already exists' }))
    await waitFor(() =>
      expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('pr-create', { failed: true })
    )
  })
})
