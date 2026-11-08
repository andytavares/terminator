import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SplitContainer } from '../../../../src/renderer/components/terminal/SplitContainer'

function renderSplit(direction: 'horizontal' | 'vertical', ratio: number, onRatioChange = vi.fn()) {
  return render(
    <SplitContainer
      splitId="split-1"
      direction={direction}
      ratio={ratio}
      onRatioChange={onRatioChange}
    >
      {[
        <div key="a" data-testid="first">
          First
        </div>,
        <div key="b" data-testid="second">
          Second
        </div>,
      ]}
    </SplitContainer>
  )
}

/** A split laid out 400 by 200 at the origin; returns its divider. */
function renderDraggable(
  direction: 'horizontal' | 'vertical',
  onRatioChange: (splitId: string, ratio: number) => void,
  splitId = 'split-1'
): HTMLElement {
  const { container } = render(
    <SplitContainer
      splitId={splitId}
      direction={direction}
      ratio={0.5}
      onRatioChange={onRatioChange}
    >
      {[<div key="a">A</div>, <div key="b">B</div>]}
    </SplitContainer>
  )
  const outerContainer = container.querySelector('.split-container') as HTMLElement
  outerContainer.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 })
  return container.querySelector('.split-container__divider') as HTMLElement
}

/** Presses the left button on the divider at x 200, y 50, moves to `to`, and lets go. */
async function dragDivider(divider: HTMLElement, to: { clientX: number; clientY?: number }) {
  await userEvent
    .setup()
    .pointer([
      { keys: '[MouseLeft>]', target: divider, coords: { clientX: 200, clientY: 50 } },
      { coords: { clientY: 50, ...to } },
      { keys: '[/MouseLeft]' },
    ])
}

describe('SplitContainer', () => {
  it('renders both children', () => {
    const { getByTestId } = renderSplit('vertical', 0.5)
    expect(getByTestId('first')).toBeTruthy()
    expect(getByTestId('second')).toBeTruthy()
  })

  it.each(['vertical', 'horizontal'] as const)(
    'marks a %s split and its divider with the direction',
    (direction) => {
      const { container } = renderSplit(direction, 0.5)
      expect(container.querySelector(`.split-container--${direction}`)).toBeTruthy()
      expect(container.querySelector(`.split-container__divider--${direction}`)).toBeTruthy()
    }
  )

  it('gives the first child the ratio and the second child the rest', () => {
    const { container } = renderSplit('vertical', 0.3)
    const children = container.querySelectorAll('.split-container__child')
    expect(parseFloat((children[0] as HTMLElement).style.flex)).toBeCloseTo(0.3)
    expect(parseFloat((children[1] as HTMLElement).style.flex)).toBeCloseTo(0.7)
  })
})

describe('SplitContainer — dragging the divider', () => {
  // The split is 400 wide and 200 high, so a move to (300, 100) is 0.75 across and 0.5 down.
  it.each([
    ['vertical', 'split-v', 0.75],
    ['horizontal', 'split-h', 0.5],
  ] as const)(
    "reports a %s split's new ratio along its own axis",
    async (direction, splitId, ratio) => {
      const onRatioChange = vi.fn()
      const divider = renderDraggable(direction, onRatioChange, splitId)

      await dragDivider(divider, { clientX: 300, clientY: 100 })

      const [reportedSplitId, reportedRatio] = onRatioChange.mock.calls[0]
      expect(reportedSplitId).toBe(splitId)
      expect(reportedRatio).toBeCloseTo(ratio)
    }
  )

  it.each([
    [-100, 0.1],
    [9999, 0.9],
  ])('clamps a drag to x=%i at a ratio of %d', async (clientX, ratio) => {
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    await dragDivider(divider, { clientX })

    const [, reportedRatio] = onRatioChange.mock.calls[0]
    expect(reportedRatio).toBe(ratio)
  })
})

describe('SplitContainer — does not call onRatioChange after mouseup', () => {
  it('does not call onRatioChange after mouseup', async () => {
    const user = userEvent.setup()
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    await user.pointer([
      { keys: '[MouseLeft]', target: divider, coords: { clientX: 200, clientY: 50 } },
      { coords: { clientX: 300, clientY: 50 } },
    ])

    expect(onRatioChange).not.toHaveBeenCalled()
  })
})
