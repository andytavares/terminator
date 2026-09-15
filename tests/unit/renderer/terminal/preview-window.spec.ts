import { describe, it, expect } from 'vitest'
import { previewWindow } from '../../../../src/renderer/terminal/preview-window'

const base = { rows: 40, cursorY: 0, lineHeight: 16, naturalW: 1000, naturalH: 648 }

describe('previewWindow', () => {
  it('fills the box width rather than shrinking to fit the whole screen', () => {
    const { scale } = previewWindow({ ...base, containerW: 500, containerH: 150 })
    expect(scale).toBe(0.5)
  })

  it('shows the top of the screen when the cursor is still near it', () => {
    expect(
      previewWindow({ ...base, cursorY: 3, containerW: 500, containerH: 150 }).translateY
    ).toBe(0)
  })

  it('follows the cursor down so the latest line is the last one shown', () => {
    // 150px at scale 0.5 is 300 natural px: 18 whole rows after the 4px inset.
    const { translateY } = previewWindow({ ...base, cursorY: 30, containerW: 500, containerH: 150 })
    const top = 30 + 1 - 18
    expect(translateY).toBe(-top * 16 * 0.5)
  })

  it('never scrolls past the last row of the screen', () => {
    const { translateY } = previewWindow({ ...base, cursorY: 39, containerW: 500, containerH: 150 })
    expect(translateY).toBe(-(40 - 18) * 16 * 0.5)
  })

  it('does not move when the whole screen already fits', () => {
    expect(
      previewWindow({ ...base, cursorY: 39, containerW: 500, containerH: 400 }).translateY
    ).toBe(0)
  })
})
