import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { buildDecorations } from '../../../src/editor/livePreview'

describe('livePreview perf (SC-002)', () => {
  it('buildDecorations p95 ≤ 16ms on 5,000-line document', () => {
    const lines: string[] = []
    for (let i = 0; i < 5000; i++) {
      if (i % 50 === 0) lines.push(`# Heading ${i}`)
      else if (i % 20 === 0) lines.push(`**bold text** and _italic_ here`)
      else if (i % 10 === 0) lines.push(`\`inline code\` example`)
      else lines.push(`Line ${i}: plain text content for benchmarking`)
    }
    const doc = lines.join('\n')

    const state = EditorState.create({ doc, extensions: [markdown()] })

    const runs = 20
    const times: number[] = []
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      buildDecorations(state, { anchor: 0 })
      times.push(performance.now() - start)
    }

    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(runs * 0.95)]
    expect(p95).toBeLessThanOrEqual(16)
  })
})
