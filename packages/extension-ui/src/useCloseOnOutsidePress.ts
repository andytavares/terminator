import { useEffect, type RefObject } from 'react'

/**
 * Calls `onPress` for a press outside `ref`, while `enabled`.
 *
 * For a list that cannot be a `Popover`: the field that drives it sits outside the list, so the
 * browser's own light dismiss would take every press on that field for a click away. Anything that
 * can be a Popover should be one.
 */
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
