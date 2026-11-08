/**
 * The method at a `namespace.name` path of an `electronAPI` object, for specs
 * that walk the manifest's paths rather than name each method.
 */
export function methodAt(api: object, path: string): (...args: unknown[]) => unknown {
  const [namespace, name] = path.split('.')
  const groups: Record<string, unknown> = { ...api }
  const group = groups[namespace] as Record<string, unknown>
  return group[name] as (...args: unknown[]) => unknown
}
