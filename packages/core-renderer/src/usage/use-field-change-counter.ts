import { useCallback, useRef, type FormEvent } from 'react'
import { recordUse } from './record'

/** A change handler for a whole settings section that counts each field once while the section
 * is shown: a change event fires on every keystroke, which would count one edit many times. */
export function useFieldChangeCounter(feature: string): (event: FormEvent) => void {
  const counted = useRef(new WeakSet<EventTarget>())
  return useCallback(
    (event: FormEvent) => {
      if (counted.current.has(event.target)) return
      counted.current.add(event.target)
      recordUse(feature)
    },
    [feature]
  )
}
