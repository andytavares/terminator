#!/usr/bin/env bash
# Generates 50 test pull requests, each with 5 real TypeScript/TSX source files.
# Branches: test/pr-batch-NNN
# Label: test-pr-batch
# Files written under src/test-batch/pr-NNN/

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BASE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LABEL="test-pr-batch"
SRC_DIR="src/test-batch"
TOTAL=50

echo "Base branch: $BASE_BRANCH"
echo "Generating $TOTAL PRs with 5 TypeScript files each..."

gh label create "$LABEL" --color "#e4e669" --description "Automated test PR batch" 2>/dev/null || true

mkdir -p "$SRC_DIR"

for i in $(seq -f "%03g" 1 $TOTAL); do
  N=$((10#$i))
  BRANCH="test/pr-batch-$i"
  DIR="$SRC_DIR/pr-$i"

  # Pre-compute all values used inside heredocs to avoid bash expressions there
  PAGE_SIZE=$((N % 25 + 10))
  MAX_ITEMS=$((N * 10 + 100))
  RETRY_LIMIT=$((N % 5 + 1))
  TIMEOUT_MS=$((N * 100 + 1000))
  LABEL_COUNT=$((N % 5 + 1))

  echo ""
  echo "[$i/$TOTAL] Creating branch $BRANCH..."

  git branch -D "$BRANCH" 2>/dev/null || true
  git checkout -b "$BRANCH" "$BASE_BRANCH"

  mkdir -p "$DIR"

  # ── File 1: types.ts ─────────────────────────────────────────────────────────
  cat > "$DIR/types.ts" <<EOF
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem$N {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult$N {
  items: BatchItem$N[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter$N {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}
EOF

  # ── File 2: utils.ts ─────────────────────────────────────────────────────────
  cat > "$DIR/utils.ts" <<EOF
import type { BatchItem$N, BatchFilter$N, BatchResult$N, Priority } from './types'

const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function sortByPriority(items: BatchItem$N[]): BatchItem$N[] {
  return [...items].sort(
    (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
  )
}

export function filterItems(
  items: BatchItem$N[],
  filter: BatchFilter$N
): BatchItem$N[] {
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

export function paginate(items: BatchItem$N[], page: number, pageSize: number): BatchResult$N {
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

export function createItem$N(index: number, priority: Priority = 'medium'): BatchItem$N {
  return {
    id: \`item-batch-$N-\${index}-\${Date.now()}\`,
    index,
    priority,
    tags: [\`batch-$N\`, \`index-\${index}\`],
    createdAt: new Date(),
    metadata: { batchId: $N, sequence: index },
  }
}
EOF

  # ── File 3: constants.ts ──────────────────────────────────────────────────────
  cat > "$DIR/constants.ts" <<EOF
export const BATCH_ID = $N as const
export const BATCH_KEY = 'batch-$i' as const
export const DEFAULT_PAGE_SIZE = $PAGE_SIZE
export const MAX_ITEMS = $MAX_ITEMS
export const RETRY_LIMIT = $RETRY_LIMIT
export const TIMEOUT_MS = $TIMEOUT_MS

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, $LABEL_COUNT) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP
EOF

  # ── File 4: useBatch.ts (hook) ────────────────────────────────────────────────
  cat > "$DIR/useBatch.ts" <<EOF
import { useState, useCallback, useRef } from 'react'
import type { BatchItem$N, BatchFilter$N, BatchResult$N, Priority } from './types'
import { sortByPriority, filterItems, paginate, createItem$N } from './utils'
import { DEFAULT_PAGE_SIZE, MAX_ITEMS, RETRY_LIMIT, TIMEOUT_MS } from './constants'

interface UseBatch$N {
  result: BatchResult$N | null
  loading: boolean
  error: string | null
  fetch: (filter?: BatchFilter$N) => Promise<void>
  reset: () => void
  addItem: (priority?: Priority) => void
}

export function useBatch$N(page = 1): UseBatch$N {
  const [result, setResult] = useState<BatchResult$N | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retries = useRef(0)
  const items = useRef<BatchItem$N[]>([])

  const fetch = useCallback(async (filter: BatchFilter$N = {}) => {
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
    items.current = [...items.current, createItem$N(items.current.length, priority)]
  }, [])

  return { result, loading, error, fetch, reset, addItem }
}
EOF

  # ── File 5: BatchPanel.tsx (component) ───────────────────────────────────────
  cat > "$DIR/BatchPanel.tsx" <<EOF
import React, { useEffect } from 'react'
import { useBatch$N } from './useBatch'
import type { BatchFilter$N, Priority } from './types'
import { BATCH_KEY, STATUS_MAP } from './constants'

interface Props {
  filter?: BatchFilter$N
  onItemClick?: (id: string) => void
}

const PRIORITY_COLOR: Record<Priority, string> = {
  low: '#6b7280',
  medium: '#2563eb',
  high: '#d97706',
  critical: '#dc2626',
}

export function BatchPanel$N({ filter, onItemClick }: Props): JSX.Element {
  const { result, loading, error, fetch } = useBatch$N()

  useEffect(() => {
    void fetch(filter)
  }, [fetch, filter])

  if (loading) {
    return <div data-testid={\`\${BATCH_KEY}-loading\`}>Loading batch $N...</div>
  }

  if (error) {
    return (
      <div data-testid={\`\${BATCH_KEY}-error\`} style={{ color: '#dc2626' }}>
        Error: {error}
      </div>
    )
  }

  if (!result || result.items.length === 0) {
    return <div data-testid={\`\${BATCH_KEY}-empty\`}>No items in batch $N.</div>
  }

  return (
    <div data-testid={\`\${BATCH_KEY}-panel\`}>
      <h3>Batch $N ({result.totalCount} items)</h3>
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
EOF

  git add "$DIR/"
  git commit -m "feat(test-batch): add batch-$i module — types, utils, hook, component [skip ci]"

  git push origin "$BRANCH" --force-with-lease

  gh pr create \
    --title "feat(test-batch): batch $i — BatchPanel$N with filter/sort/pagination" \
    --body "$(cat <<BODY
## Summary

Adds \`src/test-batch/pr-$i/\` module for batch $N.

### Files
- \`types.ts\` — \`BatchItem$N\`, \`BatchResult$N\`, \`BatchFilter$N\` interfaces
- \`utils.ts\` — \`sortByPriority\`, \`filterItems\`, \`paginate\`, \`createItem$N\`
- \`constants.ts\` — batch-scoped config constants
- \`useBatch.ts\` — React hook with retry logic and pagination
- \`BatchPanel.tsx\` — React component renders item list with priority colouring

> Auto-generated test PR $N/$TOTAL. Remove with \`scripts/cleanup-test-prs.sh\`.
BODY
)" \
    --base "$BASE_BRANCH" \
    --head "$BRANCH" \
    --label "$LABEL" \
    --draft

  git checkout "$BASE_BRANCH"
  git branch -D "$BRANCH"

  echo "  Created PR $i ✓"
done

echo ""
echo "Done. $TOTAL draft PRs created under label '$LABEL'."
echo "Run scripts/cleanup-test-prs.sh to delete them."
