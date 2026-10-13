import type React from 'react'
import { useEffect, useRef } from 'react'

/** A ref that always holds the latest value, for listeners created once. */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
