/** Reads a JSON value, or the fallback when storage is absent, blocked or corrupt. */
export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
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
