import type { BatchItem32, BatchFilter32, BatchResult32, Priority } from './types'

const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function sortByPriority(items: BatchItem32[]): BatchItem32[] {
  return [...items].sort(
    (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
  )
}

export function filterItems(
  items: BatchItem32[],
  filter: BatchFilter32
): BatchItem32[] {
  return items.filter((item) => {
    if (filter.priority && item.priority !== filter.priority) return false
    if (filter.tags?.length && !filter.tags.some((t) => item.tags.includes(t))) return false
    if (filter.fromDate && item.createdAt < filter.fromDate) return false
    if (filter.toDate && item.createdAt > filter.toDate) return false
    if (filter.search) {
      const q = filter.search.toLowerCase()
      if (!item.id.toLowerCase().includes(q)) return false
    }
    return true
  })
}

export function paginate(items: BatchItem32[], page: number, pageSize: number): BatchResult32 {
  const start = (page - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  return {
    items: slice,
    totalCount: items.length,
    page,
    pageSize,
    hasMore: start + pageSize < items.length,
  }
}

export function createItem32(index: number, priority: Priority = 'medium'): BatchItem32 {
  return {
    id: `item-batch-32-${index}-${Date.now()}`,
    index,
    priority,
    tags: [`batch-32`, `index-${index}`],
    createdAt: new Date(),
    metadata: { batchId: 32, sequence: index },
  }
}
