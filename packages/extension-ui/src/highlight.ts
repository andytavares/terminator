import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'

// The common set, not all ~190 languages: every extension this code maps is in
// it except Dockerfile, and the full build was 1 MB of the renderer bundle.
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerAliases('htm', { languageName: 'xml' })

export { hljs }

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The file's extension, lower-cased; a `Dockerfile` is its own name. highlight.js knows both as aliases. */
export function extensionOf(path: string): string | undefined {
  return path.split('/').pop()?.split('.').pop()?.toLowerCase() || undefined
}

/** `code` as highlighted HTML, or escaped text when highlight.js has no language for `ext`. */
export function highlight(code: string, ext: string | undefined): string {
  if (!ext || !hljs.getLanguage(ext)) return escapeHtml(code)
  return hljs.highlight(code, { language: ext, ignoreIllegals: true }).value
}
