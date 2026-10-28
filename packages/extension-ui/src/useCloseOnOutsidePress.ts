import { useEffect, type RefObject } from 'react'

/** Calls `onPress` for a press outside `ref`, while `enabled`. For a list that cannot be a `Popover`:
 * its field sits outside it, so light dismiss would read each press there as a click away. */
export function useCloseOnOutsidePress(
  ref: RefObject<HTMLElement | null>,
  onPress: () => void,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) return
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onPress()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
