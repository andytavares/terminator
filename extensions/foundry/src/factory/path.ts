import type { HallMap, Tile } from './layout.js'

// BFS over a 4-neighbour grid. Every edge costs the same — a hall has no
// terrain, only walls — so breadth-first already finds the shortest route.
//
// The destination is always enterable even when the grid marks it solid: a
// crew member's goal is a station or a seat, and a station tile is solid so
// nobody walks *through* it, but arriving there is exactly the point.

function key(tile: Tile): string {
  return `${tile.x},${tile.y}`
}

function passable(solid: HallMap['solid'], tile: Tile, to: Tile): boolean {
  if (tile.y < 0 || tile.y >= solid.length) return false
  const row = solid[tile.y]
  if (tile.x < 0 || tile.x >= row.length) return false
  if (tile.x === to.x && tile.y === to.y) return true
  return !row[tile.x]
}

export function findPath(solid: HallMap['solid'], from: Tile, to: Tile): Tile[] {
  if (from.x === to.x && from.y === to.y) return []

  const cameFrom = new Map<string, Tile>()
  const visited = new Set<string>([key(from)])
  const queue: Tile[] = [from]

  let found = false
  for (let head = 0; head < queue.length && !found; head++) {
    const current = queue[head]
    const neighbours: Tile[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]
    for (const next of neighbours) {
      const k = key(next)
      if (visited.has(k)) continue
      if (!passable(solid, next, to)) continue
      visited.add(k)
      cameFrom.set(k, current)
      if (next.x === to.x && next.y === to.y) {
        found = true
        break
      }
      queue.push(next)
    }
  }

  if (!visited.has(key(to))) return []

  const path: Tile[] = []
  let step: Tile | undefined = to
  while (step !== undefined && !(step.x === from.x && step.y === from.y)) {
    path.unshift(step)
    step = cameFrom.get(key(step))
  }
  return path
}
