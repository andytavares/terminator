export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem46 {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult46 {
  items: BatchItem46[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter46 {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}
