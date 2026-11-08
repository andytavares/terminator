import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const user = userEvent.setup()
  mockReadFile.mockResolvedValue({ content: template })
  render(
    <PrDialog
      repoRoot="/repo"
      branch="feature/x"
      hasStagedChanges={false}
      existingPr={null}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  )
  await waitFor(() =>
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value
    ).toBe(template)
  )
  await user.click(screen.getByRole('tab', { name: 'Preview' }))
  return screen.getByRole('tabpanel', { name: 'Preview' })
}

describe('PrDialog template preview', () => {
  it('renders the template as Markdown', async () => {
    const preview = await previewOf('## Summary\n\n- first\n- second\n')

    expect(within(preview).getByRole('heading', { level: 2 }).textContent).toBe('Summary')
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2)
  })

  it('never puts script or event-handler markup from the template into the page', async () => {
    const preview = await previewOf(
      '## Notes\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3))'
    )

    await waitFor(() =>
      expect(within(preview).getByRole('heading', { level: 2 }).textContent).toBe('Notes')
    )
    expect(preview.innerHTML).not.toContain('<script')
    expect(preview.innerHTML).not.toContain('onerror')
    expect(preview.innerHTML).not.toContain('javascript:')
  })
})

async function createWith(prCreate: () => ReturnType<typeof githubAPI.prCreate>) {
  const user = userEvent.setup()
  mockReadFile.mockResolvedValue({ content: '' })
  mockExec.mockResolvedValue({ exitCode: 0, stdout: '2\n', stderr: '' })
  vi.spyOn(githubAPI, 'prCreate').mockImplementation(prCreate)
  render(
    <PrDialog
      repoRoot="/repo"
      branch="feature/x"
      hasStagedChanges={false}
      existingPr={null}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  )
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Add x')
  await user.click(screen.getByRole('button', { name: /^Create (Draft )?PR$/ }))
}

describe('PrDialog usage', () => {
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

describe('PrDialog fields', () => {
  it('names the title, description and base branch fields by their labels', async () => {
    mockReadFile.mockResolvedValue({ content: '' })
    render(
      <PrDialog
        repoRoot="/repo"
        branch="feature/x"
        hasStagedChanges={false}
        existingPr={null}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty(
      'placeholder',
      'Pull request title'
    )
    expect(screen.getByRole('textbox', { name: 'Description' }).tagName).toBe('TEXTAREA')
    expect(screen.getByRole('listbox', { name: 'Base branch' }).tagName).toBe('SELECT')
  })
})
