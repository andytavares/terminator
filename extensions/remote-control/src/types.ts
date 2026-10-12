/**
 * The `name` on the error `spawnSession` throws for a `cwd` that is not an
 * existing directory. Part of the ExtensionAPI contract, matched by name
 * because the class itself lives in core and extensions never import from
 * there.
 */
export const MISSING_CWD_ERROR = 'MissingCwdError'
