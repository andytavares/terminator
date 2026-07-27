import React from 'react'
import './supervision.css'

// Concept 10's palette, over one unified entity index. The PRD's own check on
// this design: the palette is the query layer with a text box on it — if it is
// hard to build, the substrate is wrong. It was not hard to build.

export type EntityKind = 'session' | 'workItem' | 'repository' | 'worktree' | 'command'

export interface PaletteEntity {
  readonly id: string
  readonly kind: EntityKind
  readonly label: string
  readonly detail?: string
}

/**
 * Ranks a query across every entity type in one list (FR-026). A prefix match
 * beats a word-start match beats a substring, so typing the start of a name
 * puts it first regardless of which kind it is.
 */
export function rankEntities(
  entities: readonly PaletteEntity[],
  query: string,
  limit = 30
): PaletteEntity[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...entities].slice(0, limit)

  return entities
    .flatMap((entity) => {
      const haystack = `${entity.label} ${entity.detail ?? ''}`.toLowerCase()
      const index = haystack.indexOf(needle)
      if (index === -1) return []
      const score = entity.label.toLowerCase().startsWith(needle)
        ? 0
        : /\s/.test(haystack[index - 1] ?? ' ')
          ? 1
          : 2
      return [{ entity, score, index }]
    })
    .sort(
      (a, b) =>
        a.score - b.score || a.index - b.index || a.entity.label.localeCompare(b.entity.label)
    )
    .slice(0, limit)
    .map((scored) => scored.entity)
}

const KIND_LABELS: Record<EntityKind, string> = {
  session: 'session',
  workItem: 'work item',
  repository: 'repo',
  worktree: 'worktree',
  command: 'command',
}

export interface SupervisionPaletteProps {
  entities: readonly PaletteEntity[]
  query: string
  onQueryChange(query: string): void
  onChoose(entity: PaletteEntity): void
}

export function SupervisionPalette({
  entities,
  query,
  onQueryChange,
  onChoose,
}: SupervisionPaletteProps): JSX.Element {
  const results = rankEntities(entities, query)

  return (
    <div className="sv-panel">
      {/* Its own class, not the section-header one: that is uppercased with
          letter-spacing, so it rendered what you typed in capitals. */}
      <input
        className="sv-panel__search"
        placeholder="Search sessions, work items, repositories, worktrees and commands"
        aria-label="Search sessions, work items, repositories, worktrees and commands"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {results.length === 0 ? (
        <div className="sv-allclear">Nothing matches “{query}”.</div>
      ) : (
        results.map((entity) => (
          <button
            className="sv-row"
            key={`${entity.kind}:${entity.id}`}
            onClick={() => onChoose(entity)}
          >
            <span className="sv-chip">{KIND_LABELS[entity.kind]}</span>
            <span className="sv-row__main">
              <div className="sv-queue__title">{entity.label}</div>
              {entity.detail !== undefined && <div className="sv-queue__meta">{entity.detail}</div>}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
