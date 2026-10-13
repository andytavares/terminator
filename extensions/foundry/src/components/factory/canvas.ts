import type { Paint, PaintGradient } from '../../factory/art/kit.js'

/** The art kit's drawing surface over a real canvas context. */
export function toPaint(ctx: CanvasRenderingContext2D): Paint {
  return {
    get fillStyle() {
      return ctx.fillStyle as unknown as string
    },
    set fillStyle(value: string | PaintGradient) {
      ctx.fillStyle = value as unknown as string
    },
    get globalCompositeOperation() {
      return ctx.globalCompositeOperation
    },
    set globalCompositeOperation(value: string) {
      ctx.globalCompositeOperation = value as GlobalCompositeOperation
    },
    fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) =>
      ctx.createRadialGradient(x0, y0, r0, x1, y1, r1),
    drawImage: (image, dx, dy) => ctx.drawImage(image, dx, dy),
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}
