import { execFileSync } from 'node:child_process'

// Presses a key chord at the X server, the way a physical keyboard does, so a
// global shortcut fires whatever window has focus. Playwright's keyboard sends
// key events to one page over the DevTools protocol and never reaches the X
// server, where Electron's globalShortcut grabs its keys on Linux.
//
// It uses the XTEST extension (https://www.x.org/releases/X11R7.7/doc/libXtst/xtestlib.html)
// through Python's ctypes, both present on any Linux desktop and under xvfb.

const PRESS_CHORD = `
import ctypes, sys
x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
xtst = ctypes.cdll.LoadLibrary('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
display = x11.XOpenDisplay(None)
if not display:
    sys.exit('no X display')
codes = [x11.XKeysymToKeycode(ctypes.c_void_p(display), x11.XStringToKeysym(name.encode()))
         for name in sys.argv[1:]]
for code in codes:
    xtst.XTestFakeKeyEvent(ctypes.c_void_p(display), code, True, 0)
for code in reversed(codes):
    xtst.XTestFakeKeyEvent(ctypes.c_void_p(display), code, False, 0)
x11.XFlush(ctypes.c_void_p(display))
x11.XCloseDisplay(ctypes.c_void_p(display))
`

/** Whether this machine can press keys at the X server. */
export const canPressGlobalKeys = process.platform === 'linux' && Boolean(process.env.DISPLAY)

/** Presses and releases the keys, named as X keysyms (`Control_L`, `Shift_L`, `o`). */
export function pressGlobalChord(...keysyms: string[]): void {
  execFileSync('python3', ['-I', '-c', PRESS_CHORD, ...keysyms])
}
