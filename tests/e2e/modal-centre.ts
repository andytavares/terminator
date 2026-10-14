import { expect, test, type Locator } from '@playwright/test'

/** How far a modal's centre may sit from its window's centre, in CSS pixels: a box of odd
 * size in a window of even size is half a pixel off. */
const TOLERANCE_PX = 1

interface CentreOffset {
  x: number
  y: number
  /** Whether the modal fits inside its window with room to spare on every side. */
  inside: boolean
}

/** Read in the modal's own document: the core window's, an extension view's or a phone's. */
function centreOffset(modal: Element): CentreOffset {
  const box = modal.getBoundingClientRect()
  return {
    x: box.left + box.width / 2 - window.innerWidth / 2,
    y: box.top + box.height / 2 - window.innerHeight / 2,
    inside: box.top > 0 && box.left > 0 && box.height < window.innerHeight,
  }
}

/** Every modal sits in the middle of its window on both axes (ADR 110). Each measurement is
 * recorded on the test as a `modal-centre` annotation. */
export async function expectCentredInWindow(modal: Locator, name: string): Promise<void> {
  await expect(modal).toBeVisible()
  const offset = await modal.evaluate(centreOffset)
  test.info().annotations.push({
    type: 'modal-centre',
    description: `${name}: x ${offset.x.toFixed(2)}px, y ${offset.y.toFixed(2)}px`,
  })
  expect(Math.abs(offset.x), `${name} is off centre across`).toBeLessThanOrEqual(TOLERANCE_PX)
  expect(Math.abs(offset.y), `${name} is off centre down`).toBeLessThanOrEqual(TOLERANCE_PX)
  expect(offset.inside, `${name} reaches past its window`).toBe(true)
}
