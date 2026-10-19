/** Reads a JSON value, or the fallback when storage is absent, blocked, corrupt or `parse` refuses it. */
export function readStoredJson<T>(
  key: string,
  fallback: T,
  parse?: (value: unknown) => T | null
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    if (parse === undefined) return value as T
    return parse(value) ?? fallback
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
