import type { SubAgent } from '../types/foundry.types.js'

export function validateDag(
  agents: SubAgent[]
): { valid: true } | { valid: false; cycleNodes: string[] } {
  // Kahn's algorithm
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>() // node → dependents

  for (const a of agents) {
    if (!inDegree.has(a.agentId)) inDegree.set(a.agentId, 0)
    if (!adj.has(a.agentId)) adj.set(a.agentId, [])
    for (const dep of a.dependsOn) {
      inDegree.set(a.agentId, /* v8 ignore next */ (inDegree.get(a.agentId) ?? 0) + 1)
      if (!adj.has(dep)) adj.set(dep, [])
      adj.get(dep)!.push(a.agentId)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  let processed = 0
  while (queue.length > 0) {
    const node = queue.shift()!
    processed++
    for (const dependent of /* v8 ignore next */ adj.get(node) ?? []) {
      const newDeg = /* v8 ignore next */ (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, newDeg)
      if (newDeg === 0) queue.push(dependent)
    }
  }

  if (processed === agents.length) return { valid: true }

  const cycleNodes = [...inDegree.entries()].filter(([, deg]) => deg > 0).map(([id]) => id)
  return { valid: false, cycleNodes }
}

export function topoSort(agents: SubAgent[]): string[][] {
  // Returns tiers of parallel-eligible agents
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const a of agents) {
    if (!inDegree.has(a.agentId)) inDegree.set(a.agentId, 0)
    if (!adj.has(a.agentId)) adj.set(a.agentId, [])
    for (const dep of a.dependsOn) {
      inDegree.set(a.agentId, /* v8 ignore next */ (inDegree.get(a.agentId) ?? 0) + 1)
      if (!adj.has(dep)) adj.set(dep, [])
      adj.get(dep)!.push(a.agentId)
    }
  }

  const tiers: string[][] = []
  let safety = agents.length + 1
  while (safety-- > 0) {
    const tier = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id)
    if (tier.length === 0) break
    tiers.push(tier)
    for (const node of tier) {
      inDegree.delete(node)
      for (const dependent of /* v8 ignore next */ adj.get(node) ?? []) {
        inDegree.set(dependent, /* v8 ignore next */ (inDegree.get(dependent) ?? 0) - 1)
      }
    }
  }
  return tiers
}
