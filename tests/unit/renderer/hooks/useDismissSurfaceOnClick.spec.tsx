import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useDismissSurfaceOnClick } from '../../../../src/renderer/hooks/useDismissSurfaceOnClick'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'

function Harness(): JSX.Element {
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

describe('useDismissSurfaceOnClick', () => {
  beforeEach(() => {
    useExtensionRegistry.setState({
      activeGlobalTabId: null,
      activeWorkspaceTabId: null,
      activeProjectTabId: null,
    })
  })

  it.each(['core.home', 'core.overview', 'notepad'])(
    'a click that changes nothing dismisses %s',
    (tabId) => {
      useExtensionRegistry.getState().setActiveGlobalTab(tabId)
      const { getByText } = render(<Harness />)
      fireEvent.click(getByText('inert'))
      expect(active()).toEqual([null, null, null])
    }
  )

  it('dismisses an extension project tab', () => {
    useExtensionRegistry.setState({ activeProjectTabId: 'git' })
    const { getByTestId } = render(<Harness />)
    fireEvent.click(getByTestId('area'))
    expect(active()).toEqual([null, null, null])
  })

  it('leaves the surface a click opened showing', () => {
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { getByText } = render(<Harness />)
    fireEvent.click(getByText('open foundry'))
    expect(active()).toEqual([null, 'foundry', null])
  })

  it('does not reopen what a click toggled off', () => {
    useExtensionRegistry.getState().setActiveGlobalTab('notepad')
    const { getByText } = render(<Harness />)
    fireEvent.click(getByText('toggle off'))
    expect(active()).toEqual([null, null, null])
  })

  it('ignores a click whose propagation was stopped', () => {
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { getByText } = render(<Harness />)
    const button = getByText('inert')
    button.addEventListener('click', (e) => e.stopPropagation())
    fireEvent.click(button)
    expect(active()).toEqual(['core.home', null, null])
  })
})
