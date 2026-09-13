import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetForm } from '../../src/components/BudgetForm.js'

// One budget or three, each a whole number or no limit. The same control sets an
// order's budgets in the Forge and raises the one a run stopped at.

function setup(over: Partial<Parameters<typeof BudgetForm>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <BudgetForm
      rows={[
        { key: 'agents', label: 'Agents at once', value: 3 },
        { key: 'filesTouched', label: 'Files touched', value: null },
      ]}
      submitLabel="Save budgets"
      onSubmit={onSubmit}
      {...over}
    />
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('BudgetForm', () => {
  it('shows each limit, and a budget with no limit as ticked and without a number', () => {
    setup()
    expect(
      (screen.getByRole('spinbutton', { name: 'Agents at once' }) as HTMLInputElement).value
    ).toBe('3')
    expect(
      (screen.getByRole('checkbox', { name: 'No limit on files touched' }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(screen.queryByRole('spinbutton', { name: 'Files touched' })).toBeNull()
  })

  it('submits every row, a number or null', async () => {
    const { onSubmit, user } = setup()
    const agents = screen.getByRole('spinbutton', { name: 'Agents at once' })
    await user.clear(agents)
    await user.type(agents, '5')
    await user.click(screen.getByRole('button', { name: 'Save budgets' }))
    expect(onSubmit).toHaveBeenCalledWith({ agents: 5, filesTouched: null })
  })

  it('takes a limit off, and puts one back', async () => {
    const { onSubmit, user } = setup()
    await user.click(screen.getByRole('checkbox', { name: 'No limit on agents at once' }))
    await user.click(screen.getByRole('checkbox', { name: 'No limit on files touched' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Files touched' }), '40')
    await user.click(screen.getByRole('button', { name: 'Save budgets' }))
    expect(onSubmit).toHaveBeenCalledWith({ agents: null, filesTouched: 40 })
  })

  it('will not submit a limit below the smallest it allows, and says what that is', async () => {
    const { onSubmit, user } = setup({
      rows: [{ key: 'files_touched', label: 'Files touched', value: 10, min: 47 }],
      submitLabel: 'Raise and resume',
    })
    const button = screen.getByRole('button', { name: 'Raise and resume' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('At least 47.')).toBeTruthy()

    const files = screen.getByRole('spinbutton', { name: 'Files touched' })
    await user.clear(files)
    await user.type(files, '47')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await user.click(button)
    expect(onSubmit).toHaveBeenCalledWith({ files_touched: 47 })
  })

  it('will not submit an empty or fractional limit', async () => {
    const { user } = setup()
    const agents = screen.getByRole('spinbutton', { name: 'Agents at once' })
    const button = screen.getByRole('button', { name: 'Save budgets' }) as HTMLButtonElement
    await user.clear(agents)
    expect(button.disabled).toBe(true)
    await user.type(agents, '2.5')
    expect(button.disabled).toBe(true)
  })

  it('offers a way back out when there is one', async () => {
    const onCancel = vi.fn()
    const { user } = setup({ onCancel })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('offers no cancel when there is nothing to go back to', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('disables everything while disabled', () => {
    setup({ disabled: true })
    for (const control of [
      ...screen.getAllByRole('checkbox'),
      ...screen.getAllByRole('spinbutton'),
      screen.getByRole('button', { name: 'Save budgets' }),
    ]) {
      expect((control as HTMLInputElement).disabled).toBe(true)
    }
  })
})
