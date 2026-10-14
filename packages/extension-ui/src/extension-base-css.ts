// Carries the `*.css?raw` module type to every package that compiles this file.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./raw-css.d.ts" />
import tokens from './tokens.css?raw'
import base from './extension-base.css?raw'
import controls from './controls.css?raw'

/** The stylesheet injected into every extension document: tokens, icon scale, resets and form
 * controls. Read at build time with `?raw`, so it is in the bundle in dev, the packaged app and the
 * remote-control server alike, with no file to find on disk at run time. */
export const EXTENSION_BASE_CSS = `${tokens}\n${base}\n${controls}`
