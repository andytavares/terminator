import { fireEvent, screen, waitFor, within } from '@testing-library/react'

/** Goes to a Forge step by the name the step list shows, once it is offered. */
export async function openForgeStep(name: string): Promise<void> {
  const label = new RegExp(`^${name}`)
  const stepButton = () =>
    within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: label })
  await waitFor(stepButton)
  fireEvent.click(stepButton())
}
