import { useEffect } from 'react'
import { useFocusStore } from '../../home/focus-store'

/** Remembers when Home was last looked at, once it goes away, for "Since you left". */
export function useMarkLeftHome(): void {
  useEffect(() => () => useFocusStore.getState().markLeftHome(Date.now()), [])
}
