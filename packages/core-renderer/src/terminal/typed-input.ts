// How text is written to a terminal so the program reading it takes it as typed.

/** `text` wrapped as a bracketed paste and followed by Enter, so a leading digit is not a menu pick. */
export function pastedLine(text: string): string {
  return `\x1b[200~${text}\x1b[201~\r`
}

/** `text` as one shell word: inside single quotes, with each embedded quote closed and escaped. */
export function singleQuoted(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}
