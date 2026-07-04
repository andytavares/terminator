import type { BatchItem19, BatchFilter19, BatchResult19, Priority } from './types'

const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function sortByPriority(items: BatchItem19[]): BatchItem19[] {
  return [...items].sort(
    (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
  )
}

export function filterItems(
  items: BatchItem19[],
  filter: BatchFilter19
): BatchItem19[] {
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

export function paginate(items: BatchItem19[], page: number, pageSize: number): BatchResult19 {
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

export function createItem19(index: number, priority: Priority = 'medium'): BatchItem19 {
  return {
    id: `item-batch-19-${index}-${Date.now()}`,
    index,
    priority,
    tags: [`batch-19`, `index-${index}`],
    createdAt: new Date(),
    metadata: { batchId: 19, sequence: index },
  }
}
