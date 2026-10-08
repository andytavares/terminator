// A check that dies because its installed dependencies are missing or cut short
// says nothing about the code it was meant to check. Read as a code failure on
// the base branch, one made Foundry declare main broken and open an order for it.

const MISSING_PACKAGE = /Cannot find (?:package|module) '([^'./][^']*)'/
const UNLOADABLE_LIBRARY = /Library not loaded: (?:@rpath\/)?([^/\n]+?)\.framework/

/** What is wrong with the installed dependencies, in words, or null when nothing in the log says so. */
export function brokenInstall(log: string): string | null {
  const missing = MISSING_PACKAGE.exec(log)
  if (missing !== null) return `the package ${missing[1]} is not installed`
  const library = UNLOADABLE_LIBRARY.exec(log)
  if (library !== null)
    return `${library[1]} could not be loaded, so the installed copy is incomplete`
  return null
}
