/**
 * Whether a checkout-relative, slash-separated path is documentation: any
 * markdown file, a README or a CHANGELOG at any depth, or anything under
 * `docs/` or `specs/`.
 *
 * Free of Node builtins, because the final check's ladder uses it and the
 * renderer bundles the ladder.
 */
export function isDocumentationRelative(relative: string): boolean {
  const parts = relative.split('/').filter((part) => part !== '' && part !== '.')
  if (relative.startsWith('/') || parts[0] === '..') return false
  const name = parts[parts.length - 1] ?? ''
  if (/\.md$/i.test(name) || /^(CHANGELOG|README)/i.test(name)) return true
  return parts.length > 1 && (parts[0] === 'docs' || parts[0] === 'specs')
}
