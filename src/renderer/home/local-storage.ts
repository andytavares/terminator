import type { z } from 'zod'

/** Reads a JSON value, or the fallback when storage is absent, blocked, corrupt or not shaped like `schema`. */
export function readStoredJson<T>(
  key: string,
  fallback: T,
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    if (schema === undefined) return value as T
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

/** Writes a JSON value; a full or blocked store loses the write and nothing else. */
export function writeStoredJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // The Desk works without persistence; the next load starts empty.
  }
}
