import React from 'react'
import { describe, it, expect, onTestFinished } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useSurfaceOpen } from '../../../../src/renderer/hooks/useSurfaceOpen'
import { eventually } from '../../../support/eventually'

function Pane({ name }: { name: string }): React.JSX.Element {
  return <output aria-label={name}>{useSurfaceOpen() ? 'surface open' : 'nothing open'}</output>
}

function openDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  document.body.appendChild(dialog)
  act(() => dialog.showModal())
  onTestFinished(() => dialog.remove())
  return dialog
}

describe('useSurfaceOpen', () => {
  it('tells every pane when a modal dialog opens and when it closes', async () => {
    render(
      <>
        <Pane name="left" />
        <Pane name="right" />
      </>
    )
    const dialog = openDialog()
    await eventually(() => {
      expect(screen.getByLabelText('left').textContent).toBe('surface open')
      expect(screen.getByLabelText('right').textContent).toBe('surface open')
    })
    act(() => dialog.close())
    await eventually(() => expect(screen.getByLabelText('right').textContent).toBe('nothing open'))
  })

  it('counts a dialog removed while still open as closed: it fires no event', async () => {
    render(<Pane name="only" />)
    const dialog = openDialog()
    await eventually(() => expect(screen.getByLabelText('only').textContent).toBe('surface open'))
    act(() => dialog.remove())
    await eventually(() => expect(screen.getByLabelText('only').textContent).toBe('nothing open'))
  })
})

describe('useSurfaceOpen when it is first asked', () => {
  it('starts from what is open when the first pane mounts', () => {
    openDialog()
    render(<Pane name="late" />)
    expect(screen.getByLabelText('late').textContent).toBe('surface open')
  })
})
