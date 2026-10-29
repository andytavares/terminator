import { singleQuoted } from '../../terminal/typed-input'
import { recordUse } from '../../usage/record'

/**
 * The paths of files dropped on a terminal, as a shell would want them typed:
 * space-separated, each with whitespace single-quoted.
 */
export function droppedPaths(files: FileList): string {
  const paths = Array.from(files)
    .map((file) => window.electronAPI.getFilePath(file))
    .filter(Boolean)
    .map((p) => (/\s/.test(p) ? singleQuoted(p) : p))
    .join(' ')
  if (paths !== '') recordUse('core.terminal.drop-paths')
  return paths
}
