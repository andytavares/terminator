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
    fillRect: ctx.fillRect.bind(ctx),
    createRadialGradient: ctx.createRadialGradient.bind(ctx),
    drawImage: (image, dx, dy) => ctx.drawImage(image, dx, dy),
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}
