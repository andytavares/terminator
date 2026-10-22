// Free of Node builtins: the Forge's renderer and the hint reader both match with it.
const GLOB_PIECES: Record<string, string> = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*' }

/** A slash-separated glob as a pattern; one with no slash matches a name at any depth. */
export function globPattern(glob: string): RegExp {
  const body = glob.replace(
    /\*\*\/|\*\*|\*|[.+^${}()|[\]\\?]/g,
    (piece) => GLOB_PIECES[piece] ?? `\\${piece}`
  )
  return new RegExp(`^${glob.includes('/') ? '' : '(?:.*/)?'}${body}$`)
}
