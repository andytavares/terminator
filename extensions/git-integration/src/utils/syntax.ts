import hljs from './hljs'

export function escapeHtml(str: string): string {
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

/** The extension of the file a merge block id (`path#index`) belongs to. */
export function extensionOfBlock(blockId: string): string | undefined {
  return extensionOf(blockId.slice(0, blockId.lastIndexOf('#')))
}

/** `code` as highlighted HTML, or escaped text when highlight.js has no language for `ext`. */
export function highlight(code: string, ext: string | undefined): string {
  if (!ext || !hljs.getLanguage(ext)) return escapeHtml(code)
  return hljs.highlight(code, { language: ext, ignoreIllegals: true }).value
}
