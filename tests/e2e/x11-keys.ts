import { execFileSync } from 'node:child_process'

// Presses a chord at the X server, where Electron's globalShortcut grabs keys on Linux and
// Playwright's keyboard never reaches, through XTEST from Python's ctypes (both under xvfb):
// https://www.x.org/releases/X11R7.7/doc/libXtst/xtestlib.html

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
