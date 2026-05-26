import hljs from 'highlight.js'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  xml: 'xml',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
}

const AUTO_HINTS = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'bash', 'json']

export function langFromBlockId(blockId: string): string | undefined {
  const path = blockId.slice(0, blockId.lastIndexOf('#'))
  const filename = path.split('/').pop() ?? ''
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile'
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MAP[ext]
}

export function highlightBlock(code: string, lang?: string): string {
  if (!code) return ''
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code, AUTO_HINTS).value
  } catch {
    return escapeHtml(code)
  }
}

export function highlightLine(line: string, lang?: string): string {
  if (!line.trim()) return escapeHtml(line)
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(line, { language: lang }).value
    }
    return escapeHtml(line)
  } catch {
    return escapeHtml(line)
  }
}
