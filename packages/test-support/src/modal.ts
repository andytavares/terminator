import { fireEvent } from '@testing-library/react'

/** A press on the backdrop: it lands on the dialog element, outside its box. The test DOMs lay
 * nothing out, so every box is empty at the origin and (-1, -1) is outside it. */
export function pressOutside(dialog: Element): void {
  fireEvent.mouseDown(dialog, { clientX: -1, clientY: -1 })
}
