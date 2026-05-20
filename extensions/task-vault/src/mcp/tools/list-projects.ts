import { readIndex } from '../../vault/indexer'
import type { ProjectStatus, IndexedProject } from '../../vault/types'

interface ListProjectsInput {
  status?: ProjectStatus | ProjectStatus[]
}

export async function listProjectsMcp(
  input: ListProjectsInput,
  vaultPath: string
): Promise<{ projects: IndexedProject[] } | { error: string }> {
  const index = await readIndex(vaultPath)
  if (!index) return { projects: [] }

  const statuses: ProjectStatus[] = input.status
    ? Array.isArray(input.status)
      ? input.status
      : [input.status]
    : ['active']

  const projects = index.projects.filter((p) => statuses.includes(p.status as ProjectStatus))
  return { projects }
}
