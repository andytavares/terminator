import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { buildDecorations } from '../../../src/editor/livePreview'

describe('buildDecorations', () => {
  function makeState(doc: string) {
    return EditorState.create({ doc, extensions: [markdown()] })
  }

  function makeStateGFM(doc: string) {
    return EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] })
  }

  it('marks heading # text with a heading decoration (cursor off heading line)', () => {
    // Put heading on line 1, cursor on line 2
    const state = makeState('# Hello World\nother line\n')
    const decos = buildDecorations(state, { anchor: 14 }) // "other line" starts at 14
    let found = false
    decos.between(0, 13, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-heading')) found = true
    })
    expect(found).toBe(true)
  })

  it('returns a decoration set without throwing for heading with marker', () => {
    const state = makeState('## Section\n')
    const decos = buildDecorations(state, { anchor: 0 })
    expect(decos).toBeDefined()
  })

  it('suppresses heading decorations on the cursor line', () => {
    const state = makeState('# Hello\nSecond line\n')
    // Cursor on heading line (pos 3 = within "# Hello")
    const decosOnCursor = buildDecorations(state, { anchor: 3 })
    let foundOnCursor = false
    decosOnCursor.between(0, 7, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-heading'))
        foundOnCursor = true
    })
    // Move cursor off heading line
    const decosOffCursor = buildDecorations(state, { anchor: 10 })
    let foundOffCursor = false
    decosOffCursor.between(0, 7, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-heading'))
        foundOffCursor = true
    })
    expect(foundOnCursor).toBe(false)
    expect(foundOffCursor).toBe(true)
  })

  it('returns empty decoration set for plain text', () => {
    const state = makeState('just plain text\n')
    const decos = buildDecorations(state, { anchor: 0 })
    expect(decos).toBeDefined()
    let count = 0
    decos.between(0, state.doc.length, () => {
      count++
    })
    expect(count).toBe(0)
  })

  it('marks bold **text** with bold class (cursor off bold line)', () => {
    // Cursor on line 1 ("other"), bold on line 2 — decorations should apply
    const state = makeState('other\n**bold text**\n')
    const boldStart = 6 // position of "**" on line 2
    const decos = buildDecorations(state, { anchor: 0 }) // cursor on line 1
    let found = false
    decos.between(boldStart, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-bold')) found = true
    })
    expect(found).toBe(true)
  })

  it('marks italic _text_ with italic class (cursor off italic line)', () => {
    const state = makeState('other\n_italic text_\n')
    const decos = buildDecorations(state, { anchor: 0 }) // cursor on line 1
    let found = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-italic')) found = true
    })
    expect(found).toBe(true)
  })

  it('suppresses bold decorations on the cursor line', () => {
    const state = makeState('**bold**\nother\n')
    const decos = buildDecorations(state, { anchor: 3 }) // cursor on bold line
    let found = false
    decos.between(0, 8, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-bold')) found = true
    })
    expect(found).toBe(false)
  })

  it('marks inline code with code class (cursor off code line)', () => {
    const state = makeState('other\n`code here`\n')
    const decos = buildDecorations(state, { anchor: 0 }) // cursor on line 1
    let found = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-code')) found = true
    })
    expect(found).toBe(true)
  })

  it('handles multiple heading levels correctly', () => {
    const state = makeState('other\n## H2 heading\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let foundH2 = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-h2')) foundH2 = true
    })
    expect(foundH2).toBe(true)
  })

  it('hides inline code backtick markers (cursor off code line)', () => {
    const state = makeState('other\n`code here`\n')
    const decos = buildDecorations(state, { anchor: 0 })
    // Opening backtick at pos 6 should be replaced (no class, has replace spec)
    let foundReplace = false
    decos.between(6, 8, (_from, to, deco) => {
      if (to === 7 && !('class' in (deco.spec as Record<string, unknown>))) foundReplace = true
    })
    expect(foundReplace).toBe(true)
    // Content should still have notepad-code class
    let foundCode = false
    decos.between(7, 16, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-code')) foundCode = true
    })
    expect(foundCode).toBe(true)
  })

  it('produces a line deco for fenced code block content (cursor outside block)', () => {
    const state = makeState('other\n```\ncode\n```\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let foundLineDeco = false
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-code-block-line'))
        foundLineDeco = true
    })
    expect(foundLineDeco).toBe(true)
  })

  it('does NOT hide fenced code fences when cursor is inside block', () => {
    const state = makeState('```\ncode\n```\n')
    // Cursor at position 4 (inside "code")
    const decos = buildDecorations(state, { anchor: 4 })
    let foundLineDeco = false
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-code-block-line'))
        foundLineDeco = true
    })
    expect(foundLineDeco).toBe(false)
  })

  it('produces a blockquote line deco (cursor off quote line)', () => {
    const state = makeState('other\n> quoted text\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let found = false
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-blockquote-line'))
        found = true
    })
    expect(found).toBe(true)
  })

  it('marks strikethrough with strikethrough class (GFM, cursor off line)', () => {
    const state = makeStateGFM('other\n~~struck~~\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let found = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-strikethrough')) found = true
    })
    expect(found).toBe(true)
  })

  it('replaces horizontal rule with HR widget (cursor off rule line)', () => {
    // Need blank line before --- so it's not parsed as a Setext heading underline
    const state = makeState('other\n\n---\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let foundWidget = false
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec && 'widget' in (deco.spec as Record<string, unknown>)) foundWidget = true
    })
    expect(foundWidget).toBe(true)
  })

  it('replaces GFM task list markers with checkbox widgets (cursor off line)', () => {
    const state = makeStateGFM('other\n- [x] done\n- [ ] todo\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let widgetCount = 0
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec && 'widget' in (deco.spec as Record<string, unknown>)) widgetCount++
    })
    expect(widgetCount).toBeGreaterThanOrEqual(2)
  })

  it('produces code-block-line decorations for multi-line fenced code (cursor outside)', () => {
    const state = makeState('other\n```\nline one\nline two\n```\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let lineDecoCount = 0
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-code-block-line'))
        lineDecoCount++
    })
    expect(lineDecoCount).toBeGreaterThanOrEqual(2)
  })

  it('replaces image syntax with image widget (cursor off line)', () => {
    const state = makeState('other\n![alt text](http://example.com/img.png)\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let foundWidget = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if (deco.spec && 'widget' in (deco.spec as Record<string, unknown>)) foundWidget = true
    })
    expect(foundWidget).toBe(true)
  })

  it('applies ordered list mark class for ordered lists (cursor off line)', () => {
    const state = makeState('other\n1. first item\n2. second item\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let found = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-ordered-mark')) found = true
    })
    expect(found).toBe(true)
  })

  it('replaces link syntax with link widget (cursor off line)', () => {
    const state = makeState('other\n[link text](http://example.com)\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let foundWidget = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if (deco.spec && 'widget' in (deco.spec as Record<string, unknown>)) foundWidget = true
    })
    expect(foundWidget).toBe(true)
  })

  it('applies list-item-line decoration for bullet list items (cursor off line)', () => {
    const state = makeState('other\n- item one\n- item two\n')
    const decos = buildDecorations(state, { anchor: 0 })
    let found = false
    decos.between(6, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { class?: string })?.class?.includes('notepad-list-item-line')) found = true
    })
    expect(found).toBe(true)
  })
})
