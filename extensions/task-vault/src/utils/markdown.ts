/**
 * Minimal markdown-to-HTML renderer for task details (no external deps).
 * Handles: headers (h1–h3), bold, italic, inline code, links, fenced code
 * blocks, unordered lists with checkboxes, and paragraphs.
 */
export function renderMarkdown(raw: string): string {
  if (!raw.trim()) return ''

  const lines = raw.split('\n')
  const out: string[] = []
  let i = 0
  let inList = false

  function closeList() {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  function inlineFormat(text: string): string {
    // Escape HTML first, then apply inline patterns.
    // Links must come before bold/italic to avoid mangling href brackets.
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
        const safeUrl = url.replace(/"/g, '%22')
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      closeList()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        i++
      }
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
      i++
      continue
    }

    // Headers
    const h3 = /^### (.+)$/.exec(line)
    if (h3) {
      closeList()
      out.push(`<h3>${inlineFormat(h3[1])}</h3>`)
      i++
      continue
    }
    const h2 = /^## (.+)$/.exec(line)
    if (h2) {
      closeList()
      out.push(`<h2>${inlineFormat(h2[1])}</h2>`)
      i++
      continue
    }
    const h1 = /^# (.+)$/.exec(line)
    if (h1) {
      closeList()
      out.push(`<h1>${inlineFormat(h1[1])}</h1>`)
      i++
      continue
    }

    // Checkbox list items
    const checkDone = /^- \[x\] (.+)$/i.exec(line)
    if (checkDone) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(
        `<li class="md-check md-check--done"><span class="md-checkbox">✓</span>${inlineFormat(checkDone[1])}</li>`
      )
      i++
      continue
    }
    const checkOpen = /^- \[ \] (.+)$/.exec(line)
    if (checkOpen) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(
        `<li class="md-check"><span class="md-checkbox">○</span>${inlineFormat(checkOpen[1])}</li>`
      )
      i++
      continue
    }

    // Bullet list
    const bullet = /^[-*] (.+)$/.exec(line)
    if (bullet) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inlineFormat(bullet[1])}</li>`)
      i++
      continue
    }

    // Blank line
    if (line.trim() === '') {
      closeList()
      i++
      continue
    }

    // Paragraph text
    closeList()
    out.push(`<p>${inlineFormat(line)}</p>`)
    i++
  }

  closeList()
  return out.join('\n')
}
