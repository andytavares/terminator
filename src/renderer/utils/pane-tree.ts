import type { PaneNode, PaneSplitDirection } from '../../shared/types/index'

export function splitLeaf(
  node: PaneNode,
  targetId: string,
  newId: string,
  direction: PaneSplitDirection
): PaneNode {
  if (node.type === 'leaf') {
    if (node.sessionId !== targetId) return node
    return {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      ratio: 0.5,
      first: node,
      second: { type: 'leaf', sessionId: newId },
    }
  }
  return {
    ...node,
    first: splitLeaf(node.first, targetId, newId, direction),
    second: splitLeaf(node.second, targetId, newId, direction),
  }
}

export function removeLeaf(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === targetId ? null : node
  }
  const first = removeLeaf(node.first, targetId)
  const second = removeLeaf(node.second, targetId)
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}

export function leafIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.sessionId]
  return [...leafIds(node.first), ...leafIds(node.second)]
}

export function updateSplitRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  }
}
