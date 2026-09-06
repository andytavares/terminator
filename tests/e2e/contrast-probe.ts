/**
 * Measuring what a reader actually sees, in a rendered document.
 *
 * Shared by `extension-themes.spec.ts` and `merge-flow.spec.ts`: the first
 * covers the four extensions reachable from a global tab, the second the one
 * that needs a repository mid-merge before its surfaces exist at all.
 *
 * This has to run in a browser. Half the colours in these stylesheets are
 * `rgba()` over an inherited surface or a `color-mix()`, and the value a reader
 * sees is the composite — which no amount of stylesheet parsing produces.
 */

export interface Probe {
  text: string
  selector: string
  ratio: number
  required: number
}

export const CONTRAST_PROBE = `(() => {
  function parse(c) {
    const m = c.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  function over(fg, bg) {
    const a = fg.a
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    }
  }
  function lum({ r, g, b }) {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  function ratio(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  // The composited background behind an element: every translucent layer from
  // the element up, painted onto the first opaque one.
  function backdrop(el) {
    const stack = []
    let node = el
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0) {
        stack.push(bg)
        if (bg.a === 1) break
      }
      node = node.parentElement
    }
    let base = stack.length && stack[stack.length - 1].a === 1
      ? stack.pop()
      : { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }

  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const text = n.textContent.trim()
    if (!text) continue
    const el = n.parentElement
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    if (parseFloat(cs.opacity) < 0.15) continue
    // WCAG 1.4.3 exempts inactive controls, and a disabled control is
    // supposed to look unavailable.
    if (el.closest('[disabled],[aria-disabled="true"]')) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const bg = backdrop(el)
    const composited = over({ ...fg, a: fg.a * parseFloat(cs.opacity) }, bg)
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    // WCAG large text: 18.66px bold, or 24px.
    const large = size >= 24 || (bold && size >= 18.66)
    out.push({
      text: text.slice(0, 40),
      selector: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
      ratio: Math.round(ratio(composited, bg) * 100) / 100,
      required: large ? 3 : 4.5,
    })
  }
  return out
})()`
