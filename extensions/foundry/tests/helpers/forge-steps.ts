import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Goes to a Forge step by the name the step list shows, once it is offered. */
export async function openForgeStep(name: string): Promise<void> {
  const user = userEvent.setup()
  const label = new RegExp(`^${name}`)
  const stepButton = () =>
    within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: label })
  await waitFor(stepButton)
  await user.click(stepButton())
}
