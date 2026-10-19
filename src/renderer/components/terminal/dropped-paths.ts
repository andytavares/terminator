import { singleQuoted } from '../../terminal/typed-input'

/**
 * The paths of files dropped on a terminal, as a shell would want them typed:
 * space-separated, each with whitespace single-quoted.
 */
export function droppedPaths(files: FileList): string {
  return Array.from(files)
    .map((file) => window.electronAPI.getFilePath(file))
    .filter(Boolean)
    .map((p) => (/\s/.test(p) ? singleQuoted(p) : p))
    .join(' ')
}
