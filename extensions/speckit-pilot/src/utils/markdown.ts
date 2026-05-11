// Lightweight markdown → HTML converter for spec file display.
// Handles the subset commonly used in .specify files.

export function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let i = 0

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inline = (s: string): string =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(esc(lines[i]))
        i++
      }
      html.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ''}>${codeLines.join('\n')}</code></pre>`
      )
      i++
      continue
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)$/)
    if (hm) {
      const level = hm[1].length
      html.push(`<h${level}>${inline(hm[2])}</h${level}>`)
      i++
      continue
    }

    // HR
    if (/^---+$/.test(line.trim())) {
      html.push('<hr>')
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      html.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`)
      i++
      continue
    }

    // Table (simple)
    if (line.includes('|') && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1].trim())) {
      const headers = line
        .split('|')
        .filter((_, j, a) => j > 0 && j < a.length - 1)
        .map((c) => `<th>${inline(c.trim())}</th>`)
        .join('')
      i += 2 // skip separator
      const rows: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i]
          .split('|')
          .filter((_, j, a) => j > 0 && j < a.length - 1)
          .map((c) => `<td>${inline(c.trim())}</td>`)
          .join('')
        rows.push(`<tr>${cells}</tr>`)
        i++
      }
      html.push(`<table><thead><tr>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }

    // Task list item
    const tlm = line.match(/^(\s*)- \[([ xX])\] (.*)$/)
    if (tlm) {
      const done = tlm[2] !== ' '
      html.push(
        `<ul style="list-style:none;padding-left:${tlm[1].length * 8}px"><li class="sk-task-item${done ? ' sk-task-item--done' : ''}">` +
          `<input type="checkbox" class="sk-task-check" disabled${done ? ' checked' : ''}> ${inline(tlm[3])}</li></ul>`
      )
      i++
      continue
    }

    // Unordered list
    const ulm = line.match(/^(\s*)[-*+] (.*)$/)
    if (ulm) {
      const indent = ulm[1].length
      const items: string[] = [`<li>${inline(ulm[2])}</li>`]
      i++
      while (i < lines.length) {
        const next = lines[i].match(/^(\s*)[-*+] (.*)$/)
        if (next && next[1].length === indent) {
          items.push(`<li>${inline(next[2])}</li>`)
          i++
        } else break
      }
      html.push(`<ul style="padding-left:${indent * 8 + 20}px">${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    const olm = line.match(/^(\s*)\d+\. (.*)$/)
    if (olm) {
      const indent = olm[1].length
      const items: string[] = [`<li>${inline(olm[2])}</li>`]
      i++
      while (i < lines.length) {
        const next = lines[i].match(/^(\s*)\d+\. (.*)$/)
        if (next && next[1].length === indent) {
          items.push(`<li>${inline(next[2])}</li>`)
          i++
        } else break
      }
      html.push(`<ol style="padding-left:${indent * 8 + 20}px">${items.join('')}</ol>`)
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph
    html.push(`<p>${inline(line)}</p>`)
    i++
  }

  return html.join('\n')
}
