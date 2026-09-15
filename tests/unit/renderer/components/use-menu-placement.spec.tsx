import React, { useRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useMenuPlacement } from '../../../../src/renderer/components/home/use-menu-placement'

const VIEWPORT = { width: 1000, height: 800 }

function rect(box: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => '',
  } as DOMRect
}

function Menu({
  button,
  panel,
  open = true,
}: {
  button: { left: number; top: number; width: number; height: number }
  panel: { width: number; height: number }
  open?: boolean
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const style = useMenuPlacement(open, buttonRef, panelRef)
  // Callback refs patch the boxes as the nodes attach, before layout effects run.
  const attach =
    (box: () => DOMRect) =>
    (node: HTMLElement | null): void => {
      if (node !== null) node.getBoundingClientRect = box
    }
  return (
    <>
      <button
        ref={(node) => {
          buttonRef.current = node
          attach(() => rect(button))(node)
        }}
        type="button"
      >
        open
      </button>
      {open && (
        <div
          ref={(node) => {
            panelRef.current = node
            attach(() => rect({ left: 0, top: 0, ...panel }))(node)
          }}
          data-testid="panel"
          style={style}
        >
          panel
        </div>
      )}
    </>
  )
}

function placeOf(
  button: { left: number; top: number; width: number; height: number },
  panel: { width: number; height: number }
): { left: number; top: number; position: string } {
  window.innerWidth = VIEWPORT.width
  window.innerHeight = VIEWPORT.height
  render(<Menu button={button} panel={panel} />)
  const style = screen.getByTestId('panel').style
  return { left: parseFloat(style.left), top: parseFloat(style.top), position: style.position }
}

describe('useMenuPlacement', () => {
  it('hangs the panel under the button, aligned to its left edge', () => {
    expect(
      placeOf({ left: 120, top: 10, width: 100, height: 26 }, { width: 220, height: 300 })
    ).toEqual({
      position: 'fixed',
      left: 120,
      top: 40,
    })
  })

  it('pulls a panel that would run off the right edge back inside the window', () => {
    const placed = placeOf(
      { left: 900, top: 10, width: 90, height: 26 },
      { width: 220, height: 300 }
    )
    expect(placed.left).toBe(VIEWPORT.width - 220 - 8)
  })

  it('never pushes a panel off the left edge, however wide it is', () => {
    const placed = placeOf(
      { left: 4, top: 10, width: 90, height: 26 },
      { width: 1200, height: 300 }
    )
    expect(placed.left).toBe(8)
  })

  it('opens upwards when there is no room below', () => {
    const placed = placeOf(
      { left: 100, top: 700, width: 90, height: 26 },
      { width: 220, height: 300 }
    )
    expect(placed.top).toBe(700 - 300 - 4)
  })

  it('stays on screen when it fits neither above nor below', () => {
    const placed = placeOf(
      { left: 100, top: 400, width: 90, height: 26 },
      { width: 220, height: 900 }
    )
    expect(placed.top).toBe(8)
  })

  it('re-places itself when the window is resized', () => {
    const button = { left: 900, top: 10, width: 90, height: 26 }
    window.innerWidth = 1000
    window.innerHeight = 800
    render(<Menu button={button} panel={{ width: 220, height: 300 }} />)
    expect(parseFloat(screen.getByTestId('panel').style.left)).toBe(1000 - 220 - 8)
    window.innerWidth = 600
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(parseFloat(screen.getByTestId('panel').style.left)).toBe(600 - 220 - 8)
  })

  it('measures nothing while the menu is closed', () => {
    render(
      <Menu
        button={{ left: 0, top: 0, width: 10, height: 10 }}
        panel={{ width: 10, height: 10 }}
        open={false}
      />
    )
    expect(screen.queryByTestId('panel')).toBeNull()
  })
})
