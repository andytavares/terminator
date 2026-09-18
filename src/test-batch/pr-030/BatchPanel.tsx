import React, { useEffect } from 'react'
import { useBatch30 } from './useBatch'
import type { BatchFilter30, Priority } from './types'
import { BATCH_KEY, STATUS_MAP } from './constants'

interface Props {
  filter?: BatchFilter30
  onItemClick?: (id: string) => void
}

const PRIORITY_COLOR: Record<Priority, string> = {
  low: '#6b7280',
  medium: '#2563eb',
  high: '#d97706',
  critical: '#dc2626',
}

export function BatchPanel30({ filter, onItemClick }: Props): JSX.Element {
  const { result, loading, error, fetch } = useBatch30()

  useEffect(() => {
    void fetch(filter)
  }, [fetch, filter])

  if (loading) {
    return <div data-testid={`${BATCH_KEY}-loading`}>Loading batch 30...</div>
  }

  if (error) {
    return (
      <div data-testid={`${BATCH_KEY}-error`} style={{ color: '#dc2626' }}>
        Error: {error}
      </div>
    )
  }

  if (!result || result.items.length === 0) {
    return <div data-testid={`${BATCH_KEY}-empty`}>No items in batch 30.</div>
  }

  return (
    <div data-testid={`${BATCH_KEY}-panel`}>
      <h3>Batch 30 ({result.totalCount} items)</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {result.items.map((item) => (
          <li
            key={item.id}
            onClick={() => onItemClick?.(item.id)}
            style={{ cursor: 'pointer', marginBottom: 4 }}
          >
            <span style={{ color: PRIORITY_COLOR[item.priority], fontWeight: 600 }}>
              [{item.priority.toUpperCase()}]
            </span>{' '}
            {item.id}
            <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>
              {STATUS_MAP.active}
            </span>
          </li>
        ))}
      </ul>
      {result.hasMore && (
        <button onClick={() => fetch(filter)}>
          Load more (page {result.page + 1})
        </button>
      )}
    </div>
  )
}
