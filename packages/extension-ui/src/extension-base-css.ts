// Carries the `*.css?raw` module type to every package that compiles this file.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./raw-css.d.ts" />
import tokens from './tokens.css?raw'
import base from './extension-base.css?raw'

/**
 * The stylesheet injected into every extension document: the tokens, the icon
 * scale and the control resets. Read at build time with `?raw`, so the text is
 * part of the bundle in dev, in the packaged app and in the remote-control
 * server alike, with no file to find on disk at run time.
 */
export const EXTENSION_BASE_CSS = `${tokens}\n${base}`
