import type { Paint, PaintGradient } from '../../../src/factory/art/kit.js'

// A recording Paint the art specs assert against instead of a real canvas —
// jsdom has no canvas, and even where it did, reading pixels back out of one
// tells you nothing about *why* a pixel is that colour. Recording the calls
// lets a spec assert the honesty rules directly: this call happened only
// because that crew member was at that seat with that anim.

export type PaintCall =
  | {
      readonly op: 'fillRect'
      readonly x: number
      readonly y: number
      readonly w: number
      readonly h: number
      readonly style: string | PaintGradient
    }
  | { readonly op: 'drawImage'; readonly dx: number; readonly dy: number }

export interface RecordingPaint extends Paint {
  readonly calls: readonly PaintCall[]
}

class Gradient implements PaintGradient {
  readonly stops: [number, string][] = []
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color])
  }
}

export function createRecordingPaint(): RecordingPaint {
  const calls: PaintCall[] = []
  const paint: RecordingPaint = {
    calls,
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect(x, y, w, h) {
      calls.push({ op: 'fillRect', x, y, w, h, style: paint.fillStyle })
    },
    createRadialGradient() {
      return new Gradient()
    },
    drawImage(_image, dx, dy) {
      calls.push({ op: 'drawImage', dx, dy })
    },
  }
  return paint
}
