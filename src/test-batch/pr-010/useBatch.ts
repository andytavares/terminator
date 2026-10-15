import { useState, useCallback, useRef } from 'react'
import type { BatchItem10, BatchFilter10, BatchResult10, Priority } from './types'
import { sortByPriority, filterItems, paginate, createItem10 } from './utils'
import { DEFAULT_PAGE_SIZE, MAX_ITEMS, RETRY_LIMIT, TIMEOUT_MS } from './constants'

interface UseBatch10 {
  result: BatchResult10 | null
  loading: boolean
  error: string | null
  fetch: (filter?: BatchFilter10) => Promise<void>
  reset: () => void
  addItem: (priority?: Priority) => void
}

export function useBatch10(page = 1): UseBatch10 {
  const [result, setResult] = useState<BatchResult10 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retries = useRef(0)
  const items = useRef<BatchItem10[]>([])

  const fetch = useCallback(async (filter: BatchFilter10 = {}) => {
    setLoading(true)
    setError(null)
    try {
      await new Promise<void>((resolve, reject) =>
        setTimeout(() => (Math.random() > 0.01 ? resolve() : reject(new Error('timeout'))), 10)
      )
      const filtered = filterItems(sortByPriority(items.current), filter)
      setResult(paginate(filtered, page, DEFAULT_PAGE_SIZE))
      retries.current = 0
    } catch (err) {
      if (retries.current < RETRY_LIMIT) {
        retries.current++
        await new Promise((r) => setTimeout(r, TIMEOUT_MS / RETRY_LIMIT))
        return fetch(filter)
      }
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [page])

  const reset = useCallback(() => {
    items.current = []
    setResult(null)
    setError(null)
    retries.current = 0
  }, [])

  const addItem = useCallback((priority: Priority = 'medium') => {
    if (items.current.length >= MAX_ITEMS) return
    items.current = [...items.current, createItem10(items.current.length, priority)]
  }, [])

  return { result, loading, error, fetch, reset, addItem }
}
