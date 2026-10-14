import { describe, expect, it } from 'vitest'
import { buildVisibleCubeSpans } from 'minecraft-renderer/src/three/cubeDrawSpans'
import { createCubeMultiDrawScratch, drawCubeSpans } from './rendererCubeMultiDraw'

describe('cube multi-draw after camera culling', () => {
  it('submits every visible range when fragmentation exceeds the initial scratch capacity', () => {
    const scratch = createCubeMultiDrawScratch()
    const initialCapacity = scratch.counts.length
    let submitted = 0
    let expectedSpans: Array<{ start: number, count: number }> = []
    const caps: Parameters<typeof drawCubeSpans>[1] = {
      tier: 'A' as const,
      ext: {
        multiDrawArraysInstancedBaseInstanceWEBGL (mode, firsts, firstsOffset, counts, countsOffset, instanceCounts, instanceCountsOffset, baseInstances, baseInstancesOffset, drawCount) {
          // WebGL rejects the entire draw when any argument array is too short.
          for (const array of [firsts, counts, instanceCounts, baseInstances]) {
            expect(array.length).toBeGreaterThanOrEqual(drawCount)
          }
          expect(drawCount).toBe(expectedSpans.length)
          for (let i = 0; i < drawCount; i++) {
            expect(firsts[i]).toBe(0)
            expect(counts[i]).toBe(6)
            expect(instanceCounts[i]).toBe(expectedSpans[i].count)
            expect(baseInstances[i]).toBe(expectedSpans[i].start)
          }
          submitted++
        }
      }
    }
    // Different camera angles expose different disjoint ranges. Exercise
    // growth, reuse after shrinking, and a second growth of the same scratch.
    for (const count of [initialCapacity + 1, 3, initialCapacity * 2 + 1]) {
      const slots = Array.from({ length: count }, (_, i) => ({ start: i * 3, count: 1 }))
      expectedSpans = buildVisibleCubeSpans(slots, count * 3)
      expect(expectedSpans.length).toBe(count)
      drawCubeSpans({ TRIANGLES: 4 } as WebGL2RenderingContext, caps, expectedSpans, scratch)
    }
    expect(submitted).toBe(3)
  })
})
