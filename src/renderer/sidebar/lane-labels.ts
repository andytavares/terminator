interface NamedLane {
  repoRoot: string
  branch: string
  repoName: string
}

/** Each lane's repo name, with its branch beside it when another lane of the task is in that repo. */
export function laneLabels(lanes: readonly NamedLane[]): string[] {
  const inRepo = (root: string) => lanes.filter((l) => l.repoRoot === root).length
  return lanes.map((lane) =>
    inRepo(lane.repoRoot) > 1 ? `${lane.repoName} · ${lane.branch}` : lane.repoName
  )
}
