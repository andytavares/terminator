import { isAbsolute, relative, sep } from 'node:path'

/** Whether `path` is `root` or below it; a sibling named `..x` is not mistaken for a parent. */
export function isPathWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
