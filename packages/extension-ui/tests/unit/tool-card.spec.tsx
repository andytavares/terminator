import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Terminal } from 'lucide-react'
import { ToolCard } from '../../src/ToolCard'

const nineLines = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n')

describe('ToolCard preview', () => {
  it('shows only the first 3 lines of a long preview, with a button to show all of them', () => {
    render(<ToolCard icon={<Terminal />} title="Ran" status="completed" preview={nineLines} />)
    expect(screen.getByText(/line 3/)).toBeTruthy()
    expect(screen.queryByText(/line 4/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all 9 lines' })).toBeTruthy()
  })

  it('expands a long preview to every line, and collapses it again', async () => {
    const user = userEvent.setup()
    render(<ToolCard icon={<Terminal />} title="Ran" status="completed" preview={nineLines} />)
    await user.click(screen.getByRole('button', { name: 'Show all 9 lines' }))
    expect(screen.getByText(/line 9/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText(/line 9/)).toBeNull()
  })

  it('shows a preview of 3 lines in full, with no button', () => {
    render(
      <ToolCard icon={<Terminal />} title="Ran" status="completed" preview={'a\nb\nthird line'} />
    )
    expect(screen.getByText(/third line/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ToolCard header', () => {
  it.each([
    ['pending', 'Waiting'],
    ['in_progress', 'Running'],
    ['completed', 'Done'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ] as const)('states a %s tool call as "%s"', (status, text) => {
    render(<ToolCard icon={<Terminal />} title="Ran" status={status} />)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('names the group by its title and detail', () => {
    render(<ToolCard icon={<Terminal />} title="Ran" detail="npm test" status="completed" />)
    expect(screen.getByRole('group', { name: 'Ran npm test' })).toBeTruthy()
  })
})
