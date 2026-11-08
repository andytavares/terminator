import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDismissSurfaceOnClick } from '../../../../src/renderer/hooks/useDismissSurfaceOnClick'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'

function Harness(): React.JSX.Element {
  const handlers = useDismissSurfaceOnClick()
  const registry = useExtensionRegistry.getState()
  return (
    <div data-testid="area" {...handlers}>
      <button>inert</button>
      <button onClick={() => registry.setActiveWorkspaceTab('foundry')}>open foundry</button>
      <button onClick={() => registry.setActiveGlobalTab(null)}>toggle off</button>
    </div>
  )
}

const active = () => {
  const s = useExtensionRegistry.getState()
  return [s.activeGlobalTabId, s.activeWorkspaceTabId, s.activeProjectTabId]
}

beforeEach(() => {
  useExtensionRegistry.setState({
    activeGlobalTabId: null,
    activeWorkspaceTabId: null,
    activeProjectTabId: null,
  })
})

describe('useDismissSurfaceOnClick', () => {
  it.each(['core.home', 'core.overview', 'notepad'])(
    'a click that changes nothing dismisses %s',
    async (tabId) => {
      useExtensionRegistry.getState().setActiveGlobalTab(tabId)
      const { getByText } = render(<Harness />)
      await userEvent.setup().click(getByText('inert'))
      expect(active()).toEqual([null, null, null])
    }
  )

  it('dismisses an extension project tab', async () => {
    useExtensionRegistry.setState({ activeProjectTabId: 'git' })
    const { getByTestId } = render(<Harness />)
    await userEvent.click(getByTestId('area'))
    expect(active()).toEqual([null, null, null])
  })

  it('leaves the surface a click opened showing', async () => {
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { getByText } = render(<Harness />)
    await userEvent.click(getByText('open foundry'))
    expect(active()).toEqual([null, 'foundry', null])
  })

  it('does not reopen what a click toggled off', async () => {
    useExtensionRegistry.getState().setActiveGlobalTab('notepad')
    const { getByText } = render(<Harness />)
    await userEvent.click(getByText('toggle off'))
    expect(active()).toEqual([null, null, null])
  })
})

describe('useDismissSurfaceOnClick — ignores a click whose propagation was stopped', () => {
  it('ignores a click whose propagation was stopped', async () => {
    const user = userEvent.setup()
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { getByText } = render(<Harness />)
    const button = getByText('inert')
    button.addEventListener('click', (e) => e.stopPropagation())
    await user.click(button)
    expect(active()).toEqual(['core.home', null, null])
  })
})
