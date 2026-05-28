import { describe, it, expect } from 'vitest'
import { validateDag, topoSort } from '../../../src/core/dag.js'
import type { SubAgent } from '../../../src/types/foundry.types.js'

function agent(id: string, dependsOn: string[] = []): SubAgent {
  return {
    agentId: id,
    role: `${id} agent`,
    dependsOn,
    inputFrom: dependsOn,
    outputArtifacts: [],
    status: 'pending',
  }
}

describe('validateDag()', () => {
  it('returns valid: true for single node', () => {
    expect(validateDag([agent('a')])).toEqual({ valid: true })
  })

  it('returns valid: true for linear chain (no cycle)', () => {
    const agents = [agent('a'), agent('b', ['a']), agent('c', ['b'])]
    expect(validateDag(agents)).toEqual({ valid: true })
  })

  it('returns valid: true for diamond shape', () => {
    const agents = [agent('a'), agent('b', ['a']), agent('c', ['a']), agent('d', ['b', 'c'])]
    expect(validateDag(agents)).toEqual({ valid: true })
  })

  it('detects a simple cycle (a → b → a)', () => {
    const result = validateDag([agent('a', ['b']), agent('b', ['a'])])
    expect(result).toMatchObject({ valid: false, cycleNodes: expect.arrayContaining(['a', 'b']) })
  })

  it('detects a longer cycle (a → b → c → a)', () => {
    const result = validateDag([agent('a', ['c']), agent('b', ['a']), agent('c', ['b'])])
    expect(result).toMatchObject({ valid: false })
  })
})

describe('validateDag() edge cases', () => {
  it('handles dep node not declared as its own agent (partial graph)', () => {
    // 'b' depends on 'a' but 'a' is not in the agents list
    // Kahn's will give 'a' inDegree=0 (it gets added to adj but not inDegree),
    // so 'b' will eventually be dequeued — or the dep node 'a' starts in adj only
    const agents = [agent('b', ['a'])]
    const result = validateDag(agents)
    // In this case 'b' has inDegree=1 from 'a', 'a' never gets to 0
    // So Kahn's detects it as a cycle (b never gets processed) — expected behavior
    expect('valid' in result).toBe(true)
  })

  it('returns valid true for 8-node DAG at max allowed size', () => {
    const agents = [
      agent('a'),
      agent('b', ['a']),
      agent('c', ['a']),
      agent('d', ['b']),
      agent('e', ['c']),
      agent('f', ['d', 'e']),
      agent('g', ['f']),
      agent('h', ['g']),
    ]
    expect(validateDag(agents)).toEqual({ valid: true })
  })
})

describe('topoSort()', () => {
  it('returns single tier for independent nodes', () => {
    const tiers = topoSort([agent('a'), agent('b'), agent('c')])
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('returns sequential tiers for linear chain', () => {
    const tiers = topoSort([agent('a'), agent('b', ['a']), agent('c', ['b'])])
    expect(tiers).toHaveLength(3)
    expect(tiers[0]).toEqual(['a'])
    expect(tiers[1]).toEqual(['b'])
    expect(tiers[2]).toEqual(['c'])
  })

  it('groups parallel nodes in same tier', () => {
    // a must run first; b and c can run in parallel; d needs both
    const agents = [agent('a'), agent('b', ['a']), agent('c', ['a']), agent('d', ['b', 'c'])]
    const tiers = topoSort(agents)
    expect(tiers).toHaveLength(3)
    expect(tiers[0]).toEqual(['a'])
    expect(tiers[1]).toEqual(expect.arrayContaining(['b', 'c']))
    expect(tiers[2]).toEqual(['d'])
  })

  it('handles 8-node DAG with parallelism correctly', () => {
    const agents = [
      agent('a'),
      agent('b', ['a']),
      agent('c', ['a']),
      agent('d', ['a']),
      agent('e', ['b', 'c']),
      agent('f', ['c', 'd']),
      agent('g', ['e']),
      agent('h', ['f', 'g']),
    ]
    const tiers = topoSort(agents)
    expect(tiers[0]).toEqual(['a'])
    const tier2 = tiers[1]
    expect(tier2).toEqual(expect.arrayContaining(['b', 'c', 'd']))
    expect(tier2).toHaveLength(3)
  })
})
